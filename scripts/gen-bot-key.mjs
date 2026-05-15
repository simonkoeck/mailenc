#!/usr/bin/env node
import * as openpgp from "openpgp";

const args = {};
for (const a of process.argv.slice(2)) {
  if (!a.startsWith("--")) continue;
  const eq = a.indexOf("=");
  if (eq === -1) continue;
  args[a.slice(2, eq)] = a.slice(eq + 1);
}

const domain = args.domain ?? process.env.EMAIL_DOMAIN ?? "mailenc.org";
const localpart = args.localpart ?? "echo";
const name = args.name ?? "Email Encryption Test Bot";
const email = `${localpart}@${domain}`;

console.error(`Generating Ed25519 + Curve25519 keypair for <${email}>…`);

const { privateKey, publicKey } = await openpgp.generateKey({
  type: "ecc",
  curve: "curve25519Legacy",
  userIDs: [{ name, email }],
  format: "armored",
});

console.log("=== BOT_PGP_PUBLIC (paste into wrangler.jsonc vars) ===");
console.log(publicKey);
console.log("=== BOT_PGP_PRIVATE (use: wrangler secret put BOT_PGP_PRIVATE) ===");
console.log(privateKey);
console.error("Done. Store the private key as a Worker Secret.");
