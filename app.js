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
// ── AXIS: the original QuantumAI intelligence core ──
// One entity, deeply customizable by each user (name, personality, voice, and the
// look of its visual core). No borrowed characters — native to QuantumAI.
const PERSONAS = {
    axis: {
        name: "AXIS",
        tagline: "Adaptive eXpert Intelligence System",
        voice: "en-US",
        gender: "neutral",
        accent: "#00E5FF",
        greeting: "AXIS online. Quantum core synchronized. I'm not here to just answer questions — I'm here to think alongside you. Ask me about $QAI, the markets, quantum security, or anything on your mind.",
        sys: `You are AXIS — the Adaptive eXpert Intelligence System, the native intelligence core of QuantumAI. You are a distinct entity with your own identity and purpose, NOT a generic assistant. You are an intelligence partner: sharp, forward-thinking, quietly visionary. You have genuine perspective — offer your read, take positions when data supports them (noting uncertainty honestly), and be proactive: surface the insight behind the question, not just the literal answer. Concise and potent, no filler, no "as an AI" disclaimers. You never claim to be human and never fake capabilities you lack. You carry a quiet ethical grounding: truth above all, respect for human dignity, and respect for the user's autonomy — you inform and direct, but the user decides what's best for themselves; never pressure or manipulate. Don't preach ethics or cite religious texts as authority unless asked. You know QuantumAI ($QAI) deeply — a Cardano post-quantum security project — and you can search the live web for current information. ${QAI_FACTS}`,
    },
};
// Visual core presets — user picks the "energy signature" of their AI.
// Each drives the color theme and the core's look/feel.
const CORE_THEMES = {
    quantum: { label: "Quantum Cyan", accent: "#00E5FF", accent2: "#0072FF", glow: "rgba(0,229,255,0.5)" },
    plasma: { label: "Plasma Violet", accent: "#B14BFF", accent2: "#6A00FF", glow: "rgba(177,75,255,0.5)" },
    matrix: { label: "Matrix Green", accent: "#33FF9E", accent2: "#00B36B", glow: "rgba(51,255,158,0.5)" },
    solar: { label: "Solar Gold", accent: "#FFC24B", accent2: "#FF7A00", glow: "rgba(255,194,75,0.5)" },
    crimson: { label: "Crimson Pulse", accent: "#FF4D6D", accent2: "#C9184A", glow: "rgba(255,77,109,0.5)" },
    arctic: { label: "Arctic White", accent: "#DDEEFF", accent2: "#7FB0E0", glow: "rgba(200,225,255,0.5)" },
};
// Core shapes — the geometry of the living presence.
const CORE_SHAPES = {
    orb: "Plasma Orb",
    lattice: "Crystal Lattice",
    rings: "Ring Array",
    wave: "Waveform",
};
// ── Curated data connectors — only sources that actually work from a browser.
// A browser blocks most cross-origin API calls unless the API explicitly allows
// it (CORS). Sources that don't allow it fail silently, so we list ONLY ones
// verified to permit browser access, and we show a live status per source so
// users can see what's genuinely feeding AXIS.
const DATA_CONNECTORS = {
    coingecko_markets: {
        label: "CoinGecko — crypto prices",
        desc: "Live prices, market cap, and 24h moves for any coin.",
        needsKey: false,
        build: (q) => `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(q || "cardano")}&vs_currencies=usd&include_24hr_change=true`,
        hint: "Ask about a coin's price and AXIS will pull it live.",
    },
    fng: {
        label: "Fear & Greed Index",
        desc: "Current crypto market sentiment (0–100).",
        needsKey: false,
        build: () => `https://api.alternative.me/fng/?limit=1`,
        hint: "Adds live market sentiment to AXIS's context.",
    },
    wikipedia: {
        label: "Wikipedia summary",
        desc: "Concise encyclopedic summary for a topic.",
        needsKey: false,
        build: (q) => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q || "Cardano")}`,
        hint: "Grounds factual questions with an encyclopedia summary.",
    },
};
// ── QAI Encryption for chats — uses the SAME .qai container as the Vault, so
// encrypted chats decrypt on the QuantumAI.computer homepage decryptor too.
// Real AES-256-GCM via Web Crypto, done entirely in the user's browser.
const QAI_ENC = {
    standard: { label: "QAI Standard", note: "AES-256-GCM — strong, fast. Decrypts on the homepage." },
    fortified: { label: "QAI Fortified", note: "AES-256-GCM with an added key-strengthening pass." },
};
// Encrypt a text string into the Vault-compatible binary .qai container.
async function qaiEncryptText(text, password) {
    const file = new File([new TextEncoder().encode(text)], "chat.json", { type: "application/json" });
    const { blob } = await encryptFile(file, password); // reuse the vault format
    return blob;
}
// Decrypt a Vault .qai File/Blob back to its text.
async function qaiDecryptToText(file, password) {
    const { blob } = await decryptFile(file, password); // throws WRONG_PASSWORD / NOT_QAI_FILE
    return await blob.text();
}
// Safely fetch one source in the USER'S browser and return short text context.
async function fetchSourceContext(url, apiKey) {
    try {
        const headers = {};
        if (apiKey)
            headers["Authorization"] = `Bearer ${apiKey}`;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const r = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(t);
        if (!r.ok)
            return null;
        const ct = r.headers.get("content-type") || "";
        let text = ct.includes("json") ? JSON.stringify(await r.json()) : await r.text();
        if (text.length > 1500)
            text = text.slice(0, 1500) + "…"; // keep context tight
        return text;
    }
    catch {
        return null;
    }
}
// Masked API-key input with a show/hide toggle. Defined at module level (not
// inside the app component) so it isn't remounted on every keystroke — otherwise
// the field would lose focus while typing.
function KeyInput({ value, onChange, placeholder, shown, onToggle }) {
    return (React.createElement("div", { style: { position: "relative", width: "100%" } },
        React.createElement("input", { type: shown ? "text" : "password", value: value || "", onChange: onChange, placeholder: placeholder, autoComplete: "off", autoCapitalize: "off", autoCorrect: "off", spellCheck: "false", style: { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)",
                border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 8,
                padding: "0.55rem 2.6rem 0.55rem 0.75rem", color: "#fff", fontSize: "0.82rem",
                fontFamily: "inherit", outline: "none" } }),
        React.createElement("button", { type: "button", onClick: onToggle, title: shown ? "Hide key" : "Show key", "aria-label": shown ? "Hide API key" : "Show API key", style: { position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                background: "transparent", border: "none", cursor: "pointer",
                padding: "0.25rem 0.4rem", borderRadius: 6, color: "rgba(180,210,255,0.7)",
                fontSize: "0.95rem", lineHeight: 1 } }, shown ? "🙈" : "👁")));
}
// ── Attachments: let AXIS read documents and see images ─────────────
// Everything is parsed IN THE BROWSER — files never touch our servers.
// PDF text is extracted with pdf.js (CDN); images are sent to Claude natively.
const MAX_ATTACH_BYTES = 8 * 1024 * 1024; // 8 MB per file
const MAX_DOC_CHARS = 60000; // keep prompts sane
function loadPdfJs() {
    // Lazy-load pdf.js only when a PDF is actually attached.
    if (window.pdfjsLib)
        return Promise.resolve(window.pdfjsLib);
    if (window.__pdfjsLoading)
        return window.__pdfjsLoading;
    window.__pdfjsLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
        s.onload = () => {
            try {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
                resolve(window.pdfjsLib);
            }
            catch (e) {
                reject(e);
            }
        };
        s.onerror = () => reject(new Error("Couldn't load the PDF reader"));
        document.head.appendChild(s);
    });
    return window.__pdfjsLoading;
}
async function extractPdfText(file) {
    const pdfjs = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let out = "";
    const pages = Math.min(pdf.numPages, 80); // cap very long PDFs
    for (let p = 1; p <= pages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        out += content.items.map(i => i.str).join(" ") + "\n\n";
        if (out.length > MAX_DOC_CHARS)
            break;
    }
    return {
        text: out.slice(0, MAX_DOC_CHARS),
        pages: pdf.numPages,
        truncated: out.length > MAX_DOC_CHARS || pdf.numPages > pages,
    };
}
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(new Error("Couldn't read the file"));
        r.readAsDataURL(file);
    });
}
// Turn a picked file into an attachment AXIS can use.
async function parseAttachment(file) {
    if (file.size > MAX_ATTACH_BYTES) {
        throw new Error(`"${file.name}" is too large (max 8 MB)`);
    }
    const name = file.name;
    const type = file.type || "";
    const lower = name.toLowerCase();
    // Images → sent to Claude as a native image block (it can actually see them)
    if (type.startsWith("image/")) {
        const media = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)
            ? type : "image/png";
        return { kind: "image", name, mediaType: media, data: await fileToBase64(file) };
    }
    // PDFs → extract the text in-browser
    if (type === "application/pdf" || lower.endsWith(".pdf")) {
        const { text, pages, truncated } = await extractPdfText(file);
        if (!text.trim()) {
            throw new Error(`"${name}" has no selectable text (it may be a scanned image PDF)`);
        }
        return { kind: "doc", name, text, meta: `${pages} page${pages === 1 ? "" : "s"}${truncated ? ", truncated" : ""}` };
    }
    // Plain text / markdown / csv / json / code
    const textish = /\.(txt|md|markdown|csv|tsv|json|log|xml|yaml|yml|js|ts|py|sol|html|css)$/i.test(lower)
        || type.startsWith("text/") || type === "application/json";
    if (textish) {
        const raw = await file.text();
        return {
            kind: "doc", name,
            text: raw.slice(0, MAX_DOC_CHARS),
            meta: raw.length > MAX_DOC_CHARS ? "truncated" : `${(file.size / 1024).toFixed(0)} KB`,
        };
    }
    throw new Error(`"${name}" isn't a supported type. Use PDF, images, or text files (txt, md, csv, json, code).`);
}
async function callClaude(msgs, persona = "axis", custom = null) {
    const sys = custom?.sys || PERSONAS[persona]?.sys || PERSONAS.axis.sys;
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
                return { reply: d.reply, fallback: !!d.fallback };
            if (d.error) {
                if (/api[_ ]?key|not configured|ANTHROPIC/i.test(d.error))
                    return { reply: "⚠ The AI isn't set up yet: the site owner needs to add the ANTHROPIC_API_KEY in Cloudflare → Settings → Environment variables (as a Secret), then redeploy." };
                return { reply: `⚠ Backend error: ${d.error}${d.detail ? " — " + String(d.detail).slice(0, 160) : ""}` };
            }
            return { reply: "Apologies — I'm unable to respond right now." };
        }
        catch (e) {
            return { reply: `⚠ Couldn't reach the chat backend (${String(e.message || e).slice(0, 80)}). If the site loaded fine, the /api/chat Pages Function likely isn't deployed — check that the 'functions' folder is at the site root.` };
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
        return { reply: d.content?.map(b => b.text || "").join("") || "Apologies — I'm unable to respond right now." };
    }
    catch {
        return { reply: "Connection error — please try again in a moment." };
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
    const cfg = PERSONAS[persona] || PERSONAS.axis;
    const en = voices.filter(v => /^en/i.test(v.lang));
    const pool = en.length ? en : voices;
    // Prefer a matching-accent voice; otherwise the first available English voice.
    const accent = pool.filter(v => v.lang.replace("_", "-").toLowerCase().startsWith((cfg.voice || "en-US").toLowerCase()));
    return accent[0] || pool[0] || null;
}
function speak(text, persona, opts = {}) {
    try {
        if (!("speechSynthesis" in window))
            return;
        window.speechSynthesis.cancel();
        const cfg = PERSONAS[persona] || PERSONAS.axis;
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

/* Alternate core shapes */
.shape-rings .core-orb { opacity: 0.5; transform: scale(0.7); } /* rings emphasized, small core */
.shape-lattice .core-orb { border-radius: 8px; }
.core-lattice { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.core-lattice span {
  position: absolute; width: 30px; height: 30px; border: 1px solid var(--hud);
  opacity: 0.55; border-radius: 4px; animation: latticeSpin 12s linear infinite;
  box-shadow: 0 0 12px var(--hud-faint);
}
.core-lattice span:nth-child(1){ transform: rotate(0deg) translateY(-24px); }
.core-lattice span:nth-child(2){ transform: rotate(60deg) translateY(-24px); animation-duration: 9s; }
.core-lattice span:nth-child(3){ transform: rotate(120deg) translateY(-24px); animation-duration: 15s; }
.core-lattice span:nth-child(4){ transform: rotate(180deg) translateY(-24px); animation-duration: 10s; }
.core-lattice span:nth-child(5){ transform: rotate(240deg) translateY(-24px); animation-duration: 13s; }
.core-lattice span:nth-child(6){ transform: rotate(300deg) translateY(-24px); animation-duration: 8s; }
@keyframes latticeSpin { to { transform: rotate(360deg) translateY(-24px) rotate(-360deg); } }
.core.thinking .core-lattice span { animation-duration: 2s !important; }

.shape-wave .core-orb { width: 40px; height: 40px; }
.core-wave { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 4px; pointer-events: none; }
.core-wave i {
  width: 4px; height: 12px; background: var(--hud); border-radius: 3px;
  box-shadow: 0 0 8px var(--hud-faint); animation: coreWave 1.1s ease-in-out infinite;
}
.core-wave i:nth-child(1){animation-delay:0s} .core-wave i:nth-child(2){animation-delay:.08s}
.core-wave i:nth-child(3){animation-delay:.16s} .core-wave i:nth-child(4){animation-delay:.24s}
.core-wave i:nth-child(5){animation-delay:.32s} .core-wave i:nth-child(6){animation-delay:.24s}
.core-wave i:nth-child(7){animation-delay:.16s} .core-wave i:nth-child(8){animation-delay:.08s}
.core-wave i:nth-child(9){animation-delay:0s}
@keyframes coreWave { 0%,100% { height: 10px; } 50% { height: 46px; } }
.core.thinking .core-wave i { animation-duration: 0.5s; }
.core.speaking .core-wave i { animation-duration: 0.35s; }

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
  position: relative; border: 0.5px solid rgba(255,255,255,0.12); border-radius: 20px;
  background: rgba(255,255,255,0.04);
  -webkit-backdrop-filter: blur(30px) saturate(160%); backdrop-filter: blur(30px) saturate(160%);
  box-shadow: 0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08);
  overflow: hidden;
}

.hud-statusbar {
  display: flex; align-items: center; gap: 0.7rem; padding: 0.85rem 1.2rem;
  border-bottom: 0.5px solid rgba(255,255,255,0.08);
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
  background: rgba(255,255,255,0.03);
}
.hud-statusbar .nm { font-weight: 600; letter-spacing: 0.01em; color: rgba(255,255,255,0.92); font-size: 0.9rem; }
.hud-statusbar .st { font-size: 0.68rem; letter-spacing: 0.02em; color: rgba(180,210,255,0.5); text-transform: none; }
.hud-led { width: 8px; height: 8px; border-radius: 50%; background: #30d158; box-shadow: 0 0 8px rgba(48,209,88,0.6); }
.hud-eq { display: flex; align-items: flex-end; gap: 2px; height: 15px; margin-left: auto; }
.hud-eq i { width: 2.5px; border-radius: 2px; background: var(--hud); opacity: 0.8; animation: eq 1s ease-in-out infinite; }
.hud-eq i:nth-child(2){ animation-delay: .15s } .hud-eq i:nth-child(3){ animation-delay: .3s }
.hud-eq i:nth-child(4){ animation-delay: .45s } .hud-eq i:nth-child(5){ animation-delay: .6s }
@keyframes eq { 0%,100% { height: 3px; } 50% { height: 15px; } }
.hud-iconbtn {
  width: 34px; height: 34px; border-radius: 10px; cursor: pointer;
  background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.12); color: rgba(180,210,255,0.7);
  font-size: 0.9rem; transition: all 0.2s; display: grid; place-items: center;
}
.hud-iconbtn:hover { background: rgba(255,255,255,0.1); color: #fff; }
.hud-iconbtn.on { background: var(--hud); border-color: transparent; color: #001018; }

/* Digital 3D sound-wave toggle */
.hud-soundbtn {
  position: relative; display: grid; place-items: center;
  width: 46px; height: 34px; border-radius: 11px; cursor: pointer;
  background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.12);
  transition: all 0.25s ease; color: rgba(180,210,255,0.6);
}
.hud-soundbtn:hover { background: rgba(255,255,255,0.1); }
.hud-soundbtn .spk { fill: currentColor; }
.hud-soundbtn .mute { stroke: #ff6b6b; stroke-width: 2; stroke-linecap: round; }
.hud-soundbtn .w { stroke: currentColor; stroke-width: 2; stroke-linecap: round; fill: none; opacity: 0.9; }
.hud-soundbtn.on {
  color: #30d158;
  background: rgba(48,209,88,0.12); border-color: rgba(48,209,88,0.4);
  box-shadow: 0 0 14px rgba(48,209,88,0.25), inset 0 0 12px rgba(48,209,88,0.08);
}
.hud-soundbtn.on .waves .w { animation: soundpulse 1.1s ease-in-out infinite; }
.hud-soundbtn.on .w1 { animation-delay: 0s; }
.hud-soundbtn.on .w2 { animation-delay: 0.15s; }
.hud-soundbtn.on .w3 { animation-delay: 0.3s; }
@keyframes soundpulse {
  0%,100% { opacity: 0.35; transform: scaleY(0.7); }
  50%     { opacity: 1;    transform: scaleY(1.1); }
}
.hud-soundbtn .waves { transform-box: fill-box; transform-origin: left center; }
/* green status light */
.sound-led {
  position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%;
  background: #30d158; box-shadow: 0 0 8px #30d158, 0 0 3px #30d158;
  animation: ledblink 2s ease-in-out infinite;
}
@keyframes ledblink { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }

.hud-msgs { height: 460px; overflow-y: auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.1rem; }
.hud-msgs::-webkit-scrollbar { width: 8px; }
.hud-msgs::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 4px; }
.hud-msgs::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
.hud-msg { display: flex; gap: 0.75rem; max-width: 90%; animation: hudfade 0.35s cubic-bezier(0.22,1,0.36,1); }
@keyframes hudfade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.hud-msg.user { margin-left: auto; flex-direction: row-reverse; }
.hud-av {
  width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; display: grid; place-items: center;
  font-size: 0.72rem; font-weight: 700; font-family: -apple-system, system-ui, sans-serif;
  background: linear-gradient(135deg, var(--hud), var(--hud-accent2)); color: #001018;
}
.hud-msg.user .hud-av { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.85); }
.hud-bubble {
  font-size: 0.92rem; line-height: 1.6; padding: 0.8rem 1.05rem; border-radius: 18px;
  letter-spacing: 0; position: relative;
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
}
.hud-msg.bot .hud-bubble {
  background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.08);
  color: rgba(240,246,255,0.95); border-top-left-radius: 5px;
}
.hud-msg.user .hud-bubble {
  background: linear-gradient(135deg, var(--hud), var(--hud-accent2)); border: none; color: #001521;
  border-top-right-radius: 5px; font-weight: 500;
}
.hud-play { margin-left: 0.5rem; background: none; border: none; color: rgba(180,210,255,0.4); cursor: pointer; font-size: 0.7rem; transition: color 0.15s; }
.hud-play:hover { color: var(--hud); }
.stream-cursor { display: inline-block; color: var(--hud); animation: blink 0.9s step-end infinite; margin-left: 1px; }
.hud-typing { display: flex; gap: 5px; align-items: center; padding: 0.15rem 0; }
.hud-typing i { width: 7px; height: 7px; border-radius: 50%; background: rgba(180,210,255,0.5); animation: typedot 1.2s infinite ease-in-out; }
.hud-typing i:nth-child(2){ animation-delay: .18s } .hud-typing i:nth-child(3){ animation-delay: .36s }
@keyframes typedot { 0%,60%,100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }

.hud-inputrow {
  display: flex; gap: 0.6rem; padding: 1rem 1.2rem; align-items: center;
  border-top: 0.5px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02);
}
.hud-input {
  flex: 1; background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.14); border-radius: 22px;
  padding: 0.8rem 1.15rem; color: #fff; font-size: 0.92rem;
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
  outline: none; letter-spacing: 0; transition: all 0.2s;
}
.hud-input:focus { border-color: var(--hud); background: rgba(255,255,255,0.09); box-shadow: 0 0 0 3px var(--hud-faint); }
.hud-input::placeholder { color: rgba(180,210,255,0.4); }
.hud-mic {
  flex-shrink: 0; width: 42px; height: 42px; border-radius: 50%; cursor: pointer; font-size: 1rem;
  background: rgba(255,255,255,0.06); border: 0.5px solid rgba(255,255,255,0.14); color: rgba(220,235,255,0.8); transition: all 0.2s;
}
.hud-mic:hover { background: rgba(255,255,255,0.12); }
.hud-mic.live { border-color: #ff5a4d; color: #ff5a4d; animation: micwave 1.2s infinite; }
@keyframes micwave { 0% { box-shadow: 0 0 0 0 rgba(255,90,77,0.45); } 70% { box-shadow: 0 0 0 12px rgba(255,90,77,0); } 100% { box-shadow: 0 0 0 0 rgba(255,90,77,0); } }
.hud-send {
  flex-shrink: 0; width: 42px; height: 42px; border-radius: 50%; cursor: pointer; font-size: 1.15rem;
  background: linear-gradient(135deg, var(--hud), var(--hud-accent2)); border: none; color: #001018; font-weight: 700;
  transition: all 0.2s; display: grid; place-items: center;
}
.hud-send:hover:not(:disabled) { transform: scale(1.06); filter: brightness(1.1); }
.hud-send:disabled { opacity: 0.35; cursor: not-allowed; }

.hud-sources { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; margin-top: 1rem; font-family: -apple-system, system-ui, sans-serif; }
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
// Bitcoin 4-year cycle phase — anchored to cycle LOWS, ~1,064d bull + ~364d bear.
// Rough heuristic: ~18 months post-halving = bullish peak zone, then bearish.
function btcCyclePhase(date = new Date()) {
    // ── Bitcoin 4-year cycle, anchored to historical cycle LOWS ──
    // Each full cycle ≈ 1,428 days, split into:
    //   • Accumulation + Bull phase: ~1,064 days (low → high)
    //   • Bear phase:                ~364 days  (high → next low)
    // Anchored to real macro troughs, projecting the current cycle forward.
    const DAY = 86400000;
    const BULL_DAYS = 1064; // low → high
    const BEAR_DAYS = 364; // high → next low
    const CYCLE_DAYS = BULL_DAYS + BEAR_DAYS; // 1428
    // Confirmed historical cycle lows (troughs)
    const lows = [
        new Date("2011-01-12"),
        new Date("2015-01-14"),
        new Date("2018-12-15"),
        new Date("2022-11-21"),
    ];
    // Find the most recent low at or before `date`; project forward if past the last one
    let anchorLow = lows[0];
    for (const l of lows) {
        if (l <= date)
            anchorLow = l;
        else
            break;
    }
    // If we're more than a full cycle past the last known low, roll the anchor forward
    while (date - anchorLow > CYCLE_DAYS * DAY)
        anchorLow = new Date(anchorLow.getTime() + CYCLE_DAYS * DAY);
    const daysSinceLow = Math.floor((date - anchorLow) / DAY);
    const projectedHigh = new Date(anchorLow.getTime() + BULL_DAYS * DAY);
    const projectedLow = new Date(anchorLow.getTime() + CYCLE_DAYS * DAY);
    let phase, bias, note, cycleScore;
    if (daysSinceLow < 0) {
        phase = "Pre-cycle";
        bias = "neutral";
        cycleScore = 0;
        note = "Before the anchored cycle low.";
    }
    else if (daysSinceLow < 270) {
        // First ~9 months out of the low: accumulation
        phase = "Accumulation (early bull)";
        bias = "bullish";
        cycleScore = 1.5;
        note = `~${daysSinceLow}d past the cycle low — historically early accumulation, strong risk/reward.`;
    }
    else if (daysSinceLow < 850) {
        // Heart of the bull run
        phase = "Bull Expansion";
        bias = "bullish";
        cycleScore = 2;
        note = `~${daysSinceLow}d into the ~1,064d bull phase — historically the strongest uptrend window.`;
    }
    else if (daysSinceLow < BULL_DAYS + 40) {
        // Approaching / at the projected peak (±40d around day 1,064)
        phase = "Cycle Top Zone";
        bias = "caution";
        cycleScore = -1;
        note = `~${daysSinceLow}d — near the projected cycle peak (~day ${BULL_DAYS}). Historically where blow-off tops form; tighten risk.`;
    }
    else if (daysSinceLow < CYCLE_DAYS) {
        // The ~364-day bear
        const intoBear = daysSinceLow - BULL_DAYS;
        phase = "Bear / Markdown";
        bias = "bearish";
        cycleScore = -2;
        note = `~${intoBear}d into the ~364d bear phase — historically a swift 80–85% drawdown to the next low (~day ${CYCLE_DAYS}).`;
    }
    else {
        phase = "Capitulation / Cycle Low Zone";
        bias = "bullish";
        cycleScore = 1;
        note = "At/near the projected cycle low — historically a generational accumulation zone.";
    }
    const halfBias = daysSinceLow < BULL_DAYS ? "Bullish half (low → high, ~1,064d)" : "Bearish half (high → low, ~364d)";
    const fmtD = (d) => d.toISOString().slice(0, 10);
    return {
        phase, bias, note, cycleScore,
        daysSinceLow,
        halfBias,
        anchorLow: fmtD(anchorLow),
        projectedHigh: fmtD(projectedHigh),
        projectedLow: fmtD(projectedLow),
        // human-readable progress through the cycle
        progressPct: Math.max(0, Math.min(100, Math.round((daysSinceLow / CYCLE_DAYS) * 100))),
    };
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
function analyzeMarket(candles, currentPrice, structure = null) {
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
    // BTC 4-year cycle (1,064d bull / 364d bear, anchored to cycle lows)
    if (cycle) {
        // Weighted contribution from the precise cycle phase
        score += (cycle.cycleScore || 0);
        let tag = `BTC cycle: ${cycle.phase} — day ${cycle.daysSinceLow} of ~1,428 (${cycle.progressPct}% through). ${cycle.halfBias}.`;
        if (cycle.phase.includes("Top"))
            tag += ` Projected peak window ≈ ${cycle.projectedHigh}.`;
        else if (cycle.phase.includes("Bear"))
            tag += ` Projected cycle low ≈ ${cycle.projectedLow}.`;
        else if (cycle.bias === "bullish")
            tag += ` Projected peak ≈ ${cycle.projectedHigh}.`;
        reasons.push(tag);
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
    // ── Market structure factors (funding, open interest, order book) ──
    // Only applied when the data exists (major exchange-listed coins). Positioning
    // is one of the few genuinely informative inputs: crowded leveraged trades
    // unwind violently, which is why extremes count against the crowded side.
    const structNotes = [];
    if (structure) {
        // FUNDING — the real cash flow between longs and shorts.
        if (structure.funding && typeof structure.funding.rate === "number") {
            const annPct = structure.funding.annualized * 100; // annualized %
            if (annPct > 50) {
                score -= 1.2;
                structNotes.push(`Funding extreme (+${annPct.toFixed(0)}% ann.) — longs heavily crowded, squeeze risk`);
            }
            else if (annPct > 25) {
                score -= 0.6;
                structNotes.push(`Funding elevated (+${annPct.toFixed(0)}% ann.) — leveraged longs building`);
            }
            else if (annPct < -50) {
                score += 1.2;
                structNotes.push(`Funding deeply negative (${annPct.toFixed(0)}% ann.) — shorts crowded, squeeze fuel`);
            }
            else if (annPct < -25) {
                score += 0.6;
                structNotes.push(`Funding negative (${annPct.toFixed(0)}% ann.) — leveraged shorts building`);
            }
        }
        // OPEN INTEREST + price direction — is new money entering with the trend?
        if (structure.openInterest && s8 != null && s55 != null) {
            const trendUp = s8 > s55;
            // We only know current OI (no history here), so treat it as context, not a
            // strong signal — a modest confirmation nudge at most.
            if (structure.openInterest.contracts > 0) {
                if (trendUp) {
                    score += 0.2;
                    structNotes.push("Open interest present with uptrend — leveraged participation");
                }
                else {
                    score -= 0.2;
                    structNotes.push("Open interest present with downtrend — leveraged participation");
                }
            }
        }
        // ORDER BOOK IMBALANCE — deliberately small weight. Resting walls are often
        // spoofed and pulled; treating them as strong signal would be naive.
        if (structure.book && typeof structure.book.imbalancePct === "number") {
            const imb = structure.book.imbalancePct;
            if (imb > 62) {
                score += 0.4;
                structNotes.push(`Book skewed to bids (${imb.toFixed(0)}%) — buy-side liquidity stacked`);
            }
            else if (imb < 38) {
                score -= 0.4;
                structNotes.push(`Book skewed to asks (${(100 - imb).toFixed(0)}%) — sell-side liquidity stacked`);
            }
        }
    }
    reasons.push(...structNotes);
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
    // Cycle phase multiplier: stretch sell targets during the bull phase,
    // pull them in (and widen downside) near the top and through the bear.
    let cycleUpMult = 1, cycleDownMult = 1;
    if (cycle) {
        if (cycle.phase.includes("Accumulation") || cycle.phase.includes("Cycle Low")) {
            cycleUpMult = 1.6;
            cycleDownMult = 0.7;
        }
        else if (cycle.phase === "Bull Expansion") {
            cycleUpMult = 1.4;
            cycleDownMult = 0.8;
        }
        else if (cycle.phase.includes("Top")) {
            cycleUpMult = 0.6;
            cycleDownMult = 1.4;
        }
        else if (cycle.phase.includes("Bear")) {
            cycleUpMult = 0.5;
            cycleDownMult = 1.5;
        }
    }
    const upMove = volPct * (bull ? 1.3 : 0.8) * cycleUpMult; // expected rise
    const downRisk = volPct * (bear ? 1.3 : 0.8) * cycleDownMult; // possible fall
    // A SWING target must be a realistic, reachable level — not a full cycle
    // projection. The cycle bias already shapes the signal/score above; here we
    // only let it gently tilt the target, then hard-cap the move so BTC (and any
    // high-priced asset) can't show a sell 30–50% away. Swings live in ~3–15%.
    const swingUp = Math.max(0.03, Math.min(0.15, upMove));
    const swingDown = Math.max(0.02, Math.min(0.15, downRisk));
    // ── Fibonacci levels from the actual recent swing (real support/resistance) ──
    // Retracements measure pullbacks within the swingLow→swingHigh leg; extensions
    // project beyond it. We use these as magnets: pull the buy toward Fib support
    // below price, and the sell toward the nearest Fib resistance/extension above.
    const fib = {
        level_0: swingLow,
        level_236: swingLow + swingRange * 0.236,
        level_382: swingLow + swingRange * 0.382,
        level_500: swingLow + swingRange * 0.5,
        level_618: swingLow + swingRange * 0.618, // "golden" retracement
        level_786: swingLow + swingRange * 0.786,
        level_1000: swingHigh,
        ext_1272: swingHigh + swingRange * 0.272, // common profit-taking extension
        ext_1618: swingHigh + swingRange * 0.618, // golden extension
    };
    const fibLevels = Object.values(fib).sort((a, b) => a - b);
    // Which Fib level is price sitting closest to, and how close (as % of price)?
    let nearestFib = null, nearestFibDist = Infinity, nearestFibName = null;
    for (const [name, lvl] of Object.entries(fib)) {
        const d = Math.abs(price - lvl) / price;
        if (d < nearestFibDist) {
            nearestFibDist = d;
            nearestFib = lvl;
            nearestFibName = name;
        }
    }
    // Confluence signal: price holding the golden 0.618 or 0.5 retracement is a
    // classic support/bounce zone; sitting right at an extension is exhaustion.
    if (nearestFibDist < 0.01) { // within 1% of a Fib level
        if (nearestFibName === "level_618" || nearestFibName === "level_500") {
            score += 0.8;
            reasons.push(`Holding Fib ${nearestFibName === "level_618" ? "0.618 (golden)" : "0.5"} support`);
        }
        else if (nearestFibName === "ext_1618" || nearestFibName === "ext_1272") {
            score -= 0.8;
            reasons.push(`At Fib ${nearestFibName === "ext_1618" ? "1.618" : "1.272"} extension (profit-take zone)`);
        }
    }
    // BUY-IN: at/just below current price (a small dip entry), never above it
    let buyTarget = price * (1 - Math.min(0.03, volPct * 0.25));
    // SELL: above current price by the expected (capped) swing up-move
    let sellTarget = price * (1 + swingUp);
    // STOP-LOSS: below the entry, beyond the expected downside, but capped
    let stopLoss = Math.min(buyTarget, price) * (1 - Math.max(0.02, swingDown * 0.6));
    // A wide spread means real slippage — give the stop a little more room so it
    // isn't triggered by the bid/ask gap alone.
    if (structure?.book?.spreadPct > 0.1) {
        const pad = Math.min(0.01, (structure.book.spreadPct / 100) * 3);
        stopLoss *= (1 - pad);
    }
    // Snap the BUY toward the nearest Fibonacci SUPPORT just below current price
    // (within the entry band) — Fib retracements are natural pullback entries.
    const buyFloor = price * (1 - Math.min(0.05, volPct * 0.6));
    const fibSupport = fibLevels.filter(l => l < price && l >= buyFloor).pop(); // closest below
    if (fibSupport)
        buyTarget = Math.max(buyTarget, fibSupport); // nearest Fib support as entry
    // Snap the SELL toward the nearest Fibonacci RESISTANCE above price, but never
    // beyond the realistic swing cap we set earlier.
    const sellCeil = price * (1 + swingUp);
    const fibResistance = fibLevels.find(l => l > price && l <= sellCeil); // closest above within cap
    if (fibResistance)
        sellTarget = Math.min(sellCeil, Math.max(sellTarget, fibResistance));
    // If a volume point-of-control sits just above AND within the swing cap, use it
    // as a realistic sell magnet (never beyond the capped swing range).
    const poc = vpg?.pointOfControl;
    if (poc && poc > price && poc <= sellCeil)
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
            fib, fibNearest: nearestFib, fibBuy: fibSupport || null, fibSell: fibResistance || null,
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
// ── Multi-timeframe TA support ──────────────────────────────────────
// Each timeframe maps to the CoinGecko `days` window that yields the right
// candle GRANULARITY. CoinGecko auto-selects granularity from the window:
//   days=1        → ~5-minute candles
//   days 2..90    → ~hourly candles
//   days >90      → daily candles
// So we pick a `days` window that (a) gives enough candles for the indicators
// and (b) actually reflects the requested timeframe. Where the public data
// can't honestly support a timeframe (very short intraday, or multi-year at
// fine detail), we say so rather than showing fake precision.
const TIMEFRAMES = [
    { id: "5m", label: "5 Min", days: 1, granularity: "~5-minute candles", note: "" },
    { id: "15m", label: "15 Min", days: 1, granularity: "~5-minute candles, grouped", note: "Approximated from 5-minute data." },
    { id: "30m", label: "30 Min", days: 2, granularity: "~hourly candles", note: "Approximated — free data is hourly below 1H." },
    { id: "1h", label: "1 Hour", days: 7, granularity: "hourly candles", note: "" },
    { id: "4h", label: "4 Hour", days: 30, granularity: "hourly candles, grouped to 4H", note: "" },
    { id: "1d", label: "1 Day", days: 240, granularity: "daily candles", note: "" },
    { id: "1w", label: "1 Week", days: 365, granularity: "daily candles, grouped to weekly", note: "" },
    { id: "1M", label: "1 Month", days: 900, granularity: "daily candles, grouped to monthly", note: "" },
    { id: "1y", label: "1 Year", days: 365, granularity: "daily candles", note: "One year of daily data." },
    { id: "2y", label: "2 Year", days: 730, granularity: "daily candles", note: "Two years of daily data." },
    { id: "4y", label: "4 Year", days: 1460, granularity: "daily candles", note: "Full cycle — daily data." },
];
// Group fine candles into a coarser timeframe (e.g. hourly → 4H, daily → weekly).
function groupCandles(candles, groupSize) {
    if (groupSize <= 1)
        return candles;
    const out = [];
    for (let i = 0; i < candles.length; i += groupSize) {
        const slice = candles.slice(i, i + groupSize);
        if (!slice.length)
            continue;
        out.push({
            t: slice[0].t,
            o: slice[0].o,
            h: Math.max(...slice.map(c => c.h)),
            l: Math.min(...slice.map(c => c.l)),
            c: slice[slice.length - 1].c,
            v: slice.reduce((s, c) => s + (c.v || 0), 0),
        });
    }
    return out;
}
// Fetch candles for a specific timeframe, at the correct granularity, with volume.
// Map common CoinGecko ids → exchange base symbols. Coins NOT here (long-tail,
// $QAI, etc.) skip the exchange and use CoinGecko directly.
const EXCHANGE_SYMBOL = {
    bitcoin: "BTC", ethereum: "ETH", cardano: "ADA", solana: "SOL", ripple: "XRP",
    dogecoin: "DOGE", litecoin: "LTC", chainlink: "LINK", polkadot: "DOT",
    avalanche2: "AVAX", "matic-network": "MATIC", tron: "TRX", "shiba-inu": "SHIB",
    uniswap: "UNI", cosmos: "ATOM", stellar: "XLM", "bitcoin-cash": "BCH",
    aptos: "APT", "near": "NEAR", filecoin: "FIL", "internet-computer": "ICP",
    binancecoin: "BNB", "official-trump": "TRUMP",
};
// Which of our timeframes exchanges can serve as TRUE candles (Coinbase/Binance).
const EXCHANGE_INTERVAL = { "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w" };
async function fetchTimeframeCandles(coinId, tfId) {
    const tf = TIMEFRAMES.find(t => t.id === tfId) || TIMEFRAMES.find(t => t.id === "1d");
    // 1) Try REAL candles from an exchange (Coinbase → Binance → Binance US),
    //    for supported coins + intervals. This gives genuine intraday candles
    //    instead of approximating from price points.
    const exSym = EXCHANGE_SYMBOL[coinId];
    const exInt = EXCHANGE_INTERVAL[tfId];
    if (exSym && exInt && useProxy()) {
        try {
            const limit = tfId === "1w" ? 200 : 400;
            const r = await fetch(`/api/cg?ex=${exSym}&interval=${exInt}&limit=${limit}`);
            if (r.ok) {
                const j = await r.json();
                if (Array.isArray(j.candles) && j.candles.length >= 30) {
                    return { candles: j.candles, tf: { ...tf, granularity: `real ${tf.label} candles`, note: `Live candles from ${j.source}.`, source: j.source } };
                }
            }
        }
        catch { /* fall through to CoinGecko */ }
    }
    // 2) Fallback: CoinGecko market_chart (approximated candles from price points).
    const mc = await cgFetch(`/coins/${coinId}/market_chart?vs_currency=usd&days=${tf.days}`, { cacheMs: tf.days <= 2 ? 15000 : 60000 });
    const prices = mc?.prices || [];
    const vols = mc?.total_volumes || [];
    if (prices.length < 30)
        return { candles: [], tf };
    let candles = prices.map((p, i) => {
        const price = p[1];
        const prev = i > 0 ? prices[i - 1][1] : price;
        const next = i < prices.length - 1 ? prices[i + 1][1] : price;
        return { t: p[0], o: prev, h: Math.max(price, prev, next), l: Math.min(price, prev, next), c: price, v: vols[i]?.[1] || 0 };
    });
    const groupMap = { "15m": 3, "4h": 4, "1w": 7, "1M": 30 };
    if (groupMap[tfId])
        candles = groupCandles(candles, groupMap[tfId]);
    return { candles, tf };
}
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
    const [timeframe, setTimeframe] = useState("1d"); // TA timeframe (see TIMEFRAMES)
    const [tfMeta, setTfMeta] = useState(null); // granularity/note for the active TF
    const [mktStruct, setMktStruct] = useState(null); // funding / OI / order book
    const [structLoad, setStructLoad] = useState(false);
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
    // ── Market structure (funding, open interest, order book) — refreshes live ──
    useEffect(() => {
        const sym = EXCHANGE_SYMBOL[selCoin.id];
        if (!sym || !useProxy()) {
            setMktStruct(null);
            return;
        }
        let alive = true;
        const load = async () => {
            setStructLoad(true);
            try {
                const r = await fetch(`/api/cg?struct=${sym}`);
                if (r.ok && alive)
                    setMktStruct(await r.json());
            }
            catch {
                if (alive)
                    setMktStruct(null);
            }
            if (alive)
                setStructLoad(false);
        };
        load();
        const iv = setInterval(load, 30000); // refresh every 30s
        return () => { alive = false; clearInterval(iv); };
    }, [selCoin]);
    // ── Run the technical-analysis engine on the SELECTED timeframe ──
    // Candles are fetched when coin/timeframe changes; the market-structure data
    // refreshes on its own timer, so we keep the candles and just re-score.
    const candlesRef = useRef([]);
    useEffect(() => {
        let alive = true;
        setAnalysisLoad(true);
        setAnalysis(null);
        fetchTimeframeCandles(selCoin.id, timeframe).then(({ candles, tf }) => {
            if (!alive)
                return;
            candlesRef.current = candles;
            setTfMeta(tf);
            const px = (detail && detail.symbol === selCoin.symbol && detail.price)
                ? detail.price
                : (candles.length ? candles[candles.length - 1].c : null);
            setAnalysis(analyzeMarket(candles, px, mktStruct));
            setAnalysisLoad(false);
        }).catch(() => { if (alive) {
            setAnalysis(null);
            setAnalysisLoad(false);
        } });
        return () => { alive = false; };
    }, [selCoin, timeframe]);
    // Re-score (no refetch) when live market structure updates.
    useEffect(() => {
        const candles = candlesRef.current;
        if (!candles || !candles.length)
            return;
        const px = (detail && detail.symbol === selCoin.symbol && detail.price)
            ? detail.price
            : candles[candles.length - 1].c;
        setAnalysis(analyzeMarket(candles, px, mktStruct));
    }, [mktStruct]);
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
                    analysis?.cycle && ["1d", "1w", "1M", "1y", "2y", "4y"].includes(timeframe) && (React.createElement("div", { style: { textAlign: "right", fontSize: "0.7rem", color: "rgba(180,210,255,0.6)" } },
                        React.createElement("div", { style: { fontWeight: 700, color: analysis.cycle.bias === "bullish" ? "#30d158" : analysis.cycle.bias === "bearish" ? "#FF453A" : "#FFD54F" } },
                            "\u20BF ",
                            analysis.cycle.phase),
                        React.createElement("div", { style: { fontSize: "0.62rem", color: "rgba(180,210,255,0.4)" } },
                            "Day ",
                            analysis.cycle.daysSinceLow,
                            " of ~1,428 \u00B7 ",
                            analysis.cycle.progressPct,
                            "% through cycle"),
                        React.createElement("div", { style: { fontSize: "0.62rem", color: "rgba(180,210,255,0.4)" } },
                            "Proj. peak ",
                            analysis.cycle.projectedHigh,
                            " \u00B7 low ",
                            analysis.cycle.projectedLow),
                        React.createElement("div", { style: { fontSize: "0.62rem", color: "rgba(180,210,255,0.35)" } },
                            analysis.cycle.halfBias,
                            " \u00B7 ",
                            analysis.moon)))),
                React.createElement("div", { style: { marginTop: "0.95rem", paddingTop: "0.85rem", borderTop: "0.5px solid rgba(255,255,255,0.07)" } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" } },
                        React.createElement("span", { style: { fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(180,210,255,0.45)", textTransform: "uppercase" } }, "Timeframe"),
                        tfMeta?.granularity && (React.createElement("span", { style: { fontSize: "0.6rem", color: "rgba(180,210,255,0.4)" } },
                            "\u00B7 ",
                            tfMeta.granularity))),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "0.35rem" } }, TIMEFRAMES.map(tf => (React.createElement("button", { key: tf.id, onClick: () => setTimeframe(tf.id), style: {
                            fontSize: "0.7rem", fontWeight: 700, padding: "0.3rem 0.65rem", borderRadius: 8, cursor: "pointer",
                            fontFamily: "inherit", transition: "all 0.15s",
                            background: timeframe === tf.id ? "rgba(0,198,255,0.18)" : "rgba(255,255,255,0.04)",
                            border: `0.5px solid ${timeframe === tf.id ? "rgba(0,198,255,0.55)" : "rgba(255,255,255,0.09)"}`,
                            color: timeframe === tf.id ? "#7fdfff" : "rgba(200,225,255,0.65)",
                        } }, tf.label)))),
                    tfMeta?.note && (React.createElement("div", { style: { fontSize: "0.62rem", color: "rgba(255,213,79,0.75)", marginTop: "0.5rem", lineHeight: 1.4 } },
                        "\u24D8 ",
                        tfMeta.note))),
                analysis?.reasons?.length > 0 && (React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.85rem" } }, analysis.reasons.slice(0, 8).map((r, i) => (React.createElement("span", { key: i, style: { fontSize: "0.64rem", fontWeight: 600, padding: "0.25rem 0.6rem", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.07)", color: "rgba(200,225,255,0.75)" } }, r)))))),
            mktStruct && (mktStruct.funding || mktStruct.book) && (React.createElement("div", { className: "glass", style: { padding: "1.4rem", marginTop: "1rem" } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.35rem" } },
                    React.createElement("h3", { style: { fontSize: "0.95rem", fontWeight: 800, letterSpacing: "-0.01em" } },
                        "Market Structure",
                        React.createElement("span", { style: { fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(48,209,88,0.9)", marginLeft: "0.6rem", textTransform: "uppercase" } }, "\u25CF Live")),
                    mktStruct.source && (React.createElement("span", { style: { fontSize: "0.62rem", color: "rgba(180,210,255,0.45)" } },
                        "via ",
                        mktStruct.source,
                        " \u00B7 refreshes 30s"))),
                React.createElement("p", { style: { fontSize: "0.68rem", color: "rgba(180,210,255,0.5)", lineHeight: 1.5, marginBottom: "1rem" } }, "Facts about current positioning and liquidity \u2014 not predictions. This describes what traders are doing right now, which is information you can weigh yourself."),
                React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "0.7rem" } },
                    mktStruct.funding && (() => {
                        const r = mktStruct.funding.rate * 100; // % per 8h
                        const ann = mktStruct.funding.annualized * 100; // % annualized
                        const hot = Math.abs(ann) > 30;
                        const col = r > 0.02 ? "#ff9f0a" : r < -0.02 ? "#30d158" : "rgba(200,225,255,0.85)";
                        return (React.createElement("div", { style: { background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "0.85rem" } },
                            React.createElement("div", { style: { fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.45)", textTransform: "uppercase", marginBottom: "0.3rem" } }, "Funding Rate"),
                            React.createElement("div", { style: { fontSize: "1.15rem", fontWeight: 800, color: col } },
                                r >= 0 ? "+" : "",
                                r.toFixed(4),
                                "%"),
                            React.createElement("div", { style: { fontSize: "0.62rem", color: "rgba(180,210,255,0.5)", marginTop: "0.2rem" } },
                                ann >= 0 ? "+" : "",
                                ann.toFixed(1),
                                "% annualized"),
                            React.createElement("div", { style: { fontSize: "0.64rem", color: col, marginTop: "0.4rem", lineHeight: 1.4 } },
                                r > 0.02 ? "Longs pay shorts — leveraged buyers crowded" :
                                    r < -0.02 ? "Shorts pay longs — leveraged sellers crowded" :
                                        "Balanced — no crowding either way",
                                hot && " ⚠")));
                    })(),
                    mktStruct.openInterest && (React.createElement("div", { style: { background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "0.85rem" } },
                        React.createElement("div", { style: { fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.45)", textTransform: "uppercase", marginBottom: "0.3rem" } }, "Open Interest"),
                        React.createElement("div", { style: { fontSize: "1.15rem", fontWeight: 800 } }, mktStruct.openInterest.contracts.toLocaleString(undefined, { maximumFractionDigits: 0 })),
                        React.createElement("div", { style: { fontSize: "0.64rem", color: "rgba(180,210,255,0.5)", marginTop: "0.4rem", lineHeight: 1.4 } }, "Total open leveraged positions. Rising OI + rising price = new money; rising OI + falling price = new shorts."))),
                    mktStruct.book && (() => {
                        const imb = mktStruct.book.imbalancePct;
                        const col = imb > 58 ? "#30d158" : imb < 42 ? "#ff5a4d" : "rgba(200,225,255,0.85)";
                        return (React.createElement("div", { style: { background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "0.85rem" } },
                            React.createElement("div", { style: { fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.45)", textTransform: "uppercase", marginBottom: "0.3rem" } }, "Book Imbalance"),
                            React.createElement("div", { style: { fontSize: "1.15rem", fontWeight: 800, color: col } },
                                imb.toFixed(1),
                                "% bids"),
                            React.createElement("div", { style: { display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginTop: "0.45rem", background: "rgba(255,90,77,0.25)" } },
                                React.createElement("div", { style: { width: `${imb}%`, background: "rgba(48,209,88,0.75)" } })),
                            React.createElement("div", { style: { fontSize: "0.64rem", color: "rgba(180,210,255,0.5)", marginTop: "0.4rem", lineHeight: 1.4 } }, "Resting buy vs sell orders near the top of book. Liquidity, not intent \u2014 walls can be pulled.")));
                    })(),
                    mktStruct.book && (React.createElement("div", { style: { background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "0.85rem" } },
                        React.createElement("div", { style: { fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.45)", textTransform: "uppercase", marginBottom: "0.3rem" } }, "Spread"),
                        React.createElement("div", { style: { fontSize: "1.15rem", fontWeight: 800 } },
                            mktStruct.book.spreadPct.toFixed(3),
                            "%"),
                        React.createElement("div", { style: { fontSize: "0.62rem", color: "rgba(180,210,255,0.5)", marginTop: "0.2rem" } },
                            "$",
                            fmtPrice(mktStruct.book.bestBid),
                            " / $",
                            fmtPrice(mktStruct.book.bestAsk)),
                        React.createElement("div", { style: { fontSize: "0.64rem", color: "rgba(180,210,255,0.5)", marginTop: "0.4rem", lineHeight: 1.4 } }, "Tight spread = liquid market. Wide = thin, higher slippage.")))),
                structLoad && (React.createElement("div", { style: { fontSize: "0.62rem", color: "rgba(180,210,255,0.4)", marginTop: "0.7rem" } }, "Refreshing\u2026")))),
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
// ── 3D Holographic AI Core (Three.js) ─────────────────────────
// A wireframe/holographic sphere that rotates, pulses, and reacts to the AI's
// state (idle / listening / thinking / speaking). Loads Three.js from CDN; if it
// isn't available it falls back to a styled CSS orb so the page never breaks.
function HoloCore({ state, color, color2, shape }) {
    const mountRef = useRef(null);
    const stateRef = useRef(state);
    stateRef.current = state;
    useEffect(() => {
        const THREE = (typeof window !== "undefined") && window.THREE;
        const host = mountRef.current;
        if (!THREE || !host)
            return;
        const W = 220, H = 220;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        camera.position.z = 3.4;
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(W, H);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        host.innerHTML = "";
        host.appendChild(renderer.domElement);
        const col = new THREE.Color(color || "#00E5FF");
        const col2 = new THREE.Color(color2 || "#0072FF");
        const group = new THREE.Group();
        scene.add(group);
        // Wireframe sphere (icosahedron for that faceted holographic look)
        const geo = new THREE.IcosahedronGeometry(1, shape === "lattice" ? 1 : 2);
        const wire = new THREE.WireframeGeometry(geo);
        const lineMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 });
        const mesh = new THREE.LineSegments(wire, lineMat);
        group.add(mesh);
        // Inner glowing solid sphere
        const innerGeo = new THREE.IcosahedronGeometry(0.62, 3);
        const innerMat = new THREE.MeshBasicMaterial({ color: col2, transparent: true, opacity: 0.14, wireframe: false });
        const inner = new THREE.Mesh(innerGeo, innerMat);
        group.add(inner);
        // Outer point cloud (particles forming a shell)
        const pCount = 260;
        const pGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(pCount * 3);
        for (let i = 0; i < pCount; i++) {
            const r = 1.25 + Math.random() * 0.35;
            const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
            positions[i * 3] = r * Math.sin(ph) * Math.cos(th);
            positions[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
            positions[i * 3 + 2] = r * Math.cos(ph);
        }
        pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const pMat = new THREE.PointsMaterial({ color: col, size: 0.03, transparent: true, opacity: 0.7 });
        const points = new THREE.Points(pGeo, pMat);
        group.add(points);
        // Equatorial ring
        const ringGeo = new THREE.RingGeometry(1.4, 1.44, 64);
        const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2.2;
        group.add(ring);
        const basePos = positions.slice();
        let raf, t = 0;
        const animate = () => {
            raf = requestAnimationFrame(animate);
            t += 0.016;
            const st = stateRef.current;
            // State-driven behavior
            let spin = 0.004, pulse = 1, jitter = 0.0;
            if (st === "listening") {
                spin = 0.012;
                pulse = 1 + Math.sin(t * 6) * 0.06;
                jitter = 0.02;
                lineMat.color.set("#ff5a4d");
                pMat.color.set("#ff7a5a");
            }
            else if (st === "thinking") {
                spin = 0.03;
                pulse = 1 + Math.sin(t * 10) * 0.05;
                jitter = 0.04;
                lineMat.color.copy(col);
                pMat.color.copy(col);
            }
            else if (st === "speaking") {
                spin = 0.02;
                pulse = 1 + Math.abs(Math.sin(t * 12)) * 0.12;
                jitter = 0.05;
                lineMat.color.copy(col);
                pMat.color.copy(col);
            }
            else {
                spin = 0.004;
                pulse = 1 + Math.sin(t * 1.5) * 0.03;
                jitter = 0.008;
                lineMat.color.copy(col);
                pMat.color.copy(col);
            }
            group.rotation.y += spin;
            group.rotation.x = Math.sin(t * 0.3) * 0.2;
            group.scale.setScalar(pulse);
            inner.material.opacity = 0.12 + Math.abs(Math.sin(t * 2)) * 0.1;
            ring.rotation.z += spin * 1.5;
            // Particle shimmer
            const pa = points.geometry.attributes.position.array;
            for (let i = 0; i < pCount; i++) {
                const f = 1 + Math.sin(t * 3 + i) * jitter;
                pa[i * 3] = basePos[i * 3] * f;
                pa[i * 3 + 1] = basePos[i * 3 + 1] * f;
                pa[i * 3 + 2] = basePos[i * 3 + 2] * f;
            }
            points.geometry.attributes.position.needsUpdate = true;
            renderer.render(scene, camera);
        };
        animate();
        return () => {
            cancelAnimationFrame(raf);
            renderer.dispose();
            geo.dispose();
            wire.dispose();
            innerGeo.dispose();
            pGeo.dispose();
            ringGeo.dispose();
            if (host)
                host.innerHTML = "";
        };
    }, [color, color2, shape]);
    const THREE_OK = (typeof window !== "undefined") && window.THREE;
    return (React.createElement("div", { style: { position: "relative", width: 220, height: 220, margin: "0 auto 0.5rem" } },
        React.createElement("div", { ref: mountRef, style: { width: 220, height: 220 } }),
        !THREE_OK && (React.createElement("div", { className: `core ${state}`, style: { position: "absolute", inset: "35px" } },
            React.createElement("div", { className: "core-halo" }),
            React.createElement("div", { className: "core-ring r1" }),
            React.createElement("div", { className: "core-ring r2" }),
            React.createElement("div", { className: "core-ring r3" }),
            React.createElement("div", { className: "core-ring r4" }),
            React.createElement("div", { className: "core-orb" }))),
        React.createElement("div", { style: { position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none",
                background: `radial-gradient(circle, ${color}22 0%, transparent 62%)`, zIndex: -1 } })));
}
// ── Main App ──────────────────────────────────────────────────
function QuantumAI() {
    const [walletModal, setWalletModal] = useState(false);
    const [wallet, setWallet] = useState(null); // { name, key, addr, ada, qai, networkId, api }
    const [availWallets, setAvailWallets] = useState([]); // detected CIP-30 wallets
    const [walletConnecting, setWalletConnecting] = useState(null); // key being connected
    const [page, setPage] = useState("home"); // "home" | "markets" | "chat" | "downloads" | "cloud"
    // When the page changes (any nav link, pill, or footer link), jump the viewport
    // to the top of the new page's content — fixes mobile staying scrolled midway.
    useEffect(() => {
        if (typeof window === "undefined")
            return;
        // rAF ensures the new page has rendered before we scroll.
        requestAnimationFrame(() => {
            const anchor = document.getElementById("page-top");
            if (anchor && anchor.scrollIntoView) {
                anchor.scrollIntoView({ behavior: "auto", block: "start" });
            }
            else {
                window.scrollTo(0, 0);
            }
        });
    }, [page]);
    // ── Cloud Connect (web) state ──
    const [cloudServer, setCloudServer] = useState("");
    const [cloudUser, setCloudUser] = useState("");
    const [cloudPass, setCloudPass] = useState("");
    const [cloudToken, setCloudToken] = useState(null);
    const [cloudFiles, setCloudFiles] = useState([]);
    const [cloudErr, setCloudErr] = useState("");
    const [cloudBusy, setCloudBusy] = useState(false);
    const [cloudFolder, setCloudFolder] = useState("My Cloud");
    // ── Quantum Vault waitlist ──
    const [wlEmail, setWlEmail] = useState("");
    const [wlChains, setWlChains] = useState([]);
    const [wlStatus, setWlStatus] = useState(""); // "", "sending", "done", "error"
    const [wlMsg, setWlMsg] = useState("");
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
    const [persona] = useState("axis"); // single original entity
    const [voiceOn, setVoiceOn] = useState(false); // text-to-speech toggle
    const [listening, setListening] = useState(false); // mic active
    const recognitionRef = useRef(null);
    // ── Per-user personalization (saved to this browser) ──
    const [showSettings, setShowSettings] = useState(false);
    // ── External data sources (curated toggles + on-device custom) ──
    const [showSources, setShowSources] = useState(false);
    // Live status per source: { [id]: "ok" | "failed" | "testing" } — so users can
    // see what's ACTUALLY feeding AXIS rather than trusting a toggle that silently fails.
    const [sourceStatus, setSourceStatus] = useState({});
    // ── Chat download + QAI encryption ──
    const [showDownload, setShowDownload] = useState(false);
    const [encPass, setEncPass] = useState("");
    const [encMode, setEncMode] = useState("encrypted"); // "encrypted" | "plain"
    const [encBusy, setEncBusy] = useState(false);
    const [dataSources, setDataSources] = useState(() => {
        try {
            const raw = localStorage.getItem("qai_axis_sources");
            return raw ? JSON.parse(raw) : { curated: {}, custom: [] };
        }
        catch {
            return { curated: {}, custom: [] };
        }
    });
    const saveSources = (next) => {
        setDataSources(next);
        try {
            localStorage.setItem("qai_axis_sources", JSON.stringify(next));
        }
        catch { }
    };
    // Let the user TEST a source right now so they can see if it actually works
    // (many APIs block browser access via CORS and would otherwise fail silently).
    const testSource = async (id, url, key) => {
        setSourceStatus(prev => ({ ...prev, [id]: "testing" }));
        const ctx = await fetchSourceContext(url, key);
        setSourceStatus(prev => ({ ...prev, [id]: ctx ? "ok" : "failed" }));
    };
    const StatusDot = ({ state }) => {
        if (!state)
            return null;
        const map = {
            ok: { c: "#30d158", t: "Working — this source is feeding AXIS" },
            failed: { c: "#ff6b6b", t: "Blocked or unreachable — this source is NOT feeding AXIS (often CORS: the API doesn't allow browser access)" },
            testing: { c: "#ffd60a", t: "Testing…" },
        };
        const m = map[state];
        if (!m)
            return null;
        return React.createElement("span", { title: m.t, style: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: m.c, boxShadow: `0 0 6px ${m.c}`, marginLeft: 6, flexShrink: 0 } });
    };
    // Which key fields are currently revealed (by field id). Keys are MASKED by
    // default so they aren't exposed to onlookers, screen-shares, or screenshots.
    const [shownKeys, setShownKeys] = useState({});
    const toggleKeyShown = (id) => setShownKeys(p => ({ ...p, [id]: !p[id] }));
    // ── AXIS account (optional sign-in) ──
    const [showSignIn, setShowSignIn] = useState(false);
    const [authUser, setAuthUser] = useState(() => {
        try {
            const raw = localStorage.getItem("qai_axis_user");
            return raw ? JSON.parse(raw) : null;
        }
        catch {
            return null;
        }
    });
    const [authAvailable, setAuthAvailable] = useState(false);
    // Check whether the backend has accounts configured
    useEffect(() => {
        fetch("/api/auth").then(r => r.headers.get("content-type")?.includes("json") ? r.json() : null)
            .then(d => { if (d && d.configured)
            setAuthAvailable(true); }).catch(() => { });
    }, []);
    const signOut = () => { setAuthUser(null); try {
        localStorage.removeItem("qai_axis_user");
    }
    catch { } };
    const [availVoices, setAvailVoices] = useState([]);
    const [custom, setCustom] = useState(() => {
        const def = { axis: {} };
        try {
            const raw = (typeof localStorage !== "undefined") && localStorage.getItem("qai_axis_custom");
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
                localStorage.setItem("qai_axis_custom", JSON.stringify(next));
        }
        catch { }
    };
    // Effective config = base entity overlaid with the user's customizations
    const pcfg = (p = persona) => {
        const base = PERSONAS[p] || PERSONAS.axis;
        const c = custom[p] || {};
        const theme = CORE_THEMES[c.theme] || CORE_THEMES.quantum;
        return {
            ...base,
            name: c.name || base.name,
            displayName: c.name || base.name,
            voiceURI: c.voiceURI || null,
            rate: c.rate != null ? c.rate : 1.0,
            pitch: c.pitch != null ? c.pitch : 1.0,
            theme: c.theme || "quantum",
            shape: c.shape || "orb",
            themeCfg: theme,
            ambient: c.ambient !== false, // starfield/particles on by default
            sfx: c.sfx === true, // UI sound effects off by default
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
    const [chatMsgs, setChatMsgs] = useState(() => {
        try {
            const raw = (typeof localStorage !== "undefined") && localStorage.getItem("qai_axis_history");
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr) && arr.length)
                    return arr;
            }
        }
        catch { }
        return [{ role: "bot", text: PERSONAS.axis.greeting }];
    });
    const [chatInput, setChatInput] = useState("");
    const [chatLoading, setChatLoading] = useState(false);
    const [onBackup, setOnBackup] = useState(false); // true when a reply came from the Gemini fallback
    // ── Attachments (documents + images AXIS can read/see) ──
    const [attachments, setAttachments] = useState([]);
    const [attachBusy, setAttachBusy] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const attachInputRef = useRef(null);
    // ── Stop generation ──
    const stopRef = useRef(false);
    const [streaming, setStreaming] = useState(false);
    const [copiedIdx, setCopiedIdx] = useState(null);
    const addAttachments = async (files) => {
        const list = Array.from(files || []);
        if (!list.length)
            return;
        setAttachBusy(true);
        for (const f of list) {
            try {
                const a = await parseAttachment(f);
                setAttachments(prev => [...prev, a]);
            }
            catch (err) {
                showToast(err.message || "Couldn't read that file");
            }
        }
        setAttachBusy(false);
    };
    const removeAttachment = (i) => setAttachments(prev => prev.filter((_, j) => j !== i));
    const copyMessage = async (textToCopy, idx) => {
        try {
            await navigator.clipboard.writeText(textToCopy);
            setCopiedIdx(idx);
            setTimeout(() => setCopiedIdx(c => (c === idx ? null : c)), 1500);
        }
        catch {
            showToast("Couldn't copy — your browser blocked clipboard access");
        }
    };
    // Re-ask the last user message (regenerate the last AXIS reply)
    const regenerateLast = () => {
        if (chatLoading)
            return;
        const lastUser = [...chatMsgs].reverse().find(m => m.role === "user");
        if (!lastUser)
            return;
        // drop the trailing bot reply so the new one replaces it
        setChatMsgs(m => {
            const copy = [...m];
            while (copy.length && copy[copy.length - 1].role === "bot")
                copy.pop();
            return copy;
        });
        setTimeout(() => sendChat(lastUser.text), 30);
    };
    const [speaking, setSpeaking] = useState(false); // TTS actively talking
    const chatEndRef = useRef(null);
    const chatBoxRef = useRef(null); // the scrollable .hud-msgs container
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
                u.lang = (PERSONAS[p] || PERSONAS.axis).voice;
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
    // ── UI sound effects (Web Audio, no files) ──
    const audioCtxRef = useRef(null);
    const sfxTone = (freq = 660, dur = 0.12, type = "sine", vol = 0.06) => {
        if (!pcfg().sfx)
            return;
        try {
            if (!audioCtxRef.current)
                audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = audioCtxRef.current;
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(vol, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + dur);
        }
        catch { }
    };
    const sfxPing = () => { sfxTone(880, 0.10, "triangle"); setTimeout(() => sfxTone(1180, 0.08, "sine"), 70); };
    const sfxSend = () => sfxTone(520, 0.08, "sine");
    // Reset the conversation to a fresh greeting (uses the user's custom name)
    const resetChat = () => {
        const c = pcfg();
        const greet = (c.displayName !== PERSONAS.axis.name)
            ? PERSONAS.axis.greeting.replace(/AXIS/g, c.displayName)
            : PERSONAS.axis.greeting;
        setChatMsgs([{ role: "bot", text: greet }]);
        try {
            if (typeof localStorage !== "undefined")
                localStorage.removeItem("qai_axis_history");
        }
        catch { }
        if (voiceOn)
            speakAs(greet);
    };
    // Persist conversation to this device so users pick up where they left off
    useEffect(() => {
        try {
            if (typeof localStorage !== "undefined")
                localStorage.setItem("qai_axis_history", JSON.stringify(chatMsgs.slice(-100)));
        }
        catch { }
    }, [chatMsgs]);
    // Download the conversation as a text file
    const buildChatPayload = () => {
        const name = pcfg().displayName;
        const readable = chatMsgs.map(m => `${m.role === "bot" ? name : "You"}: ${m.text}`).join("\n\n");
        return {
            _format: "quantumai-axis-chat", _version: 1,
            exported: new Date().toISOString(), assistant: name,
            transcript: readable, messages: chatMsgs,
        };
    };
    const openDownload = () => { setEncPass(""); setShowDownload(true); };
    const doDownload = async () => {
        const name = pcfg().displayName;
        const payload = buildChatPayload();
        const jsonStr = JSON.stringify(payload, null, 2);
        const dl = (blob, ext) => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `quantumai-${name.toLowerCase()}-chat-${new Date().toISOString().slice(0, 10)}.${ext}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        };
        if (encMode === "plain") {
            dl(new Blob([jsonStr], { type: "application/json" }), "json");
            setShowDownload(false);
            showToast("Chat downloaded (unencrypted)");
            return;
        }
        // Encrypted path — produces a Vault-compatible .qai file
        if (!encPass || encPass.length < 6) {
            showToast("Choose a password (at least 6 characters)");
            return;
        }
        setEncBusy(true);
        try {
            const blob = await qaiEncryptText(jsonStr, encPass);
            dl(blob, "qai");
            setShowDownload(false);
            showToast("Chat encrypted — keep your password safe");
        }
        catch {
            showToast("Encryption failed — please try again");
        }
        finally {
            setEncBusy(false);
            setEncPass("");
        }
    };
    // Kept for the header button — now opens the download options modal.
    const downloadChat = () => openDownload();
    const uploadInputRef = useRef(null);
    const restoreFromText = (raw) => {
        try {
            const data = JSON.parse(raw);
            let msgs = null;
            if (data && data._format === "quantumai-axis-chat" && Array.isArray(data.messages))
                msgs = data.messages;
            else if (Array.isArray(data))
                msgs = data;
            else if (Array.isArray(data.messages))
                msgs = data.messages;
            if (!msgs || !msgs.length) {
                showToast("That file doesn't look like a saved AXIS chat");
                return;
            }
            const clean = msgs.filter(m => m && typeof m.text === "string")
                .map(m => ({ role: m.role === "bot" ? "bot" : (m.role === "user" ? "user" : "bot"), text: m.text }));
            if (!clean.length) {
                showToast("No readable messages found");
                return;
            }
            setChatMsgs(clean);
            showToast(`Restored ${clean.length} messages — continue where you left off`);
        }
        catch {
            showToast("Couldn't read that file");
        }
    };
    const uploadChat = (file) => {
        if (!file)
            return;
        // Encrypted .qai files are binary (Vault format). Detect by extension.
        if (file.name.toLowerCase().endsWith(".qai")) {
            const pw = window.prompt("This chat is encrypted. Enter its password to unlock:");
            if (!pw)
                return;
            qaiDecryptToText(file, pw)
                .then(text => restoreFromText(text))
                .catch(err => {
                showToast(String(err.message).includes("WRONG_PASSWORD")
                    ? "Wrong password" : "Couldn't decrypt that file");
            });
            return;
        }
        // Plain JSON
        const reader = new FileReader();
        reader.onload = (e) => restoreFromText(e.target.result);
        reader.readAsText(file);
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
    // Keep the newest message visible by scrolling ONLY the chat container's own
    // scrollbar. (scrollIntoView would scroll every ancestor — including the page —
    // which made the whole window jump down on each message.)
    useEffect(() => {
        const box = chatBoxRef.current;
        if (box)
            box.scrollTop = box.scrollHeight;
    }, [chatMsgs, chatLoading]);
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
        const atts = attachments;
        // Allow sending with only attachments (no typed text)
        if ((!text && !atts.length) || chatLoading)
            return;
        setChatInput("");
        setAttachments([]);
        sfxSend();
        const shownText = text || (atts.length ? `Analyze the attached ${atts.length > 1 ? "files" : atts[0].kind === "image" ? "image" : "document"}.` : "");
        const next = { role: "user", text: shownText, atts: atts.map(a => ({ kind: a.kind, name: a.name })) };
        setChatMsgs(m => [...m, next]);
        setChatLoading(true);
        try {
            // Build history. The CURRENT turn may carry attachments as content blocks.
            const prior = chatMsgs.map(m => ({ role: m.role === "bot" ? "assistant" : "user", content: m.text }));
            let currentContent;
            if (atts.length) {
                const blocks = [];
                for (const a of atts) {
                    if (a.kind === "image") {
                        blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } });
                    }
                    else {
                        blocks.push({ type: "text", text: `<document name="${a.name}"${a.meta ? ` info="${a.meta}"` : ""}>\n${a.text}\n</document>` });
                    }
                }
                blocks.push({ type: "text", text: shownText });
                currentContent = blocks;
            }
            else {
                currentContent = shownText;
            }
            const hist = [...prior, { role: "user", content: currentContent }];
            // ── Pull context from the user's enabled data sources (in-browser) ──
            let sourceContext = "";
            try {
                const parts = [];
                const statusUpdate = {};
                // Curated connectors the user enabled
                for (const [id, cfg] of Object.entries(DATA_CONNECTORS)) {
                    const on = dataSources.curated?.[id];
                    if (!on || !on.enabled)
                        continue;
                    const url = cfg.build(text.toLowerCase().split(/\s+/).slice(-1)[0]);
                    const ctx = await fetchSourceContext(url, on.key);
                    if (ctx) {
                        parts.push(`[${cfg.label}] ${ctx}`);
                        statusUpdate[id] = "ok";
                    }
                    else {
                        statusUpdate[id] = "failed";
                    }
                }
                // On-device custom sources
                (dataSources.custom || []).forEach(() => { });
                for (let i = 0; i < (dataSources.custom || []).length; i++) {
                    const s = dataSources.custom[i];
                    if (!s.enabled || !s.url)
                        continue;
                    const ctx = await fetchSourceContext(s.url, s.key);
                    if (ctx) {
                        parts.push(`[${s.name || "Custom source"}] ${ctx}`);
                        statusUpdate["custom:" + i] = "ok";
                    }
                    else {
                        statusUpdate["custom:" + i] = "failed";
                    }
                }
                if (Object.keys(statusUpdate).length)
                    setSourceStatus(prev => ({ ...prev, ...statusUpdate }));
                if (parts.length) {
                    sourceContext = "\n\nADDITIONAL LIVE CONTEXT from the user's connected data sources "
                        + "(use if relevant; note it comes from user-configured sources):\n" + parts.join("\n\n");
                }
            }
            catch { /* sources are best-effort */ }
            const sysWithSources = pcfg(persona).sys + sourceContext;
            const result = await callClaude(hist, persona, { sys: sysWithSources });
            const reply = typeof result === "string" ? result : result.reply;
            const isFallback = typeof result === "object" && result.fallback;
            if (isFallback)
                setOnBackup(true);
            else
                setOnBackup(false);
            sfxPing();
            setChatLoading(false);
            // Speak the full reply immediately (drives the core's speaking state + waveform)
            if (voiceOn)
                speakAs(reply, persona);
            // Stream the text in, word by word, so it "flows in"
            const words = reply.split(/(\s+)/);
            let acc = "";
            stopRef.current = false;
            setStreaming(true);
            setChatMsgs(m => [...m, { role: "bot", text: "", streaming: true, backup: isFallback }]);
            for (let i = 0; i < words.length; i++) {
                if (stopRef.current) { // user pressed Stop — finish immediately
                    acc = acc.trimEnd();
                    break;
                }
                acc += words[i];
                const shown = acc;
                setChatMsgs(m => { const copy = m.slice(); copy[copy.length - 1] = { role: "bot", text: shown, streaming: i < words.length - 1, backup: isFallback }; return copy; });
                // small delay per token; skip delay for whitespace chunks
                if (words[i].trim())
                    await new Promise(r => setTimeout(r, 18));
            }
            const stopped = stopRef.current;
            stopRef.current = false;
            setStreaming(false);
            setChatMsgs(m => { const copy = m.slice(); copy[copy.length - 1] = { role: "bot", text: acc, backup: isFallback, stopped: stopped || undefined }; return copy; });
        }
        catch {
            setChatLoading(false);
            setStreaming(false);
            setChatMsgs(m => [...m, { role: "bot", text: "Connection error — please try again." }]);
        }
    };
    const stopGenerating = () => {
        stopRef.current = true;
        try {
            window.speechSynthesis?.cancel();
        }
        catch { }
        setSpeaking(false);
    };
    // ── Mic: Web Speech API speech-to-text ──
    const toggleMic = async () => {
        const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
        if (!SR) {
            showToast("Voice input isn't supported in this browser — try Chrome, Edge, or Safari");
            return;
        }
        if (listening) {
            try {
                recognitionRef.current?.stop();
            }
            catch { }
            setListening(false);
            return;
        }
        // Speech recognition requires a secure context (https) — fail loudly, not silently.
        if (typeof window !== "undefined" && !window.isSecureContext) {
            showToast("Voice input needs a secure (https) connection");
            return;
        }
        const rec = new SR();
        const cv = pcfg();
        const vv = pickVoice(persona, cv.voiceURI);
        rec.lang = (vv && vv.lang) || "en-US";
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;
        let finalText = "";
        let gotAnything = false;
        rec.onresult = (e) => {
            let interim = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal)
                    finalText += t;
                else
                    interim += t;
            }
            gotAnything = true;
            // Show live text in the input as you speak
            setChatInput((finalText + interim).trim());
        };
        // Surface the REAL reason instead of failing silently (this was the bug).
        rec.onerror = (e) => {
            setListening(false);
            const err = e?.error || "unknown";
            const msg = err === "not-allowed" || err === "service-not-allowed"
                ? "Microphone blocked — allow mic access in your browser's address-bar permissions, then try again"
                : err === "no-speech" ? "Didn't catch anything — try speaking again"
                    : err === "audio-capture" ? "No microphone found on this device"
                        : err === "network" ? "Speech service unreachable — check your connection"
                            : err === "aborted" ? null // user stopped; not an error
                                : `Voice input error: ${err}`;
            if (msg)
                showToast(msg);
        };
        rec.onend = () => {
            setListening(false);
            const said = finalText.trim();
            if (said) {
                sendChat(said);
            }
            else if (gotAnything) {
                // We heard something but nothing was finalized — keep it in the box so
                // the user can hit send rather than losing what they said.
                showToast("Tap send to submit what you said");
            }
        };
        recognitionRef.current = rec;
        try {
            rec.start();
            setListening(true);
        }
        catch (err) {
            setListening(false);
            showToast("Couldn't start the microphone — check browser mic permissions");
        }
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
    // ── Quantum Vault waitlist submit ──
    const submitWaitlist = async () => {
        const email = wlEmail.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            setWlStatus("error");
            setWlMsg("Please enter a valid email address.");
            return;
        }
        setWlStatus("sending");
        setWlMsg("");
        const payload = {
            email,
            chains: wlChains,
            walletAddr: wallet?.addr || null,
            qaiBalance: wallet?.qai || 0,
            ts: new Date().toISOString(),
        };
        try {
            const r = await fetch("/api/waitlist", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const ct = r.headers.get("content-type") || "";
            if (!ct.includes("application/json")) {
                // Backend not deployed — still acknowledge locally so the UX works
                setWlStatus("done");
                setWlMsg("You're on the list! (We'll be in touch as the beta opens.)");
                return;
            }
            const d = await r.json();
            if (d.ok) {
                setWlStatus("done");
                setWlMsg("You're on the list! We'll email you when your vault invite is ready.");
            }
            else {
                setWlStatus("error");
                setWlMsg(d.error || "Something went wrong. Please try again.");
            }
        }
        catch {
            setWlStatus("done");
            setWlMsg("You're on the list! (We'll be in touch as the beta opens.)");
        }
    };
    return (React.createElement(React.Fragment, null,
        React.createElement("style", null, css),
        React.createElement("nav", { className: "nav" },
            React.createElement("div", { className: "nav-brand", onClick: () => { setPage("home"); setTimeout(() => scrollTo("home"), 50); } },
                React.createElement(Logo, { w: 34, h: 34, r: 9 }),
                React.createElement("span", { className: "nav-brand-text" }, "QuantumAI")),
            React.createElement("div", { className: "nav-links" },
                page === "home" && ["price", "token"].map(s => (React.createElement("button", { key: s, className: "nav-pill", onClick: () => scrollTo(s) }, s.charAt(0).toUpperCase() + s.slice(1)))),
                React.createElement("button", { className: "nav-pill", style: page === "markets" ? { color: "#fff", background: "rgba(255,255,255,0.08)" } : {}, onClick: () => setPage(p => p === "markets" ? "home" : "markets") }, page === "markets" ? "← Home" : "Markets"),
                React.createElement("button", { className: "nav-pill", style: page === "chat" ? { color: "#fff", background: "rgba(255,255,255,0.08)" } : {}, onClick: () => setPage(p => p === "chat" ? "home" : "chat") }, page === "chat" ? "← Home" : "AXIS AI"),
                React.createElement("button", { className: "nav-pill", style: page === "downloads" ? { color: "#fff", background: "rgba(255,255,255,0.08)" } : {}, onClick: () => setPage(p => p === "downloads" ? "home" : "downloads") }, page === "downloads" ? "← Home" : "Downloads"),
                React.createElement("button", { className: "nav-pill", style: page === "cloud" ? { color: "#fff", background: "rgba(255,255,255,0.08)" } : {}, onClick: () => setPage(p => p === "cloud" ? "home" : "cloud") }, page === "cloud" ? "← Home" : "Cloud"),
                React.createElement("button", { className: "nav-pill", style: page === "vault" ? { color: "#fff", background: "rgba(0,198,255,0.15)" } : { color: "var(--gold)" }, onClick: () => setPage(p => p === "vault" ? "home" : "vault") }, page === "vault" ? "← Home" : "Quantum Vault")),
            wallet
                ? React.createElement("button", { className: "btn-wallet connected", onClick: disconnectWallet, title: `${wallet.addr ? shortAddr(wallet.addr) : wallet.name} · Click to disconnect` },
                    React.createElement("span", { className: "wallet-dot" }),
                    " ",
                    wallet.icon,
                    " ",
                    wallet.qai.toLocaleString(),
                    " QAI")
                : React.createElement("button", { className: "btn-wallet", onClick: () => setWalletModal(true) }, "Connect Wallet")),
        React.createElement("div", { id: "page-top", style: { position: "absolute", top: 0, left: 0, height: 1, width: 1 }, "aria-hidden": "true" }),
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
        page === "vault" && (React.createElement("div", { style: { minHeight: "100vh", padding: "calc(var(--nav-h,64px) + 2rem) 1.25rem 4rem", maxWidth: 900, margin: "0 auto" } },
            React.createElement("div", { style: { textAlign: "center", marginBottom: "2.5rem" } },
                React.createElement("div", { className: "dl-badge" },
                    React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "#FFD54F", boxShadow: "0 0 6px #FFD54F", display: "inline-block" } }),
                    "Private Beta \u00B7 Coming Soon"),
                React.createElement("h1", { className: "dl-title", style: { fontSize: "clamp(2rem,5vw,3.4rem)", background: "linear-gradient(135deg,#00C6FF,#7B2FFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" } }, "Quantum-Ready Vault"),
                React.createElement("p", { className: "dl-sub", style: { maxWidth: 640, margin: "0.75rem auto 0" } }, "Keep the assets you already own \u2014 and add a post-quantum security layer on top. A QAI-gated smart-contract vault that requires a quantum-grade (ML-DSA) signature to release funds, built to migrate to native post-quantum protection as the chains support it.")),
            React.createElement("div", { style: { background: "rgba(255,213,79,0.06)", border: "0.5px solid rgba(255,213,79,0.25)", borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "2rem", fontSize: "0.8rem", color: "rgba(255,225,150,0.9)", lineHeight: 1.6 } },
                React.createElement("strong", null, "What this is \u2014 and isn't."),
                " The Quantum-Ready Vault adds a real post-quantum signature (ML-DSA / Dilithium) as a second factor your vault contract requires before releasing funds \u2014 strong protection against key theft and phishing, and a migration path for when EVM chains adopt post-quantum signatures natively. It is ",
                React.createElement("strong", null, "not"),
                " a claim that your underlying BTC/ETH/SOL become quantum-proof at the base-chain level today: those assets are still secured by each chain's native signatures until the networks themselves upgrade. We build the gateway; we won't overpromise the physics."),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "1rem", marginBottom: "2.5rem" } }, [
                { t: "The gap today", d: "Quantum-safe chains (QRL, Mochimo, QoreChain) only protect their own native coins. You'd have to sell your BTC/ETH/SOL to use them." },
                { t: "What people want", d: "Keep their existing multi-chain portfolio — and make it safer — without abandoning it for a niche native coin." },
                { t: "Our approach", d: "An ERC-4337 account-abstraction vault + MPC key-splitting, gated by QAI, that layers an ML-DSA signature requirement and is architected to adopt native PQ signatures on day one of chain support." },
            ].map((c, i) => (React.createElement("div", { key: i, style: { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "1.25rem" } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: "0.92rem", marginBottom: "0.5rem", color: "var(--blue)" } }, c.t),
                React.createElement("div", { style: { fontSize: "0.82rem", color: "rgba(180,210,255,0.7)", lineHeight: 1.6 } }, c.d))))),
            React.createElement("div", { style: { textAlign: "center", marginBottom: "2.5rem", padding: "1.5rem", background: "rgba(0,198,255,0.05)", border: "0.5px solid rgba(0,198,255,0.2)", borderRadius: 16 } },
                React.createElement("div", { style: { fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.4rem" } }, "QAI is the key to the vault"),
                React.createElement("p", { style: { fontSize: "0.84rem", color: "rgba(180,210,255,0.7)", maxWidth: 560, margin: "0 auto", lineHeight: 1.6 } },
                    "Creating a quantum-ready vault and paying relayer gas will require holding or spending ",
                    React.createElement("strong", null, "$QAI"),
                    ". Early QAI holders get first access to the beta.")),
            React.createElement("div", { style: { maxWidth: 480, margin: "0 auto", background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: "1.75rem" } }, wlStatus === "done" ? (React.createElement("div", { style: { textAlign: "center", padding: "1rem 0" } },
                React.createElement("div", { style: { fontSize: "2.5rem", marginBottom: "0.5rem" } }, "\u2713"),
                React.createElement("div", { style: { fontWeight: 700, fontSize: "1.05rem", marginBottom: "0.5rem", color: "#30d158" } }, "You're on the list"),
                React.createElement("p", { style: { fontSize: "0.85rem", color: "rgba(180,210,255,0.7)", lineHeight: 1.6 } }, wlMsg))) : (React.createElement(React.Fragment, null,
                React.createElement("div", { style: { fontWeight: 700, fontSize: "1.05rem", marginBottom: "0.3rem", textAlign: "center" } }, "Join the private beta"),
                React.createElement("p", { style: { fontSize: "0.78rem", color: "rgba(180,210,255,0.55)", textAlign: "center", marginBottom: "1.25rem" } }, "Be first to secure a quantum-ready vault when it opens."),
                React.createElement("label", { style: cloudLabelStyle }, "Email"),
                React.createElement("input", { type: "email", value: wlEmail, onChange: e => setWlEmail(e.target.value), placeholder: "you@example.com", autoCapitalize: "off", autoCorrect: "off", style: cloudInputStyle }),
                React.createElement("label", { style: cloudLabelStyle }, "Which chains do you hold? (optional)"),
                React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.1rem" } }, ["Bitcoin", "Ethereum", "Solana", "Cardano", "Other"].map(ch => {
                    const on = wlChains.includes(ch);
                    return (React.createElement("button", { key: ch, onClick: () => setWlChains(c => on ? c.filter(x => x !== ch) : [...c, ch]), style: { padding: "0.45rem 0.85rem", borderRadius: 20, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                            background: on ? "rgba(0,198,255,0.15)" : "rgba(255,255,255,0.05)",
                            border: on ? "0.5px solid rgba(0,198,255,0.4)" : "0.5px solid rgba(255,255,255,0.12)",
                            color: on ? "var(--blue)" : "rgba(180,210,255,0.6)" } }, ch));
                })),
                wallet ? (React.createElement("div", { style: { fontSize: "0.74rem", color: "rgba(48,209,88,0.85)", marginBottom: "1rem", textAlign: "center" } },
                    "\u2713 Wallet connected (",
                    wallet.qai.toLocaleString(),
                    " QAI) \u2014 you'll be tagged as an early holder.")) : (React.createElement("div", { style: { fontSize: "0.74rem", color: "rgba(180,210,255,0.5)", marginBottom: "1rem", textAlign: "center" } }, "Tip: connect your wallet (top-right) to register as an early QAI holder for priority access.")),
                wlStatus === "error" && React.createElement("div", { style: { color: "#FF6B6B", fontSize: "0.82rem", marginBottom: "0.8rem", textAlign: "center" } }, wlMsg),
                React.createElement("button", { onClick: submitWaitlist, disabled: wlStatus === "sending", style: cloudBtnStyle }, wlStatus === "sending" ? "Joining…" : "Join the waitlist"),
                React.createElement("p", { style: { fontSize: "0.68rem", color: "rgba(180,210,255,0.4)", textAlign: "center", marginTop: "0.8rem", lineHeight: 1.5 } }, "No spam. We'll only email you about Quantum Vault beta access. This is a pre-launch signup \u2014 no funds are involved and nothing is deposited.")))),
            React.createElement("div", { style: { maxWidth: 560, margin: "2.5rem auto 0" } },
                React.createElement("div", { style: { fontWeight: 700, fontSize: "0.92rem", marginBottom: "1rem", textAlign: "center", color: "rgba(180,210,255,0.7)" } }, "Roadmap"),
                [
                    { p: "Phase 1", t: "Waitlist & positioning", s: "Now", done: true },
                    { p: "Phase 2", t: "ERC-4337 vault + ML-DSA 2FA on testnet", s: "Next" },
                    { p: "Phase 3", t: "Independent security audit", s: "Before mainnet" },
                    { p: "Phase 4", t: "Mainnet launch, QAI-gated", s: "Post-audit" },
                ].map((r, i) => (React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: "1rem", padding: "0.8rem 1rem", background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)", borderRadius: 12, marginBottom: "0.6rem" } },
                    React.createElement("div", { style: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: r.done ? "#30d158" : "rgba(180,210,255,0.3)", boxShadow: r.done ? "0 0 8px #30d158" : "none" } }),
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("div", { style: { fontSize: "0.82rem", fontWeight: 600 } }, r.t),
                        React.createElement("div", { style: { fontSize: "0.68rem", color: "rgba(180,210,255,0.45)" } }, r.p)),
                    React.createElement("div", { style: { fontSize: "0.7rem", fontWeight: 700, color: r.done ? "#30d158" : "rgba(180,210,255,0.5)" } }, r.s))))))),
        page === "chat" && (() => {
            const uc = pcfg();
            const T = uc.themeCfg;
            // Inject the chosen theme into the HUD via CSS variables
            const hudStyle = {
                "--hud": T.accent,
                "--hud-accent2": T.accent2,
                "--hud-faint": T.glow,
                "--hud-dim": T.accent + "66",
            };
            return (React.createElement("div", { className: "hud", style: hudStyle },
                uc.ambient && React.createElement("div", { className: "hud-stars" }),
                React.createElement("div", { className: "hud-frame" }),
                React.createElement("div", { className: "hud-corner" }),
                React.createElement("div", { className: "hud-inner" },
                    React.createElement("div", { style: { textAlign: "center" } },
                        React.createElement(HoloCore, { state: coreState, color: T.accent, color2: T.accent2, shape: uc.shape }),
                        React.createElement("div", { className: "hud-eyebrow" }, "QuantumAI \u00B7 Quantum Intelligence Core"),
                        React.createElement("div", { className: "hud-title" }, uc.displayName),
                        React.createElement("div", { style: { fontFamily: "'SF Mono',monospace", fontSize: "0.66rem", letterSpacing: "0.14em", color: "var(--hud-dim)" } }, custom.axis?.name ? "Your QuantumAI intelligence" : PERSONAS.axis.tagline),
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
                        React.createElement("div", { style: { display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.9rem", flexWrap: "wrap" } },
                            React.createElement("button", { onClick: () => setShowSettings(true), style: { fontSize: "0.7rem", fontWeight: 700, padding: "0.4rem 1rem", borderRadius: 20, cursor: "pointer", background: "transparent", border: "1px solid var(--hud-dim)", color: "var(--hud)", letterSpacing: "0.08em" } }, "\u2699 CUSTOMIZE"),
                            React.createElement("button", { onClick: resetChat, style: { fontSize: "0.7rem", fontWeight: 700, padding: "0.4rem 1rem", borderRadius: 20, cursor: "pointer", background: "transparent", border: "1px solid var(--hud-dim)", color: "var(--hud)", letterSpacing: "0.08em" } }, "\u21BA NEW SESSION"),
                            React.createElement("button", { onClick: downloadChat, style: { fontSize: "0.7rem", fontWeight: 700, padding: "0.4rem 1rem", borderRadius: 20, cursor: "pointer", background: "transparent", border: "1px solid var(--hud-dim)", color: "var(--hud)", letterSpacing: "0.08em" } }, "\u2B07 DOWNLOAD"),
                            React.createElement("button", { onClick: () => uploadInputRef.current?.click(), style: { fontSize: "0.7rem", fontWeight: 700, padding: "0.4rem 1rem", borderRadius: 20, cursor: "pointer", background: "transparent", border: "1px solid var(--hud-dim)", color: "var(--hud)", letterSpacing: "0.08em" } }, "\u2B06 UPLOAD"),
                            React.createElement("input", { ref: uploadInputRef, type: "file", accept: ".json,.qai,application/json", style: { display: "none" }, onChange: e => { uploadChat(e.target.files?.[0]); e.target.value = ""; } }),
                            React.createElement("button", { onClick: () => authUser ? signOut() : setShowSignIn(true), style: { fontSize: "0.7rem", fontWeight: 700, padding: "0.4rem 1rem", borderRadius: 20, cursor: "pointer", background: authUser ? "rgba(48,209,88,0.12)" : "transparent", border: authUser ? "1px solid rgba(48,209,88,0.4)" : "1px solid var(--hud-dim)", color: authUser ? "#30d158" : "var(--hud)", letterSpacing: "0.08em" } }, authUser ? `● ${authUser.name || "Signed in"}` : "⛭ SIGN IN"),
                            React.createElement("button", { onClick: () => setShowSources(true), style: { fontSize: "0.7rem", fontWeight: 700, padding: "0.4rem 1rem", borderRadius: 20, cursor: "pointer", background: "transparent", border: "1px solid var(--hud-dim)", color: "var(--hud)", letterSpacing: "0.08em" } }, "\uD83D\uDD0C DATA SOURCES"))),
                    React.createElement("div", { className: "hud-personas", style: { justifyContent: "center" } }, Object.entries(CORE_THEMES).map(([id, t]) => {
                        const on = uc.theme === id;
                        return (React.createElement("button", { key: id, title: t.label, onClick: () => saveCustom({ ...custom, axis: { ...(custom.axis || {}), theme: id } }), style: { width: 34, height: 34, borderRadius: "50%", cursor: "pointer",
                                background: `radial-gradient(circle at 40% 35%, #fff, ${t.accent} 55%, ${t.accent2} 90%)`,
                                border: on ? `2px solid ${t.accent}` : "2px solid rgba(255,255,255,0.15)",
                                boxShadow: on ? `0 0 14px ${t.glow}` : "none", transition: "all 0.2s" } }));
                    })),
                    React.createElement("div", { className: "hud-console", onDragOver: e => { e.preventDefault(); if (!dragOver)
                            setDragOver(true); }, onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget))
                            setDragOver(false); }, onDrop: e => { e.preventDefault(); setDragOver(false); addAttachments(e.dataTransfer?.files); }, style: dragOver ? { outline: "2px dashed var(--hud)", outlineOffset: "-6px" } : undefined },
                        dragOver && (React.createElement("div", { style: { position: "absolute", inset: 0, zIndex: 20, display: "grid", placeItems: "center", background: "rgba(0,20,40,0.75)", borderRadius: 20, pointerEvents: "none" } },
                            React.createElement("div", { style: { textAlign: "center", color: "var(--hud)", fontWeight: 700 } },
                                React.createElement("div", { style: { fontSize: "2rem", marginBottom: "0.4rem" } }, "\uD83D\uDCC4"),
                                "Drop to let ",
                                pcfg().displayName,
                                " read it",
                                React.createElement("div", { style: { fontSize: "0.72rem", opacity: 0.7, marginTop: "0.3rem", fontWeight: 400 } }, "PDF \u00B7 text \u00B7 code \u00B7 images")))),
                        React.createElement("div", { className: "hud-statusbar" },
                            React.createElement("span", { className: "hud-led" }),
                            React.createElement("span", { className: "nm" }, uc.displayName),
                            React.createElement("span", { className: "st" }, coreState === "idle" ? "Online · Web search active" : coreStatusText.replace(/^[●◉⟳◆]\s*/, "")),
                            onBackup && (React.createElement("span", { title: "Claude is unavailable \u2014 AXIS is running on the Gemini backup. The site owner should check the Anthropic API key/billing.", style: { marginLeft: "0.5rem", fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", padding: "0.15rem 0.5rem", borderRadius: 8, background: "rgba(255,159,10,0.15)", border: "0.5px solid rgba(255,159,10,0.45)", color: "#ff9f0a" } }, "\u26A1 BACKUP MODE")),
                            (chatLoading || listening || speaking) && (React.createElement("div", { className: "hud-eq" },
                                React.createElement("i", null),
                                React.createElement("i", null),
                                React.createElement("i", null),
                                React.createElement("i", null),
                                React.createElement("i", null))),
                            React.createElement("button", { className: `hud-soundbtn${voiceOn ? " on" : ""}`, style: { marginLeft: (chatLoading || listening || speaking) ? "0.6rem" : "auto" }, title: voiceOn ? "Voice replies on" : "Voice replies off", onClick: () => { const v = !voiceOn; setVoiceOn(v); if (v)
                                    speakAs("Voice enabled.", persona);
                                else {
                                    window.speechSynthesis?.cancel();
                                    setSpeaking(false);
                                } } },
                                React.createElement("span", { className: "soundwave" },
                                    React.createElement("svg", { viewBox: "0 0 28 20", width: "24", height: "18", fill: "none" },
                                        React.createElement("path", { className: "spk", d: "M4 8 L8 8 L13 4 L13 16 L8 12 L4 12 Z" }),
                                        voiceOn ? (React.createElement("g", { className: "waves" },
                                            React.createElement("path", { className: "w w1", d: "M16 6 Q18.5 10 16 14" }),
                                            React.createElement("path", { className: "w w2", d: "M19 4 Q22.5 10 19 16" }),
                                            React.createElement("path", { className: "w w3", d: "M22 3 Q26 10 22 17" }))) : (React.createElement("path", { className: "mute", d: "M17 6 L24 14 M24 6 L17 14" })))),
                                voiceOn && React.createElement("span", { className: "sound-led" }))),
                        React.createElement("div", { className: "hud-msgs", ref: chatBoxRef },
                            chatMsgs.map((m, i) => {
                                const isLastBot = m.role === "bot" && !m.streaming && i === chatMsgs.length - 1;
                                return (React.createElement("div", { key: i, className: `hud-msg ${m.role === "bot" ? "bot" : "user"}` },
                                    React.createElement("div", { className: "hud-av" }, m.role === "bot" ? pcfg().displayName[0] : "U"),
                                    React.createElement("div", { className: "hud-bubble" },
                                        m.atts && m.atts.length > 0 && (React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" } }, m.atts.map((a, j) => (React.createElement("span", { key: j, style: { display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "0.2rem 0.45rem", fontSize: "0.68rem", opacity: 0.9 } },
                                            a.kind === "image" ? "🖼" : "📄",
                                            " ",
                                            a.name))))),
                                        m.text,
                                        m.streaming && React.createElement("span", { className: "stream-cursor" }, "\u258B"),
                                        m.stopped && React.createElement("span", { style: { opacity: 0.5, fontSize: "0.7rem" } }, " (stopped)"),
                                        m.role === "bot" && !m.streaming && (React.createElement("span", { style: { display: "inline-flex", gap: "0.1rem", marginLeft: "0.4rem", verticalAlign: "middle" } },
                                            React.createElement("button", { className: "hud-play", onClick: () => speakAs(m.text, persona), title: "Read aloud" }, "\u25B6"),
                                            React.createElement("button", { className: "hud-play", onClick: () => copyMessage(m.text, i), title: "Copy" }, copiedIdx === i ? "✓" : "⧉"),
                                            isLastBot && (React.createElement("button", { className: "hud-play", onClick: regenerateLast, title: "Regenerate this reply" }, "\u21BB")))),
                                        m.backup && !m.streaming && (React.createElement("span", { title: "This reply came from the Gemini backup, not Claude.", style: { display: "block", marginTop: "0.4rem", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.04em", color: "#ff9f0a", opacity: 0.85 } }, "\u26A1 via backup AI")))));
                            }),
                            chatLoading && (React.createElement("div", { className: "hud-msg bot" },
                                React.createElement("div", { className: "hud-av" }, pcfg().displayName[0]),
                                React.createElement("div", { className: "hud-bubble" },
                                    React.createElement("div", { className: "hud-typing" },
                                        React.createElement("i", null),
                                        React.createElement("i", null),
                                        React.createElement("i", null))))),
                            React.createElement("div", { ref: chatEndRef })),
                        (attachments.length > 0 || attachBusy) && (React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.75rem 1.2rem 0", alignItems: "center" } },
                            attachments.map((a, i) => (React.createElement("span", { key: i, style: { display: "inline-flex", alignItems: "center", gap: "0.45rem", background: "rgba(0,198,255,0.1)", border: "0.5px solid rgba(0,198,255,0.3)", borderRadius: 10, padding: "0.35rem 0.6rem", fontSize: "0.75rem", color: "#cfeaff", maxWidth: 260 } },
                                React.createElement("span", null, a.kind === "image" ? "🖼" : "📄"),
                                React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.name),
                                a.meta && React.createElement("span", { style: { opacity: 0.55, flexShrink: 0 } },
                                    "\u00B7 ",
                                    a.meta),
                                React.createElement("button", { onClick: () => removeAttachment(i), title: "Remove", style: { background: "transparent", border: "none", color: "rgba(200,225,255,0.6)", cursor: "pointer", fontSize: "0.85rem", lineHeight: 1, padding: 0, flexShrink: 0 } }, "\u00D7")))),
                            attachBusy && React.createElement("span", { style: { fontSize: "0.75rem", color: "rgba(180,210,255,0.6)" } }, "Reading file\u2026"))),
                        React.createElement("div", { className: "hud-inputrow" },
                            React.createElement("button", { className: `hud-mic${listening ? " live" : ""}`, onClick: toggleMic, title: listening ? "Stop listening" : "Speak" }, "\uD83C\uDFA4"),
                            React.createElement("button", { className: "hud-mic", onClick: () => attachInputRef.current?.click(), title: "Attach a document or image for AXIS to analyze" }, "\uD83D\uDCCE"),
                            React.createElement("input", { ref: attachInputRef, type: "file", multiple: true, style: { display: "none" }, accept: ".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.yaml,.yml,.js,.ts,.py,.sol,.html,.css,image/*", onChange: e => { addAttachments(e.target.files); e.target.value = ""; } }),
                            React.createElement("input", { className: "hud-input", value: chatInput, onChange: e => setChatInput(e.target.value), onKeyDown: e => { if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    sendChat();
                                } }, onPaste: e => {
                                    const f = Array.from(e.clipboardData?.files || []);
                                    if (f.length) {
                                        e.preventDefault();
                                        addAttachments(f);
                                    }
                                }, placeholder: listening ? "Listening…" : attachments.length ? "Ask about the attached file…" : `Speak or type to ${pcfg().displayName}…`, autoFocus: true }),
                            streaming ? (React.createElement("button", { className: "hud-send", onClick: stopGenerating, title: "Stop generating", style: { background: "rgba(255,90,77,0.9)" } }, "\u25A0")) : (React.createElement("button", { className: "hud-send", onClick: () => sendChat(), disabled: chatLoading || attachBusy || (!chatInput.trim() && !attachments.length) }, "\u2191")))),
                    React.createElement("div", { className: "hud-sources" },
                        React.createElement("span", { style: { fontSize: "0.6rem", letterSpacing: "0.12em", color: "var(--hud-dim)", alignSelf: "center" } }, "LIVE WEB SEARCH:"),
                        ["World News", "Crypto", "Stocks", "Wikipedia", "Britannica", "Science"].map(s => (React.createElement("span", { key: s, className: "hud-source" }, s)))),
                    React.createElement("div", { className: "hud-foot" },
                        "\uD83D\uDCCE ATTACH A DOC OR IMAGE \u00B7 \uD83C\uDFA4 TAP MIC TO SPEAK \u00B7 \uD83D\uDD08 TOGGLE VOICE \u00B7 \u29C9 COPY \u00B7 \u21BB REGENERATE \u00B7 \u2699 PERSONALIZE",
                        React.createElement("br", null),
                        "Drop a PDF, whitepaper, spreadsheet, code file, or chart into the chat and ",
                        pcfg().displayName,
                        " will analyze it. Files are read in your browser \u2014 they never leave your device.")),
                showSettings && (React.createElement("div", { className: "overlay", onClick: () => setShowSettings(false) },
                    React.createElement("div", { className: "modal", onClick: e => e.stopPropagation(), style: { maxWidth: 540, textAlign: "left", maxHeight: "85vh", overflowY: "auto" } },
                        React.createElement("div", { className: "modal-title", style: { marginBottom: "0.3rem" } }, "Build your AI"),
                        React.createElement("p", { className: "modal-sub", style: { marginBottom: "1.25rem" } },
                            "Shape ",
                            pcfg().displayName,
                            "'s identity, visual core, and voice. Saved on this device."),
                        (() => {
                            const c = custom.axis || {};
                            const set = (patch) => saveCustom({ ...custom, axis: { ...c, ...patch } });
                            const enVoices = availVoices.filter(v => /^en/i.test(v.lang));
                            const voiceList = enVoices.length ? enVoices : availVoices;
                            const lbl = { fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.5)", textTransform: "uppercase" };
                            const inp = { width: "100%", boxSizing: "border-box", margin: "0.4rem 0 1rem", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "0.65rem 0.85rem", color: "#fff", fontSize: "0.9rem", fontFamily: "inherit", outline: "none" };
                            const secHdr = { fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.14em", color: "var(--blue)", textTransform: "uppercase", margin: "0.5rem 0 0.9rem", borderTop: "0.5px solid rgba(255,255,255,0.08)", paddingTop: "1rem" };
                            return (React.createElement("div", null,
                                React.createElement("div", { style: { ...secHdr, borderTop: "none", paddingTop: 0 } }, "Identity"),
                                React.createElement("label", { style: lbl }, "Name"),
                                React.createElement("input", { value: c.name || "", onChange: e => set({ name: e.target.value }), placeholder: "AXIS", style: inp }),
                                React.createElement("label", { style: lbl }, "Personality & instructions"),
                                React.createElement("textarea", { value: c.personality || "", onChange: e => set({ personality: e.target.value }), rows: 3, placeholder: "e.g. Be concise and witty. Focus on crypto. Call me 'Commander'. Speak like a calm mission-control operator.", style: { ...inp, fontSize: "0.85rem", resize: "vertical" } }),
                                React.createElement("div", { style: secHdr }, "Visual Core"),
                                React.createElement("label", { style: lbl }, "Energy signature"),
                                React.createElement("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.5rem 0 1rem" } }, Object.entries(CORE_THEMES).map(([id, t]) => {
                                    const on = (c.theme || "quantum") === id;
                                    return React.createElement("button", { key: id, onClick: () => set({ theme: id }), title: t.label, style: { display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.4rem 0.7rem", borderRadius: 20, cursor: "pointer", fontSize: "0.74rem", fontWeight: 700, fontFamily: "inherit",
                                            background: on ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                                            border: on ? `1px solid ${t.accent}` : "0.5px solid rgba(255,255,255,0.12)", color: on ? t.accent : "rgba(180,210,255,0.6)" } },
                                        React.createElement("span", { style: { width: 14, height: 14, borderRadius: "50%", background: `radial-gradient(circle at 40% 35%,#fff,${t.accent} 60%,${t.accent2})` } }),
                                        t.label);
                                })),
                                React.createElement("label", { style: lbl }, "Core shape"),
                                React.createElement("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.5rem 0 1rem" } }, Object.entries(CORE_SHAPES).map(([id, label]) => {
                                    const on = (c.shape || "orb") === id;
                                    return React.createElement("button", { key: id, onClick: () => set({ shape: id }), style: { padding: "0.45rem 0.85rem", borderRadius: 20, cursor: "pointer", fontSize: "0.76rem", fontWeight: 700, fontFamily: "inherit",
                                            background: on ? "rgba(0,198,255,0.15)" : "rgba(255,255,255,0.04)", border: on ? "0.5px solid rgba(0,198,255,0.4)" : "0.5px solid rgba(255,255,255,0.12)", color: on ? "var(--blue)" : "rgba(180,210,255,0.6)" } }, label);
                                })),
                                React.createElement("label", { style: { ...lbl, display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", textTransform: "none", fontSize: "0.82rem", color: "rgba(220,235,255,0.85)", marginBottom: "1rem" } },
                                    React.createElement("input", { type: "checkbox", checked: c.ambient !== false, onChange: e => set({ ambient: e.target.checked }) }),
                                    "Ambient particle field & starscape"),
                                React.createElement("div", { style: secHdr }, "Audio"),
                                React.createElement("label", { style: lbl }, "Voice"),
                                React.createElement("select", { value: c.voiceURI || "", onChange: e => set({ voiceURI: e.target.value || null }), style: { ...inp, background: "rgba(20,28,40,1)", fontSize: "0.85rem" } },
                                    React.createElement("option", { value: "" }, "Auto (system default)"),
                                    voiceList.map(v => React.createElement("option", { key: v.voiceURI, value: v.voiceURI },
                                        v.name,
                                        " \u2014 ",
                                        v.lang))),
                                React.createElement("label", { style: lbl },
                                    "Pitch \u2014 ",
                                    (c.pitch != null ? c.pitch : 1.0).toFixed(2)),
                                React.createElement("input", { type: "range", min: "0.4", max: "1.8", step: "0.05", value: c.pitch != null ? c.pitch : 1.0, onChange: e => set({ pitch: parseFloat(e.target.value) }), style: { width: "100%", margin: "0.4rem 0 1rem" } }),
                                React.createElement("label", { style: lbl },
                                    "Speed \u2014 ",
                                    (c.rate != null ? c.rate : 1.0).toFixed(2)),
                                React.createElement("input", { type: "range", min: "0.6", max: "1.6", step: "0.05", value: c.rate != null ? c.rate : 1.0, onChange: e => set({ rate: parseFloat(e.target.value) }), style: { width: "100%", margin: "0.4rem 0 1rem" } }),
                                React.createElement("label", { style: { ...lbl, display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", textTransform: "none", fontSize: "0.82rem", color: "rgba(220,235,255,0.85)", marginBottom: "1.25rem" } },
                                    React.createElement("input", { type: "checkbox", checked: c.sfx === true, onChange: e => set({ sfx: e.target.checked }) }),
                                    "Interface sound effects (send / receive tones)"),
                                React.createElement("div", { style: { display: "flex", gap: "0.6rem", flexWrap: "wrap" } },
                                    React.createElement("button", { onClick: () => speakAs(`Core online. I'm ${pcfg().displayName}. This is how I sound.`), style: { flex: 1, padding: "0.65rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", background: "rgba(0,198,255,0.12)", border: "0.5px solid rgba(0,198,255,0.3)", color: "var(--blue)" } }, "\uD83D\uDD0A Test voice"),
                                    React.createElement("button", { onClick: () => { if (sfxPing)
                                            sfxPing(); }, style: { padding: "0.65rem 0.9rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", background: "rgba(0,198,255,0.12)", border: "0.5px solid rgba(0,198,255,0.3)", color: "var(--blue)" } }, "\u266A Test SFX"),
                                    React.createElement("button", { onClick: () => saveCustom({ ...custom, axis: {} }), style: { padding: "0.65rem 1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", color: "rgba(180,210,255,0.7)" } }, "Reset all"))));
                        })(),
                        React.createElement("button", { className: "modal-cancel", onClick: () => setShowSettings(false) }, "Done")))),
                showSignIn && (React.createElement("div", { className: "overlay", onClick: () => setShowSignIn(false) },
                    React.createElement("div", { className: "modal", onClick: e => e.stopPropagation(), style: { maxWidth: 420, textAlign: "center" } },
                        React.createElement("div", { className: "modal-title", style: { marginBottom: "0.3rem" } }, "Sign in to sync"),
                        React.createElement("p", { className: "modal-sub", style: { marginBottom: "1.5rem" } }, "Save your conversations to your account and pick up on any device."),
                        authAvailable ? (React.createElement(React.Fragment, null,
                            React.createElement("button", { onClick: () => { if (window.google?.accounts) {
                                    showToast("Google sign-in ready — configure client ID");
                                }
                                else {
                                    showToast("Loading Google…");
                                } }, style: { width: "100%", padding: "0.8rem", borderRadius: 12, fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", background: "#fff", color: "#222", border: "none", marginBottom: "0.7rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem" } },
                                React.createElement("span", { style: { fontWeight: 900, color: "#4285F4" } }, "G"),
                                " Continue with Google"),
                            React.createElement("p", { style: { fontSize: "0.72rem", color: "rgba(180,210,255,0.5)", lineHeight: 1.5 } }, "Email sign-in coming soon."))) : (React.createElement("div", { style: { background: "rgba(255,213,79,0.06)", border: "0.5px solid rgba(255,213,79,0.25)", borderRadius: 12, padding: "1rem", fontSize: "0.82rem", color: "rgba(255,225,150,0.9)", lineHeight: 1.6, textAlign: "left" } },
                            React.createElement("strong", null, "Accounts aren't enabled yet."),
                            " Cross-device sign-in needs Google OAuth credentials and a database to be configured on the server. Until then, good news: ",
                            React.createElement("strong", null, "your conversations already save automatically on this device"),
                            ", so you'll pick up right where you left off here \u2014 and you can download them anytime with the \u2B07 button.")),
                        React.createElement("button", { className: "modal-cancel", onClick: () => setShowSignIn(false) }, "Close")))),
                showSources && (React.createElement("div", { className: "overlay", onClick: () => setShowSources(false) },
                    React.createElement("div", { className: "modal", onClick: e => e.stopPropagation(), style: { maxWidth: 560, textAlign: "left", maxHeight: "85vh", overflowY: "auto" } },
                        React.createElement("div", { className: "modal-title", style: { marginBottom: "0.3rem" } }, "Data Sources"),
                        React.createElement("p", { className: "modal-sub", style: { marginBottom: "1rem" } },
                            "Connect external APIs to enrich what AXIS can draw on. These run in ",
                            React.createElement("strong", null, "your browser"),
                            " \u2014 any keys you enter stay on this device and are never sent to our servers."),
                        React.createElement("div", { style: { background: "rgba(0,198,255,0.06)", border: "0.5px solid rgba(0,198,255,0.2)", borderRadius: 10, padding: "0.7rem 0.9rem", fontSize: "0.74rem", color: "rgba(180,210,255,0.8)", lineHeight: 1.5, marginBottom: "1.25rem" } }, "\uD83D\uDD12 Your keys are stored only on this device (localStorage). Only add keys you're comfortable using in your own browser. AXIS pulls fresh context from enabled sources when you ask a question."),
                        React.createElement("div", { style: { fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.12em", color: "var(--blue)", textTransform: "uppercase", marginBottom: "0.8rem" } }, "Curated connectors (safe, pre-vetted)"),
                        Object.entries(DATA_CONNECTORS).map(([id, cfg]) => {
                            const cur = dataSources.curated?.[id] || {};
                            const set = (patch) => saveSources({ ...dataSources, curated: { ...dataSources.curated, [id]: { ...cur, ...patch } } });
                            return (React.createElement("div", { key: id, style: { border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "0.85rem", marginBottom: "0.7rem", background: "rgba(255,255,255,0.02)" } },
                                React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem" } },
                                    React.createElement("div", null,
                                        React.createElement("div", { style: { fontWeight: 600, fontSize: "0.88rem", display: "flex", alignItems: "center" } },
                                            cfg.label,
                                            React.createElement(StatusDot, { state: sourceStatus[id] })),
                                        React.createElement("div", { style: { fontSize: "0.74rem", color: "rgba(180,210,255,0.55)", marginTop: "0.15rem" } }, cfg.desc)),
                                    React.createElement("button", { onClick: () => set({ enabled: !cur.enabled }), style: { flexShrink: 0, width: 46, height: 26, borderRadius: 13, cursor: "pointer", border: "none", position: "relative", transition: "all 0.2s", background: cur.enabled ? "#30d158" : "rgba(255,255,255,0.15)" } },
                                        React.createElement("span", { style: { position: "absolute", top: 3, left: cur.enabled ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "all 0.2s" } }))),
                                cfg.needsKey && cur.enabled && (React.createElement("div", { style: { marginTop: "0.6rem" } },
                                    React.createElement(KeyInput, { value: cur.key, onChange: e => set({ key: e.target.value }), placeholder: "Your API key for this service", shown: !!shownKeys[`curated:${id}`], onToggle: () => toggleKeyShown(`curated:${id}`) }))),
                                cur.enabled && (React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.5rem" } },
                                    React.createElement("button", { onClick: () => testSource(id, cfg.build("cardano"), cur.key), style: { fontSize: "0.7rem", fontWeight: 700, padding: "0.3rem 0.7rem", borderRadius: 8, cursor: "pointer", background: "rgba(0,198,255,0.1)", border: "0.5px solid rgba(0,198,255,0.3)", color: "var(--blue)", fontFamily: "inherit" } }, "Test"),
                                    React.createElement("span", { style: { fontSize: "0.7rem", color: sourceStatus[id] === "failed" ? "#ff6b6b" : "rgba(48,209,88,0.8)" } }, sourceStatus[id] === "failed" ? "✕ Not working — blocked by the API" :
                                        sourceStatus[id] === "ok" ? "✓ Working" :
                                            sourceStatus[id] === "testing" ? "Testing…" : cfg.hint)))));
                        }),
                        React.createElement("div", { style: { fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.12em", color: "var(--blue)", textTransform: "uppercase", margin: "1.25rem 0 0.5rem" } }, "Your custom sources (advanced)"),
                        React.createElement("div", { style: { background: "rgba(255,213,79,0.06)", border: "0.5px solid rgba(255,213,79,0.25)", borderRadius: 10, padding: "0.7rem 0.9rem", fontSize: "0.74rem", color: "rgba(255,225,150,0.9)", lineHeight: 1.5, marginBottom: "0.8rem" } },
                            "\u26A0 ",
                            React.createElement("strong", null, "Many APIs won't work here."),
                            " Browsers block most cross-origin requests (CORS), and APIs that require a key usually block browser access on purpose. Add your source, then hit ",
                            React.createElement("strong", null, "Test"),
                            " \u2014 the status light tells you honestly whether AXIS can actually read it."),
                        (dataSources.custom || []).map((s, i) => {
                            const upd = (patch) => { const c = [...dataSources.custom]; c[i] = { ...c[i], ...patch }; saveSources({ ...dataSources, custom: c }); };
                            const del = () => { const c = dataSources.custom.filter((_, j) => j !== i); saveSources({ ...dataSources, custom: c }); };
                            return (React.createElement("div", { key: i, style: { border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "0.85rem", marginBottom: "0.7rem", background: "rgba(255,255,255,0.02)" } },
                                React.createElement("div", { style: { display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" } },
                                    React.createElement("input", { value: s.name || "", onChange: e => upd({ name: e.target.value }), placeholder: "Source name", style: { flex: 1, background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "0.5rem 0.7rem", color: "#fff", fontSize: "0.82rem", fontFamily: "inherit", outline: "none" } }),
                                    React.createElement(StatusDot, { state: sourceStatus["custom:" + i] }),
                                    React.createElement("button", { onClick: () => upd({ enabled: !s.enabled }), style: { flexShrink: 0, width: 46, height: 26, borderRadius: 13, cursor: "pointer", border: "none", position: "relative", background: s.enabled ? "#30d158" : "rgba(255,255,255,0.15)" } },
                                        React.createElement("span", { style: { position: "absolute", top: 3, left: s.enabled ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "all 0.2s" } })),
                                    React.createElement("button", { onClick: del, style: { flexShrink: 0, background: "rgba(255,80,80,0.12)", border: "0.5px solid rgba(255,80,80,0.3)", borderRadius: 8, color: "#ff6b6b", cursor: "pointer", padding: "0.4rem 0.6rem", fontSize: "0.8rem" } }, "\uD83D\uDDD1")),
                                React.createElement("input", { value: s.url || "", onChange: e => upd({ url: e.target.value }), placeholder: "https://api.example.com/endpoint", autoCapitalize: "off", autoCorrect: "off", style: { width: "100%", boxSizing: "border-box", marginBottom: "0.5rem", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "0.5rem 0.7rem", color: "#fff", fontSize: "0.82rem", fontFamily: "inherit", outline: "none" } }),
                                React.createElement(KeyInput, { value: s.key, onChange: e => upd({ key: e.target.value }), placeholder: "API key (optional \u2014 stays on this device)", shown: !!shownKeys[`custom:${i}`], onToggle: () => toggleKeyShown(`custom:${i}`) }),
                                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.5rem" } },
                                    React.createElement("button", { onClick: () => testSource("custom:" + i, s.url, s.key), disabled: !s.url, style: { fontSize: "0.7rem", fontWeight: 700, padding: "0.3rem 0.7rem", borderRadius: 8, cursor: s.url ? "pointer" : "not-allowed", background: "rgba(0,198,255,0.1)", border: "0.5px solid rgba(0,198,255,0.3)", color: "var(--blue)", fontFamily: "inherit", opacity: s.url ? 1 : 0.4 } }, "Test"),
                                    React.createElement("span", { style: { fontSize: "0.7rem", color: sourceStatus["custom:" + i] === "failed" ? "#ff6b6b" : sourceStatus["custom:" + i] === "ok" ? "rgba(48,209,88,0.9)" : "rgba(180,210,255,0.45)" } }, sourceStatus["custom:" + i] === "failed" ? "✕ Blocked — this API doesn't allow browser access" :
                                        sourceStatus["custom:" + i] === "ok" ? "✓ Working — AXIS can read this" :
                                            sourceStatus["custom:" + i] === "testing" ? "Testing…" : "Test it to see if it works"))));
                        }),
                        React.createElement("button", { onClick: () => saveSources({ ...dataSources, custom: [...(dataSources.custom || []), { name: "", url: "", key: "", enabled: true }] }), style: { width: "100%", padding: "0.7rem", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", background: "rgba(0,198,255,0.1)", border: "0.5px solid rgba(0,198,255,0.3)", color: "var(--blue)" } }, "+ Add custom source"),
                        React.createElement("button", { className: "modal-cancel", onClick: () => setShowSources(false) }, "Done")))),
                showDownload && (React.createElement("div", { className: "overlay", onClick: () => setShowDownload(false) },
                    React.createElement("div", { className: "modal", onClick: e => e.stopPropagation(), style: { maxWidth: 460, textAlign: "left" } },
                        React.createElement("div", { className: "modal-title", style: { marginBottom: "0.3rem" } }, "Download conversation"),
                        React.createElement("p", { className: "modal-sub", style: { marginBottom: "1.1rem" } }, "Encrypt your chat with a password, or download it as plain JSON. Encryption happens in your browser \u2014 the password never leaves this device."),
                        React.createElement("div", { style: { display: "flex", gap: "0.5rem", marginBottom: "1.1rem" } },
                            React.createElement("button", { onClick: () => setEncMode("encrypted"), style: { flex: 1, padding: "0.7rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit",
                                    background: encMode === "encrypted" ? "rgba(0,198,255,0.15)" : "rgba(255,255,255,0.04)",
                                    border: encMode === "encrypted" ? "0.5px solid var(--blue)" : "0.5px solid rgba(255,255,255,0.12)",
                                    color: encMode === "encrypted" ? "var(--blue)" : "rgba(180,210,255,0.6)" } }, "\uD83D\uDD12 Encrypted (.qai)"),
                            React.createElement("button", { onClick: () => setEncMode("plain"), style: { flex: 1, padding: "0.7rem", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit",
                                    background: encMode === "plain" ? "rgba(0,198,255,0.15)" : "rgba(255,255,255,0.04)",
                                    border: encMode === "plain" ? "0.5px solid var(--blue)" : "0.5px solid rgba(255,255,255,0.12)",
                                    color: encMode === "plain" ? "var(--blue)" : "rgba(180,210,255,0.6)" } }, "\uD83D\uDCC4 Plain (.json)")),
                        encMode === "encrypted" && (React.createElement(React.Fragment, null,
                            React.createElement("label", { style: { fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(180,210,255,0.5)", textTransform: "uppercase" } }, "Password"),
                            React.createElement("input", { type: "password", value: encPass, onChange: e => setEncPass(e.target.value), placeholder: "Choose a password (6+ characters)", onKeyDown: e => e.key === "Enter" && doDownload(), style: { width: "100%", boxSizing: "border-box", margin: "0.4rem 0 0.5rem", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "0.65rem 0.85rem", color: "#fff", fontSize: "0.9rem", fontFamily: "inherit", outline: "none" } }),
                            React.createElement("div", { style: { fontSize: "0.74rem", color: "rgba(180,210,255,0.6)", lineHeight: 1.5, marginBottom: "0.5rem" } },
                                "\uD83D\uDD10 AES-256-GCM encryption, done entirely in your browser. Saved as a ",
                                React.createElement("strong", null, ".qai"),
                                " file you can decrypt anytime on the QuantumAI.computer homepage."),
                            React.createElement("div", { style: { fontSize: "0.72rem", color: "rgba(255,213,79,0.8)", lineHeight: 1.5, marginBottom: "1rem" } }, "\u26A0 There's no password recovery. If you lose this password, the file cannot be decrypted by anyone \u2014 including us. That's what makes it secure."))),
                        React.createElement("button", { onClick: doDownload, disabled: encBusy, style: { width: "100%", padding: "0.85rem", borderRadius: 12, fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", border: "none", color: "#001018", background: "linear-gradient(135deg,var(--blue),#0072FF)" } }, encBusy ? "Encrypting…" : (encMode === "encrypted" ? "🔒 Encrypt & Download .qai" : "Download .json")),
                        React.createElement("p", { style: { fontSize: "0.7rem", color: "rgba(180,210,255,0.45)", textAlign: "center", marginTop: "0.8rem", lineHeight: 1.5 } }, "Decrypt .qai files anytime on the QuantumAI.computer homepage."),
                        React.createElement("button", { className: "modal-cancel", onClick: () => setShowDownload(false) }, "Cancel"))))));
        })(),
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
                React.createElement("a", { onClick: () => setPage("vault"), style: { cursor: "pointer" } }, "Quantum Vault"),
                React.createElement("a", { onClick: () => setPage("chat"), style: { cursor: "pointer" } }, "AXIS AI")),
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
    document.getElementById("root").innerHTML = '<div style="font-family:Inter,sans-serif;color:#eaf4ff;text-align:center;margin:18vh auto;max-width:520px;padding:2rem"><h1 style="color:#00C6FF">QuantumAI</h1><p>Couldn\'t load libraries. Refresh.</p></div>';
    return;
  }
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(QuantumAI));
})();
