# mailenc

A PGP email round-trip test, hosted on a single Cloudflare Worker.

Visit the website, get a one-shot address like `echo+ab12cd34@mailenc.org`,
send a PGP-encrypted email to it from your mail client, and watch the
verification run live on the page. The bot mails back an encrypted echo
report — encrypted to whichever public key it found for you, signed with
its own key.

The point: prove end-to-end that *your* setup works. Real client, real
SMTP, real key discovery.

## What gets checked

| Step | What |
| --- | --- |
| Encryption envelope | Did you send PGP/MIME or inline PGP? |
| Decryption | Can the bot decrypt with its private key? |
| Embedded signature | Is the message signed inside the encrypted payload? |
| WKD (advanced) | `openpgpkey.<your-domain>/.well-known/openpgpkey/<your-domain>/hu/<hash>` |
| WKD (direct) | `<your-domain>/.well-known/openpgpkey/hu/<hash>` |
| Autocrypt | The `Autocrypt:` header your client sets |
| HKPS | `keys.openpgp.org` lookup by your address |
| Reply key | Which discovery source the bot used to encrypt the reply |
| Signature verification | Does your embedded signature verify against the discovered key? |

Reply preference: **WKD > Autocrypt > HKPS**. If nothing is found, the
reply is plaintext with an explanation in the body.

## Stack

- Cloudflare Workers (one `fetch` + one `email` handler)
- Cloudflare Email Routing (catch-all rule → this Worker)
- Workers Static Assets for the website
- One Durable Object per session (live SSE fan-out to the browser)
- `openpgp` 6.x for crypto, `postal-mime` for MIME

## Project layout

```
src/
  index.ts                 Worker entry; exports fetch, email, SessionDO
  env.ts                   Env binding interface
  api/
    routes.ts              URL switch
    session.ts             POST /api/session + state + stream forwarding
    wkd-serve.ts           Bot's own WKD endpoint
  email/
    handler.ts             email() entry, schedules pipeline via waitUntil
    parse.ts               postal-mime wrapper + PGP payload extraction
    pipeline.ts            decrypt → discover → encrypt → reply
    reply.ts               Build RFC 5322 + RFC 3156 reply bodies
    report.ts              Markdown + JSON appendix report
  discovery/
    wkd.ts                 Advanced + direct WKD fetch
    hkps.ts                keys.openpgp.org VKS
    autocrypt.ts           Header parser
    pick.ts                Ranking
    types.ts               Shared types
  pgp/
    bot-key.ts             Load + cache bot keys from env
    decrypt.ts             openpgp.decrypt wrapper
    encrypt.ts             openpgp.encrypt + signing
    inspect.ts             Key summary for the report
  session/
    do.ts                  SessionDO (state, alarm, SSE fan-out)
    events.ts              Discriminated union of pipeline events
  util/
    zbase32.ts             WKD localpart hashing (SHA-1 + z-base-32)
    token.ts               8-char session token
public/
  index.html               Landing page
  app.js                   SSE timeline renderer
  style.css                Styles
scripts/
  gen-bot-key.mjs          One-shot keypair generator
```

## Local development

```
pnpm install
pnpm typecheck
pnpm dev                   # http://127.0.0.1:8788
```

For the bot to serve its own WKD route locally, generate a keypair and
drop it into `.dev.vars`:

```
node scripts/gen-bot-key.mjs --domain=mailenc.org --localpart=echo
```

The script prints both keys. Put them into `.dev.vars` as
single-line dotenv values (replace newlines with `\n`):

```
BOT_PGP_PRIVATE="-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n...\n-----END PGP PRIVATE KEY BLOCK-----"
BOT_PGP_PUBLIC="-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n...\n-----END PGP PUBLIC KEY BLOCK-----"
```

Restart `pnpm dev` after editing `.dev.vars`.

The email handler can't be exercised locally — Cloudflare Email Routing
runs against the deployed Worker only. Local dev only covers the HTTP
surface (site, API, WKD).

## Deploy

Prerequisites: `mailenc.org` (or whatever domain) on Cloudflare with
Email Routing enabled.

1. **Generate the bot keypair**

   ```
   pnpm gen-bot-key --domain=mailenc.org --localpart=echo
   ```

2. **Store the private key as a Worker Secret**

   ```
   pnpm wrangler secret put BOT_PGP_PRIVATE
   ```

   Paste the armored block when prompted.

3. **Put the public key in `wrangler.jsonc`**

   Replace `BOT_PGP_PUBLIC` under `vars` with the armored public key
   (it's public — no need for a secret).

4. **Deploy**

   ```
   pnpm deploy
   ```

5. **Wire up Email Routing**

   In the Cloudflare dashboard, under Email > Email Routing > Routing
   rules, add a **catch-all** rule with action *Send to a Worker* →
   pick `mailenc`. Catch-all is required so `echo+<token>@mailenc.org`
   resolves; specific `echo@` rules won't match the plus-aliased tokens.

6. **Verify**

   ```
   gpg --auto-key-locate wkd --locate-keys echo@mailenc.org
   ```

   This should fetch and import the bot's public key over WKD. If it
   doesn't, the bot's WKD endpoint isn't reachable — check that the
   Worker is bound to the domain and `BOT_PGP_PUBLIC` is set.

## Privacy

- No email contents are stored after the report is sent. The Durable
  Object holds only the event log (booleans, key fingerprints, URLs),
  not the body.
- Sessions auto-delete one hour after creation via a DO alarm.
- The bot's private key lives in Worker Secrets (encrypted at rest by
  Cloudflare). Rotate by re-running `gen-bot-key` and putting the new
  secret.

## Why a fresh address per visit?

So the website can show *your* result live. The token in
`echo+<token>@mailenc.org` is the session ID — the email handler routes
the result to the matching Durable Object, which fans out the event
stream to the browser tab that's holding it open.
