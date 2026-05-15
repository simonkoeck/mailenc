import { wkdHash } from "../util/zbase32.js";
import type { WkdAttempt, WkdResult } from "./types.js";

const FETCH_TIMEOUT_MS = 5000;
const MAX_KEY_BYTES = 256 * 1024;

export async function wkdUrls(email: string): Promise<{ advanced: string; direct: string }> {
  const at = email.lastIndexOf("@");
  const localpart = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  const hash = await wkdHash(localpart);
  const l = encodeURIComponent(localpart);
  return {
    advanced: `https://openpgpkey.${domain}/.well-known/openpgpkey/${domain}/hu/${hash}?l=${l}`,
    direct: `https://${domain}/.well-known/openpgpkey/hu/${hash}?l=${l}`,
  };
}

async function fetchKey(url: string): Promise<WkdAttempt> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/octet-stream" },
      redirect: "follow",
    });
    if (!res.ok) {
      return { url, ok: false, status: res.status };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) {
      return { url, ok: false, status: res.status, error: "empty body" };
    }
    if (buf.byteLength > MAX_KEY_BYTES) {
      return { url, ok: false, status: res.status, error: "key too large" };
    }
    return { url, ok: true, status: res.status, bytes: new Uint8Array(buf) };
  } catch (err) {
    return { url, ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function wkdLookup(email: string): Promise<WkdResult> {
  const { advanced, direct } = await wkdUrls(email);
  const [a, d] = await Promise.all([fetchKey(advanced), fetchKey(direct)]);
  return { advanced: a, direct: d };
}
