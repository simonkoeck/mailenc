export interface Env {
  ASSETS: Fetcher;
  EMAIL: SendEmail;
  SESSION: DurableObjectNamespace;
  EMAIL_DOMAIN: string;
  BOT_LOCALPART: string;
  BOT_PGP_PRIVATE: string;
  BOT_PGP_PUBLIC: string;
}
