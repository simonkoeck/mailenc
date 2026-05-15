import * as openpgp from "openpgp";

export type KeySummary = {
  fingerprint: string;
  keyID: string;
  algorithm: string;
  userIDs: string[];
  created: string;
  expires: string | null;
  hasEncryptionSubkey: boolean;
  hasSigningSubkey: boolean;
};

export async function summarizeKey(key: openpgp.Key): Promise<KeySummary> {
  const expiry = await key.getExpirationTime();
  const expires =
    expiry === null
      ? null
      : expiry === Infinity
        ? null
        : expiry instanceof Date
          ? expiry.toISOString()
          : String(expiry);
  let hasEncryptionSubkey = false;
  let hasSigningSubkey = false;
  try {
    await key.getEncryptionKey();
    hasEncryptionSubkey = true;
  } catch {}
  try {
    await key.getSigningKey();
    hasSigningSubkey = true;
  } catch {}
  return {
    fingerprint: key.getFingerprint().toUpperCase(),
    keyID: key.getKeyID().toHex().toUpperCase(),
    algorithm: key.getAlgorithmInfo().algorithm,
    userIDs: key.getUserIDs(),
    created: key.getCreationTime().toISOString(),
    expires,
    hasEncryptionSubkey,
    hasSigningSubkey,
  };
}
