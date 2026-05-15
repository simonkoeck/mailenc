import * as openpgp from "openpgp";

import type { Env } from "../env.js";
import { getBotPublicKey, getBotPublicKeyBytes } from "../pgp/bot-key.js";
import { isToken } from "../util/token.js";
import { wkdHash } from "../util/zbase32.js";

let cachedHash: string | null = null;

async function expectedHash(localpart: string): Promise<string> {
  if (cachedHash) return cachedHash;
  cachedHash = await wkdHash(localpart);
  return cachedHash;
}

async function sessionPublicKeyBytes(env: Env, token: string): Promise<Uint8Array | null> {
  const id = env.SESSION.idFromName(token);
  const stub = env.SESSION.get(id);
  const res = await stub.fetch("https://do/public-key");
  if (!res.ok) return null;
  const armored = await res.text();
  if (!armored.includes("BEGIN PGP PUBLIC KEY")) return null;
  try {
    const key = await openpgp.readKey({ armoredKey: armored });
    return key.write();
  } catch {
    return null;
  }
}

export function handlePolicy(): Response {
  return new Response("", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function handleBotKeyDownload(env: Env): Promise<Response> {
  try {
    const key = await getBotPublicKey(env);
    const armored = key.armor();
    const filename = `${env.BOT_LOCALPART}-${env.EMAIL_DOMAIN}.asc`;
    return new Response(armored, {
      status: 200,
      headers: {
        "Content-Type": "application/pgp-keys; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(
      `bot key unavailable: ${err instanceof Error ? err.message : String(err)}`,
      { status: 503 }
    );
  }
}

function readLocalpartFromQuery(search: string, fallback: string): string {
  const match = search.match(/[?&]l=([^&#]*)/);
  if (!match || match[1] === undefined) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return fallback;
  }
}

export async function handleWkdHu(
  env: Env,
  hash: string,
  url: URL
): Promise<Response> {
  const localpart = readLocalpartFromQuery(url.search, env.BOT_LOCALPART).toLowerCase();

  const staticHash = await expectedHash(env.BOT_LOCALPART);
  if (hash === staticHash && localpart === env.BOT_LOCALPART.toLowerCase()) {
    try {
      const bytes = await getBotPublicKeyBytes(env);
      return wkdResponse(bytes);
    } catch (err) {
      return new Response(
        `bot key unavailable: ${err instanceof Error ? err.message : String(err)}`,
        { status: 503 }
      );
    }
  }

  const prefix = `${env.BOT_LOCALPART.toLowerCase()}+`;
  if (localpart.startsWith(prefix)) {
    const token = localpart.slice(prefix.length);
    if (!isToken(token)) return new Response("not found", { status: 404 });
    const expectedSessionHash = await wkdHash(localpart);
    if (hash !== expectedSessionHash) {
      return new Response("not found", { status: 404 });
    }
    const bytes = await sessionPublicKeyBytes(env, token);
    if (!bytes) return new Response("not found", { status: 404 });
    return wkdResponse(bytes);
  }

  return new Response("not found", { status: 404 });
}

function wkdResponse(bytes: Uint8Array): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
