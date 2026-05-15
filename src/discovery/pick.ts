import type {
  AutocryptResult,
  DiscoveryBundle,
  HkpsResult,
  PickedKey,
  WkdResult,
} from "./types.js";

export function pickKey(
  wkd: WkdResult,
  autocrypt: AutocryptResult,
  hkps: HkpsResult
): PickedKey | null {
  if (wkd.advanced.ok && wkd.advanced.bytes) {
    return {
      source: "wkd-advanced",
      bytes: wkd.advanced.bytes,
      detail: wkd.advanced.url,
    };
  }
  if (wkd.direct.ok && wkd.direct.bytes) {
    return {
      source: "wkd-direct",
      bytes: wkd.direct.bytes,
      detail: wkd.direct.url,
    };
  }
  if (autocrypt.found && autocrypt.bytes) {
    return {
      source: "autocrypt",
      bytes: autocrypt.bytes,
      detail: `Autocrypt: addr=${autocrypt.addr}`,
    };
  }
  if (hkps.found && hkps.armored) {
    return {
      source: "hkps",
      armored: hkps.armored,
      detail: hkps.url,
    };
  }
  return null;
}

export function bundle(
  wkd: WkdResult,
  autocrypt: AutocryptResult,
  hkps: HkpsResult
): DiscoveryBundle {
  return { wkd, autocrypt, hkps, picked: pickKey(wkd, autocrypt, hkps) };
}
