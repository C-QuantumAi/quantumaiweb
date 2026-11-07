# QuantumAI.computer — Token-holder downloads + Bug forum

Two additions to the existing Cloudflare Pages site (same repo, same deploy):

| Page | What's new |
|---|---|
| **Downloads** | A **FREE for $QAI holders** card above the $5 paywall. Holders prove it by connecting a browser wallet (Eternl, Lace, Nami, Vespr, Typhon, Yoroi…) **or** pasting any address from a cold / hardware / local wallet. The server checks the whole account on-chain (Koios) and issues a personal, short-lived download link. Non-holders see the existing payment options unchanged. |
| **Forum** (new nav item) | Anyone can post a bug note (category, title, what happened, steps, version, OS, optional name/email). Each note is **emailed to cardano.quantumai@gmail.com** and kept on a public board (emails never shown). Honeypot + rate limits against spam. |

Nothing is signed or spent by the wallet. We only read an address, look up its stake key, and sum QAI under policy `354a6c0acd846b195768ead31c92693ad26d82ba013e7df5d9777081` / asset `514149` (fingerprint `asset1nylmp38l5uq2szj6kguellahjvpsj6a7uhwxzs`).

## Files added

```
functions/_gate.js                    shared helpers for the new functions (underscore = not routed)
functions/api/verify.js               POST  /api/verify        { address } → eligibility + download token
functions/api/download/[platform].js  GET   /api/download/win|msi|mac|linux?t=TOKEN → installer
functions/api/platforms.js            GET   /api/platforms     which installers exist, min QAI, gate ready?
functions/api/forum.js                POST/GET /api/forum      post a note / list notes
shared/gate-core.mjs                  address parsing (bech32, CIP-30 hex), Koios lookup, HMAC tokens, post validation, email HTML
src/QuantumAI.jsx                     HolderGate + ForumPage components, nav + routing
test/gate.test.mjs                    39 offline tests (run: node test/gate.test.mjs)
```

The existing `/api/chat`, `/api/verify-payment`, `/api/waitlist`, `/api/auth`, `/api/cg` are untouched.

## One-time setup in Cloudflare (10 minutes)

Pages project → **Settings → Functions**:

1. **KV namespace binding** — variable name `GATE` → create a namespace (any name). Used for rate limits, single-use download links, and forum posts. *Without it the gate still works but has no rate limiting and the board doesn't persist.*
2. **R2 bucket binding** (recommended) — variable name `DOWNLOADS` → create bucket `qai-vault-downloads`, upload the installers. Then in **Environment variables** set the object keys:
   - `R2_KEY_WIN = QuantumAI-Vault-Setup.exe`
   - `R2_KEY_MSI = QuantumAI-Vault.msi`
   - `R2_KEY_MAC = QuantumAI-Vault.dmg`

   *Alternative without R2:* set `DOWNLOAD_URL_WIN / _MSI / _MAC` to unlisted URLs (e.g. GitHub Release assets). The gate then 302-redirects verified holders there. Be aware a GitHub release URL is public by nature — anyone who learns it can download; R2 keeps the files truly behind the gate.
3. **Environment variables** (Production + Preview):
   - `MIN_QAI = 1` — minimum QAI to qualify (raise if you want, e.g. `1000`)
   - `TOKEN_TTL_MIN = 15` — how long a download link lives
   - `DAILY_PER_WALLET = 5` — verifications per wallet per day (stops one wallet acting as a public mirror)
   - `FORUM_TO = cardano.quantumai@gmail.com`
   - `FORUM_FROM = QuantumAI Forum <forum@quantumai.computer>` — must be on a domain you verified at Resend (see 4)
4. **Secrets** (same page, "Encrypt"):
   - `TOKEN_SECRET` — any long random string: `openssl rand -hex 32`. Required; the gate refuses to run without it.
   - `RESEND_API_KEY` — from https://resend.com (free tier is plenty). In Resend, **add and verify `quantumai.computer`** (3 DNS records, they're in your Cloudflare DNS anyway) so mail can come from `forum@quantumai.computer` and land in Gmail's inbox rather than spam. Until the key is set, notes are still saved to the board and the poster is told email isn't configured yet.
   - `BLOCKFROST_API_KEY` — **recommended, and you already have one** for payment verification. When present it is used first for the holder check (fixed, documented API); Koios is the automatic fallback.
   - `KOIOS_API_KEY` — optional. Koios' free public tier is fine for a launch; a free key at https://koios.rest raises the limits.
5. Redeploy (push, or "Retry deployment"). Check `https://quantumai.computer/api/platforms` — it should list your platforms and `gateReady: true`.

## How the gate decides

- Source order: Blockfrost (if `BLOCKFROST_API_KEY` is set) → Koios public API. Koios' asset rows arrive flat or nested under `asset_list` depending on endpoint/version; both shapes are parsed (the v1 bug that reported "No QAI found" for real holders was a nested response summing to zero).
- When a check fails, the message now says how many asset types were seen and via which source — useful for support.

- `addr1…` → Koios `address_info` → its `stake1…` → `account_assets` summed for the QAI policy+name. So a hardware wallet with funds spread across 20 addresses passes with any one of them.
- `stake1…` pasted directly → `account_assets` straight away (best option for cold wallets; shown in Daedalus/Eternl under "Staking" / "Rewards address").
- Browser wallet → CIP-30 `getRewardAddresses()` (hex) → same path. Falls back to a used address if the wallet doesn't expose the reward address.
- Testnet addresses, typos (bech32 checksum), never-used addresses and sub-minimum balances each get a specific message.
- On success a 15-minute HMAC token is issued; each token serves a few fetches (retry + second platform) then dies. 20 checks per IP per 10 minutes; 5 per wallet per day.

## Local test

```bash
cd site && npm install && npm run build
node ../test/gate.test.mjs            # offline: addresses, Koios mock, tokens, forum, functions
npx wrangler pages dev dist --kv GATE # serves site + functions locally (set TOKEN_SECRET in .dev.vars)
```

## Honest limits

- Holdings are checked at download time only; a holder who sells later keeps the installer they already have (that's intended — it's a reward for holding, not a licence server).
- The lookup depends on Koios being up. If it's rate-limited the user is told to retry in a minute; the paid path still works.
- Email goes through Resend; the board itself never depends on email.
- The site's "Connect Wallet" button at the top is the existing one; the gate has its own connect flow and never asks the wallet to sign anything.


## Cloud page (updated 2026-11-06)

The site's **Cloud** page is now a launcher, not a client. Since Vault 1.5 every Personal Cloud session runs inside a post-quantum channel served by the Vault itself, and the Vault only talks to pages it served. The page validates the address, calls the Vault's one cross-origin endpoint (`GET /api/ping`, allowed for `https://quantumai.computer` only; returns app name, protocol version and identity fingerprint — nothing secret), shows the fingerprint for comparison with the desktop, and opens `<vault>/?s=<vault>` in a new tab. Usernames and passwords never touch the website. No Functions or secrets are involved.

## Holder lookup, hardened (2026-11-06)

If a holder sees "No QAI found": the message now ends with a diagnostic line — which provider answered, whether the whole account (stake1…) or one address was checked, and how many asset types were seen. The lookup now (1) asks Koios the targeted question (`/account_assets?policy_id=eq.<policy>&asset_name=eq.514149`, PostgREST filter) so pagination can never hide QAI, (2) falls back to the unfiltered account list, (3) then sweeps every address of the account. Blockfrost (when `BLOCKFROST_API_KEY` is set) scans up to 5,000 asset types and sweeps addresses the same way. A message **without** the diagnostic tail means the deployed site predates the Oct-29 fix — republish.
