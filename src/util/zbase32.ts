const ALPHABET = "ybndrfg8ejkmcpqxot1uwisza345h769";

export function zbase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export async function wkdHash(localpart: string): Promise<string> {
  const normalized = localpart.toLowerCase();
  const buf = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return zbase32(new Uint8Array(digest));
}
