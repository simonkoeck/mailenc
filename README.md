📨 **mailenc**

A little tool that tells you whether your PGP email setup actually works end to end.

You visit the site, get a one-shot address like `echo+ab12cd34@mailenc.org`, and send a PGP-encrypted email to it from whatever client you normally use. The verification streams live to the page while it runs. A couple of seconds later you get an encrypted echo reply, encrypted to whatever public key the bot could find for you (via WKD, Autocrypt, or HKPS), signed by the bot.

So instead of wondering if you set everything up right, you just send a real email and get a real answer.

## How sessions work

Every time you open the site, the worker generates a fresh PGP keypair just for your visit and publishes the public half over WKD at the matching `echo+<token>@mailenc.org` address. That means your mail client's normal "discover keys online" flow works without any extra setup: it queries `mailenc.org`, finds a key with a UID that matches the recipient, and lets you encrypt.

The token also doubles as your session id. It lives in the URL hash, so reloading the page brings you back to the same address with the same event log. Click "↻ new address" to throw the old session away and mint a new one.

Static `echo@mailenc.org` also works if you do not want the live page, with the bot's long-lived key at `/bot-key.asc`.

## What gets checked

When your email lands, the bot walks through:

- whether the envelope is PGP/MIME or inline PGP at all
- whether it can decrypt with the session's private key (or the static bot key for non-tokenised addresses)
- whether the message was signed inside the encrypted payload
- whether your domain publishes a key via WKD (both the advanced and direct paths)
- whether the `Autocrypt:` header is set on the message
- whether keys.openpgp.org has a key for your address
- which of those sources it ended up using to encrypt the reply
- whether the embedded signature verifies against that key

Each discovery source is validated by actually parsing the returned bytes as an OpenPGP key. A server that returns `HTTP 200 "Nothing here"` for a WKD path counts as a miss, not a hit. If more than one source has a real key, the bot prefers WKD, then Autocrypt, then HKPS. If nothing usable turns up, the reply goes back in plaintext with a short note explaining why.

## Stack

One Cloudflare Worker does everything. The `fetch` handler serves the site, a small JSON API, the per-session WKD endpoint, and the static bot key. The `email` handler receives incoming mail through Cloudflare Email Routing and runs the pipeline. There's a Durable Object per session that holds the keypair, the event log, and the SSE fan-out to your browser tab. Crypto is `openpgp` 6.x (legacy Curve25519 keys for GnuPG 2.4 / Thunderbird RNP interop), MIME parsing is `postal-mime`. The frontend is plain HTML, CSS and JS with no build step.

## Running it locally

```
pnpm install
pnpm typecheck
pnpm dev
```

The site runs at http://127.0.0.1:8788. Local dev only exercises the HTTP side, since Cloudflare Email Routing only delivers mail to deployed Workers.

Per-session keys generate themselves automatically on each `/api/session` call. If you also want the static bot key (`echo@mailenc.org`, `/bot-key.asc`, WKD for `echo`), generate one:

```
node scripts/gen-bot-key.mjs --domain=mailenc.org --localpart=echo
```

Drop the output into `.dev.vars` as single-line dotenv values (newlines as `\n`):

```
BOT_PGP_PRIVATE="-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n...\n-----END PGP PRIVATE KEY BLOCK-----"
BOT_PGP_PUBLIC="-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n...\n-----END PGP PUBLIC KEY BLOCK-----"
```

Restart `pnpm dev` after you edit `.dev.vars`.

## Deploying

You need a domain on Cloudflare with Email Routing turned on. After that:

1. Generate the static bot keypair: `pnpm gen-bot-key --domain=mailenc.org --localpart=echo`
2. Put the private key into Worker Secrets: `pnpm wrangler secret put BOT_PGP_PRIVATE`
3. Paste the public key into `BOT_PGP_PUBLIC` in `wrangler.jsonc` (it's public, no need to hide it)
4. `pnpm run deploy`
5. In the Cloudflare dashboard, add a **catch-all** Email Routing rule that sends to the `mailenc` worker. Catch-all is required: the `+token` aliases won't match a specific `echo@` rule.
6. Sanity check the static key is reachable:
   ```
   gpg --auto-key-locate wkd --locate-keys echo@mailenc.org
   ```
   If that imports the static key, your WKD endpoint works.
7. Sanity check the per-session flow: open the site, grab a fresh address, then in another terminal:
   ```
   gpg --auto-key-locate wkd --locate-keys 'echo+<your-token>@mailenc.org'
   ```
   You should see `imported: 1` with a UID containing the per-session token.

For debugging, `pnpm wrangler tail` streams live worker logs from production. Useful when something silently misbehaves and the timeline cannot tell you why.

## Privacy

The Durable Object stores three things: the per-session keypair (lifetime: one hour), the event log (booleans, fingerprints, URLs), and the address. No email body, subject, or attachment content sticks around after the reply goes out. The hour TTL is enforced by a DO alarm that wipes everything when it fires. The static bot key lives in Worker Secrets, encrypted at rest by Cloudflare. To rotate it, regenerate and `wrangler secret put BOT_PGP_PRIVATE` again.

Per-session private keys live in DO storage, also encrypted at rest. Each one is unique to a single browser tab opening the site, and you can rotate by just reloading.
