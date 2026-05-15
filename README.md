📨 **mailenc**

A little tool that tells you whether your PGP email setup actually works end to end.

You visit the site, get a one-shot address like `echo+ab12cd34@mailenc.org`, and send a PGP-encrypted email to it from whatever client you normally use. The verification streams live to the page while it runs. A couple of seconds later you get an encrypted echo reply, encrypted to whatever public key the bot could find for you (via WKD, Autocrypt, or HKPS), signed by the bot.

So instead of wondering if you set everything up right, you just send a real email and get a real answer.

## What gets checked

When your email lands, the bot walks through:

- whether the envelope is PGP/MIME or inline PGP at all
- whether it can decrypt with its private key
- whether the message was signed inside the encrypted payload
- whether your domain publishes a key via WKD (both the advanced and direct paths)
- whether the `Autocrypt:` header is set on the message
- whether keys.openpgp.org has a key for your address
- which of those sources it ended up using to encrypt the reply
- whether the embedded signature verifies against that key

If more than one source has a key, the bot prefers WKD, then Autocrypt, then HKPS. If nothing usable turns up, the reply goes back in plaintext with a short note explaining why.

## Stack

One Cloudflare Worker does everything. The `fetch` handler serves the site and a small JSON API. The `email` handler receives incoming mail through Cloudflare Email Routing and runs the pipeline. There's a Durable Object per session that holds the event log and fans it out to the browser over SSE. Crypto is `openpgp` 6.x, MIME parsing is `postal-mime`. The frontend is plain HTML, CSS and JS with no build step.

## Running it locally

```
pnpm install
pnpm typecheck
pnpm dev
```

The site runs at http://127.0.0.1:8788. Local dev only exercises the HTTP side, since Cloudflare Email Routing only delivers mail to deployed Workers.

If you want the bot to actually serve its key from the local WKD endpoint, generate a test keypair:

```
node scripts/gen-bot-key.mjs --domain=mailenc.org --localpart=echo
```

The script prints both keys. Drop them into `.dev.vars` as single-line dotenv values (newlines as `\n`):

```
BOT_PGP_PRIVATE="-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n...\n-----END PGP PRIVATE KEY BLOCK-----"
BOT_PGP_PUBLIC="-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n...\n-----END PGP PUBLIC KEY BLOCK-----"
```

Restart `pnpm dev` after you edit `.dev.vars`.

## Deploying

You need a domain on Cloudflare with Email Routing turned on. After that:

1. Generate the real bot keypair: `pnpm gen-bot-key --domain=mailenc.org --localpart=echo`
2. Put the private key into Worker Secrets: `pnpm wrangler secret put BOT_PGP_PRIVATE`
3. Paste the public key into `BOT_PGP_PUBLIC` in `wrangler.jsonc` (it's public, no need to hide it)
4. `pnpm run deploy`
5. In the Cloudflare dashboard, add a catch-all Email Routing rule that sends to the `mailenc` worker. Catch-all is important: the `+token` aliases won't match a specific `echo@` rule.
6. Sanity check that the bot's key is reachable: `gpg --auto-key-locate wkd --locate-keys echo@mailenc.org` should find it. If it doesn't, either the WKD endpoint isn't reachable from outside or `BOT_PGP_PUBLIC` isn't set.

## Privacy

The Durable Object holds event metadata: booleans, key fingerprints, URLs that were tried. No email body, subject, or attachment content sticks around after the reply goes out. Sessions delete themselves an hour after they're created via a DO alarm. The bot's private key lives in Worker Secrets, encrypted at rest by Cloudflare. To rotate, regenerate and `wrangler secret put` again.

## Why a fresh address per visit

So the page can show your result live. The token in `echo+<token>@mailenc.org` is the session id. When the email handler is done with your message, it pushes the result into the Durable Object for that token, which is already streaming to your browser tab.
