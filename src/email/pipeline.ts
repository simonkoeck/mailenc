import { EmailMessage } from "cloudflare:email";
import * as openpgp from "openpgp";

import type { Env } from "../env.js";
import { parseAutocrypt } from "../discovery/autocrypt.js";
import { hkpsLookup } from "../discovery/hkps.js";
import { wkdLookup } from "../discovery/wkd.js";
import { bundle } from "../discovery/pick.js";
import type { DiscoveryBundle } from "../discovery/types.js";
import { getBotPrivateKey, getBotPublicKey } from "../pgp/bot-key.js";
import { decryptArmored, verifyEmbeddedSignature } from "../pgp/decrypt.js";
import { encryptAndSign } from "../pgp/encrypt.js";
import type { KeySummary } from "../pgp/inspect.js";
import { summarizeKey } from "../pgp/inspect.js";
import type { SessionEvent } from "../session/events.js";
import {
  type ParsedEmail,
  extractTokenFromAddress,
  findEncryptedPayload,
  headersToArray,
  parseRaw,
} from "./parse.js";
import { buildPgpMimeReply, buildPlainReply, type ReplyHeaders } from "./reply.js";
import { buildMarkdownReport, type ReportInput } from "./report.js";

type Sink = (ev: SessionEvent) => Promise<void>;

function makeSink(env: Env, token: string | null): Sink {
  if (!token) return async () => {};
  const id = env.SESSION.idFromName(token);
  const stub = env.SESSION.get(id);
  return async (ev) => {
    try {
      await stub.fetch("https://do/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ev),
      });
    } catch {}
  };
}

async function loadSessionPrivateKey(
  env: Env,
  token: string
): Promise<openpgp.PrivateKey | null> {
  const id = env.SESSION.idFromName(token);
  const stub = env.SESSION.get(id);
  const res = await stub.fetch("https://do/private-key");
  if (!res.ok) return null;
  const armored = await res.text();
  if (!armored.includes("BEGIN PGP PRIVATE KEY")) return null;
  try {
    return await openpgp.readPrivateKey({ armoredKey: armored });
  } catch {
    return null;
  }
}

async function loadDecryptionKey(
  env: Env,
  token: string | null
): Promise<openpgp.PrivateKey> {
  if (token) {
    const sessionKey = await loadSessionPrivateKey(env, token);
    if (sessionKey) return sessionKey;
  }
  return await getBotPrivateKey(env);
}

export async function handleIncoming(
  message: ForwardableEmailMessage,
  env: Env
): Promise<void> {
  const parsed = await parseRaw(message.raw);
  const headers = headersToArray(parsed);
  const sender = parsed.from?.address ?? message.from;
  const recipient = incomingBotAddress(parsed, message);
  const subject = parsed.subject ?? "(no subject)";
  const token = extractTokenFromAddress(recipient, env.BOT_LOCALPART);
  const emit = makeSink(env, token);

  await emit({
    kind: "email-received",
    at: Date.now(),
    from: sender,
    subject,
  });

  const payload = findEncryptedPayload(parsed);
  if (!payload) {
    await emit({ kind: "encryption-missing", at: Date.now() });
    await sendPlaintextReply(
      message,
      env,
      parsed,
      "We didn't see a PGP-encrypted body. Please send your test message as PGP/MIME (multipart/encrypted with protocol=application/pgp-encrypted) or with an inline -----BEGIN PGP MESSAGE----- block, and try again."
    );
    await emit({ kind: "reply-sent", at: Date.now(), encrypted: false });
    await emit({ kind: "done", at: Date.now() });
    return;
  }
  await emit({
    kind: "encryption-detected",
    at: Date.now(),
    protocol: payload.protocol,
  });

  const botPriv = await loadDecryptionKey(env, token);

  let decryptOk = false;
  let decryptReason: string | undefined;
  let embeddedKeyIDs: string[] = [];
  try {
    const r = await decryptArmored(payload.armored, botPriv);
    embeddedKeyIDs = r.signatureKeyIDs;
    decryptOk = true;
    await emit({
      kind: "decrypted",
      at: Date.now(),
      signatureKeyIDs: r.signatureKeyIDs,
    });
  } catch (err) {
    decryptReason = err instanceof Error ? err.message : String(err);
    await emit({
      kind: "decrypt-failed",
      at: Date.now(),
      reason: decryptReason,
    });
  }

  const discovery = await runDiscovery(sender, headers, emit);

  let pickedSummary: KeySummary | null = null;
  let signature: { verified: boolean; reason?: string } | null = null;
  if (discovery.picked) {
    try {
      const key = discovery.picked.armored
        ? await openpgp.readKey({ armoredKey: discovery.picked.armored })
        : await openpgp.readKey({ binaryKey: discovery.picked.bytes! });
      pickedSummary = await summarizeKey(key);
      await emit({
        kind: "key-picked",
        at: Date.now(),
        source: discovery.picked.source,
        fingerprint: pickedSummary.fingerprint,
        detail: discovery.picked.detail,
      });
      if (decryptOk && embeddedKeyIDs.length > 0) {
        const verifyRes = await verifyEmbeddedSignature(payload.armored, botPriv, key);
        signature = verifyRes;
        if (verifyRes.verified) {
          await emit({
            kind: "signature-verified",
            at: Date.now(),
            fingerprint: pickedSummary.fingerprint,
          });
        } else {
          await emit({
            kind: "signature-unverified",
            at: Date.now(),
            reason: verifyRes.reason ?? "unknown",
          });
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await emit({
        kind: "no-key-found",
        at: Date.now(),
        reason: `picked ${discovery.picked.source} key would not parse: ${reason}`,
      });
      pickedSummary = null;
    }
  } else {
    await emit({
      kind: "no-key-found",
      at: Date.now(),
      reason: "no discovery source returned a usable key",
    });
  }

  const reportInput: ReportInput = {
    greetingName: parsed.from?.name ?? "",
    botAddress: recipient,
    encryption: { detected: true, protocol: payload.protocol },
    decrypt: {
      ok: decryptOk,
      reason: decryptReason,
      embeddedSignatureKeyIDs: embeddedKeyIDs,
    },
    discovery,
    pickedKey: pickedSummary,
    signature,
    reply: { encrypted: !!(discovery.picked && pickedSummary) },
  };
  const reportText = buildMarkdownReport(reportInput);

  try {
    if (discovery.picked && pickedSummary) {
      const recipientKey = discovery.picked.armored
        ? await openpgp.readKey({ armoredKey: discovery.picked.armored })
        : await openpgp.readKey({ binaryKey: discovery.picked.bytes! });
      let encryptedArmored: string | null = null;
      let encryptError: string | undefined;
      try {
        encryptedArmored = await encryptAndSign(reportText, recipientKey, botPriv);
      } catch (err) {
        encryptError = err instanceof Error ? err.message : String(err);
      }
      if (encryptedArmored) {
        await sendEncryptedReply(message, env, parsed, encryptedArmored);
        await emit({ kind: "reply-sent", at: Date.now(), encrypted: true });
      } else {
        await sendPlaintextReply(
          message,
          env,
          parsed,
          `${reportText}\n\n(We tried to encrypt this reply but failed: ${encryptError})`
        );
        await emit({ kind: "reply-sent", at: Date.now(), encrypted: false });
      }
    } else {
      await sendPlaintextReply(
        message,
        env,
        parsed,
        `${reportText}\n\n(No usable key was discoverable for your address, so this reply is in plaintext.)`
      );
      await emit({ kind: "reply-sent", at: Date.now(), encrypted: false });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("reply failed:", reason);
    await emit({ kind: "reply-failed", at: Date.now(), reason });
  }

  await emit({ kind: "done", at: Date.now() });
}

async function runDiscovery(
  sender: string,
  headers: { key: string; value: string }[],
  emit: Sink
): Promise<DiscoveryBundle> {
  const [wkd, autocrypt, hkps] = await Promise.all([
    wkdLookup(sender),
    parseAutocrypt(headers, sender),
    hkpsLookup(sender),
  ]);

  const wkdEvent = {
    kind: "wkd-result" as const,
    at: Date.now(),
    advanced: attemptSummary(wkd.advanced),
    direct: attemptSummary(wkd.direct),
  };
  await emit(wkdEvent);

  await emit({
    kind: "autocrypt-result",
    at: Date.now(),
    found: autocrypt.found,
    reason: autocrypt.reason,
  });
  await emit({
    kind: "hkps-result",
    at: Date.now(),
    url: hkps.url,
    found: hkps.found,
    reason: hkps.reason,
  });

  return bundle(wkd, autocrypt, hkps);
}

function attemptSummary(a: import("../discovery/types.js").WkdAttempt) {
  return { url: a.url, ok: a.ok, status: a.status, error: a.error };
}

function buildReplyHeaders(
  parsed: ParsedEmail,
  botFrom: string,
  replyRecipient: string
): ReplyHeaders {
  const inReplyTo = headerValue(parsed, "Message-ID") || undefined;
  const refsExisting = headerValue(parsed, "References");
  const references = refsExisting && inReplyTo
    ? `${refsExisting} ${inReplyTo}`
    : inReplyTo;
  const subject = `Re: ${parsed.subject ?? "Email Encryption Test"}`;
  return {
    from: botFrom,
    to: replyRecipient,
    subject,
    inReplyTo,
    references,
  };
}

function headerValue(parsed: ParsedEmail, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const h of parsed.headers ?? []) {
    if (h.key?.toLowerCase() === want) return h.value;
  }
  return undefined;
}

function addressOf(a: ParsedEmail["from"]): string | undefined {
  if (!a) return undefined;
  if ("address" in a && typeof a.address === "string") return a.address;
  const firstGroupAddress = a.group?.find((m) => m.address)?.address;
  return firstGroupAddress || undefined;
}

function firstAddressOf(addrs: ParsedEmail["replyTo"]): string | undefined {
  for (const a of addrs ?? []) {
    const addr = addressOf(a);
    if (addr) return addr;
  }
  return undefined;
}

function replyRecipient(parsed: ParsedEmail, message: ForwardableEmailMessage): string {
  return firstAddressOf(parsed.replyTo) ?? addressOf(parsed.from) ?? message.from;
}

function incomingBotAddress(parsed: ParsedEmail, message: ForwardableEmailMessage): string {
  return firstAddressOf(parsed.to) ?? message.to;
}

async function sendPlaintextReply(
  message: ForwardableEmailMessage,
  env: Env,
  parsed: ParsedEmail,
  body: string
): Promise<void> {
  const botFrom = incomingBotAddress(parsed, message);
  const to = replyRecipient(parsed, message);
  const h = buildReplyHeaders(parsed, botFrom, to);
  const raw = buildPlainReply(h, body, env.EMAIL_DOMAIN);
  const reply = new EmailMessage(botFrom, to, raw);
  await env.EMAIL.send(reply);
}

async function sendEncryptedReply(
  message: ForwardableEmailMessage,
  env: Env,
  parsed: ParsedEmail,
  encryptedArmored: string
): Promise<void> {
  const botFrom = incomingBotAddress(parsed, message);
  const to = replyRecipient(parsed, message);
  const h = buildReplyHeaders(parsed, botFrom, to);
  const raw = buildPgpMimeReply(h, encryptedArmored, env.EMAIL_DOMAIN);
  const reply = new EmailMessage(botFrom, to, raw);
  await env.EMAIL.send(reply);
}

// Avoid unused-import warning during isolated-module compilation
void getBotPublicKey;
