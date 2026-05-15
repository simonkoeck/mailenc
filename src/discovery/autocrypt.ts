import type { AutocryptResult } from "./types.js";

type AutocryptParams = { addr?: string; keydata?: string; preferEncrypt?: string };

function parseHeaderValue(value: string): AutocryptParams {
  const out: AutocryptParams = {};
  const cleaned = value.replace(/\r?\n[ \t]/g, "");
  for (const part of cleaned.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim().toLowerCase();
    const v = part.slice(eq + 1).trim();
    if (k === "addr") out.addr = v.toLowerCase();
    else if (k === "keydata") out.keydata = v.replace(/\s+/g, "");
    else if (k === "prefer-encrypt") out.preferEncrypt = v.toLowerCase();
  }
  return out;
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type RawHeader = { key: string; value: string };

export function parseAutocrypt(headers: RawHeader[], senderAddr: string): AutocryptResult {
  const want = senderAddr.toLowerCase();
  const matches: AutocryptParams[] = [];
  for (const h of headers) {
    if (h.key.toLowerCase() !== "autocrypt") continue;
    const parsed = parseHeaderValue(h.value);
    if (parsed.addr && parsed.addr === want && parsed.keydata) {
      matches.push(parsed);
    }
  }
  if (matches.length === 0) {
    return { found: false, reason: "no Autocrypt header matched sender" };
  }
  const last = matches[matches.length - 1]!;
  try {
    const bytes = base64Decode(last.keydata!);
    return {
      found: true,
      addr: last.addr,
      preferEncrypt: last.preferEncrypt,
      bytes,
    };
  } catch (err) {
    return {
      found: false,
      reason: `base64 decode failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
