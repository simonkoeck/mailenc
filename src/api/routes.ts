import type { Env } from "../env.js";
import {
  createSession,
  getSessionPublicKey,
  getSessionState,
  openSessionStream,
} from "./session.js";
import { handleBotKeyDownload, handlePolicy, handleWkdHu } from "./wkd-serve.js";

const SESSION_STREAM = /^\/api\/session\/([a-z0-9]+)\/stream$/;
const SESSION_KEY = /^\/api\/session\/([a-z0-9]+)\/key\.asc$/;
const SESSION_STATE = /^\/api\/session\/([a-z0-9]+)$/;
const WKD_HU = /^\/\.well-known\/openpgpkey\/hu\/([a-z0-9]+)$/;

export async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method === "POST" && path === "/api/session") {
    return await createSession(env);
  }

  const streamMatch = SESSION_STREAM.exec(path);
  if (method === "GET" && streamMatch) {
    return await openSessionStream(env, streamMatch[1]!);
  }

  const keyMatch = SESSION_KEY.exec(path);
  if (method === "GET" && keyMatch) {
    return await getSessionPublicKey(env, keyMatch[1]!);
  }

  const stateMatch = SESSION_STATE.exec(path);
  if (method === "GET" && stateMatch) {
    return await getSessionState(env, stateMatch[1]!);
  }

  if (method === "GET" && path === "/.well-known/openpgpkey/policy") {
    return handlePolicy();
  }

  if (method === "GET" && path === "/bot-key.asc") {
    return await handleBotKeyDownload(env);
  }

  const wkdMatch = WKD_HU.exec(path);
  if (method === "GET" && wkdMatch) {
    return await handleWkdHu(env, wkdMatch[1]!, url);
  }

  return await env.ASSETS.fetch(req);
}
