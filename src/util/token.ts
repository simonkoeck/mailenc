const TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 8;

export function newToken(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return out;
}

const VALID = new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`);

export function isToken(s: string): boolean {
  return VALID.test(s);
}
