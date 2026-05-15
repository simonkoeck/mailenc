import { wkdHash } from "../util/zbase32.js";
import type { WkdAttempt, WkdResult } from "./types.js";

const FETCH_TIMEOUT_MS = 5000;
const MAX_KEY_BYTES = 256 * 1024;

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export async function wkdUrls(email: string): Promise<{ advanced: string; direct: string }> {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) {
    throw new Error("invalid email: no localpart/domain");
  }
  const localpart = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    throw new Error(`invalid sender domain: ${domain.slice(0, 64)}`);
  }
  if (domain.length > 253) {
    throw new Error("sender domain too long");
  }
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
  let urls: { advanced: string; direct: string };
  try {
    urls = await wkdUrls(email);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      advanced: { url: "", ok: false, error },
      direct: { url: "", ok: false, error },
    };
  }
  const [a, d] = await Promise.all([fetchKey(urls.advanced), fetchKey(urls.direct)]);
  return { advanced: a, direct: d };
}
