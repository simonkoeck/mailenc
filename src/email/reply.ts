export type ReplyHeaders = {
  from: string;
  to: string;
  subject: string;
  inReplyTo?: string;
  references?: string;
};

function stripCtl(s: string): string {
  return s.replace(/[\r\n\0\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function encodeSubject(s: string): string {
  const safe = stripCtl(s);
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  const bytes = new TextEncoder().encode(safe);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

function commonHeaders(h: ReplyHeaders, fromDomain: string): string[] {
  const messageId = `<${crypto.randomUUID()}@${stripCtl(fromDomain)}>`;
  const date = new Date().toUTCString();
  const lines = [
    `Message-ID: ${messageId}`,
    `Date: ${date}`,
    `From: ${stripCtl(h.from)}`,
    `To: ${stripCtl(h.to)}`,
    `Subject: ${encodeSubject(h.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (h.inReplyTo) lines.push(`In-Reply-To: ${stripCtl(h.inReplyTo)}`);
  if (h.references) lines.push(`References: ${stripCtl(h.references)}`);
  return lines;
}

export function buildPlainReply(h: ReplyHeaders, body: string, fromDomain: string): string {
  return [
    ...commonHeaders(h, fromDomain),
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

export function buildPgpMimeReply(
  h: ReplyHeaders,
  encryptedArmored: string,
  fromDomain: string
): string {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, "")}`;
  return [
    ...commonHeaders(h, fromDomain),
    `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${boundary}"`,
    "",
    "This is an OpenPGP/MIME encrypted message (RFC 3156).",
    "",
    `--${boundary}`,
    "Content-Type: application/pgp-encrypted",
    "Content-Description: PGP/MIME version identification",
    "",
    "Version: 1",
    "",
    `--${boundary}`,
    'Content-Type: application/octet-stream; name="encrypted.asc"',
    "Content-Description: OpenPGP encrypted message",
    'Content-Disposition: inline; filename="encrypted.asc"',
    "",
    encryptedArmored,
    "",
    `--${boundary}--`,
  ].join("\r\n");
}
