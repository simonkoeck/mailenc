import * as openpgp from "openpgp";

export type DecryptOutput = {
  plaintext: string;
  signatureCount: number;
  signatureKeyIDs: string[];
  rawMessage: openpgp.Message<string>;
};

export async function decryptArmored(
  armored: string,
  privateKey: openpgp.PrivateKey
): Promise<DecryptOutput> {
  const message = await openpgp.readMessage({ armoredMessage: armored });
  return await decryptImpl(message, privateKey);
}

export async function decryptBinary(
  bytes: Uint8Array,
  privateKey: openpgp.PrivateKey
): Promise<DecryptOutput> {
  const message = await openpgp.readMessage({ binaryMessage: bytes });
  return await decryptImpl(message, privateKey);
}

async function decryptImpl(
  message: openpgp.Message<Uint8Array | string>,
  privateKey: openpgp.PrivateKey
): Promise<DecryptOutput> {
  const result = await openpgp.decrypt({
    message: message as openpgp.Message<string>,
    decryptionKeys: privateKey,
    format: "utf8",
  });
  const data = typeof result.data === "string" ? result.data : "";
  const keyIDs: string[] = [];
  for (const s of result.signatures) {
    keyIDs.push(s.keyID.toHex());
  }
  return {
    plaintext: data,
    signatureCount: result.signatures.length,
    signatureKeyIDs: keyIDs,
    rawMessage: message as openpgp.Message<string>,
  };
}

export type SignatureCheck = {
  verified: boolean;
  reason?: string;
};

export async function verifyEmbeddedSignature(
  armoredMessage: string,
  decryptionKey: openpgp.PrivateKey,
  verificationKey: openpgp.PublicKey
): Promise<SignatureCheck> {
  try {
    const message = await openpgp.readMessage({ armoredMessage });
    const result = await openpgp.decrypt({
      message,
      decryptionKeys: decryptionKey,
      verificationKeys: verificationKey,
      format: "utf8",
    });
    if (result.signatures.length === 0) {
      return { verified: false, reason: "no signatures inside encrypted payload" };
    }
    try {
      await result.signatures[0]!.verified;
      return { verified: true };
    } catch (err) {
      return {
        verified: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  } catch (err) {
    return {
      verified: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
