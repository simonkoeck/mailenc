import type { HkpsResult } from "./types.js";

const KEYSERVER = "https://keys.openpgp.org";
const FETCH_TIMEOUT_MS = 5000;
const MAX_KEY_BYTES = 256 * 1024;

export async function hkpsLookup(email: string): Promise<HkpsResult> {
  const url = `${KEYSERVER}/vks/v1/by-email/${encodeURIComponent(email)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/pgp-keys" },
    });
    if (res.status === 404) return { url, found: false, status: 404 };
    if (!res.ok) {
      return { url, found: false, status: res.status, reason: `HTTP ${res.status}` };
    }
    const text = await res.text();
    if (text.length > MAX_KEY_BYTES) {
      return { url, found: false, status: res.status, reason: "key too large" };
    }
    if (!text.includes("BEGIN PGP PUBLIC KEY BLOCK")) {
      return { url, found: false, status: res.status, reason: "not an armored key" };
    }
    return { url, found: true, status: res.status, armored: text };
  } catch (err) {
    return { url, found: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
