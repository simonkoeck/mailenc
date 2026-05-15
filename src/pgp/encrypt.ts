import * as openpgp from "openpgp";

export async function readRecipientKey(opts: {
  armored?: string;
  bytes?: Uint8Array;
}): Promise<openpgp.PublicKey> {
  if (opts.armored) return await openpgp.readKey({ armoredKey: opts.armored });
  if (opts.bytes) return await openpgp.readKey({ binaryKey: opts.bytes });
  throw new Error("readRecipientKey: no key data");
}

export async function encryptAndSign(
  plaintext: string,
  recipient: openpgp.PublicKey,
  signer: openpgp.PrivateKey
): Promise<string> {
  const message = await openpgp.createMessage({ text: plaintext });
  const armored = await openpgp.encrypt({
    message,
    encryptionKeys: recipient,
    signingKeys: signer,
  });
  return typeof armored === "string" ? armored : new TextDecoder().decode(armored);
}

export async function clearsign(
  plaintext: string,
  signer: openpgp.PrivateKey
): Promise<string> {
  const message = await openpgp.createCleartextMessage({ text: plaintext });
  const signed = await openpgp.sign({ message, signingKeys: signer });
  return typeof signed === "string" ? signed : new TextDecoder().decode(signed);
}
