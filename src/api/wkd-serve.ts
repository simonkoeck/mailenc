import type { Env } from "../env.js";
import { getBotPublicKeyBytes } from "../pgp/bot-key.js";
import { wkdHash } from "../util/zbase32.js";

let cachedHash: string | null = null;

async function expectedHash(localpart: string): Promise<string> {
  if (cachedHash) return cachedHash;
  cachedHash = await wkdHash(localpart);
  return cachedHash;
}

export function handlePolicy(): Response {
  return new Response("", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function handleWkdHu(env: Env, hash: string): Promise<Response> {
  const want = await expectedHash(env.BOT_LOCALPART);
  if (hash !== want) return new Response("not found", { status: 404 });
  try {
    const bytes = await getBotPublicKeyBytes(env);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
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
