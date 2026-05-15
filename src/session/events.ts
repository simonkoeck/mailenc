export type AttemptSummary = {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
};

export type SessionEvent =
  | { kind: "session-created"; at: number; address: string }
  | { kind: "email-received"; at: number; from: string; subject: string }
  | { kind: "encryption-detected"; at: number; protocol: "pgp-mime" | "inline" }
  | { kind: "encryption-missing"; at: number }
  | { kind: "decrypted"; at: number; signatureKeyIDs: string[] }
  | { kind: "decrypt-failed"; at: number; reason: string }
  | {
      kind: "wkd-result";
      at: number;
      advanced: AttemptSummary;
      direct: AttemptSummary;
      fingerprint?: string;
    }
  | {
      kind: "autocrypt-result";
      at: number;
      found: boolean;
      reason?: string;
      fingerprint?: string;
    }
  | {
      kind: "hkps-result";
      at: number;
      url: string;
      found: boolean;
      reason?: string;
      fingerprint?: string;
    }
  | { kind: "key-picked"; at: number; source: string; fingerprint: string; detail: string }
  | { kind: "no-key-found"; at: number }
  | { kind: "signature-verified"; at: number; fingerprint: string }
  | { kind: "signature-unverified"; at: number; reason: string }
  | { kind: "reply-sent"; at: number; encrypted: boolean }
  | { kind: "done"; at: number };

export type SessionStatus = "awaiting" | "processing" | "done" | "expired";

export type SessionState = {
  token: string;
  address: string;
  status: SessionStatus;
  createdAt: number;
  expiresAt: number;
  events: SessionEvent[];
};
