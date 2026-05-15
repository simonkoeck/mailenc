import * as openpgp from "openpgp";

let cachedPriv: openpgp.PrivateKey | null = null;
let cachedPub: openpgp.PublicKey | null = null;
let cachedPubBytes: Uint8Array | null = null;

export type Env = {
  BOT_PGP_PRIVATE: string;
  BOT_PGP_PUBLIC: string;
};

export async function getBotPrivateKey(env: Env): Promise<openpgp.PrivateKey> {
  if (cachedPriv) return cachedPriv;
  if (!env.BOT_PGP_PRIVATE || env.BOT_PGP_PRIVATE.startsWith("REPLACE_WITH")) {
    throw new Error("BOT_PGP_PRIVATE is not configured");
  }
  cachedPriv = await openpgp.readPrivateKey({ armoredKey: env.BOT_PGP_PRIVATE });
  if (!cachedPriv.isDecrypted()) {
    throw new Error("BOT_PGP_PRIVATE is passphrase-protected; not supported");
  }
  return cachedPriv;
}

export async function getBotPublicKey(env: Env): Promise<openpgp.PublicKey> {
  if (cachedPub) return cachedPub;
  if (!env.BOT_PGP_PUBLIC || env.BOT_PGP_PUBLIC.startsWith("REPLACE_WITH")) {
    throw new Error("BOT_PGP_PUBLIC is not configured");
  }
  cachedPub = await openpgp.readKey({ armoredKey: env.BOT_PGP_PUBLIC });
  return cachedPub;
}

export async function getBotPublicKeyBytes(env: Env): Promise<Uint8Array> {
  if (cachedPubBytes) return cachedPubBytes;
  const key = await getBotPublicKey(env);
  cachedPubBytes = key.write();
  return cachedPubBytes;
}
