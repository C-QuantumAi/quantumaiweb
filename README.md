# QuantumAI — Prebuilt (No Build Needed)

## ⚠ IMPORTANT: How to deploy so the AI chat & market data work

The `/api/*` features (AI chat, web search, live prices, payment verification)
only work when Cloudflare runs the **Pages Functions** in the `functions/` folder.

### Deploy via GitHub (the reliable way)

1. Upload the CONTENTS of this folder to a new GitHub repo (so `index.html` and
   `functions/` sit at the repo ROOT — not inside a subfolder).
2. Cloudflare Dashboard → Workers & Pages → Create → **Pages** → Connect to Git.
3. Set these EXACTLY:
   - Framework preset: **None**
   - Build command: **(leave empty)**
   - Build output directory: **`/`**
   - Deploy command / Custom deploy command: **(leave empty — do NOT use `npx wrangler deploy`)**
4. Save and Deploy.
5. Settings → Environment variables → add your keys (ANTHROPIC_API_KEY, etc.) to
   **Production** → then Deployments → Retry deployment.

> If a previous attempt set the deploy command to `npx wrangler deploy`, clear it.
> That command deploys as a Worker and fails. Pages auto-detects `functions/`.

### Verify
Visit `https://your-site.pages.dev/api/chat` directly. You should see JSON
(an error about "messages" is fine). If you see the website instead, the
functions didn't deploy — re-check that `functions/` is at the repo root.

---

# QuantumAI — Pre-Built (No-Build) Version

This folder is **ready to deploy as-is**. No `npm install`, no build step. Just upload it to Cloudflare Pages.

## Why your earlier upload showed a blank page

The other zip (`quantumai-cloudflare`) contains **source code** that must be compiled with `npm run build` first. If you upload that source directly, the browser tries to run raw `.jsx` files it can't understand → blank white page.

**This** folder is already compiled to plain JavaScript, so it works when uploaded directly.

## Deploy to Cloudflare Pages (drag & drop — easiest)

1. Go to **dash.cloudflare.com** → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Name it (e.g. `quantumai`).
3. **Drag this entire folder's contents** (the files, not a parent folder) into the upload box:
   - `index.html`, `app.js`, `logo.png`, `_headers`, `_redirects`, and the `functions/` folder.
4. Click **Deploy**. Your site is live at `https://<name>.pages.dev`.

> Tip: select all the files **inside** this folder and zip them, or drag the files themselves — don't upload the folder as a single nested item, or paths break.

## Add your domain (QuantumAI.computer)

In the Pages project → **Custom domains** → add `quantumai.computer` and `www.quantumai.computer`, then point GoDaddy DNS at Cloudflare (see the main README in the source zip for exact GoDaddy steps).

## Make the AI chat + payment verification work (optional but recommended)

These features use the included `functions/` (Cloudflare Pages Functions). After deploying, add environment variables in **Settings → Environment variables → Production** (mark each as a Secret), then redeploy:

| Variable | Used for | Get it free at |
|---|---|---|
| `ANTHROPIC_API_KEY` | JARVIS/FRIDAY AI chat + web search | console.anthropic.com |
| `BLOCKFROST_API_KEY` | Verify QAI + ADA payments (Cardano mainnet) | blockfrost.io |
| `ETHERSCAN_API_KEY` | Verify USDT (ERC-20) payments | etherscan.io/myapikey |
| `COINGECKO_API_KEY` | Faster, more reliable market data & charts (optional but recommended) | coingecko.com/en/developers/dashboard |
| `CMC_API_KEY` | CoinMarketCap fallback for prices (optional, extra accuracy) | coinmarketcap.com/api |

Bitcoin verification needs no key. Everything else on the site (prices, markets, charts, wallet connect, encryption vault) works without any keys.

## What's inside

- `index.html` — loads React 18 (jsDelivr CDN) + the app
- `app.js` — the entire QuantumAI site, pre-transpiled to plain JS (no JSX, no build)
- `logo.png` — app icon / favicon
- `_redirects` — SPA routing (keeps `/api/*` going to the functions)
- `_headers` — security headers + microphone permission for the voice assistant
- `functions/api/chat.js` — secure AI chat backend
- `functions/api/verify-payment.js` — on-chain payment verification backend

## If you prefer the proper build (smaller, fully self-contained)

Use the `quantumai-cloudflare` source zip instead and let Cloudflare build it:
- Connect the repo in Cloudflare Pages with **Build command:** `npm run build` and **Output directory:** `dist`.
That version bundles React locally (no CDN dependency). This pre-built folder is the zero-effort option.
