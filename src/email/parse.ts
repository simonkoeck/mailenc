import PostalMime from "postal-mime";

export type ParsedEmail = Awaited<ReturnType<PostalMime["parse"]>>;
export type ParsedHeader = { key: string; value: string };

export async function parseRaw(raw: ReadableStream<Uint8Array>): Promise<ParsedEmail> {
  const buf = await new Response(raw).arrayBuffer();
  const parser = new PostalMime();
  return await parser.parse(buf);
}

export type EncryptedPayload = { armored: string; protocol: "pgp-mime" | "inline" };

export function findEncryptedPayload(email: ParsedEmail): EncryptedPayload | null {
  for (const a of email.attachments ?? []) {
    const mt = (a.mimeType || "").toLowerCase();
    if (
      mt === "application/octet-stream" ||
      mt === "application/pgp-encrypted" ||
      a.filename?.endsWith(".asc") ||
      a.filename?.endsWith(".pgp")
    ) {
      const content = a.content;
      let asText: string | null = null;
      if (typeof content === "string") asText = content;
      else if (content) asText = new TextDecoder().decode(new Uint8Array(content as ArrayBuffer));
      if (asText && asText.includes("BEGIN PGP MESSAGE")) {
        const start = asText.indexOf("-----BEGIN PGP MESSAGE-----");
        const end = asText.indexOf("-----END PGP MESSAGE-----");
        if (start !== -1 && end !== -1) {
          return {
            armored: asText.slice(start, end + "-----END PGP MESSAGE-----".length),
            protocol: "pgp-mime",
          };
        }
      }
    }
  }
  const text = email.text ?? "";
  const start = text.indexOf("-----BEGIN PGP MESSAGE-----");
  if (start !== -1) {
    const end = text.indexOf("-----END PGP MESSAGE-----", start);
    if (end !== -1) {
      return {
        armored: text.slice(start, end + "-----END PGP MESSAGE-----".length),
        protocol: "inline",
      };
    }
  }
  return null;
}

export function extractTokenFromAddress(addr: string, localpart: string): string | null {
  const at = addr.indexOf("@");
  if (at === -1) return null;
  const local = addr.slice(0, at).toLowerCase();
  const expected = localpart.toLowerCase();
  if (local === expected) return null;
  const prefix = `${expected}+`;
  if (local.startsWith(prefix)) return local.slice(prefix.length);
  return null;
}

export function headersToArray(email: ParsedEmail): ParsedHeader[] {
  const out: ParsedHeader[] = [];
  for (const h of email.headers ?? []) {
    if (typeof h.key === "string" && typeof h.value === "string") {
      out.push({ key: h.key, value: h.value });
    }
  }
  return out;
}
