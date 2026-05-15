import type { KeySummary } from "../pgp/inspect.js";
import type {
  AutocryptResult,
  DiscoveryBundle,
  HkpsResult,
  PickedKey,
  WkdResult,
} from "../discovery/types.js";

export type ReportInput = {
  greetingName: string;
  botAddress: string;
  encryption: { detected: boolean; protocol?: "pgp-mime" | "inline" };
  decrypt: { ok: boolean; reason?: string; embeddedSignatureKeyIDs: string[] };
  discovery: DiscoveryBundle;
  pickedKey: KeySummary | null;
  signature: { verified: boolean; reason?: string } | null;
  reply: { encrypted: boolean; reason?: string };
};

const ok = "[OK]";
const fail = "[FAIL]";
const info = "[INFO]";

function wkdLine(label: string, attempt: WkdResult["advanced"]): string {
  if (attempt.ok) return `  ${ok} ${label}: 200 (${attempt.url})`;
  if (attempt.status) return `  ${fail} ${label}: HTTP ${attempt.status} (${attempt.url})`;
  if (attempt.error) return `  ${fail} ${label}: ${attempt.error} (${attempt.url})`;
  return `  ${fail} ${label}: unknown (${attempt.url})`;
}

function autocryptLine(a: AutocryptResult): string {
  if (a.found) {
    return `  ${ok} Autocrypt header present (addr=${a.addr}${a.preferEncrypt ? `, prefer-encrypt=${a.preferEncrypt}` : ""})`;
  }
  return `  ${fail} Autocrypt header: ${a.reason ?? "not found"}`;
}

function hkpsLine(h: HkpsResult): string {
  if (h.found) return `  ${ok} HKPS keys.openpgp.org: found (${h.url})`;
  return `  ${fail} HKPS keys.openpgp.org: ${h.reason ?? `HTTP ${h.status}`} (${h.url})`;
}

function pickedLine(p: PickedKey | null, summary: KeySummary | null): string {
  if (!p || !summary)
    return `  ${fail} No usable key for sender. We can't send an encrypted reply.`;
  return `  ${ok} Picked: ${p.source}  fp=${summary.fingerprint}  uids=${summary.userIDs.join(", ")}`;
}

export function buildMarkdownReport(input: ReportInput): string {
  const { encryption, decrypt, discovery, pickedKey, signature, reply, botAddress, greetingName } = input;

  const lines: string[] = [];
  lines.push(`Email Encryption Test — Report`);
  lines.push(`==============================`);
  lines.push("");
  lines.push(
    `Hi${greetingName ? ` ${greetingName}` : ""}, thanks for testing against ${botAddress}.`
  );
  lines.push("This report runs end-to-end on a Cloudflare Worker. Everything below is what I observed about your message.");
  lines.push("");

  lines.push(`[1] Encryption to me`);
  lines.push(
    encryption.detected
      ? `  ${ok} Detected: ${encryption.protocol}`
      : `  ${fail} No PGP-encrypted payload detected. Please send as PGP/MIME or with an inline PGP MESSAGE block.`
  );
  if (encryption.detected) {
    lines.push(
      decrypt.ok
        ? `  ${ok} Decrypted with my key`
        : `  ${fail} Decrypt failed: ${decrypt.reason ?? "unknown"}`
    );
    lines.push(
      decrypt.embeddedSignatureKeyIDs.length
        ? `  ${info} Embedded signatures: ${decrypt.embeddedSignatureKeyIDs.join(", ")}`
        : `  ${info} No embedded signatures`
    );
  }
  lines.push("");

  lines.push(`[2] Sender key autodiscovery`);
  lines.push(`  WKD:`);
  lines.push(wkdLine("advanced", discovery.wkd.advanced));
  lines.push(wkdLine("direct  ", discovery.wkd.direct));
  lines.push(autocryptLine(discovery.autocrypt));
  lines.push(hkpsLine(discovery.hkps));
  lines.push("");

  lines.push(`[3] Reply key selection`);
  lines.push(pickedLine(discovery.picked, pickedKey));
  if (pickedKey) {
    lines.push(`        algorithm: ${pickedKey.algorithm}`);
    lines.push(`        keyID:     ${pickedKey.keyID}`);
    lines.push(`        created:   ${pickedKey.created}`);
    lines.push(
      `        expires:   ${pickedKey.expires ?? "never"}`
    );
    lines.push(
      `        capabilities: ${[
        pickedKey.hasEncryptionSubkey ? "encrypt" : null,
        pickedKey.hasSigningSubkey ? "sign" : null,
      ]
        .filter(Boolean)
        .join(" + ") || "none"}`
    );
  }
  lines.push("");

  lines.push(`[4] Signature on your message`);
  if (!signature) {
    lines.push(`  ${info} Skipped (no message to verify or no sender key found)`);
  } else if (signature.verified) {
    lines.push(`  ${ok} Signature verified against your discovered key`);
  } else {
    lines.push(`  ${fail} Could not verify: ${signature.reason ?? "no signature"}`);
  }
  lines.push("");

  lines.push(`[5] This reply`);
  lines.push(
    reply.encrypted
      ? `  ${ok} Encrypted to your key and signed by me.`
      : `  ${fail} Sent in plaintext. ${reply.reason ?? ""}`
  );
  lines.push("");

  lines.push(`— Email Encryption Test`);
  lines.push("");
  lines.push(`--- JSON ---`);
  lines.push(JSON.stringify(toJsonAppendix(input), null, 2));
  return lines.join("\n");
}

function toJsonAppendix(input: ReportInput) {
  return {
    encryption: input.encryption,
    decrypt: {
      ok: input.decrypt.ok,
      reason: input.decrypt.reason,
      embeddedSignatureKeyIDs: input.decrypt.embeddedSignatureKeyIDs,
    },
    wkd: {
      advanced: summariseAttempt(input.discovery.wkd.advanced),
      direct: summariseAttempt(input.discovery.wkd.direct),
    },
    autocrypt: {
      found: input.discovery.autocrypt.found,
      addr: input.discovery.autocrypt.addr,
      preferEncrypt: input.discovery.autocrypt.preferEncrypt,
      reason: input.discovery.autocrypt.reason,
    },
    hkps: {
      url: input.discovery.hkps.url,
      found: input.discovery.hkps.found,
      reason: input.discovery.hkps.reason,
    },
    picked: input.discovery.picked
      ? {
          source: input.discovery.picked.source,
          detail: input.discovery.picked.detail,
          fingerprint: input.pickedKey?.fingerprint,
        }
      : null,
    signature: input.signature,
    reply: input.reply,
  };
}

function summariseAttempt(a: WkdResult["advanced"]) {
  return { url: a.url, ok: a.ok, status: a.status, error: a.error };
}
