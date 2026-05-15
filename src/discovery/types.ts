export type WkdAttempt = {
  url: string;
  ok: boolean;
  status?: number;
  bytes?: Uint8Array;
  error?: string;
};

export type WkdResult = {
  advanced: WkdAttempt;
  direct: WkdAttempt;
};

export type AutocryptResult = {
  found: boolean;
  addr?: string;
  preferEncrypt?: string;
  bytes?: Uint8Array;
  reason?: string;
};

export type HkpsResult = {
  url: string;
  found: boolean;
  status?: number;
  armored?: string;
  reason?: string;
};

export type DiscoverySource =
  | "wkd-advanced"
  | "wkd-direct"
  | "autocrypt"
  | "hkps";

export type PickedKey = {
  source: DiscoverySource;
  armored?: string;
  bytes?: Uint8Array;
  detail: string;
};

export type DiscoveryBundle = {
  wkd: WkdResult;
  autocrypt: AutocryptResult;
  hkps: HkpsResult;
  picked: PickedKey | null;
};
