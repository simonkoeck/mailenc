import type { Env } from "../env.js";
import { isToken, newToken } from "../util/token.js";

function sessionStub(env: Env, token: string) {
  const id = env.SESSION.idFromName(token);
  return env.SESSION.get(id);
}

export async function createSession(env: Env): Promise<Response> {
  const token = newToken();
  const stub = sessionStub(env, token);
  const initRes = await stub.fetch("https://do/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!initRes.ok) {
    return Response.json(
      { error: "init failed", detail: await initRes.text() },
      { status: 500 }
    );
  }
  const address = `${env.BOT_LOCALPART}+${token}@${env.EMAIL_DOMAIN}`;
  return Response.json({ token, address });
}

export async function getSessionState(env: Env, token: string): Promise<Response> {
  if (!isToken(token)) return new Response("bad token", { status: 400 });
  const stub = sessionStub(env, token);
  return await stub.fetch("https://do/state");
}

export async function openSessionStream(env: Env, token: string): Promise<Response> {
  if (!isToken(token)) return new Response("bad token", { status: 400 });
  const stub = sessionStub(env, token);
  return await stub.fetch("https://do/stream");
}

export async function getSessionPublicKey(env: Env, token: string): Promise<Response> {
  if (!isToken(token)) return new Response("bad token", { status: 400 });
  const stub = sessionStub(env, token);
  const res = await stub.fetch("https://do/public-key");
  if (!res.ok) return new Response("not found", { status: 404 });
  const armored = await res.text();
  return new Response(armored, {
    status: 200,
    headers: {
      "Content-Type": "application/pgp-keys; charset=utf-8",
      "Content-Disposition": `attachment; filename="mailenc-echo-${token}.asc"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}
