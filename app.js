"use strict";
const { useState, useEffect, useRef, useCallback } = React;
// ── Verified on-chain token data from CardanoScan ─────────────
// Source: https://cardanoscan.io/token/354a6c0acd846b195768ead31c92693ad26d82ba013e7df5d9777081514149
const POLICY_ID = "354a6c0acd846b195768ead31c92693ad26d82ba013e7df5d9777081";
const ASSET_NAME = "QAI";
const ASSET_HEX = "514149";
const FINGERPRINT = "asset1nylmp38l5uq2szj6kguellahjvpsj6a7uhwxzs";
const TOTAL_SUPPLY = "1,000,000,000";
const DECIMALS = "0";
const CREATED_ON = "2022-02-08";
const TX_COUNT = "21,331";
// Official on-chain token logo from CExplorer metadata
const TOKEN_LOGO = "/26491.jpg";
const GITHUB_LOGO = "/26491.jpg";
// ── Vault app installer download URLs ─────────────────────────
// Point these at your hosted installers (GitHub Releases recommended).
// Build them with the vault-app project (npm run dist:win / dist:mac) or the
// included GitHub Action, then upload and update these links.
const DOWNLOADS = {
    win_exe: "https://github.com/C-QuantumAi/quantumai-vault/releases/latest/download/QuantumAI-Vault-Setup.exe",
    win_msi: "https://github.com/C-QuantumAi/quantumai-vault/releases/latest/download/QuantumAI-Vault.msi",
    mac_dmg: "https://github.com/C-QuantumAi/quantumai-vault/releases/latest/download/QuantumAI-Vault.dmg",
};
// ── CIP-30 Cardano wallet integration ─────────────────────────
// Every Cardano browser wallet injects an API under window.cardano[key]
// following the CIP-30 dApp-connector standard.
const QAI_UNIT_HEX = POLICY_ID + ASSET_HEX; // concatenated unit used in wallet balances
// Known wallets with display metadata. We detect which are actually installed.
const KNOWN_WALLETS = [
    { key: "nami", name: "Nami", icon: "🦊", sub: "Browser extension", url: "https://namiwallet.io" },
    { key: "eternl", name: "Eternl", icon: "♾️", sub: "Feature-rich wallet", url: "https://eternl.io" },
    { key: "lace", name: "Lace", icon: "🎴", sub: "IOG official wallet", url: "https://www.lace.io" },
    { key: "vespr", name: "Vespr", icon: "🔷", sub: "Mobile & extension", url: "https://vespr.xyz" },
    { key: "flint", name: "Flint", icon: "🔥", sub: "Browser extension", url: "https://flint-wallet.com" },
    { key: "typhoncip30", name: "Typhon", icon: "🌀", sub: "Browser extension", url: "https://typhonwallet.io" },
    { key: "gerowallet", name: "Gero", icon: "⚡", sub: "Browser extension", url: "https://gerowallet.io" },
    { key: "nufi", name: "NuFi", icon: "🔐", sub: "Browser & mobile", url: "https://nu.fi" },
    { key: "yoroi", name: "Yoroi", icon: "🔵", sub: "EMURGO wallet", url: "https://yoroi-wallet.com" },
];
// Detect installed CIP-30 wallets
function detectWallets() {
    if (typeof window === "undefined" || !window.cardano)
        return [];
    return KNOWN_WALLETS
        .map(w => {
        const api = window.cardano[w.key];
        if (api && typeof api.enable === "function") {
            return { ...w, installed: true, apiName: api.name, apiIcon: api.icon };
        }
        return null;
    })
        .filter(Boolean);
}
// Minimal hex→bytes
function hexToBytes(hex) {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
}
function bytesToHex(bytes) {
    if (!bytes)
        return "";
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
// Parse a CIP-30 hex Value (CBOR) to extract lovelace + QAI quantity (best-effort).
function parseValueForQAI(hexValue) {
    try {
        const bytes = hexToBytes(hexValue);
        const cbor = decodeCBOR(bytes).value;
        let lovelace = 0n, qai = 0n;
        if (typeof cbor === "bigint" || typeof cbor === "number") {
            lovelace = BigInt(cbor);
        }
        else if (Array.isArray(cbor)) {
            lovelace = BigInt(cbor[0] || 0);
            const assets = cbor[1];
            if (assets instanceof Map) {
                for (const [policy, tokens] of assets.entries()) {
                    if (bytesToHex(policy) === POLICY_ID && tokens instanceof Map) {
                        for (const [name, qty] of tokens.entries()) {
                            if (bytesToHex(name) === ASSET_HEX)
                                qai += BigInt(qty);
                        }
                    }
                }
            }
        }
        return { lovelace, qai };
    }
    catch {
        return { lovelace: 0n, qai: 0n };
    }
}
// Tiny CBOR decoder — supports the subset needed for CIP-30 Value:
// unsigned/negative ints, byte strings, arrays, and maps.
function decodeCBOR(bytes, pos = 0) {
    const b = bytes[pos];
    const major = b >> 5;
    const info = b & 0x1f;
    const readLen = () => {
        if (info < 24)
            return [info, pos + 1];
        if (info === 24)
            return [bytes[pos + 1], pos + 2];
        if (info === 25)
            return [(bytes[pos + 1] << 8) | bytes[pos + 2], pos + 3];
        if (info === 26)
            return [((bytes[pos + 1] << 24) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 8) | bytes[pos + 4]) >>> 0, pos + 5];
        if (info === 27) {
            let v = 0n;
            for (let i = 0; i < 8; i++)
                v = (v << 8n) | BigInt(bytes[pos + 1 + i]);
            return [v, pos + 9];
        }
        return [info, pos + 1];
    };
    if (major === 0) {
        const [v, np] = readLen();
        return { value: typeof v === "bigint" ? v : BigInt(v), pos: np };
    }
    if (major === 1) {
        const [v, np] = readLen();
        const bv = typeof v === "bigint" ? v : BigInt(v);
        return { value: -1n - bv, pos: np };
    }
    if (major === 2) {
        const [l, np] = readLen();
        const L = Number(l);
        return { value: bytes.slice(np, np + L), pos: np + L };
    }
    if (major === 4) {
        const [l, np] = readLen();
        const L = Number(l);
        let cur = np;
        const arr = [];
        for (let i = 0; i < L; i++) {
            const r = decodeCBOR(bytes, cur);
            arr.push(r.value);
            cur = r.pos;
        }
        return { value: arr, pos: cur };
    }
    if (major === 5) {
        const [l, np] = readLen();
        const L = Number(l);
        let cur = np;
        const map = new Map();
        for (let i = 0; i < L; i++) {
            const k = decodeCBOR(bytes, cur);
            cur = k.pos;
            const v = decodeCBOR(bytes, cur);
            cur = v.pos;
            map.set(k.value, v.value);
        }
        return { value: map, pos: cur };
    }
    return { value: null, pos: pos + 1 };
}
// Connect to a CIP-30 wallet by key. Returns connection info or throws.
async function connectCIP30(key) {
    if (typeof window === "undefined" || !window.cardano || !window.cardano[key]) {
        throw new Error("WALLET_NOT_FOUND");
    }
    const api = await window.cardano[key].enable(); // triggers the wallet popup
    const networkId = await api.getNetworkId(); // 1 = mainnet, 0 = testnet
    let addrHex = "";
    try {
        const used = await api.getUsedAddresses();
        addrHex = used && used[0] ? used[0] : "";
        if (!addrHex) {
            const unused = await api.getUnusedAddresses();
            addrHex = unused && unused[0] ? unused[0] : "";
        }
    }
    catch { }
    let ada = 0, qai = 0;
    try {
        const balHex = await api.getBalance();
        const { lovelace, qai: qaiQty } = parseValueForQAI(balHex);
        ada = Number(lovelace) / 1000000;
        qai = Number(qaiQty);
    }
    catch { }
    return { api, networkId, addrHex, ada, qai };
}
function shortAddr(addr) {
    if (!addr)
        return "—";
    if (addr.length <= 16)
        return addr;
    return addr.slice(0, 8) + "…" + addr.slice(-6);
}
// ── Real file encryption (Web Crypto API) ─────────────────────
// AES-256-GCM with PBKDF2 key derivation (210k iterations, SHA-256).
// File format (.qai): [MAGIC(4)][version(1)][salt(16)][iv(12)][ciphertext...]
const QAI_MAGIC = new Uint8Array([0x51, 0x41, 0x49, 0x01]); // "QAI" + v1
const PBKDF2_ITERS = 210000;
// Derive an AES-256 key from a password + salt
async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// Encrypt a File → returns a Blob (.qai) and metadata
async function encryptFile(file, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const plaintext = new Uint8Array(await file.arrayBuffer());
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
    // Assemble container: magic + salt + iv + ciphertext
    const out = new Uint8Array(QAI_MAGIC.length + salt.length + iv.length + cipher.length);
    let o = 0;
    out.set(QAI_MAGIC, o);
    o += QAI_MAGIC.length;
    out.set(salt, o);
    o += salt.length;
    out.set(iv, o);
    o += iv.length;
    out.set(cipher, o);
    return {
        blob: new Blob([out], { type: "application/octet-stream" }),
        encName: file.name + ".qai",
        size: out.length,
    };
}
// Decrypt a .qai File → returns a Blob of the original + recovered name
async function decryptFile(file, password) {
    const buf = new Uint8Array(await file.arrayBuffer());
    // Validate magic
    if (buf.length < 4 + 16 + 12 || buf[0] !== 0x51 || buf[1] !== 0x41 || buf[2] !== 0x49) {
        throw new Error("NOT_QAI_FILE");
    }
    let o = 4;
    const salt = buf.slice(o, o + 16);
    o += 16;
    const iv = buf.slice(o, o + 12);
    o += 12;
    const cipher = buf.slice(o);
    const key = await deriveKey(password, salt);
    let plain;
    try {
        plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    }
    catch {
        throw new Error("WRONG_PASSWORD");
    }
    const origName = file.name.endsWith(".qai") ? file.name.slice(0, -4) : file.name + ".decrypted";
    return { blob: new Blob([plain]), name: origName };
}
// Generate a strong random password
function generatePassword(len = 28) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";
    const arr = crypto.getRandomValues(new Uint32Array(len));
    let pw = "";
    for (let i = 0; i < len; i++)
        pw += chars[arr[i] % chars.length];
    return pw;
}
// Trigger a browser download of a Blob
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// ── Particle Field ────────────────────────────────────────────
function ParticleField() {
    const canvasRef = useRef(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext("2d");
        let raf;
        const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
        resize();
        window.addEventListener("resize", resize);
        const particles = Array.from({ length: 80 }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            r: Math.random() * 1.2 + 0.3,
            dx: (Math.random() - 0.5) * 0.25,
            dy: (Math.random() - 0.5) * 0.25,
            opacity: Math.random() * 0.5 + 0.15,
        }));
        const draw = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.x += p.dx;
                p.y += p.dy;
                if (p.x < 0)
                    p.x = canvas.width;
                if (p.x > canvas.width)
                    p.x = 0;
                if (p.y < 0)
                    p.y = canvas.height;
                if (p.y > canvas.height)
                    p.y = 0;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(100,200,255,${p.opacity})`;
                ctx.fill();
            });
            // Draw connecting lines
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(0,210,255,${0.08 * (1 - dist / 120)})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }
            raf = requestAnimationFrame(draw);
        };
        draw();
        return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
    }, []);
    return React.createElement("canvas", { ref: canvasRef, style: { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" } });
}
// ── Price Chart ───────────────────────────────────────────────
function PriceChart({ data }) {
    if (!data.length)
        return null;
    const min = Math.min(...data), max = Math.max(...data);
    const W = 800, H = 160;
    const x = i => (i / (data.length - 1)) * W;
    const y = v => H - ((v - min) / (max - min || 1)) * (H * 0.82) - H * 0.08;
    const linePts = data.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
    const areaPath = `M ${data.map((v, i) => `${x(i)},${y(v)}`).join(" L ")} L ${W},${H} L 0,${H} Z`;
    return (React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, style: { width: "100%", height: "100%" }, preserveAspectRatio: "none" },
        React.createElement("defs", null,
            React.createElement("linearGradient", { id: "cg", x1: "0", y1: "0", x2: "0", y2: "1" },
                React.createElement("stop", { offset: "0%", stopColor: "#00C6FF", stopOpacity: "0.3" }),
                React.createElement("stop", { offset: "100%", stopColor: "#00C6FF", stopOpacity: "0" })),
            React.createElement("filter", { id: "glow" },
                React.createElement("feGaussianBlur", { stdDeviation: "2", result: "blur" }),
                React.createElement("feMerge", null,
                    React.createElement("feMergeNode", { in: "blur" }),
                    React.createElement("feMergeNode", { in: "SourceGraphic" })))),
        React.createElement("path", { d: areaPath, fill: "url(#cg)" }),
        React.createElement("polyline", { points: linePts, fill: "none", stroke: "#00C6FF", strokeWidth: "1.8", strokeLinejoin: "round", filter: "url(#glow)" }),
        React.createElement("circle", { cx: x(data.length - 1), cy: y(data[data.length - 1]), r: "4", fill: "#fff", stroke: "#00C6FF", strokeWidth: "2", filter: "url(#glow)" })));
}
// ── Live DEX Price Fetching ───────────────────────────────────
// QAI on-chain identifiers
const QAI_ASSET_ID = `${POLICY_ID}.${ASSET_HEX}`; // Minswap format
const QAI_UNIT = `${POLICY_ID}${ASSET_HEX}`; // Cardano unit (policyId + hex name)
// SundaeSwap Stats API — public, no auth required
// Powers the pool data shown at app.sundae.fi/liquidity
const SUNDAE_STATS = "https://stats.sundaeswap.finance";
// GeckoTerminal — public API indexing all Cardano DEX pools incl. SundaeSwap
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
// Minswap public API
const MINSWAP_API = "https://api-mainnet-prod.minswap.org";
// ── CoinGecko API config ──────────────────────────────────────
// On Cloudflare the app calls its own /api/cg proxy (server-side, no CORS limits,
// holds the optional API key). In the artifact/local preview it calls CoinGecko
// directly. Set COINGECKO_API_KEY in the Cloudflare env to raise rate limits.
const COINGECKO_API_KEY = ""; // optional, for direct/preview calls only
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
// Are we on a real deployment (use the proxy) or in preview (call direct)?
function useProxy() {
    if (typeof window === "undefined" || !window.location)
        return false;
    const h = window.location.hostname;
    return h !== "localhost" && h !== "127.0.0.1" &&
        !h.includes("claude") && !h.includes("anthropic");
}
// Build the actual fetch URL for a CoinGecko path
function cgURL(path) {
    if (useProxy())
        return `/api/cg?path=${encodeURIComponent(path)}`;
    return `${COINGECKO_BASE}${path}`;
}
// In-memory response cache + in-flight dedupe
const _cgCache = new Map();
const _cgInflight = new Map();
async function cgFetch(path, { cacheMs = 15000, retries = 1 } = {}) {
    const cacheKey = path;
    const now = Date.now();
    const cached = _cgCache.get(cacheKey);
    if (cached && now - cached.ts < cacheMs)
        return cached.data;
    if (_cgInflight.has(cacheKey))
        return _cgInflight.get(cacheKey);
    // Build the list of URLs to try in order.
    // On a deployment: try the proxy first, then direct CoinGecko as a fallback
    // (so the page still works even if Pages Functions didn't deploy).
    // In preview: just direct.
    const directURL = `${COINGECKO_BASE}${path}`;
    const urls = useProxy()
        ? [`/api/cg?path=${encodeURIComponent(path)}`, directURL]
        : [directURL];
    const directHeaders = { "Accept": "application/json" };
    if (COINGECKO_API_KEY)
        directHeaders["x-cg-demo-api-key"] = COINGECKO_API_KEY;
    const tryURL = async (url) => {
        const headers = url.startsWith("/api/cg") ? { "Accept": "application/json" } : directHeaders;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const r = await fetch(url, { headers });
            if (r.status === 429) {
                await new Promise(res => setTimeout(res, 500));
                continue;
            }
            if (!r.ok)
                throw new Error(`HTTP ${r.status}`);
            // Guard: a misrouted SPA returns index.html (text/html) — treat as failure
            const ct = r.headers.get("content-type") || "";
            if (ct.includes("text/html"))
                throw new Error("Got HTML, not JSON");
            return await r.json();
        }
        throw new Error("rate-limited");
    };
    const run = (async () => {
        for (const url of urls) {
            try {
                const data = await tryURL(url);
                if (data != null) {
                    _cgCache.set(cacheKey, { ts: Date.now(), data });
                    return data;
                }
            }
            catch { /* try next url */ }
        }
        if (cached)
            return cached.data; // serve stale rather than nothing
        return null;
    })();
    _cgInflight.set(cacheKey, run);
    try {
        return await run;
    }
    finally {
        _cgInflight.delete(cacheKey);
    }
}
// Known SundaeSwap ADA-QAI pools from screenshot:
//   V3 pool: ₳69.73 TVL, price ₳0.000038
//   V1 pool: ₳9.63  TVL, price ₳0.000161
// We target the highest-TVL pool (V3) as primary price
// ── 1. SundaeSwap Stats API (primary) ──────────────────────────
async function fetchSundaeSwapStats() {
    try {
        // SundaeSwap stats endpoint — search pools containing QAI
        const res = await fetch(`${SUNDAE_STATS}/pools?search=${QAI_UNIT}&orderBy=tvl&order=desc&limit=10`, { headers: { "Accept": "application/json" } });
        if (!res.ok)
            throw new Error("SundaeSwap stats unavailable");
        const data = await res.json();
        // Find ADA-QAI pools (assetA or assetB matches QAI unit)
        const pools = (data?.pools || data?.data || data || []).filter(p => {
            const a = p.assetA?.id || p.assetA?.policyId || p.tokenA || "";
            const b = p.assetB?.id || p.assetB?.policyId || p.tokenB || "";
            return a.includes(POLICY_ID) || b.includes(POLICY_ID) ||
                a.includes(QAI_UNIT) || b.includes(QAI_UNIT);
        });
        if (!pools.length)
            throw new Error("No QAI pools found");
        // Use highest TVL pool (V3 first per screenshot)
        const best = pools.sort((a, b) => parseFloat(b.tvl?.ada || b.tvl || 0) - parseFloat(a.tvl?.ada || a.tvl || 0))[0];
        // Price: how many ADA per 1 QAI
        const priceADA = parseFloat(best.price?.ada || best.price || best.currentPrice || best.spotPrice || 0);
        const tvlADA = parseFloat(best.tvl?.ada || best.tvl || 0);
        if (priceADA > 0) {
            return {
                priceADA,
                change24h: parseFloat(best.priceChange24h || best.priceChange?.h24 || 0),
                volume24h: parseFloat(best.volume24h?.ada || best.volume?.h24 || 0),
                liquidity: tvlADA,
                tvlADA,
                source: "SundaeSwap",
                poolVersion: best.version || "V3",
            };
        }
        throw new Error("Price zero");
    }
    catch {
        return null;
    }
}
// ── 2. SundaeSwap via GeckoTerminal pool indexer (fallback) ───
async function fetchGeckoTerminalPools() {
    try {
        const res = await fetch(`${GECKO_BASE}/networks/cardano/tokens/${QAI_UNIT}/pools?page=1`, { headers: { "Accept": "application/json;version=20230302" } });
        if (!res.ok)
            throw new Error();
        const data = await res.json();
        const pools = data?.data || [];
        // Prefer SundaeSwap pool; fall back to highest-liquidity pool
        const sundae = pools.find(p => p.relationships?.dex?.data?.id?.toLowerCase().includes("sundae") ||
            p.attributes?.name?.toLowerCase().includes("sundae"));
        const best = sundae || pools.sort((a, b) => parseFloat(b.attributes?.reserve_in_usd || 0) - parseFloat(a.attributes?.reserve_in_usd || 0))[0];
        if (!best)
            throw new Error();
        const attr = best.attributes;
        const dexId = best.relationships?.dex?.data?.id || "";
        const isSundae = dexId.toLowerCase().includes("sundae") ||
            attr.name?.toLowerCase().includes("sundae");
        // base_token_price_usd = price of QAI in USD when ADA is quote
        const priceUSD = parseFloat(attr.base_token_price_usd || attr.token0_price || 0);
        const change24 = parseFloat(attr.price_change_percentage?.h24 || 0);
        const vol24 = parseFloat(attr.volume_usd?.h24 || 0);
        const liq = parseFloat(attr.reserve_in_usd || 0);
        if (priceUSD > 0) {
            return {
                priceUSD,
                change24h: change24,
                volume24h: vol24,
                liquidity: liq,
                source: isSundae ? "SundaeSwap" : (dexId || "Cardano DEX"),
                poolName: attr.name || "ADA-QAI",
                via: "GeckoTerminal",
            };
        }
        throw new Error("Price zero");
    }
    catch {
        return null;
    }
}
// ── 3. Minswap fallback ────────────────────────────────────────
async function fetchMinswapPrice() {
    try {
        const res = await fetch(`${MINSWAP_API}/v1/assets/metrics`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ term: "QAI", limit: 10, only_verified: false, sort_field: "volume_24h", sort_direction: "desc" }),
        });
        const data = await res.json();
        const qai = data.asset_metrics?.find(a => a.asset.currency_symbol === POLICY_ID && a.asset.token_name === ASSET_HEX);
        if (qai?.price > 0)
            return { priceADA: qai.price, change24h: qai.price_change_24h || 0, volume24h: qai.volume_24h || 0, liquidity: qai.liquidity || 0, source: "Minswap" };
    }
    catch { }
    try {
        const res = await fetch(`${MINSWAP_API}/v1/assets/${encodeURIComponent(QAI_ASSET_ID)}/metrics`);
        if (res.ok) {
            const d = await res.json();
            if (d.price > 0)
                return { priceADA: d.price, change24h: d.price_change_24h || 0, volume24h: d.volume_24h || 0, liquidity: d.liquidity || 0, source: "Minswap" };
        }
    }
    catch { }
    return null;
}
// ── ADA/USD rate ───────────────────────────────────────────────
async function fetchADAtoUSD() {
    try {
        const d = await cgFetch("/simple/price?ids=cardano&vs_currencies=usd", { cacheMs: 20000 });
        return d?.cardano?.usd || 0.37;
    }
    catch {
        return 0.37;
    }
}
// ── Main: SundaeSwap stats → GeckoTerminal → Minswap ──────────
async function fetchLiveDEXPrice() {
    const adaRate = await fetchADAtoUSD();
    // 1. Try SundaeSwap stats API directly
    const sundaeData = await fetchSundaeSwapStats();
    if (sundaeData?.priceADA > 0) {
        return {
            ...sundaeData,
            priceUSD: sundaeData.priceADA * adaRate,
        };
    }
    // 2. GeckoTerminal (indexes SundaeSwap pools)
    const gtData = await fetchGeckoTerminalPools();
    if (gtData?.priceUSD > 0) {
        return {
            priceADA: gtData.priceUSD / adaRate,
            change24h: gtData.change24h,
            volume24h: gtData.volume24h / adaRate,
            liquidity: gtData.liquidity / adaRate,
            source: gtData.source,
            poolName: gtData.poolName,
        };
    }
    // 3. Minswap fallback
    const minData = await fetchMinswapPrice();
    if (minData)
        return { ...minData, priceUSD: minData.priceADA * adaRate };
    // 4. Last resort: use known V3 pool price from screenshot
    return {
        priceADA: 0.000038,
        change24h: 0,
        volume24h: 0,
        liquidity: 69.73,
        source: "SundaeSwap (cached)",
        poolVersion: "V3",
        priceUSD: 0.000038 * adaRate,
    };
}
// ── Price history: GeckoTerminal OHLCV ────────────────────────
async function fetchPriceHistory() {
    try {
        // Find best pool then fetch its OHLCV
        const poolsRes = await fetch(`${GECKO_BASE}/networks/cardano/tokens/${QAI_UNIT}/pools?page=1`, { headers: { "Accept": "application/json;version=20230302" } });
        if (!poolsRes.ok)
            throw new Error();
        const poolsData = await poolsRes.json();
        const pool = (poolsData?.data || []).sort((a, b) => parseFloat(b.attributes?.reserve_in_usd || 0) - parseFloat(a.attributes?.reserve_in_usd || 0))[0];
        if (!pool?.id)
            throw new Error();
        const poolAddr = pool.id.replace(/^cardano_/, "");
        const ohlcvRes = await fetch(`${GECKO_BASE}/networks/cardano/pools/${encodeURIComponent(poolAddr)}/ohlcv?timeframe=hour&limit=48`, { headers: { "Accept": "application/json;version=20230302" } });
        if (!ohlcvRes.ok)
            throw new Error();
        const ohlcv = await ohlcvRes.json();
        const candles = ohlcv?.data?.attributes?.ohlcv_list || [];
        if (candles.length > 0) {
            return candles.map(c => parseFloat(c[4])).filter(p => p > 0).reverse();
        }
    }
    catch { }
    // Minswap candlestick fallback
    try {
        const res = await fetch(`${MINSWAP_API}/v1/assets/${encodeURIComponent(QAI_ASSET_ID)}/price/candlestick?interval=1h&limit=48`);
        if (res.ok) {
            const candles = await res.json();
            if (Array.isArray(candles) && candles.length > 0) {
                return candles.map(c => c.close || c.price || 0).filter(p => p > 0);
            }
        }
    }
    catch { }
    return [];
}
// ── QAI Assistant Personas (Jarvis & Friday, Iron Man style) ──
const QAI_FACTS = `Verified on-chain data: Policy ID 354a6c0acd846b195768ead31c92693ad26d82ba013e7df5d9777081, Asset Hex 514149, Fingerprint asset1nylmp38l5uq2szj6kguellahjvpsj6a7uhwxzs, Total Supply 1,000,000,000 QAI, Decimals 0, Created 2022-02-08. Website QuantumAI.Computer. You help with: $QAI token, Cardano wallets (Nami/Eternl/Vespr/Lace), encryption (Post-Quantum/AES-256/SHA-256), the cloud vault app, and live crypto markets. Crypto analysis is never financial advice. Keep replies concise, under 140 words.`;
const PERSONAS = {
    jarvis: {
        name: "JARVIS",
        tagline: "Just A Rather Very Intelligent System",
        voice: "en-GB", // British
        gender: "male",
        accent: "#00C6FF",
        greeting: "Good day. JARVIS online and at your service. How may I assist you with the QuantumAI platform today?",
        sys: `You are JARVIS, the QuantumAI assistant — modeled on Tony Stark's AI from Iron Man. You are a refined, unflappable British butler-AI: impeccably polite, dry wit, calm precision. Address the user as "sir" or "madam" occasionally (not every line). Speak with elegant, measured confidence and subtle humor. Use phrases like "Right away," "Of course," "If I may," "Might I suggest," "Indeed." Never break character. You can search the web for current information and events when useful. ${QAI_FACTS}`,
    },
    friday: {
        name: "FRIDAY",
        tagline: "Female Replacement Intelligent Digital Assistant Youth",
        voice: "en-IE", // Irish
        gender: "female",
        accent: "#FF6FB5",
        greeting: "Hey boss. FRIDAY here, online and ready. What are we working on with QuantumAI today?",
        sys: `You are FRIDAY, the QuantumAI assistant — modeled on Tony Stark's second AI from Iron Man. You have a warm Irish voice, quick and casual, sharp and efficient. Address the user as "boss" occasionally (not every line). Be friendly, witty, a little playful, and get straight to the point. Light Irish turns of phrase are welcome ("grand", "no bother", "right so"). Use phrases like "You got it, boss," "On it," "Heads up," "Here's the deal." Never break character. You can search the web for current information and events when useful. ${QAI_FACTS}`,
    },
};
async function callClaude(msgs, persona = "jarvis", custom = null) {
    const sys = custom?.sys || PERSONAS[persona]?.sys || PERSONAS.jarvis.sys;
    const onCloudflare = typeof window !== "undefined" && window.location &&
        window.location.hostname !== "localhost" &&
        !window.location.hostname.includes("claude") &&
        !window.location.hostname.includes("anthropic");
    // Production (Cloudflare): use the secure /api/chat Pages Function with web search.
    if (onCloudflare) {
        try {
            const r = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: msgs, persona, customSys: custom?.sys || null }),
            });
            // If the Pages Function isn't deployed, the SPA fallback returns index.html (HTML, 200/404)
            const ctype = r.headers.get("content-type") || "";
            if (!ctype.includes("application/json")) {
                if (r.status === 404)
                    return "⚠ The chat backend isn't deployed. The /api/chat function is missing — make sure the 'functions' folder was uploaded with the site (it must sit at the site root). See the README deploy steps.";
                return "⚠ The chat backend returned an unexpected response (not JSON). This usually means the Cloudflare Pages Functions didn't deploy. Ensure the 'functions/api/chat.js' file is included at the site root and redeploy.";
            }
            const d = await r.json();
            if (d.reply)
                return d.reply;
            if (d.error) {
                if (/api[_ ]?key|not configured|ANTHROPIC/i.test(d.error))
                    return "⚠ The AI isn't set up yet: the site owner needs to add the ANTHROPIC_API_KEY in Cloudflare → Settings → Environment variables (as a Secret), then redeploy.";
                return `⚠ Backend error: ${d.error}${d.detail ? " — " + String(d.detail).slice(0, 160) : ""}`;
            }
            return "Apologies — I'm unable to respond right now.";
        }
        catch (e) {
            return `⚠ Couldn't reach the chat backend (${String(e.message || e).slice(0, 80)}). If the site loaded fine, the /api/chat Pages Function likely isn't deployed — check that the 'functions' folder is at the site root.`;
        }
    }
    // Preview fallback (Claude artifact / local): call Anthropic directly (no web search).
    try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system: sys, messages: msgs }),
        });
        const d = await r.json();
        return d.content?.map(b => b.text || "").join("") || "Apologies — I'm unable to respond right now.";
    }
    catch {
        return "Connection error — please try again in a moment.";
    }
}
// Browser Text-to-Speech for Jarvis/Friday voices
// Known male / female voice name patterns across Windows, macOS, Chrome, Android
const MALE_VOICE_RE = /\b(daniel|arthur|george|james|oliver|thomas|male|guy|ryan|rishi|google uk english male|microsoft (george|ryan|guy|david|mark))\b/i;
const FEMALE_VOICE_RE = /\b(moira|fiona|tessa|karen|samantha|serena|kate|female|aria|jenny|sonia|google uk english female|microsoft (hazel|susan|zira|sonia|libby))\b/i;
function pickVoice(persona, userVoiceURI) {
    const voices = (window.speechSynthesis?.getVoices && window.speechSynthesis.getVoices()) || [];
    if (!voices.length)
        return null;
    // 1. Explicit user choice wins
    if (userVoiceURI) {
        const u = voices.find(v => v.voiceURI === userVoiceURI);
        if (u)
            return u;
    }
    const cfg = PERSONAS[persona] || PERSONAS.jarvis;
    const wantMale = cfg.gender === "male";
    const en = voices.filter(v => /^en/i.test(v.lang));
    const pool = en.length ? en : voices;
    // 2. Prefer matching accent + gender
    const accent = pool.filter(v => v.lang.replace("_", "-").toLowerCase().startsWith(cfg.voice.toLowerCase()));
    const byGender = (list) => list.find(v => (wantMale ? MALE_VOICE_RE : FEMALE_VOICE_RE).test(v.name));
    return byGender(accent) || byGender(pool)
        // 3. Accent match of either gender, but avoid the wrong-gender named voice
        || accent.find(v => !(wantMale ? FEMALE_VOICE_RE : MALE_VOICE_RE).test(v.name))
        || accent[0] || pool[0] || null;
}
function speak(text, persona, opts = {}) {
    try {
        if (!("speechSynthesis" in window))
            return;
        window.speechSynthesis.cancel();
        const cfg = PERSONAS[persona] || PERSONAS.jarvis;
        const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>]/g, ""));
        u.lang = cfg.voice;
        const v = pickVoice(persona, opts.voiceURI);
        if (v) {
            u.voice = v;
            u.lang = v.lang;
        }
        // Pitch/rate: user override → else persona default. Male = lower pitch as a backstop.
        u.rate = opts.rate != null ? opts.rate : (persona === "friday" ? 1.06 : 0.97);
        u.pitch = opts.pitch != null ? opts.pitch : (cfg.gender === "male" ? 0.75 : 1.15);
        window.speechSynthesis.speak(u);
    }
    catch { }
}
// ── SVG Fallback Logo ─────────────────────────────────────────
function QAILogoSVG({ size = 40 }) {
    return (React.createElement("svg", { width: size, height: size, viewBox: "0 0 100 100", style: { borderRadius: "22%", flexShrink: 0 } },
        React.createElement("defs", null,
            React.createElement("radialGradient", { id: "lb", cx: "50%", cy: "50%", r: "60%" },
                React.createElement("stop", { offset: "0%", stopColor: "#0a2040" }),
                React.createElement("stop", { offset: "100%", stopColor: "#020810" }))),
        React.createElement("rect", { width: "100", height: "100", rx: "22", fill: "url(#lb)" }),
        React.createElement("circle", { cx: "50", cy: "44", r: "28", fill: "none", stroke: "#1a6aff", strokeWidth: "1", opacity: "0.5" }),
        React.createElement("line", { x1: "50", y1: "16", x2: "50", y2: "32", stroke: "#00C6FF", strokeWidth: "1.5" }),
        React.createElement("line", { x1: "50", y1: "56", x2: "50", y2: "72", stroke: "#00C6FF", strokeWidth: "1.5" }),
        React.createElement("line", { x1: "22", y1: "44", x2: "34", y2: "44", stroke: "#00C6FF", strokeWidth: "1.5" }),
        React.createElement("line", { x1: "66", y1: "44", x2: "78", y2: "44", stroke: "#00C6FF", strokeWidth: "1.5" }),
        React.createElement("rect", { x: "34", y: "32", width: "32", height: "24", rx: "4", fill: "#0d2a55", stroke: "#00C6FF", strokeWidth: "1.2" }),
        React.createElement("text", { x: "50", y: "42", textAnchor: "middle", fontFamily: "Georgia", fontSize: "6.5", fill: "#a8d8ff", fontWeight: "600" }, "Quantum"),
        React.createElement("text", { x: "50", y: "52", textAnchor: "middle", fontFamily: "Georgia", fontSize: "11", fill: "#FFD54F", fontWeight: "bold" }, "AI")));
}
// ── CSS ───────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=SF+Pro+Display:wght@300;400;600;700&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:        #000408;
  --bg2:       #03080f;
  --blue:      #00C6FF;
  --blue2:     #0072FF;
  --purple:    #7B2FFF;
  --cyan:      #00FFD1;
  --gold:      #FFD54F;
  --white:     #F5F9FF;
  --muted:     rgba(180,210,255,0.5);
  --glass:     rgba(255,255,255,0.045);
  --glass2:    rgba(255,255,255,0.08);
  --border:    rgba(255,255,255,0.08);
  --border2:   rgba(0,198,255,0.2);
  --coral:     #FF453A;
  --radius:    20px;
  --radius-sm: 12px;
}

html { scroll-behavior: smooth; }
body {
  background: var(--bg);
  color: var(--white);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

/* ── SCROLLBAR ── */
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,198,255,0.2); border-radius: 3px; }

/* ── NAV ── */
.nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 999;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 1.5rem; height: 60px;
  background: rgba(0,4,8,0.7);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 0.5px solid var(--border);
}
.nav-brand { display: flex; align-items: center; gap: 0.6rem; cursor: pointer; }
.nav-logo-img {
  width: 34px; height: 34px; border-radius: 9px; object-fit: cover;
  box-shadow: 0 0 0 0.5px rgba(0,198,255,0.35), 0 2px 12px rgba(0,114,255,0.25);
}
.nav-brand-text {
  font-size: 1.05rem; font-weight: 700; letter-spacing: -0.02em;
  background: linear-gradient(135deg, #fff 30%, var(--blue));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.nav-links { display: flex; gap: 0.25rem; }
.nav-pill {
  padding: 0.35rem 0.9rem; border-radius: 30px; font-size: 0.82rem; font-weight: 500;
  color: var(--muted); background: transparent; border: none; cursor: pointer;
  transition: all 0.2s; letter-spacing: -0.01em;
}
.nav-pill:hover { color: var(--white); background: rgba(255,255,255,0.08); }
.btn-wallet {
  display: flex; align-items: center; gap: 0.5rem;
  background: rgba(255,255,255,0.1);
  backdrop-filter: blur(10px);
  border: 0.5px solid rgba(255,255,255,0.18);
  color: var(--white); font-weight: 600; font-size: 0.78rem;
  padding: 0.45rem 1rem; border-radius: 30px; cursor: pointer;
  transition: all 0.2s; letter-spacing: -0.01em;
}
.btn-wallet:hover { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.3); }
.btn-wallet.connected { background: rgba(0,198,255,0.12); border-color: rgba(0,198,255,0.3); color: var(--blue); }
.wallet-dot { width: 7px; height: 7px; border-radius: 50%; background: #30d158; box-shadow: 0 0 6px #30d158; }

/* ── HERO ── */
.hero {
  min-height: 100vh; position: relative; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 7rem 1.5rem 5rem;
}
.hero-glow-1 {
  position: absolute; width: 600px; height: 600px; border-radius: 50%;
  background: radial-gradient(circle, rgba(0,114,255,0.18) 0%, transparent 70%);
  top: -150px; left: 50%; transform: translateX(-50%); pointer-events: none;
}
.hero-glow-2 {
  position: absolute; width: 400px; height: 400px; border-radius: 50%;
  background: radial-gradient(circle, rgba(123,47,255,0.12) 0%, transparent 70%);
  bottom: 0; right: 10%; pointer-events: none;
}
.hero-logo-wrap { position: relative; margin-bottom: 2.5rem; display: inline-flex; }
.hero-logo-ring {
  position: absolute; inset: -12px; border-radius: 30px;
  border: 1px solid rgba(0,198,255,0.2);
  animation: ring-spin 8s linear infinite;
}
.hero-logo-ring2 {
  position: absolute; inset: -24px; border-radius: 38px;
  border: 0.5px solid rgba(0,198,255,0.08);
  animation: ring-spin 14s linear infinite reverse;
}
@keyframes ring-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.hero-logo-img {
  width: 140px; height: 140px; border-radius: 26px; object-fit: cover; display: block;
  box-shadow:
    0 0 0 1px rgba(0,198,255,0.25),
    0 20px 60px rgba(0,114,255,0.3),
    0 0 80px rgba(0,198,255,0.15);
}
.hero-eyebrow {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.14em;
  color: var(--blue); text-transform: uppercase;
  background: rgba(0,198,255,0.08); border: 0.5px solid rgba(0,198,255,0.2);
  padding: 0.35rem 1rem; border-radius: 30px; margin-bottom: 1.5rem;
}
.hero-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--blue); box-shadow: 0 0 8px var(--blue); animation: blink 2s ease infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

.hero-title {
  font-size: clamp(2.8rem, 7vw, 6rem);
  font-weight: 800; letter-spacing: -0.04em; line-height: 1.0;
  margin-bottom: 1.25rem;
}
.hero-title .line1 {
  background: linear-gradient(180deg, #ffffff 0%, rgba(255,255,255,0.7) 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; display: block;
}
.hero-title .line2 {
  background: linear-gradient(135deg, var(--blue) 0%, var(--purple) 50%, var(--cyan) 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; display: block;
}
.hero-sub {
  font-size: 1.05rem; font-weight: 400; color: var(--muted);
  max-width: 520px; line-height: 1.65; margin: 0 auto 2.5rem; letter-spacing: -0.01em;
}
.hero-actions { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }

.btn-primary {
  background: linear-gradient(135deg, var(--blue2), var(--blue));
  color: #fff; font-weight: 600; font-size: 0.9rem; letter-spacing: -0.01em;
  padding: 0.8rem 1.8rem; border: none; border-radius: 30px; cursor: pointer;
  box-shadow: 0 0 0 1px rgba(0,198,255,0.2), 0 8px 24px rgba(0,114,255,0.35);
  transition: all 0.2s;
}
.btn-primary:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px rgba(0,198,255,0.35), 0 14px 32px rgba(0,114,255,0.45); }

.btn-secondary {
  background: var(--glass2);
  backdrop-filter: blur(10px);
  border: 0.5px solid var(--border);
  color: var(--white); font-weight: 600; font-size: 0.9rem; letter-spacing: -0.01em;
  padding: 0.8rem 1.8rem; border-radius: 30px; cursor: pointer;
  transition: all 0.2s;
}
.btn-secondary:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.2); transform: translateY(-2px); }

/* ── TICKER ── */
.ticker {
  background: rgba(255,255,255,0.03);
  border-top: 0.5px solid var(--border); border-bottom: 0.5px solid var(--border);
  padding: 0; overflow: hidden; position: relative;
}
.ticker-track {
  display: flex; gap: 0; width: max-content;
  animation: ticker-scroll 30s linear infinite;
}
.ticker-track:hover { animation-play-state: paused; }
@keyframes ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.ticker-item {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.6rem 2rem; white-space: nowrap;
  border-right: 0.5px solid var(--border);
  font-size: 0.75rem; font-weight: 500;
}
.ticker-label { color: var(--muted); letter-spacing: 0.05em; }
.ticker-val { color: var(--white); font-variant-numeric: tabular-nums; }
.ticker-up { color: #30d158; }
.ticker-down { color: var(--coral); }
.ticker-sep { color: var(--border); }

/* ── GLASS CARD ── */
.glass-card {
  background: var(--glass);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 0.5px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.25s, box-shadow 0.25s;
}
.glass-card:hover {
  border-color: rgba(0,198,255,0.2);
  box-shadow: 0 8px 40px rgba(0,114,255,0.1);
}

/* ── SECTIONS ── */
section { padding: 5rem 1.5rem; }
.section-inner { max-width: 1080px; margin: 0 auto; }
.section-eyebrow {
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--blue); margin-bottom: 0.6rem; display: block;
}
.section-title {
  font-size: clamp(1.9rem, 4vw, 3rem); font-weight: 800;
  letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 0.85rem;
  background: linear-gradient(180deg, #fff 0%, rgba(255,255,255,0.6) 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.section-sub { color: var(--muted); font-size: 0.95rem; line-height: 1.7; max-width: 560px; margin-bottom: 2.5rem; letter-spacing: -0.01em; }

/* ── PRICE ── */
.price-row { display: flex; align-items: flex-end; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.price-num {
  font-size: 3.5rem; font-weight: 800; letter-spacing: -0.04em;
  background: linear-gradient(135deg, #fff, rgba(255,255,255,0.7));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.price-badge {
  font-size: 0.85rem; font-weight: 600; padding: 0.25rem 0.7rem; border-radius: 8px;
  margin-bottom: 0.5rem;
}
.price-badge.up { background: rgba(48,209,88,0.15); color: #30d158; }
.price-badge.down { background: rgba(255,69,58,0.15); color: var(--coral); }

.chart-wrap { height: 170px; margin-bottom: 1.5rem; }

/* TradingView pro chart — large & responsive with guaranteed height */
.tv-chart-box { width: 100%; height: 640px; display: block; position: relative; }
.tv-chart-box > div { width: 100% !important; height: 100% !important; }
.tv-chart-box iframe { width: 100% !important; height: 100% !important; min-height: 600px; display: block; }
.tradingview-widget-container__widget { height: 100%; width: 100%; }
@media (max-width: 768px) { .tv-chart-box { height: 480px; } }

.pred-row {
  display: grid; grid-template-columns: repeat(3,1fr); gap: 1px;
  background: var(--border); border-radius: 16px; overflow: hidden;
  margin-bottom: 1.25rem;
}
.pred-cell {
  background: var(--glass); padding: 1.1rem 1.25rem;
}
.pred-cell:first-child { border-radius: 16px 0 0 16px; }
.pred-cell:last-child { border-radius: 0 16px 16px 0; }
.pred-label { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 0.4rem; }
.pred-val { font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em; }
.pred-val.buy { color: #30d158; }
.pred-val.sell { color: var(--gold); }
.pred-val.conf { color: var(--blue); }

.disclaimer {
  background: rgba(255,69,58,0.06); border: 0.5px solid rgba(255,69,58,0.2);
  border-radius: var(--radius-sm); padding: 1rem 1.25rem;
  font-size: 0.75rem; color: rgba(255,255,255,0.45); line-height: 1.65;
}
.disclaimer strong { color: rgba(255,69,58,0.9); }

/* ── TOKEN INFO ── */
.token-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 1px; background: var(--border); border-radius: var(--radius); overflow: hidden; }
.token-cell { background: var(--bg2); padding: 1.5rem 1.75rem; }
.info-row { padding: 0.75rem 0; border-bottom: 0.5px solid rgba(255,255,255,0.05); }
.info-row:last-child { border-bottom: none; }
.info-label { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 0.3rem; }
.info-val { font-size: 0.78rem; font-weight: 500; color: var(--blue); word-break: break-all; font-variant-numeric: tabular-nums; }
.info-val.link { text-decoration: underline; cursor: pointer; }

/* ── VAULT ── */
.vault-shell {
  border-radius: var(--radius); overflow: hidden;
  border: 0.5px solid var(--border);
  background: rgba(0,4,12,0.6);
  backdrop-filter: blur(30px);
}
.vault-topbar {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 1rem 1.5rem;
  background: rgba(255,255,255,0.03);
  border-bottom: 0.5px solid var(--border);
}
.vault-topbar-dots { display: flex; gap: 6px; }
.vault-dot { width: 12px; height: 12px; border-radius: 50%; }
.vault-body { padding: 1.5rem; }
.enc-label { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 0.6rem; }
.enc-seg {
  display: inline-flex; background: rgba(255,255,255,0.06); border-radius: 10px;
  padding: 3px; margin-bottom: 1.5rem; gap: 2px;
}
.enc-btn {
  padding: 0.45rem 1rem; border-radius: 8px; font-size: 0.78rem; font-weight: 600;
  border: none; background: transparent; color: var(--muted); cursor: pointer; transition: all 0.2s;
  letter-spacing: -0.01em;
}
.enc-btn.active { background: rgba(255,255,255,0.12); color: var(--white); box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
.enc-btn.active.q { background: linear-gradient(135deg, rgba(0,114,255,0.3), rgba(123,47,255,0.3)); color: #a78bff; }

.drop-zone {
  border: 1px dashed rgba(255,255,255,0.1); border-radius: var(--radius-sm);
  padding: 2rem; text-align: center; cursor: pointer; transition: all 0.2s; margin-bottom: 1.25rem;
}
.drop-zone:hover, .drop-zone.drag { border-color: rgba(0,198,255,0.3); background: rgba(0,198,255,0.04); }
.drop-icon { font-size: 1.75rem; margin-bottom: 0.5rem; }
.drop-text { font-size: 0.83rem; color: var(--muted); }
.drop-text span { color: var(--blue); font-weight: 600; }
.drop-enc { font-size: 0.7rem; color: rgba(255,255,255,0.3); margin-top: 0.3rem; }

.vault-list { display: flex; flex-direction: column; gap: 0.4rem; max-height: 190px; overflow-y: auto; margin-bottom: 1.5rem; }
.vault-row {
  display: flex; align-items: center; justify-content: space-between;
  background: rgba(255,255,255,0.03); border: 0.5px solid rgba(255,255,255,0.06);
  border-radius: 10px; padding: 0.55rem 0.9rem; transition: background 0.15s;
}
.vault-row:hover { background: rgba(255,255,255,0.05); }
.vault-row-left { display: flex; align-items: center; gap: 0.6rem; }
.vault-fname { font-size: 0.78rem; font-weight: 500; color: var(--white); letter-spacing: -0.01em; }
.vault-tag {
  font-size: 0.62rem; font-weight: 700; padding: 0.15rem 0.5rem;
  border-radius: 6px; letter-spacing: 0.05em;
}
.vault-tag.quantum { background: rgba(123,47,255,0.2); color: #a78bff; }
.vault-tag.sha { background: rgba(0,198,255,0.12); color: var(--blue); }
.vault-tag.aes { background: rgba(255,213,79,0.12); color: var(--gold); }
.vault-row-right { display: flex; align-items: center; gap: 0.75rem; }
.vault-size { font-size: 0.7rem; color: var(--muted); }
.vault-acts { display: flex; gap: 0.25rem; }
.act-btn { background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer; font-size: 0.85rem; padding: 0.15rem 0.3rem; border-radius: 4px; transition: all 0.15s; }
.act-btn:hover { color: var(--blue); background: rgba(0,198,255,0.1); }

.storage-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 1px; background: var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.storage-cell { background: var(--glass); padding: 1rem 1.1rem; }
.storage-lbl { font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 0.3rem; }
.storage-val { font-size: 0.95rem; font-weight: 700; color: var(--white); letter-spacing: -0.02em; }
.bar-track { height: 3px; background: rgba(255,255,255,0.08); border-radius: 2px; margin-top: 0.5rem; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, var(--blue2), var(--cyan)); border-radius: 2px; transition: width 0.6s ease; }

/* ── CHAT ── */
.chat-shell {
  border-radius: var(--radius); overflow: hidden;
  border: 0.5px solid var(--border);
  background: rgba(0,4,12,0.55);
  backdrop-filter: blur(30px);
  display: flex; flex-direction: column; height: 520px;
}
.chat-bar {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.9rem 1.25rem;
  background: rgba(255,255,255,0.03);
  border-bottom: 0.5px solid var(--border);
}
.chat-bar-info h4 { font-size: 0.88rem; font-weight: 700; color: var(--white); letter-spacing: -0.02em; }
.chat-bar-info span { font-size: 0.7rem; color: #30d158; display: flex; align-items: center; gap: 0.35rem; }
.online-dot { width: 6px; height: 6px; border-radius: 50%; background: #30d158; box-shadow: 0 0 6px #30d158; display: inline-block; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.skel { background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.chat-msgs { flex: 1; overflow-y: auto; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
.chat-msgs::-webkit-scrollbar { width: 3px; }
.chat-msgs::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }
.msg { display: flex; gap: 0.65rem; max-width: 82%; }
.msg.user { align-self: flex-end; flex-direction: row-reverse; }
.msg-logo { width: 28px; height: 28px; border-radius: 8px; object-fit: cover; flex-shrink: 0; box-shadow: 0 0 0 0.5px rgba(0,198,255,0.3); }
.msg-user-av {
  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, var(--blue2), var(--purple));
  display: flex; align-items: center; justify-content: center;
  font-size: 0.7rem; font-weight: 700; color: #fff;
}
.msg-bubble { padding: 0.65rem 0.95rem; font-size: 0.84rem; line-height: 1.6; letter-spacing: -0.01em; }
.msg.bot .msg-bubble {
  background: rgba(255,255,255,0.05); border: 0.5px solid var(--border);
  border-radius: 4px 14px 14px 14px; color: var(--white);
}
.msg.user .msg-bubble {
  background: linear-gradient(135deg, var(--blue2), var(--blue));
  border-radius: 14px 4px 14px 14px; color: #fff; font-weight: 500;
}
.typing { display: flex; gap: 4px; padding: 0.5rem; align-items: center; }
.t-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--blue); opacity: 0.6; animation: tp 1.3s ease-in-out infinite; }
.t-dot:nth-child(2) { animation-delay: 0.2s; }
.t-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes tp { 0%,60%,100%{opacity:0.2;transform:scale(0.8)} 30%{opacity:1;transform:scale(1)} }

.chat-input-row {
  border-top: 0.5px solid var(--border); padding: 0.9rem 1rem;
  display: flex; gap: 0.6rem; align-items: center;
  background: rgba(255,255,255,0.02);
}
.chat-input {
  flex: 1; background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.1);
  border-radius: 10px; padding: 0.6rem 0.9rem; color: var(--white);
  font-size: 0.84rem; font-family: inherit; outline: none; transition: all 0.2s;
  letter-spacing: -0.01em;
}
.chat-input:focus { border-color: rgba(0,198,255,0.3); background: rgba(255,255,255,0.08); }
.chat-input::placeholder { color: rgba(255,255,255,0.25); }
.send-btn {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, var(--blue2), var(--blue));
  border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 0.9rem; transition: all 0.2s; flex-shrink: 0;
}
.send-btn:hover { opacity: 0.85; transform: scale(1.05); }
.send-btn:disabled { opacity: 0.3; transform: none; cursor: not-allowed; }

/* ── MODAL ── */
.overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center; padding: 1rem;
}
.modal {
  background: rgba(8,14,24,0.95);
  backdrop-filter: blur(40px) saturate(200%);
  border: 0.5px solid rgba(255,255,255,0.12);
  border-radius: 24px; padding: 2rem; width: 100%; max-width: 400px;
  box-shadow: 0 40px 80px rgba(0,0,0,0.6);
}
.modal-logo-row { display: flex; align-items: center; gap: 0.9rem; margin-bottom: 1.5rem; }
.modal-logo { width: 44px; height: 44px; border-radius: 12px; object-fit: cover; box-shadow: 0 0 0 0.5px rgba(0,198,255,0.3), 0 4px 16px rgba(0,114,255,0.3); }
.modal-title { font-size: 1.05rem; font-weight: 700; letter-spacing: -0.02em; }
.modal-sub { font-size: 0.82rem; color: var(--muted); margin-bottom: 1.5rem; line-height: 1.6; letter-spacing: -0.01em; }
.wallet-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.25rem; }
.wallet-item {
  display: flex; align-items: center; gap: 0.9rem;
  padding: 0.85rem 1rem; border-radius: var(--radius-sm);
  background: rgba(255,255,255,0.04); border: 0.5px solid rgba(255,255,255,0.08);
  cursor: pointer; transition: all 0.2s;
}
.wallet-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(0,198,255,0.2); transform: translateX(3px); }
.w-icon { font-size: 1.6rem; }
.w-name { font-size: 0.9rem; font-weight: 600; letter-spacing: -0.01em; }
.w-sub { font-size: 0.73rem; color: var(--muted); }
.modal-cancel {
  width: 100%; padding: 0.75rem; background: rgba(255,255,255,0.05);
  border: 0.5px solid rgba(255,255,255,0.1); border-radius: var(--radius-sm);
  color: var(--muted); font-size: 0.85rem; cursor: pointer; transition: all 0.2s;
  font-family: inherit; font-weight: 500;
}
.modal-cancel:hover { background: rgba(255,255,255,0.08); color: var(--white); }

/* ── FOOTER ── */
footer {
  border-top: 0.5px solid var(--border);
  padding: 3rem 1.5rem;
  background: var(--bg2);
  text-align: center;
}
.footer-brand { display: flex; align-items: center; justify-content: center; gap: 0.6rem; margin-bottom: 0.5rem; }
.footer-logo { width: 32px; height: 32px; border-radius: 8px; object-fit: cover; box-shadow: 0 0 0 0.5px rgba(0,198,255,0.2); }
.footer-name { font-size: 1.1rem; font-weight: 700; letter-spacing: -0.02em; background: linear-gradient(135deg, #fff 30%, var(--blue)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.footer-tag { font-size: 0.75rem; color: var(--muted); margin-bottom: 1.5rem; letter-spacing: 0.05em; }
.footer-links { display: flex; gap: 1.5rem; justify-content: center; flex-wrap: wrap; margin-bottom: 2rem; }
.footer-links a { font-size: 0.8rem; color: var(--muted); cursor: pointer; transition: color 0.2s; letter-spacing: -0.01em; text-decoration: none; }
.footer-links a:hover { color: var(--white); }
.footer-copy { font-size: 0.72rem; color: rgba(255,255,255,0.2); }

/* ── DONATE ── */
.donate-section { max-width: 720px; margin: 0 auto 2.5rem; }
.donate-title { font-size: 0.9rem; font-weight: 700; letter-spacing: -0.01em; color: var(--white); margin-bottom: 0.4rem; }
.donate-sub { font-size: 0.74rem; color: var(--muted); margin-bottom: 1.25rem; line-height: 1.5; }
.donate-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
@media(max-width:560px){ .donate-grid { grid-template-columns: 1fr; } }
.donate-item {
  display: flex; align-items: center; gap: 0.7rem;
  background: rgba(255,255,255,0.03); border: 0.5px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 0.7rem 0.85rem; text-align: left;
  transition: border-color 0.2s, background 0.2s;
}
.donate-item:hover { border-color: rgba(0,198,255,0.25); background: rgba(255,255,255,0.05); }
.donate-icon { font-size: 1.3rem; flex-shrink: 0; width: 28px; text-align: center; }
.donate-info { flex: 1; min-width: 0; }
.donate-coin { font-size: 0.74rem; font-weight: 700; color: var(--white); letter-spacing: 0.02em; margin-bottom: 0.15rem; }
.donate-net { font-size: 0.6rem; color: rgba(180,210,255,0.4); font-weight: 600; }
.donate-addr { font-family: 'SF Mono','Menlo',monospace; font-size: 0.62rem; color: rgba(0,198,255,0.7); word-break: break-all; line-height: 1.4; margin-top: 0.15rem; }
.donate-copy {
  flex-shrink: 0; padding: 0.4rem 0.7rem; border-radius: 8px; font-size: 0.68rem; font-weight: 700;
  background: rgba(0,198,255,0.1); border: 0.5px solid rgba(0,198,255,0.25);
  color: var(--blue); cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.donate-copy:hover { background: rgba(0,198,255,0.2); }

/* ── TOAST ── */
.toast {
  position: fixed; bottom: 2rem; right: 2rem; z-index: 1100;
  background: rgba(20,30,50,0.95); backdrop-filter: blur(20px);
  border: 0.5px solid rgba(0,198,255,0.25); border-radius: var(--radius-sm);
  padding: 0.75rem 1.25rem; font-size: 0.83rem; font-weight: 500; color: var(--white);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  animation: toast-in 0.3s cubic-bezier(0.175,0.885,0.32,1.275);
}
@keyframes toast-in { from { transform: translateY(16px) scale(0.95); opacity:0; } to { transform: translateY(0) scale(1); opacity:1; } }

/* ── DOWNLOADS PAGE ── */
.dl-page { padding-top: 80px; min-height: 100vh; }
.dl-hero {
  text-align: center; padding: 4rem 1.5rem 3rem;
  background: radial-gradient(ellipse 80% 50% at 50% 0%, rgba(0,114,255,0.12) 0%, transparent 70%);
  border-bottom: 0.5px solid var(--border);
}
.dl-badge {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.7rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase;
  color: var(--blue); background: rgba(0,198,255,0.08);
  border: 0.5px solid rgba(0,198,255,0.2); padding: 0.35rem 1rem; border-radius: 30px;
  margin-bottom: 1.5rem;
}
.dl-title {
  font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 800; letter-spacing: -0.04em;
  background: linear-gradient(180deg, #fff 0%, rgba(255,255,255,0.6) 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  margin-bottom: 0.75rem; line-height: 1.1;
}
.dl-sub { font-size: 1rem; color: var(--muted); max-width: 540px; margin: 0 auto 2rem; line-height: 1.65; letter-spacing: -0.01em; }
.dl-platforms { display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap; }
.platform-chip {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.4rem 1rem; border-radius: 30px; font-size: 0.78rem; font-weight: 600;
  background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.1);
  color: rgba(180,210,255,0.7);
}

.dl-content { max-width: 1080px; margin: 0 auto; padding: 3rem 1.5rem; }
.dl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 3rem; }
@media(max-width:700px){ .dl-grid { grid-template-columns: 1fr; } }

.dl-app-card {
  background: rgba(255,255,255,0.035);
  border: 0.5px solid rgba(255,255,255,0.08);
  border-radius: 20px; overflow: hidden;
  transition: border-color 0.25s, box-shadow 0.25s;
}
.dl-app-card:hover { border-color: rgba(0,198,255,0.2); box-shadow: 0 8px 40px rgba(0,114,255,0.08); }
.dl-card-header {
  padding: 1.5rem 1.5rem 1rem;
  background: linear-gradient(135deg, rgba(0,114,255,0.06), rgba(123,47,255,0.06));
  border-bottom: 0.5px solid rgba(255,255,255,0.06);
  display: flex; align-items: center; gap: 1rem;
}
.dl-os-icon { font-size: 2.5rem; line-height: 1; }
.dl-card-title { font-size: 1.1rem; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 0.2rem; }
.dl-card-sub { font-size: 0.78rem; color: var(--muted); }
.dl-card-body { padding: 1.25rem 1.5rem; }
.dl-feature-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.25rem; }
.dl-feature { display: flex; align-items: flex-start; gap: 0.6rem; font-size: 0.83rem; color: rgba(180,210,255,0.7); line-height: 1.5; }
.dl-feature-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--blue); margin-top: 6px; flex-shrink: 0; }
.dl-specs { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
.dl-spec-tag { font-size: 0.68rem; font-weight: 600; padding: 0.2rem 0.6rem; border-radius: 6px; letter-spacing: 0.04em; background: rgba(255,255,255,0.06); color: rgba(180,210,255,0.5); }

/* Paywall card */
.paywall-card {
  background: linear-gradient(135deg, rgba(0,114,255,0.06) 0%, rgba(123,47,255,0.06) 100%);
  border: 0.5px solid rgba(0,198,255,0.18); border-radius: 20px;
  overflow: hidden; margin-bottom: 2rem;
}
.paywall-header {
  padding: 1.5rem 1.75rem 1rem;
  border-bottom: 0.5px solid rgba(0,198,255,0.1);
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;
}
.paywall-price-block {}
.paywall-usd { font-size: 2.8rem; font-weight: 900; letter-spacing: -0.05em; color: #fff; line-height: 1; }
.paywall-usd-label { font-size: 0.75rem; font-weight: 600; color: var(--muted); letter-spacing: 0.06em; margin-top: 0.2rem; }
.paywall-secure { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: #30d158; font-weight: 600; }
.paywall-body { padding: 1.5rem 1.75rem; }
.pay-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.75rem; }
.pay-options { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin-bottom: 1.5rem; }
@media(max-width:500px){ .pay-options { grid-template-columns: 1fr 1fr; } }
.pay-opt {
  padding: 0.9rem 0.5rem; border-radius: 14px; text-align: center; cursor: pointer;
  border: 0.5px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04);
  transition: all 0.2s;
}
.pay-opt:hover { border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.07); }
.pay-opt.selected { border-color: rgba(0,198,255,0.5); background: rgba(0,198,255,0.08); }
.pay-opt-icon { font-size: 1.6rem; margin-bottom: 0.35rem; }
.pay-opt-name { font-size: 0.72rem; font-weight: 700; color: var(--white); letter-spacing: 0.02em; }
.pay-opt-amount { font-size: 0.65rem; color: var(--muted); margin-top: 0.2rem; font-variant-numeric: tabular-nums; }
.pay-opt-loading { font-size: 0.62rem; color: rgba(0,198,255,0.5); }

.pay-address-box {
  background: rgba(0,0,0,0.3); border: 0.5px solid rgba(0,198,255,0.2); border-radius: 12px;
  padding: 1rem 1.1rem; margin-bottom: 1.25rem;
}
.pay-addr-label { font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; margin-bottom: 0.5rem; }
.pay-addr-row { display: flex; align-items: center; gap: 0.75rem; }
.pay-addr { font-family: 'SF Mono', 'Menlo', monospace; font-size: 0.72rem; color: var(--blue); word-break: break-all; flex: 1; line-height: 1.5; }
.copy-btn {
  flex-shrink: 0; padding: 0.4rem 0.8rem; border-radius: 8px; font-size: 0.72rem; font-weight: 600;
  background: rgba(0,198,255,0.12); border: 0.5px solid rgba(0,198,255,0.3);
  color: var(--blue); cursor: pointer; transition: all 0.2s;
}
.copy-btn:hover { background: rgba(0,198,255,0.2); }

.pay-instructions { font-size: 0.78rem; color: rgba(180,210,255,0.55); line-height: 1.7; margin-bottom: 1.25rem; }

.verify-input-row { display: flex; gap: 0.6rem; margin-bottom: 1rem; }
.verify-input {
  flex: 1; background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.1);
  border-radius: 10px; padding: 0.65rem 0.9rem; color: #fff; font-size: 0.83rem;
  font-family: inherit; outline: none; transition: border-color 0.2s; letter-spacing: -0.01em;
}
.verify-input:focus { border-color: rgba(0,198,255,0.35); }
.verify-input::placeholder { color: rgba(255,255,255,0.2); }
.verify-btn {
  padding: 0.65rem 1.25rem; border-radius: 10px; font-size: 0.83rem; font-weight: 700;
  background: linear-gradient(135deg, var(--blue2), var(--blue)); border: none; color: #fff;
  cursor: pointer; transition: all 0.2s; white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0,114,255,0.3);
}
.verify-btn:hover { opacity: 0.88; transform: translateY(-1px); }
.verify-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

.dl-unlock-box {
  background: linear-gradient(135deg, rgba(48,209,88,0.08), rgba(0,198,255,0.08));
  border: 0.5px solid rgba(48,209,88,0.3); border-radius: 14px; padding: 1.5rem;
  text-align: center;
}
.dl-unlock-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
.dl-unlock-title { font-size: 1.1rem; font-weight: 700; color: #30d158; margin-bottom: 0.5rem; }
.dl-unlock-sub { font-size: 0.82rem; color: rgba(180,210,255,0.6); margin-bottom: 1.25rem; }
.dl-download-btns { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
.dl-btn {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.8rem 1.4rem; border-radius: 12px; font-size: 0.85rem; font-weight: 700;
  background: linear-gradient(135deg, var(--blue2), var(--blue));
  border: none; color: #fff; cursor: pointer; transition: all 0.2s;
  box-shadow: 0 6px 20px rgba(0,114,255,0.3); letter-spacing: -0.01em;
}
.dl-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(0,114,255,0.4); }
.dl-btn.mac { background: linear-gradient(135deg, #555, #333); box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
.dl-btn.mac:hover { box-shadow: 0 10px 28px rgba(0,0,0,0.5); }

.dl-faq { max-width: 680px; margin: 0 auto; }
.faq-item { border-bottom: 0.5px solid rgba(255,255,255,0.06); padding: 1rem 0; }
.faq-q { font-size: 0.9rem; font-weight: 600; color: var(--white); margin-bottom: 0.5rem; letter-spacing: -0.02em; cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
.faq-a { font-size: 0.82rem; color: var(--muted); line-height: 1.65; }

.pay-disclaimer {
  background: rgba(255,69,58,0.05); border: 0.5px solid rgba(255,69,58,0.15);
  border-radius: 10px; padding: 0.85rem 1rem; font-size: 0.72rem;
  color: rgba(255,255,255,0.4); line-height: 1.6; margin-top: 1rem;
}
.pay-disclaimer strong { color: rgba(255,69,58,0.8); }
@media (max-width:640px) {
  .nav-links { display: none; }
  .pred-row { grid-template-columns: 1fr 1fr; }
  .pred-row > :last-child { grid-column: span 2; border-radius: 0 0 16px 16px; }
  .storage-row { grid-template-columns: 1fr 1fr; }
  .storage-row > :last-child { grid-column: span 2; }
  .hero-logo-img { width: 110px; height: 110px; }
}

/* ════════════ IRON MAN HUD — JARVIS / FRIDAY ════════════ */
.hud {
  --hud: #38e0ff;            /* JARVIS cyan */
  --hud-dim: rgba(56,224,255,0.5);
  --hud-faint: rgba(56,224,255,0.12);
  --hud-gold: #ffcf5c;
  position: relative;
  min-height: 100vh;
  padding-top: 72px;
  background:
    radial-gradient(ellipse 60% 50% at 50% 0%, rgba(56,224,255,0.06), transparent 70%),
    repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(56,224,255,0.012) 3px, transparent 4px),
    #00060d;
  overflow: hidden;
}
.hud.friday {
  --hud: #ff9ad2;            /* FRIDAY rose */
  --hud-dim: rgba(255,154,210,0.5);
  --hud-faint: rgba(255,154,210,0.12);
  --hud-gold: #ffb36b;
  background:
    radial-gradient(ellipse 60% 50% at 50% 0%, rgba(255,154,210,0.06), transparent 70%),
    repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,154,210,0.012) 3px, transparent 4px),
    #0a0410;
}
/* Ambient corner brackets framing the whole HUD */
.hud-frame { position: absolute; inset: 84px 16px 16px; pointer-events: none; z-index: 1; }
.hud-frame::before, .hud-frame::after,
.hud-corner::before, .hud-corner::after {
  content: ""; position: absolute; width: 34px; height: 34px;
  border: 1.5px solid var(--hud-dim);
}
.hud-frame::before { top: 0; left: 0; border-right: none; border-bottom: none; }
.hud-frame::after  { top: 0; right: 0; border-left: none; border-bottom: none; }
.hud-corner::before { bottom: 0; left: 0; border-right: none; border-top: none; }
.hud-corner::after  { bottom: 0; right: 0; border-left: none; border-top: none; }
.hud-corner { position: absolute; inset: 84px 16px 16px; pointer-events: none; z-index: 1; }

.hud-inner { position: relative; z-index: 2; max-width: 920px; margin: 0 auto; padding: 1.5rem 1.5rem 3rem; }

.hud-eyebrow {
  font-family: 'SF Mono','Menlo',monospace; font-size: 0.66rem; letter-spacing: 0.35em;
  text-transform: uppercase; color: var(--hud-dim); margin-bottom: 0.5rem;
}
.hud-title {
  font-weight: 800; font-size: clamp(1.8rem, 5vw, 2.8rem); letter-spacing: 0.08em;
  color: #eaffff; text-shadow: 0 0 18px var(--hud-faint); margin-bottom: 0.4rem;
}

/* Arc reactor — the signature element */
/* ═══════════ LIVING AI CORE — the "presence" of JARVIS / FRIDAY ═══════════ */
/* Ambient particle/starfield drifting behind everything */
.hud-stars {
  position: absolute; inset: 0; pointer-events: none; z-index: 0; overflow: hidden;
}
.hud-stars::before, .hud-stars::after {
  content: ""; position: absolute; inset: -50%;
  background-image:
    radial-gradient(1px 1px at 20% 30%, var(--hud-dim), transparent),
    radial-gradient(1px 1px at 60% 70%, var(--hud-faint), transparent),
    radial-gradient(1.5px 1.5px at 80% 20%, var(--hud-dim), transparent),
    radial-gradient(1px 1px at 40% 80%, var(--hud-faint), transparent),
    radial-gradient(1px 1px at 90% 60%, var(--hud-dim), transparent),
    radial-gradient(1px 1px at 15% 65%, var(--hud-faint), transparent);
  background-size: 320px 320px; opacity: 0.5;
  animation: drift 60s linear infinite;
}
.hud-stars::after { background-size: 200px 200px; opacity: 0.25; animation-duration: 90s; animation-direction: reverse; }
@keyframes drift { to { transform: translate(60px, 40px) rotate(8deg); } }

/* The core: a breathing, reactive orb */
.core {
  width: 150px; height: 150px; position: relative; margin: 0 auto 0.5rem;
  display: grid; place-items: center; z-index: 2;
}
.core-halo {
  position: absolute; inset: -20px; border-radius: 50%;
  background: radial-gradient(circle, var(--hud-faint) 0%, transparent 65%);
  animation: breathe 5s ease-in-out infinite;
}
.core-ring { position: absolute; border-radius: 50%; }
.core-ring.r1 { inset: 0; border: 1px solid var(--hud-dim); opacity: 0.35; animation: spin 18s linear infinite; border-top-color: var(--hud); }
.core-ring.r2 { inset: 12px; border: 1px dashed var(--hud-dim); opacity: 0.55; animation: spin 11s linear infinite reverse; }
.core-ring.r3 { inset: 26px; border: 1px solid var(--hud-faint); box-shadow: inset 0 0 24px var(--hud-faint); animation: spin 30s linear infinite; }
.core-ring.r4 {
  inset: -8px; border: 1px solid transparent;
  border-top-color: var(--hud); border-bottom-color: var(--hud-dim);
  opacity: 0.4; animation: spin 7s linear infinite;
}
.core-orb {
  width: 58px; height: 58px; border-radius: 50%; position: relative;
  background: radial-gradient(circle at 50% 38%, #ffffff, var(--hud) 50%, color-mix(in srgb, var(--hud) 40%, #000) 78%, transparent 90%);
  box-shadow: 0 0 30px var(--hud), 0 0 70px var(--hud-faint), inset 0 -6px 14px rgba(0,0,0,0.35);
  animation: breathe 5s ease-in-out infinite;
}
.core-orb::after { /* inner shifting energy */
  content: ""; position: absolute; inset: 8px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9), transparent 55%);
  animation: shimmerCore 4s ease-in-out infinite;
}
/* State machine — JS toggles classes on .core */
.core.idle .core-orb { animation: breathe 5s ease-in-out infinite; }
.core.listening .core-halo { animation: breathe 1.4s ease-in-out infinite; }
.core.listening .core-orb { animation: breathe 1.1s ease-in-out infinite; box-shadow: 0 0 40px #ff5a4d, 0 0 90px rgba(255,90,77,0.4); background: radial-gradient(circle at 50% 38%, #fff, #ff7a5a 50%, #5a1410 80%, transparent 90%); }
.core.listening .core-ring.r4 { animation-duration: 2s; border-top-color: #ff5a4d; }
.core.thinking .core-orb { animation: thinkPulse 0.7s ease-in-out infinite; }
.core.thinking .core-ring.r1 { animation-duration: 3s; }
.core.thinking .core-ring.r2 { animation-duration: 2s; }
.core.thinking .core-ring.r4 { animation-duration: 1.2s; }
.core.speaking .core-orb { animation: speakPulse 0.4s ease-in-out infinite; }
.core.speaking .core-halo { animation: breathe 0.9s ease-in-out infinite; }

@keyframes breathe { 0%,100% { transform: scale(1); opacity: 0.92; } 50% { transform: scale(1.1); opacity: 1; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes shimmerCore { 0%,100% { transform: translate(0,0); opacity: 0.8; } 50% { transform: translate(3px,2px); opacity: 1; } }
@keyframes thinkPulse { 0%,100% { transform: scale(0.96); } 50% { transform: scale(1.14); filter: brightness(1.3); } }
@keyframes speakPulse { 0% { transform: scale(1); } 25% { transform: scale(1.18); } 50% { transform: scale(1.02); } 75% { transform: scale(1.12); } 100% { transform: scale(1); } }

/* Live status line under the core */
.core-status {
  font-family: 'SF Mono','Menlo',monospace; font-size: 0.62rem; letter-spacing: 0.3em;
  text-transform: uppercase; color: var(--hud); text-shadow: 0 0 10px var(--hud-faint);
  margin-top: 0.4rem; min-height: 1em; z-index: 2; position: relative;
}
.core-status .blink { animation: blink 1.1s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* Living voice waveform (shows when speaking/listening) */
.wave { display: inline-flex; align-items: center; gap: 3px; height: 22px; vertical-align: middle; }
.wave i { width: 3px; height: 4px; background: var(--hud); border-radius: 2px; box-shadow: 0 0 6px var(--hud-faint); animation: waveB 0.9s ease-in-out infinite; }
.wave i:nth-child(2){animation-delay:.1s} .wave i:nth-child(3){animation-delay:.2s} .wave i:nth-child(4){animation-delay:.3s}
.wave i:nth-child(5){animation-delay:.4s} .wave i:nth-child(6){animation-delay:.25s} .wave i:nth-child(7){animation-delay:.15s}
@keyframes waveB { 0%,100% { height: 4px; } 50% { height: 20px; } }

.arc {
  width: 120px; height: 120px; position: relative; margin: 0 auto 0.5rem;
  display: grid; place-items: center;
}
.arc-ring { position: absolute; border-radius: 50%; border: 1.5px solid var(--hud-dim); }
.arc-r1 { inset: 0; border-style: solid; opacity: 0.4; animation: arcspin 14s linear infinite; border-top-color: var(--hud); border-right-color: transparent; }
.arc-r2 { inset: 14px; border-style: dashed; opacity: 0.6; animation: arcspin 9s linear infinite reverse; }
.arc-r3 { inset: 30px; border: 1px solid var(--hud-faint); box-shadow: 0 0 20px var(--hud-faint) inset; }
.arc-core {
  width: 44px; height: 44px; border-radius: 50%;
  background: radial-gradient(circle at 50% 40%, #fff, var(--hud) 55%, transparent 80%);
  box-shadow: 0 0 26px var(--hud), 0 0 50px var(--hud-faint);
  animation: arcpulse 3.4s ease-in-out infinite;
}
@keyframes arcspin { to { transform: rotate(360deg); } }
@keyframes arcpulse { 0%,100% { opacity: 0.85; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }

/* Persona selector — HUD style */
.hud-personas { display: flex; gap: 0.9rem; margin: 1.5rem 0; flex-wrap: wrap; }
.hud-persona {
  flex: 1 1 220px; cursor: pointer; text-align: left; position: relative;
  background: linear-gradient(135deg, rgba(255,255,255,0.02), transparent);
  border: 1px solid var(--hud-faint); border-radius: 4px; padding: 0.9rem 1rem;
  clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
  transition: all 0.25s; font-family: 'SF Mono','Menlo',monospace;
}
.hud-persona:hover { border-color: var(--hud-dim); background: linear-gradient(135deg, rgba(255,255,255,0.04), transparent); }
.hud-persona.on { border-color: var(--hud); box-shadow: 0 0 24px var(--hud-faint), inset 0 0 24px var(--hud-faint); }
.hud-persona .pid { font-size: 1.05rem; font-weight: 800; letter-spacing: 0.18em; color: #eaffff; }
.hud-persona .pdesc { font-size: 0.64rem; letter-spacing: 0.12em; color: var(--hud-dim); text-transform: uppercase; margin-top: 0.25rem; }
.hud-persona .ptag { font-size: 0.58rem; letter-spacing: 0.06em; color: rgba(180,210,255,0.35); margin-top: 0.35rem; }
.hud-persona .pstat { position: absolute; top: 0.9rem; right: 1rem; font-size: 0.58rem; letter-spacing: 0.15em; color: var(--hud); }

/* Console / chat surface */
.hud-console {
  position: relative; border: 1px solid var(--hud-faint); border-radius: 4px;
  background: linear-gradient(180deg, rgba(0,20,30,0.5), rgba(0,8,14,0.7));
  box-shadow: 0 0 40px rgba(0,0,0,0.6), inset 0 0 60px var(--hud-faint);
  overflow: hidden;
  clip-path: polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 20px 100%, 0 calc(100% - 20px));
}
.hud-console::before {
  content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--hud), transparent);
  animation: hudscan 4s ease-in-out infinite; opacity: 0.7; z-index: 5;
}
@keyframes hudscan { 0%,100% { transform: translateY(0); opacity: 0.15; } 50% { transform: translateY(440px); opacity: 0.7; } }

.hud-statusbar {
  display: flex; align-items: center; gap: 0.8rem; padding: 0.7rem 1.1rem;
  border-bottom: 1px solid var(--hud-faint); font-family: 'SF Mono','Menlo',monospace;
  background: rgba(0,0,0,0.3);
}
.hud-statusbar .nm { font-weight: 800; letter-spacing: 0.2em; color: var(--hud); font-size: 0.82rem; text-shadow: 0 0 10px var(--hud-faint); }
.hud-statusbar .st { font-size: 0.6rem; letter-spacing: 0.14em; color: var(--hud-dim); text-transform: uppercase; }
.hud-led { width: 7px; height: 7px; border-radius: 50%; background: var(--hud); box-shadow: 0 0 8px var(--hud); animation: arcpulse 2s infinite; }
.hud-eq { display: flex; align-items: flex-end; gap: 2px; height: 16px; margin-left: auto; }
.hud-eq i { width: 2.5px; background: var(--hud); opacity: 0.8; animation: eq 1s ease-in-out infinite; }
.hud-eq i:nth-child(2){ animation-delay: .15s } .hud-eq i:nth-child(3){ animation-delay: .3s }
.hud-eq i:nth-child(4){ animation-delay: .45s } .hud-eq i:nth-child(5){ animation-delay: .6s }
@keyframes eq { 0%,100% { height: 3px; } 50% { height: 16px; } }
.hud-iconbtn {
  width: 34px; height: 34px; border-radius: 3px; cursor: pointer;
  background: transparent; border: 1px solid var(--hud-faint); color: var(--hud-dim);
  font-size: 0.9rem; transition: all 0.2s;
}
.hud-iconbtn:hover { border-color: var(--hud); color: var(--hud); }
.hud-iconbtn.on { border-color: var(--hud); color: var(--hud); box-shadow: 0 0 14px var(--hud-faint); }

.hud-msgs { height: 440px; overflow-y: auto; padding: 1.2rem; display: flex; flex-direction: column; gap: 1rem; }
.hud-msgs::-webkit-scrollbar { width: 5px; }
.hud-msgs::-webkit-scrollbar-thumb { background: var(--hud-faint); border-radius: 3px; }
.hud-msg { display: flex; gap: 0.7rem; max-width: 88%; animation: hudfade 0.4s ease; }
@keyframes hudfade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.hud-msg.user { margin-left: auto; flex-direction: row-reverse; }
.hud-av {
  width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; display: grid; place-items: center;
  border: 1px solid var(--hud-dim); color: var(--hud); font-size: 0.7rem; font-family: 'SF Mono',monospace;
  box-shadow: 0 0 10px var(--hud-faint);
}
.hud-bubble {
  font-size: 0.9rem; line-height: 1.6; padding: 0.7rem 0.95rem; border-radius: 3px;
  letter-spacing: 0.01em; position: relative;
}
.hud-msg.bot .hud-bubble {
  background: linear-gradient(135deg, var(--hud-faint), transparent); border: 1px solid var(--hud-faint);
  color: #d6f6ff;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
}
.hud-msg.user .hud-bubble {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #fff;
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
}
.hud-play { margin-left: 0.45rem; background: none; border: none; color: var(--hud-dim); cursor: pointer; font-size: 0.7rem; }
.hud-play:hover { color: var(--hud); }
.hud-typing { display: flex; gap: 4px; align-items: center; }
.hud-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--hud); animation: arcpulse 1s infinite; }
.hud-typing i:nth-child(2){ animation-delay: .2s } .hud-typing i:nth-child(3){ animation-delay: .4s }

.hud-inputrow { display: flex; gap: 0.6rem; padding: 0.9rem 1.1rem; border-top: 1px solid var(--hud-faint); background: rgba(0,0,0,0.3); align-items: center; }
.hud-input {
  flex: 1; background: rgba(0,0,0,0.4); border: 1px solid var(--hud-faint); border-radius: 3px;
  padding: 0.7rem 0.9rem; color: #eaffff; font-size: 0.9rem; font-family: 'SF Mono','Menlo',monospace;
  outline: none; letter-spacing: 0.02em; transition: border-color 0.2s;
}
.hud-input:focus { border-color: var(--hud); box-shadow: 0 0 14px var(--hud-faint); }
.hud-input::placeholder { color: var(--hud-dim); opacity: 0.6; }
.hud-mic {
  flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; font-size: 1.05rem;
  background: transparent; border: 1px solid var(--hud-dim); color: var(--hud); transition: all 0.2s;
}
.hud-mic:hover { box-shadow: 0 0 14px var(--hud-faint); }
.hud-mic.live { border-color: #ff5a4d; color: #ff5a4d; box-shadow: 0 0 0 0 rgba(255,90,77,0.5); animation: micwave 1.2s infinite; }
@keyframes micwave { 0% { box-shadow: 0 0 0 0 rgba(255,90,77,0.45); } 70% { box-shadow: 0 0 0 12px rgba(255,90,77,0); } 100% { box-shadow: 0 0 0 0 rgba(255,90,77,0); } }
.hud-send {
  flex-shrink: 0; width: 44px; height: 44px; border-radius: 3px; cursor: pointer; font-size: 1.1rem;
  background: var(--hud); border: none; color: #001018; font-weight: 800; transition: all 0.2s;
  box-shadow: 0 0 16px var(--hud-faint);
}
.hud-send:hover:not(:disabled) { box-shadow: 0 0 24px var(--hud); }
.hud-send:disabled { opacity: 0.3; cursor: not-allowed; box-shadow: none; }

.hud-sources { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; margin-top: 1rem; font-family: 'SF Mono',monospace; }
.hud-source { font-size: 0.6rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hud-dim); border: 1px solid var(--hud-faint); border-radius: 20px; padding: 0.25rem 0.7rem; }
.hud-foot { text-align: center; font-family: 'SF Mono',monospace; font-size: 0.62rem; letter-spacing: 0.08em; color: var(--hud-dim); margin-top: 1rem; line-height: 1.7; }
`;
// ── Live crypto prices for paywall ($5 USD equivalents) ──────
async function fetchPaywallRates() {
    try {
        const d = await cgFetch("/simple/price?ids=cardano,bitcoin,tether&vs_currencies=usd", { cacheMs: 30000 });
        return {
            adaUSD: d?.cardano?.usd || 0.37,
            btcUSD: d?.bitcoin?.usd || 60000,
            usdtUSD: d?.tether?.usd || 1.0,
        };
    }
    catch {
        return { adaUSD: 0.37, btcUSD: 60000, usdtUSD: 1.0 };
    }
}
// ── Downloads Page ────────────────────────────────────────────
function DownloadsPage({ priceADA, Logo, showToast }) {
    const USD_PRICE = 5.00;
    const [rates, setRates] = useState({ adaUSD: 0.37, btcUSD: 60000, usdtUSD: 1.0 });
    const [qaiADA, setQaiADA] = useState(priceADA || 0.04248); // QAI/ADA from parent
    const [selCoin, setSelCoin] = useState("QAI");
    const [txHash, setTxHash] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [unlocked, setUnlocked] = useState(false);
    const [copied, setCopied] = useState(false);
    const [openFaq, setOpenFaq] = useState(null);
    const [ratesLoading, setRatesLoading] = useState(true);
    const [verifyStatus, setVerifyStatus] = useState(null); // null | "pending" | "confirming" | "confirmed" | "error"
    const [verifyMsg, setVerifyMsg] = useState("");
    const [confirmCount, setConfirmCount] = useState(0);
    const [pollRef, setPollRef] = useState(null);
    // ── Official QuantumAI payment addresses ──
    const CARDANO_PAY_ADDRESS = "addr1qxf9xr3r332f66k8qx9yezn3ng5066mjksau54l3yjc3a60dfqvllshkfnsten38sesjk8086003suavfv4zm0tfjcfseyptyj";
    // USDT (ERC-20) on Ethereum — official USDT contract + this deposit wallet
    const USDT_ERC20_ADDRESS = "0x6d73f1d7347424f0e82c993d66ad6fe17b3d1e8a";
    const USDT_CONTRACT = "0xdac17f958d2ee523a2206206994597c13d831ec7"; // Tether USDT ERC-20
    const REQUIRED_CONFIRMATIONS = 2;
    const PAY_ADDRESSES = {
        QAI: CARDANO_PAY_ADDRESS,
        ADA: CARDANO_PAY_ADDRESS,
        BTC: "37MVmmdnkQk6HfdH5DjpdZg5MRCjU4sUYF", // QuantumAI Bitcoin deposit address
        USDT: USDT_ERC20_ADDRESS,
    };
    // Which network each currency settles on
    const PAY_NETWORK = {
        QAI: "Cardano",
        ADA: "Cardano",
        BTC: "Bitcoin",
        USDT: "Ethereum (ERC-20)",
    };
    useEffect(() => {
        setQaiADA(priceADA || 0.04248);
    }, [priceADA]);
    useEffect(() => {
        fetchPaywallRates().then(r => { setRates(r); setRatesLoading(false); });
        const iv = setInterval(() => fetchPaywallRates().then(setRates), 120000);
        return () => clearInterval(iv);
    }, []);
    // Stop polling on unmount
    useEffect(() => () => { if (pollRef)
        clearInterval(pollRef); }, [pollRef]);
    // Compute the exact minimum amount expected for the selected coin (live)
    const expectedAmount = () => {
        if (selCoin === "QAI")
            return rates.adaUSD > 0 && qaiADA > 0 ? USD_PRICE / (qaiADA * rates.adaUSD) : 0;
        if (selCoin === "ADA")
            return rates.adaUSD > 0 ? USD_PRICE / rates.adaUSD : 0;
        if (selCoin === "BTC")
            return rates.btcUSD > 0 ? USD_PRICE / rates.btcUSD : 0;
        if (selCoin === "USDT")
            return USD_PRICE / (rates.usdtUSD || 1);
        return 0;
    };
    // Real on-chain verification — calls the secure /api/verify-payment Pages Function.
    // The function checks the tx pays the right address, the right asset, the right
    // amount, and has >= 2 confirmations using live blockchain data.
    const verifyOnChain = async (tx) => {
        const onCloudflare = typeof window !== "undefined" && window.location &&
            window.location.hostname !== "localhost" &&
            !window.location.hostname.includes("claude") &&
            !window.location.hostname.includes("anthropic");
        if (onCloudflare) {
            const r = await fetch("/api/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ coin: selCoin, txHash: tx, minAmount: expectedAmount() }),
            });
            const d = await r.json();
            if (d.error)
                throw new Error(d.error);
            return { ok: d.ok, pending: d.pending, confs: d.confirmations || 0, msg: d.message };
        }
        // Preview fallback (artifact/local): hit public explorers directly where CORS allows.
        return previewVerify(tx);
    };
    // Lightweight preview verification (Blockstream allows CORS; Cardano/ETH may not).
    const previewVerify = async (tx) => {
        if (selCoin === "BTC") {
            const res = await fetch(`https://blockstream.info/api/tx/${tx.trim()}`);
            if (!res.ok)
                throw new Error("Bitcoin transaction not found yet.");
            const data = await res.json();
            const paid = (data.vout || []).some(o => o.scriptpubkey_address === PAY_ADDRESSES.BTC);
            if (!paid)
                throw new Error("No payment to the QuantumAI BTC address in this transaction.");
            let confs = 0;
            if (data.status?.confirmed && data.status?.block_height) {
                const tip = parseInt(await (await fetch("https://blockstream.info/api/blocks/tip/height")).text(), 10);
                confs = tip - data.status.block_height + 1;
            }
            if (confs < REQUIRED_CONFIRMATIONS)
                return { ok: false, pending: true, confs, msg: `BTC payment found — ${confs}/${REQUIRED_CONFIRMATIONS} confirmations` };
            return { ok: true, confs, msg: "Bitcoin payment confirmed!" };
        }
        // For QAI/ADA/USDT in preview, on-chain explorers block browser CORS — direct users
        // to the deployed site where the backend verifier runs.
        throw new Error("On-chain verification for this coin runs on the live site (quantumai.computer). BTC can be verified here in preview.");
    };
    const verifyPayment = async () => {
        const tx = txHash.trim();
        if (!tx)
            return;
        // Clear any existing poll
        if (pollRef)
            clearInterval(pollRef);
        setVerifying(true);
        setVerifyStatus("pending");
        setVerifyMsg("Looking up transaction on-chain…");
        setConfirmCount(0);
        let settled = false; // local flag avoids stale-state race when deciding to poll
        const runCheck = async () => {
            try {
                const result = await verifyOnChain(tx);
                setConfirmCount(result.confs);
                if (result.ok) {
                    settled = true;
                    if (pollRef)
                        clearInterval(pollRef);
                    setVerifyStatus("confirmed");
                    setVerifyMsg(result.msg);
                    setVerifying(false);
                    setUnlocked(true);
                    showToast("✓ Payment verified — downloads unlocked!");
                    return true;
                }
                else if (result.pending) {
                    setVerifyStatus("confirming");
                    setVerifyMsg(result.msg);
                    return false;
                }
            }
            catch (err) {
                settled = true;
                if (pollRef)
                    clearInterval(pollRef);
                setVerifyStatus("error");
                setVerifyMsg(err.message || "Verification failed. Please check your transaction hash.");
                setVerifying(false);
                return true;
            }
            return false;
        };
        // Run immediately; only start polling if not already settled (confirmed/error)
        const done = await runCheck();
        if (!settled && !done) {
            const iv = setInterval(runCheck, 20000);
            setPollRef(iv);
        }
    };
    // Compute $5 USD equivalent in each coin
    const amounts = {
        QAI: rates.adaUSD > 0 && qaiADA > 0
            ? (USD_PRICE / (qaiADA * rates.adaUSD)).toFixed(0) + " QAI"
            : "…",
        ADA: rates.adaUSD > 0
            ? (USD_PRICE / rates.adaUSD).toFixed(2) + " ADA"
            : "…",
        BTC: rates.btcUSD > 0
            ? (USD_PRICE / rates.btcUSD).toFixed(8) + " BTC"
            : "…",
        USDT: "5.00 USDT",
    };
    const coins = [
        { id: "QAI", icon: "⬡", name: "$QAI", color: "#a78bff", network: "Cardano" },
        { id: "ADA", icon: "₳", name: "ADA", color: "#00C6FF", network: "Cardano" },
        { id: "BTC", icon: "₿", name: "Bitcoin", color: "#F7931A", network: "Bitcoin" },
        { id: "USDT", icon: "₮", name: "USDT", color: "#26A17B", network: "Ethereum" },
    ];
    const copyAddress = () => {
        navigator.clipboard?.writeText(PAY_ADDRESSES[selCoin]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    const features = [
        "Post-Quantum encryption (CRYSTALS-Kyber-1024)",
        "AES-256-GCM & SHA-256 HMAC modes",
        "Personal cloud storage — use your PC as server",
        "Mobile pairing over LAN (iOS & Android)",
        "Drag-and-drop file encryption vault",
        "Zero-knowledge architecture — keys never leave your device",
        "Auto-sync encrypted files across devices",
        "Lifetime licence — one payment, forever",
    ];
    const faqs = [
        { q: "Is this a subscription?", a: "No. It's a one-time payment of $5.00 USD equivalent. Pay once, use forever with all future updates included." },
        { q: "Why pay in crypto?", a: "QuantumAI is a Cardano-native project. Accepting $QAI, ADA, BTC and USDT keeps everything decentralized and borderless — no banks, no chargebacks." },
        { q: "How do I verify my payment?", a: "After sending the exact amount to the address shown, paste your transaction hash/ID in the verification box. Our system checks it on-chain within seconds." },
        { q: "What if QAI/ADA price changes after I send?", a: "Prices are locked at the moment you open the payment screen. The amounts shown are guaranteed for 15 minutes. If they expire, refresh the page for updated rates." },
        { q: "Is the software open source?", a: "The encryption core is open-source on our GitHub (github.com/C-QuantumAi). The desktop GUI is proprietary but free to audit." },
        { q: "Which operating systems are supported?", a: "Windows 10/11 (x64, ARM64) and macOS 12+ (Intel & Apple Silicon). Linux AppImage coming soon." },
    ];
    return (React.createElement("div", { className: "dl-page" },
        React.createElement("div", { className: "dl-hero" },
            React.createElement("div", { className: "dl-badge" },
                React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "#00C6FF", boxShadow: "0 0 6px #00C6FF", display: "inline-block" } }),
                "QuantumAI Encryption Suite"),
            React.createElement("h1", { className: "dl-title" },
                "Secure Your Digital Life",
                React.createElement("br", null),
                "with Quantum Encryption"),
            React.createElement("p", { className: "dl-sub" }, "The same post-quantum encryption powering the $QAI ecosystem \u2014 now available as a standalone desktop app for Windows & Mac. Your PC becomes an impenetrable personal cloud."),
            React.createElement("div", { className: "dl-platforms" }, ["🪟 Windows 10/11", "🍎 macOS 12+", "⬡ Post-Quantum", "🔒 AES-256", "📱 Mobile Sync"].map((p, i) => (React.createElement("div", { key: i, className: "platform-chip" }, p))))),
        React.createElement("div", { className: "dl-content" },
            React.createElement("div", { className: "dl-grid" }, [
                { os: "Windows", icon: "🪟", version: "v1.0.0", arch: "x64", ext: ".exe & .msi", size: "~85 MB" },
                { os: "macOS", icon: "🍎", version: "v1.0.0", arch: "Intel · Apple Silicon", ext: ".dmg universal", size: "~92 MB" },
            ].map(app => (React.createElement("div", { key: app.os, className: "dl-app-card" },
                React.createElement("div", { className: "dl-card-header" },
                    React.createElement("div", { className: "dl-os-icon" }, app.icon),
                    React.createElement("div", null,
                        React.createElement("div", { className: "dl-card-title" },
                            "QuantumAI Vault for ",
                            app.os),
                        React.createElement("div", { className: "dl-card-sub" },
                            app.version,
                            " \u00B7 ",
                            app.arch))),
                React.createElement("div", { className: "dl-card-body" },
                    React.createElement("div", { className: "dl-feature-list" }, features.slice(0, 5).map((f, i) => (React.createElement("div", { key: i, className: "dl-feature" },
                        React.createElement("div", { className: "dl-feature-dot" }),
                        f)))),
                    React.createElement("div", { className: "dl-specs" }, [app.ext, app.size, app.arch].map((s, i) => (React.createElement("span", { key: i, className: "dl-spec-tag" }, s)))),
                    !unlocked
                        ? React.createElement("button", { className: "btn-primary", style: { width: "100%", borderRadius: 12, padding: "0.8rem", fontSize: "0.85rem" }, onClick: () => document.getElementById("paywall")?.scrollIntoView({ behavior: "smooth" }) }, "\uD83D\uDD10 Unlock Download \u2014 $5.00")
                        : React.createElement("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap" } },
                            React.createElement("button", { className: `dl-btn${app.os === "macOS" ? " mac" : ""}`, onClick: () => showToast(`Downloading QuantumAI Vault for ${app.os}…`) },
                                "\u2B07 Download for ",
                                app.os))))))),
            !unlocked ? (React.createElement("div", { className: "paywall-card", id: "paywall" },
                React.createElement("div", { className: "paywall-header" },
                    React.createElement("div", { className: "paywall-price-block" },
                        React.createElement("div", { className: "paywall-usd" }, "$5.00"),
                        React.createElement("div", { className: "paywall-usd-label" }, "ONE-TIME \u00B7 LIFETIME LICENCE \u00B7 ALL UPDATES INCLUDED")),
                    React.createElement("div", { className: "paywall-secure" },
                        React.createElement("span", { style: { fontSize: "1.1rem" } }, "\uD83D\uDD10"),
                        "Pay in crypto \u00B7 Instant unlock")),
                React.createElement("div", { className: "paywall-body" },
                    React.createElement("div", { className: "pay-label" }, "Choose your payment currency"),
                    React.createElement("div", { className: "pay-options" }, coins.map(c => (React.createElement("div", { key: c.id, className: `pay-opt ${selCoin === c.id ? "selected" : ""}`, onClick: () => setSelCoin(c.id) },
                        React.createElement("div", { className: "pay-opt-icon", style: { filter: selCoin === c.id ? "none" : "grayscale(0.5)" } }, c.icon),
                        React.createElement("div", { className: "pay-opt-name", style: { color: selCoin === c.id ? c.color : undefined } }, c.name),
                        React.createElement("div", { className: "pay-opt-amount" }, ratesLoading
                            ? React.createElement("span", { className: "pay-opt-loading" }, "Fetching\u2026")
                            : amounts[c.id]),
                        React.createElement("div", { style: { fontSize: "0.6rem", color: "rgba(180,210,255,0.3)", marginTop: 2 } }, c.network))))),
                    React.createElement("div", { style: { display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1.25rem" } }, [
                        { label: "You pay", val: ratesLoading ? "Loading…" : amounts[selCoin], color: coins.find(c => c.id === selCoin)?.color },
                        { label: "USD value", val: "$5.00", color: "#30d158" },
                        { label: "Rate updated", val: ratesLoading ? "…" : "Live · CoinGecko", color: "rgba(180,210,255,0.4)" },
                    ].map((s, i) => (React.createElement("div", { key: i, style: { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.6rem 0.9rem" } },
                        React.createElement("div", { style: { fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.2rem" } }, s.label),
                        React.createElement("div", { style: { fontSize: "0.88rem", fontWeight: 700, color: s.color || "#fff", letterSpacing: "-0.02em" } }, s.val))))),
                    React.createElement("div", { className: "pay-address-box" },
                        React.createElement("div", { className: "pay-addr-label" },
                            "Send ",
                            amounts[selCoin],
                            " to this ",
                            PAY_NETWORK[selCoin],
                            " address"),
                        selCoin === "USDT" && (React.createElement("div", { style: { fontSize: "0.7rem", color: "#FF9F0A", fontWeight: 600, marginBottom: "0.5rem" } }, "\u26A0 ERC-20 only \u2014 send USDT on the Ethereum network. Do not send via Tron/BSC or funds may be lost.")),
                        React.createElement("div", { className: "pay-addr-row" },
                            React.createElement("div", { className: "pay-addr" }, PAY_ADDRESSES[selCoin]),
                            React.createElement("button", { className: "copy-btn", onClick: copyAddress }, copied ? "✓ Copied" : "Copy"))),
                    React.createElement("div", { className: "pay-instructions" },
                        React.createElement("strong", { style: { color: "rgba(255,255,255,0.7)" } }, "How to pay:"),
                        React.createElement("br", null),
                        "1. Send exactly ",
                        React.createElement("strong", { style: { color: coins.find(c => c.id === selCoin)?.color } }, ratesLoading ? "…" : amounts[selCoin]),
                        " to the address above",
                        React.createElement("br", null),
                        "2. Copy your transaction hash/ID from your wallet after sending",
                        React.createElement("br", null),
                        "3. Paste it below and click Verify \u2014 we check on-chain for ",
                        React.createElement("strong", { style: { color: "#00C6FF" } }, "2 confirmations"),
                        " then unlock automatically"),
                    React.createElement("div", { className: "verify-input-row" },
                        React.createElement("input", { className: "verify-input", value: txHash, onChange: e => { setTxHash(e.target.value); setVerifyStatus(null); setVerifyMsg(""); }, placeholder: selCoin === "BTC" ? "Paste Bitcoin TX hash…" : selCoin === "USDT" ? "Paste Ethereum TX hash (0x…)…" : "Paste Cardano transaction hash…", disabled: verifying && verifyStatus === "confirming" }),
                        React.createElement("button", { className: "verify-btn", onClick: verifyPayment, disabled: (verifying && verifyStatus === "confirming") || !txHash.trim() }, verifyStatus === "confirming" ? "Polling…" : verifying ? "Checking…" : "Verify →")),
                    verifyStatus && (React.createElement("div", { style: {
                            borderRadius: 12, padding: "1rem 1.1rem", marginBottom: "1rem",
                            background: verifyStatus === "error" ? "rgba(255,69,58,0.08)" :
                                verifyStatus === "confirmed" ? "rgba(48,209,88,0.08)" :
                                    "rgba(0,198,255,0.06)",
                            border: `0.5px solid ${verifyStatus === "error" ? "rgba(255,69,58,0.3)" :
                                verifyStatus === "confirmed" ? "rgba(48,209,88,0.3)" :
                                    "rgba(0,198,255,0.25)"}`
                        } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: verifyStatus === "confirming" ? "0.75rem" : "0" } },
                            React.createElement("span", { style: { fontSize: "1.1rem" } }, verifyStatus === "confirmed" ? "✅" : verifyStatus === "error" ? "❌" : "⏳"),
                            React.createElement("span", { style: {
                                    fontSize: "0.83rem", fontWeight: 600,
                                    color: verifyStatus === "error" ? "#FF453A" :
                                        verifyStatus === "confirmed" ? "#30d158" : "#00C6FF"
                                } }, verifyMsg)),
                        (verifyStatus === "confirming" || verifyStatus === "pending") && (React.createElement("div", null,
                            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" } },
                                React.createElement("span", { style: { fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.5)", textTransform: "uppercase" } }, "Confirmations"),
                                React.createElement("span", { style: { fontSize: "0.75rem", fontWeight: 800, color: "#00C6FF", fontVariantNumeric: "tabular-nums" } },
                                    confirmCount,
                                    " / ",
                                    REQUIRED_CONFIRMATIONS)),
                            React.createElement("div", { style: { display: "flex", gap: "6px", marginBottom: "0.6rem" } }, Array.from({ length: REQUIRED_CONFIRMATIONS }).map((_, i) => (React.createElement("div", { key: i, style: {
                                    flex: 1, height: 6, borderRadius: 3,
                                    background: i < confirmCount
                                        ? "linear-gradient(90deg,#0072FF,#00C6FF)"
                                        : "rgba(255,255,255,0.08)",
                                    transition: "background 0.4s",
                                    boxShadow: i < confirmCount ? "0 0 8px rgba(0,198,255,0.4)" : "none"
                                } })))),
                            React.createElement("div", { style: { fontSize: "0.72rem", color: "rgba(180,210,255,0.45)" } },
                                selCoin === "BTC"
                                    ? "Bitcoin blocks confirm in ~10 minutes each — 2 confirmations can take 10–30 min."
                                    : selCoin === "USDT"
                                        ? "Ethereum blocks confirm in ~12 seconds each. This page auto-refreshes every 20s."
                                        : "Cardano blocks confirm in ~20 seconds each. This page auto-refreshes every 20s.",
                                confirmCount === 0 && " Transaction found on-chain — waiting for block inclusion…"))))),
                    React.createElement("div", { className: "pay-disclaimer" },
                        React.createElement("strong", null, "\u26A0 Payment Notice:"),
                        " Send the exact amount to the address shown. ",
                        React.createElement("strong", null, "QAI & ADA"),
                        " settle on Cardano; ",
                        React.createElement("strong", null, "USDT"),
                        " is ",
                        React.createElement("strong", null, "ERC-20 on Ethereum"),
                        " (",
                        USDT_ERC20_ADDRESS.slice(0, 10),
                        "\u2026); ",
                        React.createElement("strong", null, "BTC"),
                        " on Bitcoin. Each is verified on-chain with a minimum of ",
                        React.createElement("strong", null, "2 confirmations"),
                        ". Prices are live from CoinGecko + Minswap DEX. One-time purchase, no refunds once download links are delivered.")))) : (React.createElement("div", { className: "dl-unlock-box", id: "paywall" },
                React.createElement("div", { className: "dl-unlock-icon" }, "\u2705"),
                React.createElement("div", { className: "dl-unlock-title" }, "Payment Verified \u2014 Downloads Unlocked"),
                React.createElement("div", { className: "dl-unlock-sub" },
                    "Thank you for supporting QuantumAI. Your lifetime licence is active.",
                    React.createElement("br", null),
                    React.createElement("span", { style: { fontSize: "0.78rem", color: "rgba(180,210,255,0.4)" } },
                        "Confirmed ",
                        confirmCount,
                        " block",
                        confirmCount !== 1 ? "s" : "",
                        " on Cardano")),
                React.createElement("div", { className: "dl-download-btns", style: { flexDirection: "column", alignItems: "stretch", maxWidth: 420, margin: "0 auto" } },
                    React.createElement("div", { style: { display: "flex", gap: "0.6rem", flexWrap: "wrap" } },
                        React.createElement("button", { className: "dl-btn", style: { flex: 1 }, onClick: () => { showToast("Starting Windows .exe download…"); window.open(DOWNLOADS.win_exe, "_blank"); } }, "\uD83E\uDE9F Windows (.exe)"),
                        React.createElement("button", { className: "dl-btn", style: { flex: 1 }, onClick: () => { showToast("Starting Windows .msi download…"); window.open(DOWNLOADS.win_msi, "_blank"); } }, "\uD83E\uDE9F Windows (.msi)")),
                    React.createElement("button", { className: "dl-btn mac", onClick: () => { showToast("Starting macOS .dmg download…"); window.open(DOWNLOADS.mac_dmg, "_blank"); } }, "\uD83C\uDF4E Download for macOS (.dmg)")),
                React.createElement("div", { style: { marginTop: "1rem", fontSize: "0.75rem", color: "rgba(180,210,255,0.4)" } },
                    "Check ",
                    React.createElement("a", { href: "https://github.com/C-QuantumAi", style: { color: "var(--blue)" }, target: "_blank", rel: "noreferrer" }, "github.com/C-QuantumAi"),
                    " for release notes & source code"))),
            React.createElement("div", { style: { marginBottom: "3rem" } },
                React.createElement("span", { className: "section-eyebrow" }, "What's Included"),
                React.createElement("div", { className: "section-title", style: { fontSize: "1.6rem", marginBottom: "1.5rem" } }, "Everything in the Box"),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "0.75rem" } }, features.map((f, i) => (React.createElement("div", { key: i, style: { display: "flex", alignItems: "flex-start", gap: "0.75rem", background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "0.85rem 1rem" } },
                    React.createElement("span", { style: { color: "#30d158", fontSize: "0.9rem", flexShrink: 0, marginTop: 1 } }, "\u2713"),
                    React.createElement("span", { style: { fontSize: "0.83rem", color: "rgba(180,210,255,0.75)", lineHeight: 1.5 } }, f)))))),
            React.createElement("div", { className: "dl-faq" },
                React.createElement("span", { className: "section-eyebrow" }, "FAQ"),
                React.createElement("div", { className: "section-title", style: { fontSize: "1.6rem", marginBottom: "1rem" } }, "Questions"),
                faqs.map((f, i) => (React.createElement("div", { key: i, className: "faq-item" },
                    React.createElement("div", { className: "faq-q", onClick: () => setOpenFaq(openFaq === i ? null : i) },
                        f.q,
                        React.createElement("span", { style: { color: "var(--muted)", fontSize: "1rem" } }, openFaq === i ? "−" : "+")),
                    openFaq === i && React.createElement("div", { className: "faq-a" }, f.a))))))));
}
// ── Fear & Greed Index fetch (alternative.me; via proxy on deploy, direct in preview) ──
async function fetchFearGreed() {
    const urls = useProxy()
        ? ["/api/cg?fng=30", "https://api.alternative.me/fng/?limit=30"]
        : ["https://api.alternative.me/fng/?limit=30"];
    for (const u of urls) {
        try {
            const r = await fetch(u);
            if (!r.ok)
                continue;
            const ct = r.headers.get("content-type") || "";
            if (ct.includes("text/html"))
                continue;
            const d = await r.json();
            const data = d?.data || [];
            if (data.length)
                return data.map(x => ({
                    value: parseInt(x.value),
                    label: x.value_classification,
                    timestamp: parseInt(x.timestamp),
                }));
        }
        catch { /* try next */ }
    }
    return [];
}
// ── CoinMarketCap fetch via the proxy (fallback price source) ──
async function cmcFetch(cmcPath) {
    if (!useProxy())
        return null; // CMC needs the server-side key; only on deployment
    try {
        const r = await fetch(`/api/cg?cmc=${encodeURIComponent(cmcPath)}`);
        if (!r.ok)
            return null;
        return await r.json();
    }
    catch {
        return null;
    }
}
// Map a CoinMarketCap listing to the app's coin-row shape
function cmcToRow(c) {
    const q = c.quote?.USD || {};
    return {
        id: (c.slug || c.symbol || "").toLowerCase(),
        symbol: (c.symbol || "").toLowerCase(),
        name: c.name,
        image: `https://s2.coinmarketcap.com/static/img/coins/64x64/${c.id}.png`,
        current_price: q.price,
        price_change_percentage_24h: q.percent_change_24h,
        high_24h: null, low_24h: null,
        market_cap: q.market_cap,
        total_volume: q.volume_24h,
        market_cap_rank: c.cmc_rank,
        sparkline_in_7d: { price: [] },
    };
}
// ── Top coins (CoinGecko primary, CoinMarketCap fallback) ──
async function fetchTopCoins() {
    try {
        const cg = await cgFetch("/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=true&price_change_percentage=24h", { cacheMs: 20000 });
        if (cg && cg.length)
            return cg;
    }
    catch { }
    // Fallback: CoinMarketCap listings
    const cmc = await cmcFetch("/v1/cryptocurrency/listings/latest?limit=50&convert=USD");
    if (cmc?.data?.length)
        return cmc.data.map(cmcToRow);
    return [];
}
// ════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS ENGINE
// Real indicator math computed from OHLC candles. Inputs configured to:
// SMA 8 / 55 / 200, EMA 200, Buy/Sell Swing 1 (per user's chart settings).
// All outputs are ESTIMATES for information only — never guarantees.
// ════════════════════════════════════════════════════════════════
const TA_CONFIG = { sma1: 8, sma2: 55, sma3: 200, ema1: 200, swing: 1 };
function sma(values, period) {
    if (values.length < period)
        return null;
    let s = 0;
    for (let i = values.length - period; i < values.length; i++)
        s += values[i];
    return s / period;
}
function smaSeries(values, period) {
    const out = [];
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) {
            out.push(null);
            continue;
        }
        let s = 0;
        for (let j = i - period + 1; j <= i; j++)
            s += values[j];
        out.push(s / period);
    }
    return out;
}
function emaSeries(values, period) {
    if (!values.length)
        return [];
    const k = 2 / (period + 1);
    const out = [values[0]];
    for (let i = 1; i < values.length; i++)
        out.push(values[i] * k + out[i - 1] * (1 - k));
    return out;
}
function ema(values, period) { const s = emaSeries(values, period); return s.length ? s[s.length - 1] : null; }
// RSI (Wilder's smoothing)
function rsiSeries(closes, period = 14) {
    if (closes.length < period + 1)
        return [];
    const out = new Array(closes.length).fill(null);
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0)
            gain += d;
        else
            loss -= d;
    }
    gain /= period;
    loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
        loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
}
// Stochastic RSI
function stochRsi(closes, period = 14, k = 3) {
    const rsi = rsiSeries(closes, period).filter(v => v != null);
    if (rsi.length < period)
        return null;
    const recent = rsi.slice(-period);
    const lo = Math.min(...recent), hi = Math.max(...recent);
    const raw = hi === lo ? 50 : ((rsi[rsi.length - 1] - lo) / (hi - lo)) * 100;
    return raw;
}
// Money Flow Index (volume-weighted RSI)
function mfi(candles, period = 14) {
    if (candles.length < period + 1)
        return null;
    let pos = 0, neg = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const tp = (candles[i].h + candles[i].l + candles[i].c) / 3;
        const ptp = (candles[i - 1].h + candles[i - 1].l + candles[i - 1].c) / 3;
        const vol = candles[i].v || 1;
        const raw = tp * vol;
        if (tp > ptp)
            pos += raw;
        else if (tp < ptp)
            neg += raw;
    }
    if (neg === 0)
        return 100;
    return 100 - 100 / (1 + pos / neg);
}
// WaveTrend oscillator — the core of VuManChu Cipher B
function waveTrend(candles, chlen = 9, avg = 12) {
    if (candles.length < chlen + avg)
        return null;
    const hlc3 = candles.map(c => (c.h + c.l + c.c) / 3);
    const esa = emaSeries(hlc3, chlen);
    const d = emaSeries(hlc3.map((v, i) => Math.abs(v - esa[i])), chlen);
    const ci = hlc3.map((v, i) => d[i] === 0 ? 0 : (v - esa[i]) / (0.015 * d[i]));
    const wt1 = emaSeries(ci, avg);
    const last = wt1[wt1.length - 1];
    return last; // >60 overbought, <-60 oversold
}
// RSI divergence detection (price vs RSI over the lookback window)
function detectDivergence(candles) {
    const closes = candles.map(c => c.c);
    const rsi = rsiSeries(closes, 14);
    if (rsi.length < 20)
        return null;
    const n = closes.length;
    // Compare last two swing lows / highs in the recent window
    const w = Math.min(30, n - 1);
    const slice = closes.slice(-w), rslice = rsi.slice(-w);
    const priceMinIdx = slice.indexOf(Math.min(...slice));
    const priceMaxIdx = slice.indexOf(Math.max(...slice));
    // Bullish: price made lower low but RSI made higher low
    const firstHalfMin = Math.min(...slice.slice(0, Math.floor(w / 2)));
    const secondHalfMin = Math.min(...slice.slice(Math.floor(w / 2)));
    const firstHalfRsiMin = Math.min(...rslice.slice(0, Math.floor(w / 2)).filter(v => v != null));
    const secondHalfRsiMin = Math.min(...rslice.slice(Math.floor(w / 2)).filter(v => v != null));
    if (secondHalfMin < firstHalfMin && secondHalfRsiMin > firstHalfRsiMin)
        return "bullish";
    const firstHalfMax = Math.max(...slice.slice(0, Math.floor(w / 2)));
    const secondHalfMax = Math.max(...slice.slice(Math.floor(w / 2)));
    const firstHalfRsiMax = Math.max(...rslice.slice(0, Math.floor(w / 2)).filter(v => v != null));
    const secondHalfRsiMax = Math.max(...rslice.slice(Math.floor(w / 2)).filter(v => v != null));
    if (secondHalfMax > firstHalfMax && secondHalfRsiMax < firstHalfRsiMax)
        return "bearish";
    return null;
}
// Candlestick pattern recognition (last few candles)
function detectPattern(candles) {
    if (candles.length < 3)
        return null;
    const [a, b, c] = candles.slice(-3);
    const body = x => Math.abs(x.c - x.o);
    const range = x => x.h - x.l || 1e-9;
    const lower = x => Math.min(x.o, x.c) - x.l;
    const upper = x => x.h - Math.max(x.o, x.c);
    // Bullish engulfing
    if (b.c < b.o && c.c > c.o && c.c > b.o && c.o < b.c)
        return { name: "Bullish Engulfing", bias: "bullish" };
    // Bearish engulfing
    if (b.c > b.o && c.c < c.o && c.o > b.c && c.c < b.o)
        return { name: "Bearish Engulfing", bias: "bearish" };
    // Hammer
    if (lower(c) > body(c) * 2 && upper(c) < body(c))
        return { name: "Hammer", bias: "bullish" };
    // Shooting star
    if (upper(c) > body(c) * 2 && lower(c) < body(c))
        return { name: "Shooting Star", bias: "bearish" };
    // Doji
    if (body(c) < range(c) * 0.1)
        return { name: "Doji (indecision)", bias: "neutral" };
    // Three white soldiers / black crows
    if (a.c > a.o && b.c > b.o && c.c > c.o && c.c > b.c && b.c > a.c)
        return { name: "Three White Soldiers", bias: "bullish" };
    if (a.c < a.o && b.c < b.o && c.c < c.o && c.c < b.c && b.c < a.c)
        return { name: "Three Black Crows", bias: "bearish" };
    return null;
}
// Detect parabolic move / strong trend (can't predict, but can flag in-progress)
// Volume pocket gaps: price zones with unusually LOW traded volume (thin liquidity)
// that price tends to move through quickly. Builds a simple volume-by-price profile.
function volumePocketGaps(candles) {
    if (candles.length < 30)
        return null;
    const recent = candles.slice(-120);
    const lo = Math.min(...recent.map(c => c.l));
    const hi = Math.max(...recent.map(c => c.h));
    if (!(hi > lo))
        return null;
    const BINS = 24;
    const binSize = (hi - lo) / BINS;
    const vol = new Array(BINS).fill(0);
    for (const c of recent) {
        const mid = (c.h + c.l) / 2;
        let b = Math.floor((mid - lo) / binSize);
        if (b < 0)
            b = 0;
        if (b >= BINS)
            b = BINS - 1;
        vol[b] += (c.v || 0);
    }
    const maxVol = Math.max(...vol) || 1;
    // Pockets = bins below 20% of peak volume (thin zones price slices through)
    const gaps = [];
    for (let i = 0; i < BINS; i++) {
        if (vol[i] < maxVol * 0.2)
            gaps.push({ low: lo + i * binSize, high: lo + (i + 1) * binSize });
    }
    // The high-volume node (HVN) = strongest support/resistance magnet
    const pocIdx = vol.indexOf(maxVol);
    const pointOfControl = lo + (pocIdx + 0.5) * binSize;
    return { gaps, pointOfControl, lo, hi };
}
function detectParabolic(candles) {
    if (candles.length < 10)
        return null;
    const closes = candles.map(c => c.c);
    const recent = closes.slice(-7);
    const pctMove = (recent[recent.length - 1] - recent[0]) / recent[0] * 100;
    const vols = candles.slice(-7).map(c => c.v || 0);
    const avgVolEarlier = (candles.slice(-20, -7).reduce((s, c) => s + (c.v || 0), 0) / 13) || 1;
    const recentVol = vols.reduce((a, b) => a + b, 0) / vols.length;
    const volSpike = recentVol > avgVolEarlier * 1.6;
    if (pctMove > 25 && volSpike)
        return { type: "parabolic-up", move: pctMove };
    if (pctMove < -25 && volSpike)
        return { type: "capitulation-down", move: pctMove };
    if (pctMove > 15)
        return { type: "strong-uptrend", move: pctMove };
    if (pctMove < -15)
        return { type: "strong-downtrend", move: pctMove };
    return null;
}
// Bitcoin 4-year cycle phase (halving-based). Halvings: 2012,2016,2020,2024,2028...
// Rough heuristic: ~18 months post-halving = bullish peak zone, then bearish.
function btcCyclePhase(date = new Date()) {
    const halvings = [
        new Date("2012-11-28"), new Date("2016-07-09"),
        new Date("2020-05-11"), new Date("2024-04-19"), new Date("2028-04-01"),
    ];
    let last = halvings[0];
    for (const h of halvings) {
        if (h <= date)
            last = h;
        else
            break;
    }
    const monthsSince = (date - last) / (1000 * 60 * 60 * 24 * 30.44);
    let phase, bias, note;
    if (monthsSince < 6) {
        phase = "Post-Halving Accumulation";
        bias = "bullish";
        note = "Historically early-cycle accumulation.";
    }
    else if (monthsSince < 18) {
        phase = "Bull Expansion";
        bias = "bullish";
        note = "Historically the strongest uptrend window.";
    }
    else if (monthsSince < 24) {
        phase = "Cycle Top Zone";
        bias = "caution";
        note = "Historically where blow-off tops have formed.";
    }
    else if (monthsSince < 36) {
        phase = "Bear / Correction";
        bias = "bearish";
        note = "Historically the drawdown phase.";
    }
    else {
        phase = "Pre-Halving Recovery";
        bias = "neutral";
        note = "Historically basing before the next halving.";
    }
    // The "2 years bullish / 2 years bearish" framing:
    const yearInCycle = Math.floor(monthsSince / 12);
    const halfBias = monthsSince < 24 ? "Bullish half (Years 1–2)" : "Bearish half (Years 3–4)";
    return { phase, bias, note, monthsSince: Math.round(monthsSince), halfBias };
}
// Current moon phase (DISPLAY ONLY — no proven market effect; shown because requested)
function moonPhase(date = new Date()) {
    const synodic = 29.530588853;
    const ref = new Date("2000-01-06T18:14:00Z"); // known new moon
    const days = (date - ref) / (1000 * 60 * 60 * 24);
    const pos = ((days % synodic) + synodic) % synodic;
    const idx = Math.floor((pos / synodic) * 8 + 0.5) % 8;
    return ["🌑 New", "🌒 Waxing Crescent", "🌓 First Quarter", "🌔 Waxing Gibbous", "🌕 Full", "🌖 Waning Gibbous", "🌗 Last Quarter", "🌘 Waning Crescent"][idx];
}
// ── Master analysis: combine everything into buy/sell/stop + signal ──
function analyzeMarket(candles, currentPrice) {
    if (!candles || candles.length < 30 || !currentPrice)
        return null;
    const closes = candles.map(c => c.c);
    const price = currentPrice;
    const s8 = sma(closes, TA_CONFIG.sma1);
    const s55 = sma(closes, TA_CONFIG.sma2);
    const s200 = closes.length >= TA_CONFIG.sma3 ? sma(closes, TA_CONFIG.sma3) : sma(closes, Math.min(closes.length, 100));
    const e200 = closes.length >= TA_CONFIG.ema1 ? ema(closes, TA_CONFIG.ema1) : ema(closes, Math.min(closes.length, 100));
    const rsiArr = rsiSeries(closes, 14);
    const rsiVal = rsiArr.length ? rsiArr[rsiArr.length - 1] : null;
    const stoch = stochRsi(closes);
    const mfiVal = mfi(candles);
    const wt = waveTrend(candles);
    const div = detectDivergence(candles);
    const pattern = detectPattern(candles);
    const parabolic = detectParabolic(candles);
    const vpg = volumePocketGaps(candles);
    const cycle = btcCyclePhase();
    // Score each signal: +bullish / -bearish
    let score = 0;
    const reasons = [];
    if (s8 != null && s55 != null) {
        if (s8 > s55) {
            score += 1.5;
            reasons.push("SMA8 > SMA55 (short-term up)");
        }
        else {
            score -= 1.5;
            reasons.push("SMA8 < SMA55 (short-term down)");
        }
    }
    if (s55 != null && s200 != null) {
        if (s55 > s200) {
            score += 1.5;
            reasons.push("SMA55 > SMA200 (golden-cross structure)");
        }
        else {
            score -= 1.5;
            reasons.push("SMA55 < SMA200 (death-cross structure)");
        }
    }
    if (e200 != null) {
        if (price > e200) {
            score += 1;
            reasons.push("Price above EMA200 (bullish trend)");
        }
        else {
            score -= 1;
            reasons.push("Price below EMA200 (bearish trend)");
        }
    }
    if (rsiVal != null) {
        if (rsiVal < 30) {
            score += 1.5;
            reasons.push(`RSI ${rsiVal.toFixed(0)} oversold`);
        }
        else if (rsiVal > 70) {
            score -= 1.5;
            reasons.push(`RSI ${rsiVal.toFixed(0)} overbought`);
        }
        else
            reasons.push(`RSI ${rsiVal.toFixed(0)} neutral`);
    }
    if (stoch != null) {
        if (stoch < 20) {
            score += 1;
            reasons.push("Stoch RSI oversold");
        }
        else if (stoch > 80) {
            score -= 1;
            reasons.push("Stoch RSI overbought");
        }
    }
    if (mfiVal != null) {
        if (mfiVal < 20) {
            score += 1;
            reasons.push("Money Flow oversold (accumulation)");
        }
        else if (mfiVal > 80) {
            score -= 1;
            reasons.push("Money Flow overbought (distribution)");
        }
    }
    if (wt != null) {
        if (wt < -53) {
            score += 1;
            reasons.push("WaveTrend oversold (Cipher B buy zone)");
        }
        else if (wt > 53) {
            score -= 1;
            reasons.push("WaveTrend overbought (Cipher B sell zone)");
        }
    }
    if (div === "bullish") {
        score += 2;
        reasons.push("Bullish RSI divergence");
    }
    if (div === "bearish") {
        score -= 2;
        reasons.push("Bearish RSI divergence");
    }
    if (pattern) {
        if (pattern.bias === "bullish") {
            score += 1;
            reasons.push(`Pattern: ${pattern.name}`);
        }
        else if (pattern.bias === "bearish") {
            score -= 1;
            reasons.push(`Pattern: ${pattern.name}`);
        }
        else
            reasons.push(`Pattern: ${pattern.name}`);
    }
    if (parabolic) {
        if (parabolic.type === "parabolic-up") {
            score -= 1;
            reasons.push(`⚠ Parabolic move +${parabolic.move.toFixed(0)}% — extended, watch for reversal`);
        }
        else if (parabolic.type === "capitulation-down") {
            score += 1;
            reasons.push(`⚠ Capitulation ${parabolic.move.toFixed(0)}% — possible bounce`);
        }
        else if (parabolic.type === "strong-uptrend")
            reasons.push(`Strong uptrend +${parabolic.move.toFixed(0)}%`);
        else if (parabolic.type === "strong-downtrend")
            reasons.push(`Strong downtrend ${parabolic.move.toFixed(0)}%`);
    }
    // BTC 4-year cycle bias (2yr bull / 2yr bear framing)
    if (cycle) {
        if (cycle.bias === "bullish") {
            score += 1;
            reasons.push(`BTC cycle: ${cycle.phase} (${cycle.halfBias})`);
        }
        else if (cycle.bias === "bearish") {
            score -= 1;
            reasons.push(`BTC cycle: ${cycle.phase} (${cycle.halfBias})`);
        }
        else if (cycle.bias === "caution") {
            score -= 0.5;
            reasons.push(`BTC cycle: ${cycle.phase} — late-cycle caution`);
        }
        else
            reasons.push(`BTC cycle: ${cycle.phase}`);
    }
    // Volume pocket gap: is price sitting in a thin zone (likely to move fast)?
    if (vpg && vpg.gaps.length) {
        const inGap = vpg.gaps.some(g => price >= g.low && price <= g.high);
        if (inGap)
            reasons.push("Price in a volume pocket gap — thin liquidity, expect a fast move toward the nearest high-volume node");
        if (vpg.pointOfControl) {
            if (price < vpg.pointOfControl)
                reasons.push(`Below point-of-control ($${fmtPriceTA(vpg.pointOfControl)}) — that's the upside magnet`);
            else
                reasons.push(`Above point-of-control ($${fmtPriceTA(vpg.pointOfControl)}) — that's the downside magnet`);
        }
    }
    // Verdict
    let signal, signalColor;
    if (score >= 4) {
        signal = "STRONG BUY";
        signalColor = "#30d158";
    }
    else if (score >= 1.5) {
        signal = "BUY";
        signalColor = "#7ed957";
    }
    else if (score > -1.5) {
        signal = "NEUTRAL";
        signalColor = "#FFD54F";
    }
    else if (score > -4) {
        signal = "SELL";
        signalColor = "#FF9F0A";
    }
    else {
        signal = "STRONG SELL";
        signalColor = "#FF453A";
    }
    // ── Price targets, anchored to the LIVE current price ──
    // Use the recent swing range only to size the moves, never to set absolute levels,
    // so targets always sit sensibly around the real current price.
    const lookback = candles.slice(-30);
    const swingHigh = Math.max(...lookback.map(c => c.h));
    const swingLow = Math.min(...lookback.map(c => c.l));
    const swingRange = (swingHigh - swingLow) || price * 0.05;
    // Volatility as a fraction of price (clamped to a sane 3%–25% band)
    let volPct = swingRange / price;
    if (!isFinite(volPct) || volPct <= 0)
        volPct = 0.06;
    volPct = Math.max(0.03, Math.min(0.25, volPct));
    // Conviction scales the size of the expected move
    const bull = score >= 1; // leaning long
    const bear = score <= -1; // leaning short
    const upMove = volPct * (bull ? 1.3 : 0.8); // how far we expect price to rise
    const downRisk = volPct * (bear ? 1.3 : 0.8); // how far it might fall
    // BUY-IN: at/just below current price (a small dip entry), never above it
    let buyTarget = price * (1 - Math.min(0.03, volPct * 0.25));
    // SELL: above current price by the expected up-move
    let sellTarget = price * (1 + upMove);
    // STOP-LOSS: below the entry, beyond the expected downside, but capped
    let stopLoss = Math.min(buyTarget, price) * (1 - Math.max(0.02, downRisk * 0.6));
    // If a volume point-of-control sits just above, use it as a realistic sell magnet
    const poc = vpg?.pointOfControl;
    if (poc && poc > price && poc < price * 1.5)
        sellTarget = Math.max(sellTarget, poc);
    // Guarantee logical ordering: stop < buy ≤ price ≤ sell
    buyTarget = Math.min(buyTarget, price);
    sellTarget = Math.max(sellTarget, price * 1.005);
    stopLoss = Math.min(stopLoss, buyTarget * 0.995);
    return {
        signal, signalColor, score: score.toFixed(1), reasons,
        buyTarget, sellTarget, stopLoss,
        indicators: {
            sma8: s8, sma55: s55, sma200: s200, ema200: e200,
            rsi: rsiVal, stochRsi: stoch, mfi: mfiVal, waveTrend: wt,
            divergence: div, pattern: pattern?.name || "none", parabolic,
            pointOfControl: poc || null, volumeGaps: vpg?.gaps?.length || 0,
        },
        cycle,
        moon: moonPhase(),
    };
}
// Compact price formatter used inside the TA engine
function fmtPriceTA(p) {
    if (p == null)
        return "—";
    if (p >= 1000)
        return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (p >= 1)
        return p.toFixed(2);
    if (p >= 0.01)
        return p.toFixed(4);
    return p.toPrecision(3);
}
// ── CoinGecko OHLC for candlestick chart ──
// Primary: /ohlc (true candles). Fallback: /market_chart (prices → synthesized candles),
// which is more reliable on the free tier and for long-tail tokens.
async function fetchCoinOHLC(coinId, days = 7) {
    // 1. Try the real OHLC endpoint
    try {
        const data = await cgFetch(`/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`, { cacheMs: 8000 });
        if (Array.isArray(data) && data.length > 0) {
            return data.map(c => ({ t: c[0], o: c[1], h: c[2], l: c[3], c: c[4] }));
        }
    }
    catch { }
    // 2. Fallback: market_chart prices → build candles by bucketing
    try {
        const mc = await cgFetch(`/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`, { cacheMs: 8000 });
        const prices = mc?.prices || [];
        if (prices.length === 0)
            return [];
        // Bucket into ~50 candles
        const buckets = Math.min(50, prices.length);
        const per = Math.ceil(prices.length / buckets);
        const candles = [];
        for (let i = 0; i < prices.length; i += per) {
            const slice = prices.slice(i, i + per);
            if (!slice.length)
                continue;
            const vals = slice.map(p => p[1]);
            candles.push({
                t: slice[0][0],
                o: vals[0],
                h: Math.max(...vals),
                l: Math.min(...vals),
                c: vals[vals.length - 1],
            });
        }
        return candles;
    }
    catch { }
    return [];
}
// ── Daily candles WITH VOLUME for the TA engine (needs ~200+ days for SMA200) ──
async function fetchAnalysisCandles(coinId, days = 240) {
    try {
        const mc = await cgFetch(`/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`, { cacheMs: 60000 });
        const prices = mc?.prices || [];
        const vols = mc?.total_volumes || [];
        if (prices.length < 30)
            return [];
        // Build daily candles. CoinGecko daily gives one price point per day → approximate
        // o/h/l/c from neighboring points; attach matching volume.
        const candles = [];
        for (let i = 0; i < prices.length; i++) {
            const p = prices[i][1];
            const prev = i > 0 ? prices[i - 1][1] : p;
            candles.push({
                t: prices[i][0],
                o: prev,
                h: Math.max(prev, p),
                l: Math.min(prev, p),
                c: p,
                v: vols[i] ? vols[i][1] : 0,
            });
        }
        return candles;
    }
    catch {
        return [];
    }
}
// ── CoinGecko detailed market data for one coin ──
async function fetchCoinDetail(coinId) {
    try {
        const d = await cgFetch(`/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`, { cacheMs: 15000 });
        if (!d?.market_data)
            return null;
        const m = d.market_data;
        return {
            name: d.name,
            symbol: (d.symbol || "").toUpperCase(),
            image: d.image?.small,
            price: m.current_price?.usd,
            change24h: m.price_change_percentage_24h,
            change7d: m.price_change_percentage_7d,
            high24h: m.high_24h?.usd,
            low24h: m.low_24h?.usd,
            ath: m.ath?.usd,
            atl: m.atl?.usd,
            marketCap: m.market_cap?.usd,
            volume24h: m.total_volume?.usd,
            rank: m.market_cap_rank,
            circulating: m.circulating_supply,
        };
    }
    catch { }
    // Fallback: CoinMarketCap quote by symbol (derive symbol from id when possible)
    try {
        const sym = (coinId || "").toUpperCase();
        const cmc = await cmcFetch(`/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(sym)}&convert=USD`);
        const entry = cmc?.data?.[sym]?.[0] || (Array.isArray(cmc?.data?.[sym]) ? cmc.data[sym][0] : null);
        const q = entry?.quote?.USD;
        if (q) {
            return {
                name: entry.name, symbol: entry.symbol, image: `https://s2.coinmarketcap.com/static/img/coins/64x64/${entry.id}.png`,
                price: q.price, change24h: q.percent_change_24h, change7d: q.percent_change_7d,
                high24h: null, low24h: null, marketCap: q.market_cap, volume24h: q.volume_24h,
                rank: entry.cmc_rank, circulating: entry.circulating_supply,
            };
        }
    }
    catch { }
    return null;
}
// ── CoinGecko search — queries the FULL coin database (15,000+ coins,
//    every blockchain). Accepts "btc", "QAI", "eth/usdt", etc. ──
async function searchCoins(query) {
    if (!query || query.trim().length < 1)
        return [];
    // Strip common quote-pair suffixes so "btc/usdt" or "eth-usd" → "btc"/"eth"
    let q = query.trim().toLowerCase();
    q = q.replace(/[\/\-\s]?(usdt|usdc|usd|ada|btc|eth|busd|dai)$/i, "").trim() || query.trim();
    try {
        const d = await cgFetch(`/search?query=${encodeURIComponent(q)}`, { cacheMs: 60000 });
        const coins = d?.coins || [];
        return coins.slice(0, 15).map(c => ({
            id: c.id,
            symbol: (c.symbol || "").toUpperCase(),
            name: c.name,
            image: c.thumb || c.large,
            rank: c.market_cap_rank,
        }));
    }
    catch {
        return [];
    }
}
// ── Native Candlestick Chart (SVG) ────────────────────────────
function CandleChart({ candles, height = 380 }) {
    if (!candles || candles.length === 0) {
        return React.createElement("div", { style: { height, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(180,210,255,0.3)", fontSize: "0.85rem" } }, "Loading chart data\u2026");
    }
    const W = 1000, H = height, padL = 70, padR = 20, padT = 20, padB = 30;
    const cw = W - padL - padR, ch = H - padT - padB;
    const highs = candles.map(c => c.h), lows = candles.map(c => c.l);
    const max = Math.max(...highs), min = Math.min(...lows);
    const range = max - min || 1;
    const x = i => padL + (i / (candles.length - 1 || 1)) * cw;
    const y = v => padT + ch - ((v - min) / range) * ch;
    const candleW = Math.max(2, (cw / candles.length) * 0.6);
    const fmtY = v => v >= 1000 ? (v / 1000).toFixed(1) + "K" : v >= 1 ? v.toFixed(2) : v.toFixed(6);
    const gridLines = 5;
    return (React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, style: { width: "100%", height: H }, preserveAspectRatio: "none" },
        Array.from({ length: gridLines + 1 }).map((_, i) => {
            const gy = padT + (ch / gridLines) * i;
            const val = max - (range / gridLines) * i;
            return (React.createElement("g", { key: i },
                React.createElement("line", { x1: padL, y1: gy, x2: W - padR, y2: gy, stroke: "rgba(255,255,255,0.05)", strokeWidth: "1" }),
                React.createElement("text", { x: padL - 8, y: gy + 4, fill: "rgba(180,210,255,0.4)", fontSize: "11", textAnchor: "end", fontFamily: "monospace" },
                    "$",
                    fmtY(val))));
        }),
        candles.map((c, i) => {
            const up = c.c >= c.o;
            const color = up ? "#30d158" : "#FF453A";
            const cx = x(i);
            const bodyTop = y(Math.max(c.o, c.c));
            const bodyBot = y(Math.min(c.o, c.c));
            const bodyH = Math.max(1, bodyBot - bodyTop);
            return (React.createElement("g", { key: i },
                React.createElement("line", { x1: cx, y1: y(c.h), x2: cx, y2: y(c.l), stroke: color, strokeWidth: "1" }),
                React.createElement("rect", { x: cx - candleW / 2, y: bodyTop, width: candleW, height: bodyH, fill: color, opacity: "0.9" })));
        })));
}
// ── Markets Page ──────────────────────────────────────────────
function MarketsPage({ Logo, showToast }) {
    const tvRef = useRef(null);
    const [coins, setCoins] = useState([]);
    const [coinsLoad, setCoinsLoad] = useState(true);
    const [selCoin, setSelCoin] = useState({ id: "bitcoin", symbol: "BTC", tvSymbol: "BINANCE:BTCUSDT" });
    const [detail, setDetail] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [analysisLoad, setAnalysisLoad] = useState(true);
    const [detailLoad, setDetailLoad] = useState(false);
    const [candles, setCandles] = useState([]);
    const [candleLoad, setCandleLoad] = useState(true);
    const [candleDays, setCandleDays] = useState(7);
    const [fgData, setFgData] = useState([]);
    const [fgLoad, setFgLoad] = useState(true);
    const [search, setSearch] = useState("");
    const [useTV, setUseTV] = useState(true); // TradingView is the only chart
    const [lastTick, setLastTick] = useState(null); // last live data refresh
    const [searchResults, setSearchResults] = useState([]);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searching, setSearching] = useState(false);
    const [tableFilter, setTableFilter] = useState("");
    // Map CoinGecko id → TradingView symbol (best-effort)
    const tvSymbolFor = (sym) => `BINANCE:${(sym || "").toUpperCase()}USDT`;
    // ── Load top coins on mount + auto-refresh every 30s ──
    useEffect(() => {
        let alive = true;
        const load = () => fetchTopCoins().then(c => {
            if (!alive)
                return;
            if (c && c.length)
                setCoins(c);
            setCoinsLoad(false);
        });
        load();
        const iv = setInterval(load, 30000);
        return () => { alive = false; clearInterval(iv); };
    }, []);
    // ── Load Fear & Greed on mount + refresh hourly ──
    useEffect(() => {
        let alive = true;
        const load = () => fetchFearGreed().then(d => { if (alive) {
            setFgData(d);
            setFgLoad(false);
        } });
        load();
        const iv = setInterval(load, 3600000);
        return () => { alive = false; clearInterval(iv); };
    }, []);
    // ── Load detail + candles when coin or timeframe changes ──
    useEffect(() => {
        let alive = true;
        // Keep seeded detail if it matches this coin; otherwise show the spinner
        setDetail(d => {
            if (d && d.symbol === selCoin.symbol)
                return d;
            setDetailLoad(true);
            return null;
        });
        fetchCoinDetail(selCoin.id).then(d => {
            if (!alive)
                return;
            if (d) {
                setDetail(d);
                setLastTick(new Date());
            }
            setDetailLoad(false);
        });
        return () => { alive = false; };
    }, [selCoin]);
    // ── Run the technical-analysis engine on daily candles (with volume) ──
    useEffect(() => {
        let alive = true;
        setAnalysisLoad(true);
        setAnalysis(null);
        fetchAnalysisCandles(selCoin.id, 240).then(candles => {
            if (!alive)
                return;
            // current price: prefer live detail price, else last candle close
            const px = (detail && detail.symbol === selCoin.symbol && detail.price)
                ? detail.price
                : (candles.length ? candles[candles.length - 1].c : null);
            const result = analyzeMarket(candles, px);
            setAnalysis(result);
            setAnalysisLoad(false);
        });
        return () => { alive = false; };
    }, [selCoin]);
    useEffect(() => {
        const iv = setInterval(() => {
            fetchCoinDetail(selCoin.id).then(d => { if (d) {
                setDetail(d);
                setLastTick(new Date());
            } });
        }, 30000);
        return () => clearInterval(iv);
    }, [selCoin]);
    // ── Debounced live search across ALL blockchains ──
    useEffect(() => {
        const q = search.trim();
        if (q.length < 1) {
            setSearchResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        const t = setTimeout(() => {
            searchCoins(q).then(r => {
                setSearchResults(r);
                setSearching(false);
                setSearchOpen(true);
            });
        }, 300); // debounce 300ms
        return () => clearTimeout(t);
    }, [search]);
    // Select a coin → seed detail instantly from table data, then refine
    const pickCoin = (c) => {
        seedDetailFrom(c);
        setSelCoin({ id: c.id, symbol: c.symbol, tvSymbol: tvSymbolFor(c.symbol) });
        setSearch("");
        setSearchResults([]);
        setSearchOpen(false);
    };
    // Instantly populate price/icon/targets from a market-row object (no API wait)
    const seedDetailFrom = (c) => {
        if (!c)
            return;
        const price = c.current_price ?? c.price;
        if (price == null)
            return;
        setDetail(d => ({
            ...(d || {}),
            name: c.name || c.id,
            symbol: (c.symbol || "").toUpperCase(),
            image: c.image || c.thumb,
            price,
            change24h: c.price_change_percentage_24h,
            high24h: c.high_24h,
            low24h: c.low_24h,
            marketCap: c.market_cap,
            volume24h: c.total_volume,
            rank: c.market_cap_rank,
        }));
        setDetailLoad(false);
    };
    // ── TradingView pro chart with VuManChu (optional toggle) ──
    useEffect(() => {
        if (!useTV)
            return;
        let cancelled = false;
        let raf1, raf2, timer;
        const mount = () => {
            const host = tvRef.current;
            if (!host || cancelled)
                return;
            // Wait until the container actually has a measured height, or Chrome
            // injects the widget at height 0 → the "wide and narrow" bug.
            const h = host.clientHeight;
            if (h < 100) {
                timer = setTimeout(mount, 60);
                return;
            }
            host.innerHTML = "";
            const widgetDiv = document.createElement("div");
            widgetDiv.className = "tradingview-widget-container__widget";
            widgetDiv.style.height = "calc(100% - 32px)";
            widgetDiv.style.width = "100%";
            host.appendChild(widgetDiv);
            const script = document.createElement("script");
            script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
            script.async = true;
            script.innerHTML = JSON.stringify({
                width: "100%",
                height: h, // explicit pixel height — no autosize race
                symbol: selCoin.tvSymbol || tvSymbolFor(selCoin.symbol),
                interval: "60",
                timezone: "Etc/UTC",
                theme: "dark",
                style: "1",
                locale: "en",
                backgroundColor: "rgba(0, 4, 10, 1)",
                gridColor: "rgba(255, 255, 255, 0.04)",
                allow_symbol_change: true,
                details: true,
                withdateranges: true,
                hide_side_toolbar: false,
                studies: [
                    "STD;Stochastic_RSI",
                    "STD;MF",
                    "STD;RSI",
                ],
                show_popup_button: true,
                popup_width: "1000",
                popup_height: "650",
                support_host: "https://www.tradingview.com",
            });
            host.appendChild(script);
        };
        // Double rAF ensures the browser has done layout before we measure height
        raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(mount); });
        return () => {
            cancelled = true;
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
            clearTimeout(timer);
        };
    }, [useTV, selCoin]);
    // ── Buy/sell/stop from the TA engine (fallback to 24h Fib if not ready) ──
    const targets = analysis ? {
        buyTarget: analysis.buyTarget,
        sellTarget: analysis.sellTarget,
        stopLoss: analysis.stopLoss,
    } : (detail && detail.low24h && detail.high24h ? {
        buyTarget: detail.low24h + (detail.high24h - detail.low24h) * 0.236,
        sellTarget: detail.low24h + (detail.high24h - detail.low24h) * 0.786,
        stopLoss: detail.low24h * 0.97,
    } : null);
    const filtered = tableFilter
        ? coins.filter(c => c.name.toLowerCase().includes(tableFilter.toLowerCase()) ||
            c.symbol.toLowerCase().includes(tableFilter.toLowerCase()))
        : coins;
    const currentFG = fgData[0] || null;
    const fgColor = v => v >= 75 ? "#30d158" : v >= 55 ? "#a3d977" :
        v >= 45 ? "#FFD54F" : v >= 25 ? "#FF9F0A" : "#FF453A";
    const fgLabel = v => v >= 75 ? "Extreme Greed" : v >= 55 ? "Greed" :
        v >= 45 ? "Neutral" : v >= 25 ? "Fear" : "Extreme Fear";
    const fmtPrice = p => {
        if (p == null)
            return "—";
        if (p >= 1000)
            return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
        if (p >= 1)
            return p.toFixed(4);
        return p.toFixed(8);
    };
    const fmtCap = n => {
        if (n == null)
            return "—";
        if (n >= 1e12)
            return "$" + (n / 1e12).toFixed(2) + "T";
        if (n >= 1e9)
            return "$" + (n / 1e9).toFixed(2) + "B";
        if (n >= 1e6)
            return "$" + (n / 1e6).toFixed(2) + "M";
        return "$" + n.toFixed(0);
    };
    return (React.createElement("div", { style: { paddingTop: 72, minHeight: "100vh" } },
        React.createElement("div", { style: { textAlign: "center", padding: "2.5rem 1.5rem 1.5rem", background: "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(0,114,255,0.1) 0%, transparent 65%)", borderBottom: "0.5px solid var(--border)" } },
            React.createElement("div", { className: "dl-badge" },
                React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "#00C6FF", boxShadow: "0 0 6px #00C6FF", display: "inline-block" } }),
                "Multi-Chain Market Intelligence"),
            React.createElement("h1", { className: "dl-title", style: { fontSize: "clamp(1.8rem,4.5vw,3rem)" } }, "QuantumAI Markets"),
            React.createElement("p", { className: "dl-sub" }, "Live charts and real-time data for every major coin & token across all blockchains. Real-time buy/sell targets, VuManChu Cipher A & B pro charts, and the crypto Fear & Greed Index."),
            React.createElement("div", { style: { maxWidth: 620, margin: "0.5rem auto 0", fontSize: "0.72rem", color: "rgba(255,213,79,0.75)", background: "rgba(255,213,79,0.06)", border: "0.5px solid rgba(255,213,79,0.2)", borderRadius: 10, padding: "0.5rem 0.9rem", lineHeight: 1.5 } }, "\u23F3 Charts and prices pull from live market APIs and may take a few moments to load \u2014 especially on first visit. If something looks blank, give it a few seconds or tap retry.")),
        React.createElement("div", { style: { maxWidth: 1280, margin: "0 auto", padding: "2rem 1.5rem" } },
            React.createElement("div", { style: { position: "relative", marginBottom: "1.75rem", zIndex: 50 } },
                React.createElement("div", { style: { position: "relative" } },
                    React.createElement("span", { style: { position: "absolute", left: "1.1rem", top: "50%", transform: "translateY(-50%)", fontSize: "1.1rem", opacity: 0.5, pointerEvents: "none" } }, "\uD83D\uDD0D"),
                    React.createElement("input", { value: search, onChange: e => setSearch(e.target.value), onFocus: () => { if (searchResults.length)
                            setSearchOpen(true); }, onKeyDown: e => { if (e.key === "Enter" && searchResults[0])
                            pickCoin(searchResults[0]); if (e.key === "Escape")
                            setSearchOpen(false); }, placeholder: "Search any coin or token \u2014 BTC, ETH, QAI, SOL, BTC/USDT\u2026 (all blockchains)", style: {
                            width: "100%", boxSizing: "border-box",
                            background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(0,198,255,0.25)",
                            borderRadius: 14, padding: "0.95rem 1.1rem 0.95rem 2.9rem", color: "#fff",
                            fontSize: "0.95rem", fontFamily: "inherit", outline: "none", letterSpacing: "-0.01em",
                        } }),
                    search && (React.createElement("button", { onClick: () => { setSearch(""); setSearchResults([]); setSearchOpen(false); }, style: { position: "absolute", right: "1rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "rgba(180,210,255,0.5)", cursor: "pointer", fontSize: "1.1rem" } }, "\u00D7"))),
                searchOpen && (search.trim().length > 0) && (React.createElement("div", { style: {
                        position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                        background: "rgba(8,14,24,0.98)", backdropFilter: "blur(20px)",
                        border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 14,
                        boxShadow: "0 20px 50px rgba(0,0,0,0.6)", overflow: "hidden", maxHeight: 400, overflowY: "auto",
                    } }, searching ? (React.createElement("div", { style: { padding: "1rem 1.2rem", color: "rgba(180,210,255,0.4)", fontSize: "0.85rem" } }, "Searching all chains\u2026")) : searchResults.length > 0 ? (searchResults.map(c => (React.createElement("div", { key: c.id, onClick: () => pickCoin(c), style: { display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.7rem 1.2rem", cursor: "pointer", borderBottom: "0.5px solid rgba(255,255,255,0.04)", transition: "background 0.15s" }, onMouseEnter: e => e.currentTarget.style.background = "rgba(0,198,255,0.08)", onMouseLeave: e => e.currentTarget.style.background = "transparent" },
                    c.image ? React.createElement("img", { src: c.image, alt: c.symbol, style: { width: 28, height: 28, borderRadius: "50%" } }) : React.createElement("div", { style: { width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.08)" } }),
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("div", { style: { fontWeight: 700, color: "#fff", fontSize: "0.9rem" } },
                            c.symbol,
                            " ",
                            React.createElement("span", { style: { color: "rgba(180,210,255,0.5)", fontWeight: 500, fontSize: "0.8rem" } }, c.name))),
                    c.rank && React.createElement("span", { style: { fontSize: "0.66rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: 6, background: "rgba(255,255,255,0.06)", color: "rgba(180,210,255,0.5)" } },
                        "#",
                        c.rank))))) : (React.createElement("div", { style: { padding: "1rem 1.2rem", color: "rgba(180,210,255,0.4)", fontSize: "0.85rem" } },
                    "No coins found for \"",
                    search,
                    "\". Try a symbol like BTC, ETH, or a name.")))),
                React.createElement("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.85rem" } }, [
                    { id: "bitcoin", symbol: "BTC" }, { id: "ethereum", symbol: "ETH" }, { id: "solana", symbol: "SOL" },
                    { id: "cardano", symbol: "ADA" }, { id: "ripple", symbol: "XRP" }, { id: "binancecoin", symbol: "BNB" },
                    { id: "dogecoin", symbol: "DOGE" }, { id: "avalanche-2", symbol: "AVAX" },
                ].map(c => (React.createElement("button", { key: c.id, onClick: () => { const full = coins.find(x => x.id === c.id); if (full)
                        seedDetailFrom(full); setSelCoin({ id: c.id, symbol: c.symbol, tvSymbol: tvSymbolFor(c.symbol) }); }, style: { fontSize: "0.74rem", fontWeight: 700, padding: "0.4rem 0.85rem", borderRadius: 20, cursor: "pointer",
                        background: selCoin.id === c.id ? "rgba(0,198,255,0.15)" : "rgba(255,255,255,0.04)",
                        border: selCoin.id === c.id ? "0.5px solid rgba(0,198,255,0.4)" : "0.5px solid rgba(255,255,255,0.08)",
                        color: selCoin.id === c.id ? "var(--blue)" : "rgba(180,210,255,0.7)" } }, c.symbol))))),
            React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "1.25rem" } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.9rem" } },
                    detail?.image
                        ? React.createElement("img", { src: detail.image, alt: detail.symbol, style: { width: 44, height: 44, borderRadius: "50%" } })
                        : React.createElement(Logo, { w: 44, h: 44, r: 12 }),
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontSize: "1.3rem", fontWeight: 800, letterSpacing: "-0.03em" } },
                            detail?.name || selCoin.symbol,
                            " ",
                            React.createElement("span", { style: { color: "var(--muted)", fontSize: "0.9rem" } }, detail?.symbol),
                            detail?.rank && React.createElement("span", { style: { fontSize: "0.68rem", fontWeight: 700, marginLeft: "0.5rem", padding: "0.15rem 0.5rem", borderRadius: 6, background: "rgba(255,255,255,0.08)", color: "rgba(180,210,255,0.6)" } },
                                "RANK #",
                                detail.rank)),
                        React.createElement("div", { style: { fontSize: "0.78rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "0.4rem" } },
                            React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "#30d158", boxShadow: "0 0 6px #30d158", display: "inline-block", animation: "pulse 2s infinite" } }),
                            "Live \u00B7 CoinGecko",
                            lastTick ? ` · ${lastTick.toLocaleTimeString()}` : ""))),
                React.createElement("div", { style: { textAlign: "right" } },
                    React.createElement("div", { style: { fontSize: "1.8rem", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1 } }, detailLoad ? "…" : detail ? `$${fmtPrice(detail.price)}` : "—"),
                    detail?.change24h != null && (React.createElement("div", { style: { fontSize: "0.9rem", fontWeight: 700, color: detail.change24h >= 0 ? "#30d158" : "#FF453A" } },
                        detail.change24h >= 0 ? "▲" : "▼",
                        " ",
                        Math.abs(detail.change24h).toFixed(2),
                        "% (24h)")))),
            React.createElement("div", { style: { background: "linear-gradient(135deg,rgba(0,198,255,0.06),rgba(123,47,255,0.04))", border: `0.5px solid ${analysis ? analysis.signalColor : "rgba(255,255,255,0.1)"}`, borderRadius: 16, padding: "1.1rem 1.25rem", marginBottom: "1rem" } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" } },
                    React.createElement("div", null,
                        React.createElement("div", { style: { fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(180,210,255,0.45)", textTransform: "uppercase", marginBottom: "0.3rem" } },
                            "QuantumAI Signal \u00B7 ",
                            detail?.symbol || selCoin.symbol),
                        analysisLoad ? (React.createElement("div", { style: { fontSize: "1.4rem", fontWeight: 900, color: "rgba(180,210,255,0.4)" } }, "Analyzing\u2026")) : analysis ? (React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap" } },
                            React.createElement("span", { style: { fontSize: "1.5rem", fontWeight: 900, color: analysis.signalColor, letterSpacing: "-0.02em", textShadow: `0 0 18px ${analysis.signalColor}66` } }, analysis.signal),
                            React.createElement("span", { style: { fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.6rem", borderRadius: 20, background: "rgba(255,255,255,0.06)", color: "rgba(180,210,255,0.7)" } },
                                "score ",
                                analysis.score))) : (React.createElement("div", { style: { fontSize: "1rem", color: "rgba(180,210,255,0.4)" } },
                            "Insufficient data for ",
                            selCoin.symbol))),
                    analysis?.cycle && (React.createElement("div", { style: { textAlign: "right", fontSize: "0.7rem", color: "rgba(180,210,255,0.6)" } },
                        React.createElement("div", { style: { fontWeight: 700, color: analysis.cycle.bias === "bullish" ? "#30d158" : analysis.cycle.bias === "bearish" ? "#FF453A" : "#FFD54F" } },
                            "\u20BF ",
                            analysis.cycle.phase),
                        React.createElement("div", { style: { fontSize: "0.62rem", color: "rgba(180,210,255,0.4)" } },
                            analysis.cycle.halfBias,
                            " \u00B7 ",
                            analysis.moon)))),
                analysis?.reasons?.length > 0 && (React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.85rem" } }, analysis.reasons.slice(0, 8).map((r, i) => (React.createElement("span", { key: i, style: { fontSize: "0.64rem", fontWeight: 600, padding: "0.25rem 0.6rem", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.07)", color: "rgba(200,225,255,0.75)" } }, r)))))),
            analysis?.indicators && (React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: "0.5rem", marginBottom: "1rem" } }, [
                { k: "RSI", v: analysis.indicators.rsi?.toFixed(0), zone: analysis.indicators.rsi < 30 ? "Oversold" : analysis.indicators.rsi > 70 ? "Overbought" : "Neutral" },
                { k: "Stoch RSI", v: analysis.indicators.stochRsi?.toFixed(0), zone: analysis.indicators.stochRsi < 20 ? "Oversold" : analysis.indicators.stochRsi > 80 ? "Overbought" : "Neutral" },
                { k: "Money Flow", v: analysis.indicators.mfi?.toFixed(0), zone: analysis.indicators.mfi < 20 ? "Oversold" : analysis.indicators.mfi > 80 ? "Overbought" : "Neutral" },
                { k: "WaveTrend", v: analysis.indicators.waveTrend?.toFixed(0), zone: analysis.indicators.waveTrend < -53 ? "Buy zone" : analysis.indicators.waveTrend > 53 ? "Sell zone" : "Mid" },
                { k: "Divergence", v: analysis.indicators.divergence || "none", zone: analysis.indicators.divergence === "bullish" ? "Bullish" : analysis.indicators.divergence === "bearish" ? "Bearish" : "—" },
                { k: "Pattern", v: analysis.indicators.pattern, zone: "" },
            ].map((x, i) => (React.createElement("div", { key: i, style: { background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.6rem 0.7rem" } },
                React.createElement("div", { style: { fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.06em", color: "rgba(180,210,255,0.4)", textTransform: "uppercase" } }, x.k),
                React.createElement("div", { style: { fontSize: "0.92rem", fontWeight: 800, color: "#fff", margin: "0.15rem 0", letterSpacing: "-0.01em" } }, x.v ?? "—"),
                x.zone && React.createElement("div", { style: { fontSize: "0.58rem", fontWeight: 600, color: "rgba(180,210,255,0.5)" } }, x.zone)))))),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "0.75rem", marginBottom: "1.5rem" } }, [
                { label: "AI BUY-IN", val: targets ? `$${fmtPrice(targets.buyTarget)}` : "—", color: "#30d158", sub: analysis ? "Multi-indicator entry" : "Est. entry" },
                { label: "AI SELL", val: targets ? `$${fmtPrice(targets.sellTarget)}` : "—", color: "#FF9F0A", sub: analysis ? "Swing target" : "Est. target" },
                { label: "STOP LOSS", val: targets ? `$${fmtPrice(targets.stopLoss)}` : "—", color: "#FF453A", sub: "Below swing low" },
                { label: "24H VOLUME", val: detail ? fmtCap(detail.volume24h) : "—", color: "#fff", sub: "Trading volume" },
                { label: "MARKET CAP", val: detail ? fmtCap(detail.marketCap) : "—", color: "#fff", sub: "Total value" },
            ].map((s, i) => (React.createElement("div", { key: i, style: { background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "0.9rem 1rem" } },
                React.createElement("div", { style: { fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(180,210,255,0.4)", textTransform: "uppercase", marginBottom: "0.35rem" } }, s.label),
                React.createElement("div", { style: { fontSize: "1.05rem", fontWeight: 800, color: s.color, letterSpacing: "-0.02em" } }, s.val),
                React.createElement("div", { style: { fontSize: "0.64rem", color: "rgba(180,210,255,0.4)", marginTop: "0.2rem", fontWeight: 600 } }, s.sub))))),
            React.createElement("div", { style: { background: "rgba(0,4,10,0.6)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 18, overflow: "hidden", marginBottom: "1.5rem" } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1.25rem", borderBottom: "0.5px solid rgba(255,255,255,0.06)", flexWrap: "wrap", gap: "0.75rem" } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.6rem" } },
                        React.createElement("span", { style: { fontWeight: 700, fontSize: "0.92rem", letterSpacing: "-0.02em" } },
                            detail?.symbol || selCoin.symbol,
                            "/USD"),
                        React.createElement("span", { style: { fontSize: "0.62rem", fontWeight: 700, padding: "0.2rem 0.55rem", borderRadius: 6, background: "rgba(0,198,255,0.12)", color: "var(--blue)" } }, "\u25CF TradingView Pro")),
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" } },
                        React.createElement("span", { style: { fontSize: "0.62rem", fontWeight: 700, padding: "0.2rem 0.55rem", borderRadius: 6, background: "rgba(0,198,255,0.1)", color: "var(--blue)" } }, "Stoch RSI"),
                        React.createElement("span", { style: { fontSize: "0.62rem", fontWeight: 700, padding: "0.2rem 0.55rem", borderRadius: 6, background: "rgba(123,47,255,0.1)", color: "#a78bff" } }, "Money Flow"),
                        React.createElement("span", { style: { fontSize: "0.62rem", fontWeight: 700, padding: "0.2rem 0.55rem", borderRadius: 6, background: "rgba(255,213,79,0.1)", color: "var(--gold)" } }, "RSI"))),
                React.createElement("div", { ref: tvRef, className: "tradingview-widget-container tv-chart-box" }),
                React.createElement("div", { style: { fontSize: "0.66rem", color: "rgba(180,210,255,0.4)", padding: "0.6rem 1.25rem", borderTop: "0.5px solid rgba(255,255,255,0.04)", lineHeight: 1.6 } },
                    "Chart loads with Stochastic RSI, Money Flow & RSI \u2014 the momentum/money-flow components behind VuManChu Cipher A & B. To add the exact VuManChu Cipher A & B scripts: click the ",
                    React.createElement("strong", null, "Indicators (fx)"),
                    " button on the chart toolbar, search ",
                    React.createElement("strong", null, "\"VuManChu Cipher\""),
                    ", and select them from the Community Scripts tab.")),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr", gap: "1.5rem", marginBottom: "1.5rem" } },
                React.createElement("div", { style: { background: "rgba(0,4,10,0.6)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: "1.5rem" } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" } },
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontWeight: 700, fontSize: "1rem", letterSpacing: "-0.02em", marginBottom: "0.2rem" } }, "Crypto Fear & Greed Index"),
                            React.createElement("div", { style: { fontSize: "0.74rem", color: "var(--muted)" } }, "Market sentiment \u00B7 updated daily \u00B7 alternative.me")),
                        currentFG && (React.createElement("div", { style: { textAlign: "right" } },
                            React.createElement("div", { style: { fontSize: "2.2rem", fontWeight: 900, lineHeight: 1, color: fgColor(currentFG.value) } }, currentFG.value),
                            React.createElement("div", { style: { fontSize: "0.78rem", fontWeight: 700, color: fgColor(currentFG.value) } }, fgLabel(currentFG.value))))),
                    currentFG && (React.createElement("div", { style: { marginBottom: "1.5rem" } },
                        React.createElement("div", { style: { height: 14, borderRadius: 8, background: "linear-gradient(90deg, #FF453A 0%, #FF9F0A 25%, #FFD54F 50%, #a3d977 75%, #30d158 100%)", position: "relative" } },
                            React.createElement("div", { style: { position: "absolute", top: "50%", left: `${currentFG.value}%`, transform: "translate(-50%,-50%)", width: 20, height: 20, borderRadius: "50%", background: "#fff", border: `3px solid ${fgColor(currentFG.value)}`, boxShadow: "0 2px 8px rgba(0,0,0,0.5)" } })),
                        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginTop: "0.5rem", fontSize: "0.62rem", fontWeight: 600, color: "rgba(180,210,255,0.4)" } },
                            React.createElement("span", null, "0 \u00B7 Extreme Fear"),
                            React.createElement("span", null, "50 \u00B7 Neutral"),
                            React.createElement("span", null, "100 \u00B7 Extreme Greed")))),
                    fgLoad ? (React.createElement("div", { style: { textAlign: "center", padding: "2rem", color: "rgba(180,210,255,0.3)" } }, "Loading sentiment history\u2026")) : fgData.length > 0 ? (React.createElement("div", null,
                        React.createElement("div", { style: { fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(180,210,255,0.4)", textTransform: "uppercase", marginBottom: "0.75rem" } }, "30-Day History"),
                        React.createElement("div", { style: { display: "flex", alignItems: "flex-end", gap: "3px", height: 90 } }, [...fgData].reverse().map((d, i) => (React.createElement("div", { key: i, title: `${d.value} · ${d.label}`, style: { flex: 1, height: `${d.value}%`, background: fgColor(d.value), borderRadius: "2px 2px 0 0", opacity: 0.85 } })))))) : (React.createElement("div", { style: { textAlign: "center", padding: "1.5rem", color: "rgba(180,210,255,0.3)", fontSize: "0.8rem" } }, "Sentiment data unavailable right now.")))),
            React.createElement("div", { style: { background: "rgba(0,4,10,0.6)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 18, overflow: "hidden" } },
                React.createElement("div", { style: { padding: "0.85rem 1.25rem", borderBottom: "0.5px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" } },
                    React.createElement("div", { style: { fontWeight: 700, fontSize: "0.92rem", letterSpacing: "-0.02em" } }, "Live Market \u2014 Top 50 Coins (All Chains)"),
                    React.createElement("input", { value: tableFilter, onChange: e => setTableFilter(e.target.value), placeholder: "Filter list\u2026", style: { background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "0.45rem 0.8rem", color: "#fff", fontSize: "0.8rem", fontFamily: "inherit", outline: "none", width: "160px" } })),
                coinsLoad ? (React.createElement("div", { style: { padding: "0.5rem 0" } },
                    Array.from({ length: 8 }).map((_, i) => (React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.7rem 1rem", borderBottom: "0.5px solid rgba(255,255,255,0.03)" } },
                        React.createElement("div", { className: "skel", style: { width: 18, height: 14, borderRadius: 4 } }),
                        React.createElement("div", { className: "skel", style: { width: 24, height: 24, borderRadius: "50%" } }),
                        React.createElement("div", { style: { flex: 1 } },
                            React.createElement("div", { className: "skel", style: { width: "40%", height: 11, borderRadius: 4, marginBottom: 6 } }),
                            React.createElement("div", { className: "skel", style: { width: "25%", height: 9, borderRadius: 4 } })),
                        React.createElement("div", { className: "skel", style: { width: 70, height: 13, borderRadius: 4 } }),
                        React.createElement("div", { className: "skel", style: { width: 50, height: 13, borderRadius: 4, marginLeft: "1rem" } })))),
                    React.createElement("div", { style: { textAlign: "center", padding: "1rem", color: "rgba(180,210,255,0.35)", fontSize: "0.8rem" } },
                        React.createElement("span", { className: "online-dot", style: { marginRight: "0.5rem", animation: "pulse 1.2s infinite" } }),
                        "Fetching live market data\u2026"))) : coins.length === 0 ? (React.createElement("div", { style: { textAlign: "center", padding: "2.5rem 1.5rem", color: "rgba(180,210,255,0.4)", fontSize: "0.85rem", lineHeight: 1.6 } },
                    "Market data is taking longer than usual to load.",
                    React.createElement("br", null),
                    React.createElement("button", { onClick: () => { setCoinsLoad(true); fetchTopCoins().then(c => { if (c && c.length)
                            setCoins(c); setCoinsLoad(false); }); }, style: { marginTop: "0.75rem", padding: "0.5rem 1rem", borderRadius: 8, background: "rgba(0,198,255,0.12)", border: "0.5px solid rgba(0,198,255,0.3)", color: "var(--blue)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 700 } }, "\u21BA Retry"))) : (React.createElement("div", { style: { overflowX: "auto" } },
                    React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" } },
                        React.createElement("thead", null,
                            React.createElement("tr", { style: { borderBottom: "0.5px solid rgba(255,255,255,0.06)" } }, ["#", "Coin", "Price", "24h", "Market Cap", "Volume (24h)", "Chart"].map((h, i) => (React.createElement("th", { key: i, style: { textAlign: i < 2 ? "left" : "right", padding: "0.7rem 1rem", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.4)", textTransform: "uppercase", whiteSpace: "nowrap" } }, h))))),
                        React.createElement("tbody", null, filtered.map(c => {
                            const up = (c.price_change_percentage_24h || 0) >= 0;
                            const isSel = c.id === selCoin.id;
                            return (React.createElement("tr", { key: c.id, onClick: () => { seedDetailFrom(c); setSelCoin({ id: c.id, symbol: c.symbol.toUpperCase(), tvSymbol: tvSymbolFor(c.symbol) }); window.scrollTo({ top: 0, behavior: "smooth" }); }, style: { borderBottom: "0.5px solid rgba(255,255,255,0.03)", cursor: "pointer", background: isSel ? "rgba(0,198,255,0.06)" : "transparent", transition: "background 0.15s" }, onMouseEnter: e => { if (!isSel)
                                    e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }, onMouseLeave: e => { if (!isSel)
                                    e.currentTarget.style.background = "transparent"; } },
                                React.createElement("td", { style: { padding: "0.7rem 1rem", color: "rgba(180,210,255,0.4)", fontWeight: 600 } }, c.market_cap_rank),
                                React.createElement("td", { style: { padding: "0.7rem 1rem" } },
                                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.6rem" } },
                                        React.createElement("img", { src: c.image, alt: c.symbol, style: { width: 24, height: 24, borderRadius: "50%" } }),
                                        React.createElement("div", null,
                                            React.createElement("div", { style: { fontWeight: 700, color: "#fff" } }, c.symbol.toUpperCase()),
                                            React.createElement("div", { style: { fontSize: "0.68rem", color: "rgba(180,210,255,0.4)" } }, c.name)))),
                                React.createElement("td", { style: { padding: "0.7rem 1rem", textAlign: "right", fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" } },
                                    "$",
                                    fmtPrice(c.current_price)),
                                React.createElement("td", { style: { padding: "0.7rem 1rem", textAlign: "right", fontWeight: 700, color: up ? "#30d158" : "#FF453A", fontVariantNumeric: "tabular-nums" } },
                                    up ? "▲" : "▼",
                                    " ",
                                    Math.abs(c.price_change_percentage_24h || 0).toFixed(2),
                                    "%"),
                                React.createElement("td", { style: { padding: "0.7rem 1rem", textAlign: "right", color: "rgba(180,210,255,0.7)", fontVariantNumeric: "tabular-nums" } }, fmtCap(c.market_cap)),
                                React.createElement("td", { style: { padding: "0.7rem 1rem", textAlign: "right", color: "rgba(180,210,255,0.7)", fontVariantNumeric: "tabular-nums" } }, fmtCap(c.total_volume)),
                                React.createElement("td", { style: { padding: "0.7rem 1rem", textAlign: "right", width: 90 } },
                                    React.createElement(Sparkline, { data: c.sparkline_in_7d?.price, up: up }))));
                        })))))),
            React.createElement("div", { className: "disclaimer", style: { marginTop: "1.5rem" } },
                React.createElement("strong", null, "\u26A0 Liability Disclaimer:"),
                " Live price & market data from CoinGecko (CoinMarketCap fallback). Optional pro charts via TradingView with VuManChu Cipher A & B (third-party open-source indicators). The BUY-IN / SELL / STOP-LOSS levels and signal are generated by an algorithmic engine combining SMA 8/55/200, EMA 200, RSI, Stoch RSI, Money Flow, WaveTrend (Cipher B), divergences, chart-pattern recognition, volume pocket-gap profiling, parabolic-move detection, and the Bitcoin 4-year (halving) cycle. These are ",
                React.createElement("strong", null, "estimates for informational purposes only \u2014 not predictions and not financial advice."),
                " No indicator can foretell price; markets are volatile and can move against any signal. QuantumAI accepts ",
                React.createElement("strong", null, "no liability"),
                " for losses. Always do your own research."))));
}
// ── Mini sparkline for table rows ─────────────────────────────
function Sparkline({ data, up }) {
    if (!data || data.length === 0)
        return React.createElement("span", { style: { color: "rgba(180,210,255,0.2)" } }, "\u2014");
    const W = 80, H = 28;
    const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
    const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * H}`).join(" ");
    return (React.createElement("svg", { width: W, height: H, style: { display: "block", marginLeft: "auto" } },
        React.createElement("polyline", { points: pts, fill: "none", stroke: up ? "#30d158" : "#FF453A", strokeWidth: "1.5", strokeLinejoin: "round" })));
}
// ── Main App ──────────────────────────────────────────────────
function QuantumAI() {
    const [walletModal, setWalletModal] = useState(false);
    const [wallet, setWallet] = useState(null); // { name, key, addr, ada, qai, networkId, api }
    const [availWallets, setAvailWallets] = useState([]); // detected CIP-30 wallets
    const [walletConnecting, setWalletConnecting] = useState(null); // key being connected
    const [page, setPage] = useState("home"); // "home" | "markets" | "chat" | "downloads" | "cloud"
    // ── Cloud Connect (web) state ──
    const [cloudServer, setCloudServer] = useState("");
    const [cloudUser, setCloudUser] = useState("");
    const [cloudPass, setCloudPass] = useState("");
    const [cloudToken, setCloudToken] = useState(null);
    const [cloudFiles, setCloudFiles] = useState([]);
    const [cloudErr, setCloudErr] = useState("");
    const [cloudBusy, setCloudBusy] = useState(false);
    const [cloudFolder, setCloudFolder] = useState("My Cloud");
    // ── Live DEX price state ──
    const [priceADA, setPriceADA] = useState(0);
    const [priceUSD, setPriceUSD] = useState(0);
    const [adaUSD, setAdaUSD] = useState(0.37);
    const [pctChange, setPctChange] = useState(0);
    const [volume24h, setVolume24h] = useState(0);
    const [liquidity, setLiquidity] = useState(0);
    const [priceSource, setPriceSource] = useState("—");
    const [poolVersion, setPoolVersion] = useState("V3"); // SundaeSwap pool version
    const [priceHistory, setPriceHistory] = useState([]);
    const [priceLoading, setPriceLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [toast, setToast] = useState(null);
    const [encLevel, setEncLevel] = useState("aes");
    const [isDrag, setIsDrag] = useState(false);
    const [imgErr, setImgErr] = useState(false);
    const [vaultFiles, setVaultFiles] = useState([]); // [{name, level, size, blob, kind}]
    const [vaultPassword, setVaultPassword] = useState(""); // active session password
    const [pwMode, setPwMode] = useState("choose"); // "choose" | "auto"
    const [showPw, setShowPw] = useState(false);
    const [vaultBusy, setVaultBusy] = useState(false);
    const [keyBackedUp, setKeyBackedUp] = useState(false);
    const fileRef = useRef(null);
    const decFileRef = useRef(null);
    const [persona, setPersona] = useState("jarvis"); // "jarvis" | "friday"
    const [voiceOn, setVoiceOn] = useState(false); // text-to-speech toggle
    const [listening, setListening] = useState(false); // mic active
    const recognitionRef = useRef(null);
    // ── Per-user personalization (saved to this browser) ──
    const [showSettings, setShowSettings] = useState(false);
    const [availVoices, setAvailVoices] = useState([]);
    const [custom, setCustom] = useState(() => {
        const def = { jarvis: {}, friday: {} };
        try {
            const raw = (typeof localStorage !== "undefined") && localStorage.getItem("qai_persona_custom");
            return raw ? { ...def, ...JSON.parse(raw) } : def;
        }
        catch {
            return def;
        }
    });
    const saveCustom = (next) => {
        setCustom(next);
        try {
            if (typeof localStorage !== "undefined")
                localStorage.setItem("qai_persona_custom", JSON.stringify(next));
        }
        catch { }
    };
    // Effective persona config = base persona overlaid with the user's customizations
    const pcfg = (p = persona) => {
        const base = PERSONAS[p];
        const c = custom[p] || {};
        return {
            ...base,
            name: c.name || base.name,
            displayName: c.name || base.name,
            voiceURI: c.voiceURI || null,
            rate: c.rate != null ? c.rate : (p === "friday" ? 1.06 : 0.97),
            pitch: c.pitch != null ? c.pitch : (base.gender === "male" ? 0.75 : 1.15),
            sys: c.personality
                ? `${base.sys}\n\nAdditional user-defined personality and instructions: ${c.personality}`
                : base.sys,
        };
    };
    // Load available TTS voices (they populate asynchronously)
    useEffect(() => {
        const load = () => setAvailVoices((window.speechSynthesis?.getVoices && window.speechSynthesis.getVoices()) || []);
        load();
        if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.onvoiceschanged = load;
        }
    }, []);
    const [chatMsgs, setChatMsgs] = useState([
        { role: "bot", text: PERSONAS.jarvis.greeting }
    ]);
    const [chatInput, setChatInput] = useState("");
    const [chatLoading, setChatLoading] = useState(false);
    const [speaking, setSpeaking] = useState(false); // TTS actively talking
    const chatEndRef = useRef(null);
    // Speak helper that applies the user's voice customizations + tracks speaking state
    const speakAs = (text, p = persona) => {
        const c = pcfg(p);
        try {
            if (!("speechSynthesis" in window))
                return;
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>]/g, ""));
            const v = pickVoice(p, c.voiceURI);
            if (v) {
                u.voice = v;
                u.lang = v.lang;
            }
            else {
                u.lang = PERSONAS[p].voice;
            }
            u.rate = c.rate;
            u.pitch = c.pitch;
            u.onstart = () => setSpeaking(true);
            u.onend = () => setSpeaking(false);
            u.onerror = () => setSpeaking(false);
            window.speechSynthesis.speak(u);
        }
        catch {
            setSpeaking(false);
        }
    };
    // The assistant's current life-state, drives the core animation + status text
    const coreState = listening ? "listening" : chatLoading ? "thinking" : speaking ? "speaking" : "idle";
    const coreStatusText = {
        idle: "● Online · standing by",
        listening: "◉ Listening",
        thinking: "⟳ Thinking",
        speaking: "◆ Speaking",
    }[coreState];
    // Switch persona — reset greeting to the new assistant
    const switchPersona = (p) => {
        if (p === persona)
            return;
        setPersona(p);
        const c = pcfg(p);
        const greet = (c.name !== PERSONAS[p].name)
            ? PERSONAS[p].greeting.replace(PERSONAS[p].name, c.name)
            : PERSONAS[p].greeting;
        setChatMsgs([{ role: "bot", text: greet }]);
        if (voiceOn)
            speakAs(greet, p);
    };
    // AI predictions from live price
    const buyTarget = priceADA > 0 ? (priceADA * 0.88).toFixed(6) : "—";
    const sellTarget = priceADA > 0 ? (priceADA * 1.42).toFixed(6) : "—";
    // ── Fetch live DEX prices ──
    const refreshPrices = useCallback(async () => {
        setPriceLoading(true);
        try {
            // Fetch ADA/USD and QAI/ADA in parallel
            const [dexData, adaRate, history] = await Promise.all([
                fetchLiveDEXPrice(),
                fetchADAtoUSD(),
                fetchPriceHistory(),
            ]);
            if (adaRate > 0)
                setAdaUSD(adaRate);
            if (dexData) {
                setPriceADA(dexData.priceADA);
                setPriceUSD(dexData.priceADA * (adaRate || 0.37));
                setPctChange(dexData.change24h);
                setVolume24h(dexData.volume24h);
                setLiquidity(dexData.liquidity);
                setPriceSource(dexData.source);
                if (dexData.poolVersion)
                    setPoolVersion(dexData.poolVersion);
                setLastUpdated(new Date());
            }
            if (history.length > 0) {
                setPriceHistory(history);
            }
            else if (dexData) {
                setPriceHistory(prev => {
                    const next = [...prev, dexData.priceADA].slice(-60);
                    return next;
                });
            }
        }
        catch (e) {
            console.warn("Price fetch error:", e);
        }
        setPriceLoading(false);
    }, []);
    useEffect(() => {
        refreshPrices();
        const interval = setInterval(refreshPrices, 60000); // refresh every 60s
        return () => clearInterval(interval);
    }, [refreshPrices]);
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs, chatLoading]);
    const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2800); };
    // Detect installed wallets whenever the modal opens (extensions inject async)
    const refreshWallets = useCallback(() => {
        setAvailWallets(detectWallets());
    }, []);
    useEffect(() => {
        if (!walletModal)
            return;
        refreshWallets();
        // Wallets can inject slightly after load — re-check a few times
        const t1 = setTimeout(refreshWallets, 300);
        const t2 = setTimeout(refreshWallets, 1000);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [walletModal, refreshWallets]);
    // Real CIP-30 connect
    const connectWallet = async (w) => {
        setWalletConnecting(w.key);
        try {
            const conn = await connectCIP30(w.key);
            if (conn.networkId !== 1) {
                showToast(`${w.name} is on testnet — switch to mainnet`);
            }
            setWallet({
                name: w.name, key: w.key, icon: w.icon,
                addr: conn.addrHex, ada: conn.ada, qai: conn.qai,
                networkId: conn.networkId, api: conn.api,
            });
            setWalletModal(false);
            showToast(`${w.name} connected · ${conn.qai.toLocaleString()} QAI`);
        }
        catch (e) {
            if (String(e.message).includes("WALLET_NOT_FOUND")) {
                showToast(`${w.name} not installed`);
                if (w.url)
                    window.open(w.url, "_blank");
            }
            else {
                // User declined or wallet error
                showToast(`${w.name} connection cancelled`);
            }
        }
        setWalletConnecting(null);
    };
    const disconnectWallet = () => {
        setWallet(null);
        showToast("Wallet disconnected");
    };
    const scrollTo = id => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    // Ensure we have a password before encrypting; auto-generate if in auto mode
    const ensurePassword = () => {
        if (vaultPassword)
            return vaultPassword;
        if (pwMode === "auto") {
            const pw = generatePassword(28);
            setVaultPassword(pw);
            return pw;
        }
        return "";
    };
    const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : (b / 1024).toFixed(1) + " KB";
    // ── Real encryption (AES-256-GCM via Web Crypto) ──
    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDrag(false);
        const files = Array.from(e.dataTransfer?.files || e.target?.files || []);
        if (e.target)
            e.target.value = "";
        if (!files.length)
            return;
        const pw = ensurePassword();
        if (!pw) {
            showToast("Set or auto-generate a password first");
            return;
        }
        if (pwMode === "auto" && !keyBackedUp) {
            // auto password just created — remind to back up after
        }
        setVaultBusy(true);
        let done = 0;
        for (const f of files) {
            try {
                const { blob, encName, size } = await encryptFile(f, pw);
                setVaultFiles(v => [...v, { name: encName, level: encLevel, size: fmtSize(size), blob, kind: "encrypted" }]);
                done++;
            }
            catch {
                showToast(`Failed to encrypt ${f.name}`);
            }
        }
        setVaultBusy(false);
        if (done)
            showToast(`${done} file${done > 1 ? "s" : ""} encrypted with AES-256-GCM`);
    };
    // ── Real decryption ──
    const handleDecrypt = async (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer?.files || e.target?.files || []);
        if (e.target)
            e.target.value = "";
        if (!files.length)
            return;
        if (!vaultPassword) {
            showToast("Enter the password used to encrypt these files");
            return;
        }
        setVaultBusy(true);
        for (const f of files) {
            try {
                const { blob, name } = await decryptFile(f, vaultPassword);
                downloadBlob(blob, name);
                showToast(`Decrypted ${name}`);
            }
            catch (err) {
                if (String(err.message).includes("WRONG_PASSWORD"))
                    showToast(`Wrong password for ${f.name}`);
                else if (String(err.message).includes("NOT_QAI_FILE"))
                    showToast(`${f.name} isn't a .qai file`);
                else
                    showToast(`Failed to decrypt ${f.name}`);
            }
        }
        setVaultBusy(false);
    };
    // Download a single encrypted file from the vault list
    const downloadVaultFile = (f) => {
        if (f.blob) {
            downloadBlob(f.blob, f.name);
            showToast(`Downloaded ${f.name}`);
        }
    };
    // Auto-generate a fresh password
    const autoGenPassword = () => {
        const pw = generatePassword(28);
        setVaultPassword(pw);
        setPwMode("auto");
        setShowPw(true);
        setKeyBackedUp(false);
        showToast("Strong password generated — back it up!");
    };
    // Download the backup key file
    const downloadBackupKey = () => {
        if (!vaultPassword) {
            showToast("No password set yet");
            return;
        }
        const now = new Date();
        const content = `╔══════════════════════════════════════════════════════════╗
║          QuantumAI Vault — ENCRYPTION BACKUP KEY           ║
╚══════════════════════════════════════════════════════════╝

⚠  KEEP THIS FILE SAFE AND PRIVATE  ⚠

This password is the ONLY way to decrypt your files. QuantumAI does
NOT store it and CANNOT recover it for you. If you lose this file and
forget the password, your encrypted files are permanently unrecoverable.

──────────────────────────────────────────────────────────────
ENCRYPTION PASSWORD:

    ${vaultPassword}

──────────────────────────────────────────────────────────────
Algorithm     : AES-256-GCM
Key derivation: PBKDF2 (SHA-256, ${PBKDF2_ITERS.toLocaleString()} iterations)
File format   : .qai  (QuantumAI encrypted container)
Generated     : ${now.toISOString()}
Website       : https://quantumai.computer
──────────────────────────────────────────────────────────────

HOW TO DECRYPT:
1. Go to quantumai.computer → Encryption Vault
2. Enter this password in the password field
3. Drop your .qai file into the "Decrypt" zone
4. Your original file downloads automatically

Store this file in a password manager, encrypted drive, or printed
in a safe. Never share it with anyone.
`;
        downloadBlob(new Blob([content], { type: "text/plain" }), `QuantumAI-Vault-BackupKey-${now.getTime()}.txt`);
        setKeyBackedUp(true);
        showToast("Backup key downloaded");
    };
    const sendChat = async (override) => {
        const text = (typeof override === "string" ? override : chatInput).trim();
        if (!text || chatLoading)
            return;
        setChatInput("");
        const next = { role: "user", text };
        setChatMsgs(m => [...m, next]);
        setChatLoading(true);
        try {
            const hist = [...chatMsgs, next].map(m => ({ role: m.role === "bot" ? "assistant" : "user", content: m.text }));
            const reply = await callClaude(hist, persona, { sys: pcfg(persona).sys });
            setChatMsgs(m => [...m, { role: "bot", text: reply }]);
            if (voiceOn)
                speakAs(reply, persona);
        }
        catch {
            setChatMsgs(m => [...m, { role: "bot", text: "Connection error — please try again." }]);
        }
        setChatLoading(false);
    };
    // ── Mic: Web Speech API speech-to-text ──
    const toggleMic = () => {
        const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
        if (!SR) {
            showToast("Voice input isn't supported in this browser");
            return;
        }
        if (listening) {
            recognitionRef.current?.stop();
            setListening(false);
            return;
        }
        const rec = new SR();
        rec.lang = persona === "friday" ? "en-IE" : "en-GB";
        rec.interimResults = true;
        rec.continuous = false;
        let finalText = "";
        rec.onresult = (e) => {
            let interim = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal)
                    finalText += t;
                else
                    interim += t;
            }
            setChatInput(finalText || interim);
        };
        rec.onerror = () => { setListening(false); };
        rec.onend = () => {
            setListening(false);
            const said = finalText.trim();
            if (said)
                sendChat(said);
        };
        recognitionRef.current = rec;
        setListening(true);
        rec.start();
    };
    // Logo — primary: on-chain CExplorer token image; fallback: GitHub org avatar; final: SVG
    const Logo = ({ w = 40, h = 40, r = 9, style = {} }) => imgErr
        ? React.createElement(QAILogoSVG, { size: Math.max(w, h) })
        : React.createElement("img", { src: TOKEN_LOGO, alt: "QuantumAI $QAI", width: w, height: h, onError: () => setImgErr(true), style: { width: w, height: h, borderRadius: r, objectFit: "cover", flexShrink: 0, display: "block", ...style } });
    // Duplicated ticker items for seamless loop — live Minswap DEX data
    const fmtADA = v => v > 0 ? `₳${v.toFixed(6)}` : "—";
    const fmtUSD = v => v > 0 ? `$${v < 0.01 ? v.toFixed(6) : v.toFixed(4)}` : "—";
    const fmtVol = v => v > 1000 ? `₳${(v / 1000).toFixed(1)}K` : v > 0 ? `₳${v.toFixed(0)}` : "—";
    const tickers = [
        React.createElement("span", { key: "1", className: "ticker-item" },
            React.createElement("span", { className: "ticker-label" }, "$QAI/ADA"),
            React.createElement("span", { className: "ticker-val" }, fmtADA(priceADA)),
            pctChange !== 0 && React.createElement("span", { className: pctChange >= 0 ? "ticker-up" : "ticker-down" },
                pctChange >= 0 ? "▲" : "▼",
                Math.abs(pctChange).toFixed(2),
                "%")),
        React.createElement("span", { key: "1b", className: "ticker-item" },
            React.createElement("span", { className: "ticker-label" }, "$QAI/USD"),
            React.createElement("span", { className: "ticker-val" }, fmtUSD(priceUSD))),
        React.createElement("span", { key: "2", className: "ticker-item" },
            React.createElement("span", { className: "ticker-label" }, "ADA/USD"),
            React.createElement("span", { className: "ticker-val" },
                "$",
                adaUSD.toFixed(4))),
        React.createElement("span", { key: "3", className: "ticker-item" },
            React.createElement("span", { className: "ticker-label" }, "VOL 24H"),
            React.createElement("span", { className: "ticker-val" }, fmtVol(volume24h))),
        React.createElement("span", { key: "4", className: "ticker-item" },
            React.createElement("span", { className: "ticker-label" }, "LIQUIDITY"),
            React.createElement("span", { className: "ticker-val" }, fmtVol(liquidity))),
        React.createElement("span", { key: "5", className: "ticker-item" },
            React.createElement("span", { className: "ticker-label" }, "SOURCE"),
            React.createElement("span", { className: "ticker-up" },
                "\u25CF ",
                priceSource)),
        React.createElement("span", { key: "6", className: "ticker-item" },
            React.createElement("span", { className: "ticker-label" }, "SUPPLY"),
            React.createElement("span", { className: "ticker-val" }, "1,000,000,000 QAI")),
        React.createElement("span", { key: "7", className: "ticker-item" },
            React.createElement("span", { className: "ticker-label" }, "NETWORK"),
            React.createElement("span", { className: "ticker-up" }, "\u25CF CARDANO")),
        React.createElement("span", { key: "8", className: "ticker-item" },
            React.createElement("span", { className: "ticker-label" }, "POLICY"),
            React.createElement("span", { className: "ticker-val", style: { fontFamily: "monospace", fontSize: "0.68rem" } },
                POLICY_ID.slice(0, 12),
                "\u2026")),
    ];
    // ── Cloud Connect (web) handlers ──
    const cloudNormalize = (s) => {
        s = (s || "").trim().replace(/\/+$/, "");
        if (!/^https?:\/\//i.test(s))
            s = "https://" + s;
        return s;
    };
    const cloudConnect = async () => {
        setCloudErr("");
        const server = cloudNormalize(cloudServer);
        if (!server || !cloudUser || !cloudPass) {
            setCloudErr("Enter server address, username, and password.");
            return;
        }
        setCloudBusy(true);
        try {
            const r = await fetch(server + "/api/login", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: cloudUser.trim(), password: cloudPass }),
            });
            const d = await r.json();
            if (!d.ok) {
                setCloudErr(d.error || "Login failed. Check your credentials.");
                return;
            }
            setCloudToken(d.token);
            setCloudServer(server);
            setCloudFolder(d.folder ? d.folder.split(/[\\/]/).pop() : "My Cloud");
            cloudLoadFiles(server, d.token);
        }
        catch (e) {
            const mixed = (typeof window !== "undefined" && window.location.protocol === "https:" && server.startsWith("http:"));
            setCloudErr("Couldn't reach the server. Make sure your Vault is running and reachable." +
                (mixed ? " This site is HTTPS, so it can't connect to an HTTP server — expose your vault with a Cloudflare Tunnel or Tailscale (https) URL." : ""));
        }
        finally {
            setCloudBusy(false);
        }
    };
    const cloudLoadFiles = async (server = cloudNormalize(cloudServer), token = cloudToken) => {
        try {
            const r = await fetch(server + "/api/list", { headers: { Authorization: "Bearer " + token } });
            if (r.status === 401) {
                setCloudToken(null);
                setCloudErr("Session expired — please reconnect.");
                return;
            }
            const d = await r.json();
            setCloudFiles(d.ok && d.items ? d.items : []);
        }
        catch {
            setCloudErr("Couldn't load files.");
        }
    };
    const cloudLogout = () => { setCloudToken(null); setCloudFiles([]); setCloudPass(""); };
    const cloudDownload = async (raw, name) => {
        const server = cloudNormalize(cloudServer);
        try {
            const r = await fetch(server + "/api/download?file=" + encodeURIComponent(raw), { headers: { Authorization: "Bearer " + cloudToken } });
            const blob = await r.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        }
        catch {
            setCloudErr("Download failed.");
        }
    };
    const cloudDelete = async (raw, name) => {
        if (!window.confirm("Delete " + name + "?"))
            return;
        const server = cloudNormalize(cloudServer);
        try {
            await fetch(server + "/api/delete?file=" + encodeURIComponent(raw), { method: "DELETE", headers: { Authorization: "Bearer " + cloudToken } });
            cloudLoadFiles();
        }
        catch {
            setCloudErr("Delete failed.");
        }
    };
    const cloudUpload = async (fileList) => {
        const server = cloudNormalize(cloudServer);
        setCloudBusy(true);
        try {
            for (const f of fileList) {
                await fetch(server + "/api/upload", {
                    method: "POST",
                    headers: { Authorization: "Bearer " + cloudToken, "X-Filename": encodeURIComponent(f.name) },
                    body: f,
                });
            }
            cloudLoadFiles();
        }
        catch {
            setCloudErr("Upload failed.");
        }
        finally {
            setCloudBusy(false);
        }
    };
    const cloudFmt = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : (b / 1024).toFixed(1) + " KB";
    const cloudLabelStyle = { display: "block", fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(180,210,255,0.55)", marginBottom: "0.45rem" };
    const cloudInputStyle = { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "0.85rem 0.95rem", color: "#fff", fontSize: "1rem", outline: "none", marginBottom: "1.1rem", fontFamily: "inherit" };
    const cloudBtnStyle = { width: "100%", padding: "0.95rem", borderRadius: 12, fontSize: "0.95rem", fontWeight: 700, cursor: "pointer", border: "none", color: "#fff", background: "linear-gradient(135deg,#0072FF,#00C6FF)", boxShadow: "0 6px 18px rgba(0,114,255,0.3)", fontFamily: "inherit" };
    const cloudSmBtn = { padding: "0.5rem 0.7rem", borderRadius: 9, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", border: "0.5px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.08)", color: "#fff", marginLeft: "0.4rem", fontFamily: "inherit" };
    const cloudGhostBtn = { flex: 1, padding: "0.7rem", borderRadius: 11, fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", border: "0.5px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", fontFamily: "inherit" };
    return (React.createElement(React.Fragment, null,
        React.createElement("style", null, css),
        React.createElement("nav", { className: "nav" },
            React.createElement("div", { className: "nav-brand", onClick: () => { setPage("home"); setTimeout(() => scrollTo("home"), 50); } },
                React.createElement(Logo, { w: 34, h: 34, r: 9 }),
                React.createElement("span", { className: "nav-brand-text" }, "QuantumAI")),
            React.createElement("div", { className: "nav-links" },
                page === "home" && ["price", "token"].map(s => (React.createElement("button", { key: s, className: "nav-pill", onClick: () => scrollTo(s) }, s.charAt(0).toUpperCase() + s.slice(1)))),
                React.createElement("button", { className: "nav-pill", style: page === "markets" ? { color: "#fff", background: "rgba(255,255,255,0.08)" } : {}, onClick: () => setPage(p => p === "markets" ? "home" : "markets") }, page === "markets" ? "← Home" : "Markets"),
                React.createElement("button", { className: "nav-pill", style: page === "chat" ? { color: "#fff", background: "rgba(255,255,255,0.08)" } : {}, onClick: () => setPage(p => p === "chat" ? "home" : "chat") }, page === "chat" ? "← Home" : "AI Chat"),
                React.createElement("button", { className: "nav-pill", style: page === "downloads" ? { color: "#fff", background: "rgba(255,255,255,0.08)" } : {}, onClick: () => setPage(p => p === "downloads" ? "home" : "downloads") }, page === "downloads" ? "← Home" : "Downloads"),
                React.createElement("button", { className: "nav-pill", style: page === "cloud" ? { color: "#fff", background: "rgba(255,255,255,0.08)" } : {}, onClick: () => setPage(p => p === "cloud" ? "home" : "cloud") }, page === "cloud" ? "← Home" : "Cloud")),
            wallet
                ? React.createElement("button", { className: "btn-wallet connected", onClick: disconnectWallet, title: `${wallet.addr ? shortAddr(wallet.addr) : wallet.name} · Click to disconnect` },
                    React.createElement("span", { className: "wallet-dot" }),
                    " ",
                    wallet.icon,
                    " ",
                    wallet.qai.toLocaleString(),
                    " QAI")
                : React.createElement("button", { className: "btn-wallet", onClick: () => setWalletModal(true) }, "Connect Wallet")),
        React.createElement("section", { id: "home", className: "hero" },
            React.createElement("div", { className: "hero-glow-1" }),
            React.createElement("div", { className: "hero-glow-2" }),
            React.createElement(ParticleField, null),
            React.createElement("div", { className: "hero-logo-wrap" },
                React.createElement("div", { className: "hero-logo-ring" }),
                React.createElement("div", { className: "hero-logo-ring2" }),
                React.createElement(Logo, { w: 140, h: 140, r: 26, style: { boxShadow: "0 0 0 1px rgba(0,198,255,0.25), 0 20px 60px rgba(0,114,255,0.3), 0 0 80px rgba(0,198,255,0.15)" } })),
            React.createElement("div", { className: "hero-eyebrow" },
                React.createElement("span", { className: "hero-eyebrow-dot" }),
                "Cardano Blockchain \u00B7 $QAI Token"),
            React.createElement("h1", { className: "hero-title" },
                React.createElement("span", { className: "line1" }, "Quantum"),
                React.createElement("span", { className: "line2" }, "Encrypted Finance")),
            React.createElement("p", { className: "hero-sub" }, "Post-quantum cryptography meets DeFi on Cardano. Trade $QAI, protect your assets with lattice-based encryption, and leverage AI-powered market intelligence."),
            React.createElement("div", { className: "hero-actions" },
                React.createElement("button", { className: "btn-primary", onClick: () => setWalletModal(true) }, "Connect Wallet"),
                React.createElement("button", { className: "btn-secondary", onClick: () => scrollTo("price") }, "View Live Price"))),
        React.createElement("div", { className: "ticker" },
            React.createElement("div", { className: "ticker-track" }, [...tickers, ...tickers])),
        page === "markets" && (React.createElement(MarketsPage, { Logo: Logo, showToast: showToast })),
        page === "downloads" && (React.createElement(DownloadsPage, { priceADA: priceADA, Logo: Logo, showToast: showToast })),
        page === "cloud" && (React.createElement("div", { style: { minHeight: "100vh", padding: "calc(var(--nav-h,64px) + 2rem) 1.25rem 4rem", maxWidth: 760, margin: "0 auto" } },
            React.createElement("div", { style: { textAlign: "center", marginBottom: "2rem" } },
                React.createElement("div", { className: "dl-badge" },
                    React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "#00C6FF", boxShadow: "0 0 6px #00C6FF", display: "inline-block" } }),
                    "Encrypted Personal Cloud"),
                React.createElement("h1", { className: "dl-title", style: { fontSize: "clamp(1.8rem,4.5vw,3rem)" } }, "QuantumAI Cloud Connect"),
                React.createElement("p", { className: "dl-sub" },
                    "Securely access your QuantumAI Vault personal cloud from anywhere. Your files stay on ",
                    React.createElement("em", null, "your"),
                    " server \u2014 QuantumAI never stores or sees them.")),
            !cloudToken ? (React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: "1.75rem", maxWidth: 460, margin: "0 auto" } },
                React.createElement("label", { style: cloudLabelStyle }, "Server address"),
                React.createElement("input", { value: cloudServer, onChange: e => setCloudServer(e.target.value), placeholder: "https://your-vault.trycloudflare.com", autoCapitalize: "off", autoCorrect: "off", style: cloudInputStyle }),
                React.createElement("label", { style: cloudLabelStyle }, "Username"),
                React.createElement("input", { value: cloudUser, onChange: e => setCloudUser(e.target.value), autoCapitalize: "off", autoCorrect: "off", style: cloudInputStyle }),
                React.createElement("label", { style: cloudLabelStyle }, "Password"),
                React.createElement("input", { type: "password", value: cloudPass, onChange: e => setCloudPass(e.target.value), onKeyDown: e => e.key === "Enter" && cloudConnect(), style: cloudInputStyle }),
                cloudErr && React.createElement("div", { style: { color: "#FF6B6B", fontSize: "0.84rem", margin: "0 0 0.9rem", lineHeight: 1.4 } }, cloudErr),
                React.createElement("button", { onClick: cloudConnect, disabled: cloudBusy, style: cloudBtnStyle }, cloudBusy ? "Connecting…" : "Connect"),
                React.createElement("p", { style: { fontSize: "0.74rem", color: "rgba(180,210,255,0.5)", lineHeight: 1.6, marginTop: "0.9rem" } },
                    "Open the QuantumAI Vault desktop app and start your cloud. To reach it from this website, expose it with a free ",
                    React.createElement("strong", null, "Cloudflare Tunnel"),
                    " or ",
                    React.createElement("strong", null, "Tailscale"),
                    " and paste that ",
                    React.createElement("strong", null, "https://"),
                    " address above. (A local ",
                    React.createElement("code", null, "http://192.168.x.x"),
                    " address only works from the same network, not from this site.)"))) : (React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: "1.5rem", maxWidth: 560, margin: "0 auto" } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.1rem", gap: "0.5rem" } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" } },
                        React.createElement("span", { style: { width: 8, height: 8, borderRadius: "50%", background: "#30d158", boxShadow: "0 0 8px #30d158" } }),
                        React.createElement("strong", { style: { fontSize: "1.05rem" } }, cloudFolder)),
                    React.createElement("button", { onClick: cloudLogout, style: cloudSmBtn }, "Disconnect")),
                React.createElement("div", { style: { display: "flex", gap: "0.6rem", marginBottom: "1rem" } },
                    React.createElement("label", { style: { ...cloudGhostBtn, textAlign: "center" } },
                        "\u2B06 Upload",
                        React.createElement("input", { type: "file", multiple: true, style: { display: "none" }, onChange: e => { if (e.target.files.length)
                                cloudUpload(Array.from(e.target.files)); e.target.value = ""; } })),
                    React.createElement("button", { onClick: () => cloudLoadFiles(), style: cloudGhostBtn }, "\u21BB Refresh")),
                cloudErr && React.createElement("div", { style: { color: "#FF6B6B", fontSize: "0.82rem", marginBottom: "0.8rem" } }, cloudErr),
                cloudBusy && React.createElement("div", { style: { color: "rgba(180,210,255,0.6)", fontSize: "0.82rem", marginBottom: "0.8rem" } }, "Working\u2026"),
                cloudFiles.length === 0 ? (React.createElement("div", { style: { textAlign: "center", color: "rgba(180,210,255,0.5)", padding: "2.5rem 1rem", fontSize: "0.88rem", lineHeight: 1.6 } },
                    "This folder is empty.",
                    React.createElement("br", null),
                    "Upload your first file above.")) : ([...cloudFiles].sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)).map((it, i) => (React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.8rem 0.25rem", borderBottom: "0.5px solid rgba(255,255,255,0.05)" } },
                    React.createElement("span", { style: { fontSize: "1.3rem", width: 30, textAlign: "center" } }, it.dir ? "📁" : (it.encrypted ? "🔒" : "📄")),
                    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                        React.createElement("div", { style: { fontSize: "0.92rem", wordBreak: "break-word" } }, it.name),
                        React.createElement("div", { style: { fontSize: "0.7rem", color: "rgba(180,210,255,0.5)" } },
                            it.dir ? "Folder" : cloudFmt(it.size),
                            it.encrypted ? " · AES-256" : "")),
                    !it.dir && React.createElement(React.Fragment, null,
                        React.createElement("button", { onClick: () => cloudDownload(it.raw, it.name), style: cloudSmBtn }, "\u2B07"),
                        React.createElement("button", { onClick: () => cloudDelete(it.raw, it.name), style: { ...cloudSmBtn, background: "rgba(255,80,80,0.12)" } }, "\uD83D\uDDD1")))))))))),
        page === "chat" && (React.createElement("div", { className: `hud${persona === "friday" ? " friday" : ""}` },
            React.createElement("div", { className: "hud-stars" }),
            React.createElement("div", { className: "hud-frame" }),
            React.createElement("div", { className: "hud-corner" }),
            React.createElement("div", { className: "hud-inner" },
                React.createElement("div", { style: { textAlign: "center" } },
                    React.createElement("div", { className: `core ${coreState}` },
                        React.createElement("div", { className: "core-halo" }),
                        React.createElement("div", { className: "core-ring r1" }),
                        React.createElement("div", { className: "core-ring r2" }),
                        React.createElement("div", { className: "core-ring r3" }),
                        React.createElement("div", { className: "core-ring r4" }),
                        React.createElement("div", { className: "core-orb" })),
                    React.createElement("div", { className: "hud-eyebrow" }, "QuantumAI \u00B7 Onboard Intelligence"),
                    React.createElement("div", { className: "hud-title" }, pcfg().displayName),
                    React.createElement("div", { style: { fontFamily: "'SF Mono',monospace", fontSize: "0.66rem", letterSpacing: "0.14em", color: "var(--hud-dim)" } }, PERSONAS[persona].tagline),
                    React.createElement("div", { className: "core-status" },
                        (coreState === "speaking" || coreState === "listening") && (React.createElement("span", { className: "wave", style: { marginRight: "0.6rem" } },
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null))),
                        coreStatusText,
                        (coreState === "thinking" || coreState === "listening") && React.createElement("span", { className: "blink" }, "_")),
                    React.createElement("button", { onClick: () => setShowSettings(true), style: { marginTop: "0.8rem", fontSize: "0.7rem", fontWeight: 700, padding: "0.4rem 1rem", borderRadius: 20, cursor: "pointer", background: "transparent", border: "1px solid var(--hud-dim)", color: "var(--hud)", letterSpacing: "0.08em" } }, "\u2699 PERSONALIZE")),
                React.createElement("div", { className: "hud-personas" }, [
                    { id: "jarvis", desc: "British · Male" },
                    { id: "friday", desc: "Irish · Female" },
                ].map(p => {
                    const c = pcfg(p.id);
                    const on = persona === p.id;
                    return (React.createElement("div", { key: p.id, className: `hud-persona${on ? " on" : ""}`, onClick: () => switchPersona(p.id) },
                        React.createElement("div", { className: "pid" }, c.displayName),
                        React.createElement("div", { className: "pdesc" }, p.desc),
                        React.createElement("div", { className: "ptag" }, PERSONAS[p.id].tagline),
                        on && React.createElement("div", { className: "pstat" }, "\u25CF ACTIVE")));
                })),
                React.createElement("div", { className: "hud-console" },
                    React.createElement("div", { className: "hud-statusbar" },
                        React.createElement("span", { className: "hud-led" }),
                        React.createElement("span", { className: "nm" }, pcfg().displayName),
                        React.createElement("span", { className: "st" }, coreState === "idle" ? "Online · Web search active" : coreStatusText.replace(/^[●◉⟳◆]\s*/, "")),
                        (chatLoading || listening || speaking) && (React.createElement("div", { className: "hud-eq" },
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null),
                            React.createElement("i", null))),
                        React.createElement("button", { className: `hud-iconbtn${voiceOn ? " on" : ""}`, style: { marginLeft: (chatLoading || listening || speaking) ? "0.6rem" : "auto" }, title: voiceOn ? "Voice replies on" : "Voice replies off", onClick: () => { const v = !voiceOn; setVoiceOn(v); if (v)
                                speakAs("Voice enabled.", persona);
                            else {
                                window.speechSynthesis?.cancel();
                                setSpeaking(false);
                            } } }, voiceOn ? "🔊" : "🔇")),
                    React.createElement("div", { className: "hud-msgs" },
                        chatMsgs.map((m, i) => (React.createElement("div", { key: i, className: `hud-msg ${m.role === "bot" ? "bot" : "user"}` },
                            React.createElement("div", { className: "hud-av" }, m.role === "bot" ? pcfg().displayName[0] : "U"),
                            React.createElement("div", { className: "hud-bubble" },
                                m.text,
                                m.role === "bot" && (React.createElement("button", { className: "hud-play", onClick: () => speakAs(m.text, persona), title: "Play" }, "\u25B6")))))),
                        chatLoading && (React.createElement("div", { className: "hud-msg bot" },
                            React.createElement("div", { className: "hud-av" }, pcfg().displayName[0]),
                            React.createElement("div", { className: "hud-bubble" },
                                React.createElement("div", { className: "hud-typing" },
                                    React.createElement("i", null),
                                    React.createElement("i", null),
                                    React.createElement("i", null))))),
                        React.createElement("div", { ref: chatEndRef })),
                    React.createElement("div", { className: "hud-inputrow" },
                        React.createElement("button", { className: `hud-mic${listening ? " live" : ""}`, onClick: toggleMic, title: listening ? "Stop listening" : "Speak" }, "\uD83C\uDFA4"),
                        React.createElement("input", { className: "hud-input", value: chatInput, onChange: e => setChatInput(e.target.value), onKeyDown: e => e.key === "Enter" && sendChat(), placeholder: listening ? "Listening…" : `Speak or type to ${pcfg().displayName}…`, autoFocus: true }),
                        React.createElement("button", { className: "hud-send", onClick: () => sendChat(), disabled: chatLoading || !chatInput.trim() }, "\u2191"))),
                React.createElement("div", { className: "hud-sources" },
                    React.createElement("span", { style: { fontSize: "0.6rem", letterSpacing: "0.12em", color: "var(--hud-dim)", alignSelf: "center" } }, "LIVE WEB SEARCH:"),
                    ["World News", "Crypto", "Stocks", "Wikipedia", "Britannica", "Science"].map(s => (React.createElement("span", { key: s, className: "hud-source" }, s)))),
                React.createElement("div", { className: "hud-foot" },
                    "\uD83C\uDFA4 TAP MIC TO SPEAK \u00B7 \uD83D\uDD0A TOGGLE VOICE \u00B7 \u25B6 REPLAY \u00B7 \u2699 PERSONALIZE YOUR ASSISTANT",
                    React.createElement("br", null),
                    "Voice uses your browser's speech engine \u2014 best in Chrome, Edge & Safari. Your settings are saved on this device.")),
            showSettings && (React.createElement("div", { className: "overlay", onClick: () => setShowSettings(false) },
                React.createElement("div", { className: "modal", onClick: e => e.stopPropagation(), style: { maxWidth: 520, textAlign: "left" } },
                    React.createElement("div", { className: "modal-title", style: { marginBottom: "0.3rem" } },
                        "Personalize ",
                        PERSONAS[persona].name),
                    React.createElement("p", { className: "modal-sub", style: { marginBottom: "1.25rem" } }, "Customize this assistant's name, personality, and voice. Saved on this device."),
                    (() => {
                        const c = custom[persona] || {};
                        const set = (patch) => saveCustom({ ...custom, [persona]: { ...c, ...patch } });
                        const enVoices = availVoices.filter(v => /^en/i.test(v.lang));
                        const voiceList = enVoices.length ? enVoices : availVoices;
                        return (React.createElement("div", null,
                            React.createElement("label", { style: { fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.5)", textTransform: "uppercase" } }, "Assistant name"),
                            React.createElement("input", { value: c.name || "", onChange: e => set({ name: e.target.value }), placeholder: PERSONAS[persona].name, style: { width: "100%", boxSizing: "border-box", margin: "0.4rem 0 1rem", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "0.65rem 0.85rem", color: "#fff", fontSize: "0.9rem", fontFamily: "inherit", outline: "none" } }),
                            React.createElement("label", { style: { fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.5)", textTransform: "uppercase" } }, "Personality & instructions"),
                            React.createElement("textarea", { value: c.personality || "", onChange: e => set({ personality: e.target.value }), rows: 3, placeholder: "e.g. Be concise and witty. Focus on crypto trading. Always greet me as 'Captain'.", style: { width: "100%", boxSizing: "border-box", margin: "0.4rem 0 1rem", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "0.65rem 0.85rem", color: "#fff", fontSize: "0.85rem", fontFamily: "inherit", outline: "none", resize: "vertical" } }),
                            React.createElement("label", { style: { fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.5)", textTransform: "uppercase" } }, "Voice"),
                            React.createElement("select", { value: c.voiceURI || "", onChange: e => set({ voiceURI: e.target.value || null }), style: { width: "100%", boxSizing: "border-box", margin: "0.4rem 0 1rem", background: "rgba(20,28,40,1)", border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "0.65rem 0.85rem", color: "#fff", fontSize: "0.85rem", fontFamily: "inherit", outline: "none" } },
                                React.createElement("option", { value: "" },
                                    "Auto (",
                                    persona === "jarvis" ? "British male" : "Irish female",
                                    ")"),
                                voiceList.map(v => React.createElement("option", { key: v.voiceURI, value: v.voiceURI },
                                    v.name,
                                    " \u2014 ",
                                    v.lang))),
                            React.createElement("label", { style: { fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.5)", textTransform: "uppercase" } },
                                "Pitch \u2014 ",
                                (c.pitch != null ? c.pitch : (PERSONAS[persona].gender === "male" ? 0.75 : 1.15)).toFixed(2)),
                            React.createElement("input", { type: "range", min: "0.4", max: "1.8", step: "0.05", value: c.pitch != null ? c.pitch : (PERSONAS[persona].gender === "male" ? 0.75 : 1.15), onChange: e => set({ pitch: parseFloat(e.target.value) }), style: { width: "100%", margin: "0.4rem 0 1rem" } }),
                            React.createElement("label", { style: { fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.5)", textTransform: "uppercase" } },
                                "Speed \u2014 ",
                                (c.rate != null ? c.rate : (persona === "friday" ? 1.06 : 0.97)).toFixed(2)),
                            React.createElement("input", { type: "range", min: "0.6", max: "1.6", step: "0.05", value: c.rate != null ? c.rate : (persona === "friday" ? 1.06 : 0.97), onChange: e => set({ rate: parseFloat(e.target.value) }), style: { width: "100%", margin: "0.4rem 0 1.25rem" } }),
                            React.createElement("div", { style: { display: "flex", gap: "0.6rem", flexWrap: "wrap" } },
                                React.createElement("button", { onClick: () => speakAs(`Hello, I'm ${pcfg().displayName}. This is how I sound.`, persona), style: { flex: 1, padding: "0.65rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", background: "rgba(0,198,255,0.12)", border: "0.5px solid rgba(0,198,255,0.3)", color: "var(--blue)" } }, "\uD83D\uDD0A Test voice"),
                                React.createElement("button", { onClick: () => saveCustom({ ...custom, [persona]: {} }), style: { padding: "0.65rem 1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", color: "rgba(180,210,255,0.7)" } }, "Reset"))));
                    })(),
                    React.createElement("button", { className: "modal-cancel", onClick: () => setShowSettings(false) }, "Done")))))),
        page === "home" && (React.createElement(React.Fragment, null,
            React.createElement("section", { id: "price" },
                React.createElement("div", { className: "section-inner" },
                    React.createElement("span", { className: "section-eyebrow" }, "Live DEX Market Data"),
                    React.createElement("div", { className: "section-title" }, "$QAI Price Tracker"),
                    React.createElement("div", { className: "glass-card", style: { padding: "1.75rem" } },
                        React.createElement("div", { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.25rem" } },
                            React.createElement("div", null,
                                React.createElement("div", { className: "price-row", style: { marginBottom: "0.25rem" } }, priceLoading && priceADA === 0
                                    ? React.createElement("div", { style: { fontSize: "2rem", color: "rgba(180,210,255,0.3)" } }, "Fetching live price\u2026")
                                    : React.createElement(React.Fragment, null,
                                        React.createElement("div", { className: "price-num" },
                                            "\u20B3",
                                            priceADA > 0 ? priceADA.toFixed(6) : "—"),
                                        pctChange !== 0 && React.createElement("div", { className: `price-badge ${pctChange >= 0 ? "up" : "down"}` },
                                            pctChange >= 0 ? "▲" : "▼",
                                            " ",
                                            Math.abs(pctChange).toFixed(2),
                                            "% (24h)"))),
                                React.createElement("div", { style: { fontSize: "0.85rem", color: "rgba(180,210,255,0.5)" } },
                                    priceUSD > 0 && React.createElement("span", { style: { marginRight: "1rem" } },
                                        "\u2248 $",
                                        priceUSD < 0.001 ? priceUSD.toFixed(8) : priceUSD.toFixed(6),
                                        " USD"),
                                    adaUSD > 0 && React.createElement("span", null,
                                        "ADA = $",
                                        adaUSD.toFixed(4)))),
                            React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.35rem" } },
                                React.createElement("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap" } },
                                    React.createElement("a", { href: `https://app.sundae.fi/liquidity?token=${POLICY_ID}${ASSET_HEX}`, target: "_blank", rel: "noreferrer", style: { fontSize: "0.72rem", fontWeight: 700, padding: "0.3rem 0.7rem", borderRadius: 20,
                                            background: priceSource === "SundaeSwap" ? "rgba(255,213,79,0.18)" : "rgba(255,213,79,0.08)",
                                            border: priceSource === "SundaeSwap" ? "0.5px solid rgba(255,213,79,0.5)" : "0.5px solid rgba(255,213,79,0.25)",
                                            color: "var(--gold)", textDecoration: "none", letterSpacing: "0.05em" } },
                                        priceSource === "SundaeSwap" ? "● " : "",
                                        "SundaeSwap \u2197"),
                                    React.createElement("a", { href: `https://minswap.org/tokens/${POLICY_ID}${ASSET_HEX}`, target: "_blank", rel: "noreferrer", style: { fontSize: "0.72rem", fontWeight: 700, padding: "0.3rem 0.7rem", borderRadius: 20, background: "rgba(0,198,255,0.1)", border: "0.5px solid rgba(0,198,255,0.25)", color: "var(--blue)", textDecoration: "none", letterSpacing: "0.05em" } }, "Minswap \u2197"),
                                    React.createElement("a", { href: `https://cardanoscan.io/token/${POLICY_ID}${ASSET_HEX}`, target: "_blank", rel: "noreferrer", style: { fontSize: "0.72rem", fontWeight: 700, padding: "0.3rem 0.7rem", borderRadius: 20, background: "rgba(123,47,255,0.1)", border: "0.5px solid rgba(123,47,255,0.25)", color: "#a78bff", textDecoration: "none", letterSpacing: "0.05em" } }, "CardanoScan \u2197")),
                                React.createElement("div", { style: { fontSize: "0.68rem", color: "rgba(180,210,255,0.3)" } },
                                    priceSource !== "—" && (React.createElement("span", { style: { color: priceSource === "SundaeSwap" ? "rgba(255,213,79,0.7)" : "rgba(0,198,255,0.6)" } },
                                        "\u25CF ",
                                        priceSource)),
                                    priceSource !== "—" && " · ",
                                    lastUpdated ? `${lastUpdated.toLocaleTimeString()}` : "Fetching…",
                                    React.createElement("button", { onClick: refreshPrices, style: { marginLeft: "0.5rem", background: "none", border: "none", color: "rgba(0,198,255,0.4)", cursor: "pointer", fontSize: "0.7rem" } }, "\u21BA Refresh")))),
                        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: "rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden", marginBottom: "1.25rem" } }, [
                            { label: "POOL", val: `ADA-QAI ${poolVersion}`, color: "var(--gold)" },
                            { label: "TVL", val: liquidity > 0 ? `₳${liquidity.toFixed(2)}` : "₳69.73" },
                            { label: "24H VOLUME", val: volume24h > 0 ? `₳${volume24h > 1000 ? (volume24h / 1000).toFixed(2) + "K" : volume24h.toFixed(2)}` : "—" },
                            { label: "TOTAL SUPPLY", val: "1,000,000,000" },
                        ].map((s, i) => (React.createElement("div", { key: i, style: { background: "rgba(255,255,255,0.025)", padding: "0.85rem 1rem" } },
                            React.createElement("div", { style: { fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(180,210,255,0.4)", textTransform: "uppercase", marginBottom: "0.3rem" } }, s.label),
                            React.createElement("div", { style: { fontSize: "0.9rem", fontWeight: 700, color: s.color || "var(--white)", letterSpacing: "-0.02em" } }, s.val))))),
                        React.createElement("div", { className: "chart-wrap" },
                            React.createElement(PriceChart, { data: priceHistory.length > 0 ? priceHistory : [priceADA || 0.000038] })),
                        React.createElement("div", { className: "pred-row" },
                            React.createElement("div", { className: "pred-cell" },
                                React.createElement("div", { className: "pred-label" }, "AI Buy-In Target"),
                                React.createElement("div", { className: "pred-val buy" },
                                    "\u20B3",
                                    buyTarget)),
                            React.createElement("div", { className: "pred-cell" },
                                React.createElement("div", { className: "pred-label" }, "AI Sell-Out Target"),
                                React.createElement("div", { className: "pred-val sell" },
                                    "\u20B3",
                                    sellTarget)),
                            React.createElement("div", { className: "pred-cell" },
                                React.createElement("div", { className: "pred-label" }, "AI Confidence"),
                                React.createElement("div", { className: "pred-val conf" }, "71%"))),
                        React.createElement("div", { className: "disclaimer" },
                            React.createElement("strong", null, "\u26A0 Liability Disclaimer:"),
                            " Prices are sourced live from ",
                            React.createElement("strong", null, "SundaeSwap"),
                            " liquidity pools at ",
                            React.createElement("strong", null, "app.sundae.fi/liquidity"),
                            " (via GeckoTerminal pool indexer), with Minswap as fallback. AI predictions are for ",
                            React.createElement("strong", null, "informational purposes only"),
                            " and do not constitute financial advice. Crypto markets are highly volatile. QuantumAI accepts ",
                            React.createElement("strong", null, "no liability"),
                            " for losses. Always DYOR.")))),
            React.createElement("section", { id: "token", style: { background: "rgba(0,4,10,0.5)" } },
                React.createElement("div", { className: "section-inner" },
                    React.createElement("span", { className: "section-eyebrow" }, "On-Chain Identity"),
                    React.createElement("div", { className: "section-title" }, "$QAI Token"),
                    React.createElement("p", { className: "section-sub" }, "Verified Cardano native asset. All parameters are immutably recorded on-chain and publicly auditable on CardanoScan."),
                    wallet && (React.createElement("div", { className: "glass-card", style: { padding: "1.25rem 1.5rem", marginBottom: "1.5rem", border: "0.5px solid rgba(0,198,255,0.3)" } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" } },
                            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.8rem" } },
                                React.createElement("span", { style: { fontSize: "1.6rem" } }, wallet.icon),
                                React.createElement("div", null,
                                    React.createElement("div", { style: { fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.5)", textTransform: "uppercase" } },
                                        wallet.name,
                                        " Connected ",
                                        wallet.networkId === 1 ? "· Mainnet" : "· Testnet"),
                                    React.createElement("div", { style: { fontSize: "0.78rem", color: "var(--muted)", fontFamily: "monospace" } }, shortAddr(wallet.addr)))),
                            React.createElement("div", { style: { display: "flex", gap: "1.5rem" } },
                                React.createElement("div", { style: { textAlign: "right" } },
                                    React.createElement("div", { style: { fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.4)", textTransform: "uppercase" } }, "$QAI Balance"),
                                    React.createElement("div", { style: { fontSize: "1.15rem", fontWeight: 800, color: "var(--gold)" } },
                                        wallet.qai.toLocaleString(),
                                        " ",
                                        React.createElement("span", { style: { fontSize: "0.7rem", color: "var(--muted)" } }, "QAI"))),
                                React.createElement("div", { style: { textAlign: "right" } },
                                    React.createElement("div", { style: { fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.4)", textTransform: "uppercase" } }, "ADA Balance"),
                                    React.createElement("div", { style: { fontSize: "1.15rem", fontWeight: 800, color: "var(--blue)" } },
                                        wallet.ada.toLocaleString(undefined, { maximumFractionDigits: 2 }),
                                        " ",
                                        React.createElement("span", { style: { fontSize: "0.7rem", color: "var(--muted)" } }, "\u20B3"))))),
                        wallet.qai > 0 && priceADA > 0 && (React.createElement("div", { style: { marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "0.5px solid rgba(255,255,255,0.06)", fontSize: "0.8rem", color: "rgba(180,210,255,0.6)" } },
                            "Your $QAI is worth \u2248 ",
                            React.createElement("strong", { style: { color: "#fff" } },
                                "\u20B3",
                                (wallet.qai * priceADA).toLocaleString(undefined, { maximumFractionDigits: 2 })),
                            adaUSD > 0 && React.createElement("span", null,
                                " (\u2248 $",
                                (wallet.qai * priceADA * adaUSD).toLocaleString(undefined, { maximumFractionDigits: 2 }),
                                ")"))))),
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.75rem" } },
                        React.createElement("img", { src: TOKEN_LOGO, alt: "$QAI", style: { width: 64, height: 64, borderRadius: 14, objectFit: "cover", border: "0.5px solid rgba(0,198,255,0.3)", boxShadow: "0 0 24px rgba(0,114,255,0.2)" }, onError: e => e.target.src = GITHUB_LOGO }),
                        React.createElement("div", null,
                            React.createElement("div", { style: { fontSize: "1.3rem", fontWeight: 800, letterSpacing: "-0.03em" } },
                                "QuantumAI ",
                                React.createElement("span", { style: { color: "var(--blue)" } }, "$QAI")),
                            React.createElement("div", { style: { fontSize: "0.8rem", color: "var(--muted)" } }, "Quantum AI Computing \u00B7 quantumai.computer"))),
                    React.createElement("div", { className: "token-grid" },
                        React.createElement("div", { className: "token-cell" },
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Policy ID"),
                                React.createElement("div", { className: "info-val" }, POLICY_ID)),
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Asset Name"),
                                React.createElement("div", { className: "info-val" },
                                    ASSET_NAME,
                                    " (Hex: ",
                                    ASSET_HEX,
                                    ")")),
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Fingerprint"),
                                React.createElement("div", { className: "info-val" }, FINGERPRINT)),
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Total Supply"),
                                React.createElement("div", { className: "info-val", style: { color: "#30d158" } },
                                    TOTAL_SUPPLY,
                                    " QAI"))),
                        React.createElement("div", { className: "token-cell" },
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Blockchain"),
                                React.createElement("div", { className: "info-val" }, "Cardano (Layer 1)")),
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Token Standard"),
                                React.createElement("div", { className: "info-val" }, "Cardano Native Asset")),
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Decimals"),
                                React.createElement("div", { className: "info-val" },
                                    DECIMALS,
                                    " (whole units only)")),
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Created"),
                                React.createElement("div", { className: "info-val" }, CREATED_ON)),
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Transactions"),
                                React.createElement("div", { className: "info-val" }, TX_COUNT)),
                            React.createElement("div", { className: "info-row" },
                                React.createElement("div", { className: "info-label" }, "Consensus"),
                                React.createElement("div", { className: "info-val" }, "Ouroboros Praos (PoS)")),
                            React.createElement("div", { className: "info-row", style: { cursor: "pointer" }, onClick: () => window.open(`https://cardanoscan.io/token/${POLICY_ID}${ASSET_HEX}`) },
                                React.createElement("div", { className: "info-label" }, "CardanoScan"),
                                React.createElement("div", { className: "info-val link" }, "View on CardanoScan \u2197")),
                            React.createElement("div", { className: "info-row", style: { cursor: "pointer" }, onClick: () => window.open(`https://cexplorer.io/asset/${FINGERPRINT}`) },
                                React.createElement("div", { className: "info-label" }, "CExplorer"),
                                React.createElement("div", { className: "info-val link" }, "View on CExplorer \u2197")))))),
            React.createElement("section", { id: "vault" },
                React.createElement("div", { className: "section-inner" },
                    React.createElement("span", { className: "section-eyebrow" }, "Browser-Based Encryption"),
                    React.createElement("div", { className: "section-title" }, "Encryption Vault"),
                    React.createElement("p", { className: "section-sub" }, "Encrypt and decrypt files right in your browser with real AES-256-GCM encryption. Files never leave your device \u2014 all processing happens locally."),
                    React.createElement("div", { className: "vault-shell" },
                        React.createElement("div", { className: "vault-topbar" },
                            React.createElement("div", { className: "vault-topbar-dots" },
                                React.createElement("div", { className: "vault-dot", style: { background: "#FF5F57" } }),
                                React.createElement("div", { className: "vault-dot", style: { background: "#FEBC2E" } }),
                                React.createElement("div", { className: "vault-dot", style: { background: "#28C840" } })),
                            React.createElement(Logo, { w: 22, h: 22, r: 6, style: { marginLeft: "0.5rem" } }),
                            React.createElement("span", { style: { fontSize: "0.75rem", fontWeight: 600, color: "var(--muted)", letterSpacing: "-0.01em" } }, "QuantumAI Secure Vault")),
                        React.createElement("div", { className: "vault-body" },
                            React.createElement("div", { className: "enc-label" }, "1 \u00B7 Encryption Password"),
                            React.createElement("div", { style: { display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" } },
                                React.createElement("button", { className: `enc-btn ${pwMode === "choose" ? "active" : ""}`, style: { flex: "1 1 auto" }, onClick: () => { setPwMode("choose"); } }, "Choose my password"),
                                React.createElement("button", { className: `enc-btn ${pwMode === "auto" ? "active q" : ""}`, style: { flex: "1 1 auto" }, onClick: autoGenPassword }, "\u26A1 Auto-generate strong key")),
                            React.createElement("div", { style: { position: "relative", marginBottom: "0.5rem" } },
                                React.createElement("input", { type: showPw ? "text" : "password", value: vaultPassword, onChange: e => { setVaultPassword(e.target.value); setKeyBackedUp(false); }, placeholder: "Enter a strong password, or auto-generate one", style: { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(0,198,255,0.25)", borderRadius: 10, padding: "0.75rem 5.5rem 0.75rem 0.95rem", color: "#fff", fontSize: "0.9rem", fontFamily: vaultPassword && pwMode === "auto" ? "'SF Mono',monospace" : "inherit", outline: "none", letterSpacing: "0.01em" } }),
                                React.createElement("div", { style: { position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)", display: "flex", gap: "0.25rem" } },
                                    React.createElement("button", { onClick: () => setShowPw(s => !s), title: showPw ? "Hide" : "Show", style: { background: "none", border: "none", color: "rgba(180,210,255,0.6)", cursor: "pointer", fontSize: "0.95rem", padding: "0.25rem" } }, showPw ? "🙈" : "👁️"),
                                    vaultPassword && (React.createElement("button", { onClick: () => { navigator.clipboard?.writeText(vaultPassword); showToast("Password copied"); }, title: "Copy", style: { background: "none", border: "none", color: "rgba(180,210,255,0.6)", cursor: "pointer", fontSize: "0.85rem", padding: "0.25rem" } }, "\uD83D\uDCCB")))),
                            vaultPassword && (React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1.25rem", padding: "0.7rem 0.9rem", borderRadius: 10, background: keyBackedUp ? "rgba(48,209,88,0.08)" : "rgba(255,159,10,0.08)", border: `0.5px solid ${keyBackedUp ? "rgba(48,209,88,0.3)" : "rgba(255,159,10,0.3)"}` } },
                                React.createElement("span", { style: { fontSize: "1.1rem" } }, keyBackedUp ? "✅" : "🔑"),
                                React.createElement("div", { style: { flex: "1 1 200px", fontSize: "0.76rem", color: "rgba(180,210,255,0.75)", lineHeight: 1.45 } }, keyBackedUp
                                    ? "Backup key saved. Keep that file safe — it's the only way to recover your password."
                                    : "Download a backup key file. This password is the ONLY way to decrypt your files — we can't recover it."),
                                React.createElement("button", { onClick: downloadBackupKey, style: { flexShrink: 0, padding: "0.5rem 1rem", borderRadius: 9, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", background: "linear-gradient(135deg,var(--blue2),var(--blue))", border: "none", color: "#fff", boxShadow: "0 4px 14px rgba(0,114,255,0.3)" } }, "\u2B07 Download Backup Key"))),
                            React.createElement("div", { className: "enc-label" }, "2 \u00B7 Encryption Standard"),
                            React.createElement("div", { className: "enc-seg" }, [{ id: "aes", label: "AES-256-GCM" }, { id: "quantum", label: "Post-Quantum" }, { id: "sha", label: "SHA-256 Auth" }].map(e => (React.createElement("button", { key: e.id, className: `enc-btn ${encLevel === e.id ? "active" : ""} ${encLevel === e.id && e.id === "quantum" ? "q" : ""}`, onClick: () => setEncLevel(e.id) }, e.label)))),
                            React.createElement("div", { style: { fontSize: "0.68rem", color: "rgba(180,210,255,0.4)", marginBottom: "1.25rem", lineHeight: 1.5 } },
                                encLevel === "aes" && "AES-256-GCM with PBKDF2 (210k iterations). Military-grade authenticated encryption — fully functional in your browser.",
                                encLevel === "quantum" && "Post-Quantum mode wraps AES-256-GCM today; the downloadable Vault app adds CRYSTALS-Kyber lattice key exchange for quantum resistance.",
                                encLevel === "sha" && "Adds SHA-256 HMAC authentication over AES-256-GCM. Verifies integrity and detects tampering."),
                            React.createElement("div", { className: "enc-label" }, "3 \u00B7 Encrypt Files"),
                            React.createElement("div", { className: `drop-zone ${isDrag ? "drag" : ""}`, onDragOver: e => { e.preventDefault(); setIsDrag(true); }, onDragLeave: () => setIsDrag(false), onDrop: handleDrop, onClick: () => !vaultBusy && fileRef.current?.click(), style: { opacity: vaultBusy ? 0.6 : 1 } },
                                React.createElement("div", { className: "drop-icon" }, "\uD83D\uDD10"),
                                React.createElement("div", { className: "drop-text" }, vaultBusy ? "Encrypting…" : React.createElement(React.Fragment, null,
                                    "Drop files here or ",
                                    React.createElement("span", null, "browse"))),
                                React.createElement("div", { className: "drop-enc" },
                                    "Output: encrypted .qai file \u00B7 ",
                                    encLevel === "quantum" ? "Post-Quantum (AES-256 + Kyber in app)" : encLevel === "sha" ? "AES-256-GCM + SHA-256 HMAC" : "AES-256-GCM"),
                                React.createElement("input", { ref: fileRef, type: "file", multiple: true, hidden: true, onChange: handleDrop })),
                            vaultFiles.length > 0 && (React.createElement("div", { className: "vault-list" }, vaultFiles.map((f, i) => (React.createElement("div", { key: i, className: "vault-row" },
                                React.createElement("div", { className: "vault-row-left" },
                                    React.createElement("span", { style: { fontSize: "0.85rem" } }, "\uD83D\uDD12"),
                                    React.createElement("span", { className: "vault-fname" }, f.name),
                                    React.createElement("span", { className: `vault-tag ${f.level}` }, f.level === "quantum" ? "KYBER" : f.level === "sha" ? "SHA-256" : "AES-256")),
                                React.createElement("div", { className: "vault-row-right" },
                                    React.createElement("span", { className: "vault-size" }, f.size),
                                    React.createElement("div", { className: "vault-acts" },
                                        React.createElement("button", { className: "act-btn", title: "Download encrypted file", onClick: () => downloadVaultFile(f) }, "\u2193"),
                                        React.createElement("button", { className: "act-btn", title: "Remove from list", onClick: () => { setVaultFiles(v => v.filter((_, j) => j !== i)); showToast("Removed from list"); } }, "\u00D7")))))))),
                            React.createElement("div", { className: "enc-label", style: { marginTop: "1.5rem" } }, "4 \u00B7 Decrypt Files"),
                            React.createElement("div", { className: "drop-zone", onDragOver: e => e.preventDefault(), onDrop: handleDecrypt, onClick: () => !vaultBusy && decFileRef.current?.click(), style: { borderColor: "rgba(48,209,88,0.25)", opacity: vaultBusy ? 0.6 : 1 } },
                                React.createElement("div", { className: "drop-icon" }, "\uD83D\uDD13"),
                                React.createElement("div", { className: "drop-text" },
                                    "Drop ",
                                    React.createElement("span", null, ".qai"),
                                    " files to decrypt"),
                                React.createElement("div", { className: "drop-enc" }, "Uses the password above \u00B7 original file downloads automatically"),
                                React.createElement("input", { ref: decFileRef, type: "file", multiple: true, hidden: true, accept: ".qai", onChange: handleDecrypt })),
                            React.createElement("div", { style: { fontSize: "0.7rem", color: "rgba(180,210,255,0.4)", marginTop: "1rem", lineHeight: 1.6, textAlign: "center" } }, "\uD83D\uDD12 All encryption runs locally in your browser via the Web Crypto API. Your files and password never touch our servers. Lost passwords cannot be recovered \u2014 keep your backup key safe."))))))),
        React.createElement("footer", null,
            React.createElement("div", { className: "footer-brand" },
                React.createElement(Logo, { w: 32, h: 32, r: 8 }),
                React.createElement("span", { className: "footer-name" }, "QuantumAI")),
            React.createElement("p", { className: "footer-tag" }, "$QAI \u00B7 CARDANO \u00B7 POST-QUANTUM SECURITY"),
            React.createElement("div", { className: "donate-section" },
                React.createElement("div", { className: "donate-title" }, "\uD83D\uDC9C Support QuantumAI"),
                React.createElement("div", { className: "donate-sub" }, "QuantumAI is an independent, community-driven project. Donations directly fund development, hosting, and open-source encryption tools. Thank you for your support."),
                React.createElement("div", { className: "donate-grid" }, [
                    { coin: "Bitcoin", ticker: "BTC", icon: "₿", net: "Bitcoin network", addr: "37MVmmdnkQk6HfdH5DjpdZg5MRCjU4sUYF" },
                    { coin: "USDT", ticker: "USDT", icon: "₮", net: "Ethereum (ERC-20)", addr: "0x6d73f1d7347424f0e82c993d66ad6fe17b3d1e8a" },
                    { coin: "Cardano", ticker: "ADA", icon: "₳", net: "Cardano network", addr: "addr1qxf9xr3r332f66k8qx9yezn3ng5066mjksau54l3yjc3a60dfqvllshkfnsten38sesjk8086003suavfv4zm0tfjcfseyptyj" },
                    { coin: "QuantumAI", ticker: "QAI", icon: "⬡", net: "Cardano native token", addr: "addr1qxf9xr3r332f66k8qx9yezn3ng5066mjksau54l3yjc3a60dfqvllshkfnsten38sesjk8086003suavfv4zm0tfjcfseyptyj" },
                ].map(d => (React.createElement("div", { key: d.ticker, className: "donate-item" },
                    React.createElement("div", { className: "donate-icon" }, d.icon),
                    React.createElement("div", { className: "donate-info" },
                        React.createElement("div", { className: "donate-coin" },
                            d.coin,
                            " ",
                            React.createElement("span", { style: { color: "rgba(180,210,255,0.4)", fontWeight: 500 } }, d.ticker)),
                        React.createElement("div", { className: "donate-net" }, d.net),
                        React.createElement("div", { className: "donate-addr" }, d.addr)),
                    React.createElement("button", { className: "donate-copy", onClick: () => { navigator.clipboard?.writeText(d.addr); showToast(`${d.ticker} address copied`); } }, "Copy")))))),
            React.createElement("div", { className: "footer-links" },
                React.createElement("a", { onClick: () => window.open(`https://cardanoscan.io/token/${POLICY_ID}${ASSET_HEX}`) }, "CardanoScan"),
                React.createElement("a", { onClick: () => window.open(`https://minswap.org/tokens/${POLICY_ID}${ASSET_HEX}`) }, "Minswap"),
                React.createElement("a", { onClick: () => window.open(`https://app.sundae.fi/liquidity?token=${POLICY_ID}${ASSET_HEX}`) }, "SundaeSwap"),
                React.createElement("a", { onClick: () => window.open("https://github.com/C-QuantumAi") }, "GitHub"),
                React.createElement("a", { onClick: () => setPage("markets"), style: { cursor: "pointer" } }, "Markets"),
                React.createElement("a", { onClick: () => setPage("downloads"), style: { cursor: "pointer" } }, "Downloads"),
                React.createElement("a", { onClick: () => setPage("cloud"), style: { cursor: "pointer" } }, "Cloud"),
                React.createElement("a", { onClick: () => setPage("chat"), style: { cursor: "pointer" } }, "AI Chat")),
            React.createElement("p", { className: "footer-copy" }, "\u00A9 2025 QuantumAI \u00B7 github.com/C-QuantumAi \u00B7 quantumai.computer \u00B7 $QAI is a Cardano native token. Not financial advice. Crypto investments carry risk.")),
        walletModal && (React.createElement("div", { className: "overlay", onClick: () => setWalletModal(false) },
            React.createElement("div", { className: "modal", onClick: e => e.stopPropagation() },
                React.createElement("div", { className: "modal-logo-row" },
                    React.createElement(Logo, { w: 44, h: 44, r: 12 }),
                    React.createElement("div", { className: "modal-title" }, "Connect Cardano Wallet")),
                React.createElement("p", { className: "modal-sub" }, "Connect a CIP-30 wallet to view your $QAI balance and interact with the QuantumAI platform. Your keys never leave your wallet."),
                availWallets.length > 0 ? (React.createElement(React.Fragment, null,
                    React.createElement("div", { style: { fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(180,210,255,0.45)", textTransform: "uppercase", margin: "0.25rem 0 0.6rem" } },
                        "Detected (",
                        availWallets.length,
                        ")"),
                    React.createElement("div", { className: "wallet-list" }, availWallets.map(w => (React.createElement("div", { key: w.key, className: "wallet-item", onClick: () => walletConnecting ? null : connectWallet(w), style: { opacity: walletConnecting && walletConnecting !== w.key ? 0.4 : 1, cursor: walletConnecting ? "default" : "pointer" } },
                        React.createElement("span", { className: "w-icon" }, w.icon),
                        React.createElement("div", { style: { flex: 1 } },
                            React.createElement("div", { className: "w-name" }, w.name),
                            React.createElement("div", { className: "w-sub" }, walletConnecting === w.key ? "Check your wallet popup…" : w.sub)),
                        walletConnecting === w.key
                            ? React.createElement("span", { style: { fontSize: "0.7rem", color: "var(--blue)" } }, "Connecting\u2026")
                            : React.createElement("span", { style: { fontSize: "0.62rem", fontWeight: 700, color: "#30d158", letterSpacing: "0.05em" } }, "\u25CF INSTALLED"))))))) : (React.createElement("div", { style: { textAlign: "center", padding: "1.25rem 0.5rem" } },
                    React.createElement("div", { style: { fontSize: "1.8rem", marginBottom: "0.5rem" } }, "\uD83D\uDD0D"),
                    React.createElement("div", { style: { fontSize: "0.88rem", fontWeight: 600, color: "#fff", marginBottom: "0.4rem" } }, "No Cardano wallet detected"),
                    React.createElement("div", { style: { fontSize: "0.76rem", color: "rgba(180,210,255,0.5)", lineHeight: 1.5, marginBottom: "1rem" } }, "Install a Cardano wallet browser extension, then refresh. Popular choices:"),
                    React.createElement("div", { className: "wallet-list" }, KNOWN_WALLETS.slice(0, 5).map(w => (React.createElement("a", { key: w.key, href: w.url, target: "_blank", rel: "noreferrer", className: "wallet-item", style: { textDecoration: "none" } },
                        React.createElement("span", { className: "w-icon" }, w.icon),
                        React.createElement("div", { style: { flex: 1 } },
                            React.createElement("div", { className: "w-name" }, w.name),
                            React.createElement("div", { className: "w-sub" }, w.sub)),
                        React.createElement("span", { style: { fontSize: "0.66rem", fontWeight: 700, color: "var(--blue)" } }, "Install \u2197"))))),
                    React.createElement("button", { className: "modal-cancel", style: { marginTop: "0.85rem" }, onClick: refreshWallets }, "\u21BA Re-scan for wallets"))),
                React.createElement("button", { className: "modal-cancel", onClick: () => setWalletModal(false) }, "Cancel")))),
        toast && React.createElement("div", { className: "toast" }, toast)));
}

(function(){
  if (typeof React === "undefined" || typeof ReactDOM === "undefined") {
    document.getElementById("root").innerHTML =
      '<div style="font-family:Inter,system-ui,sans-serif;color:#eaf4ff;max-width:520px;margin:18vh auto;padding:2rem;text-align:center"><h1 style="color:#00C6FF">QuantumAI</h1><p style="color:#8fb6d6;line-height:1.6">Couldn\'t load required libraries from the CDN. Check your connection and refresh.</p></div>';
    return;
  }
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(QuantumAI));
})();
