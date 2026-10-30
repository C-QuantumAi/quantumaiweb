// QuantumAI — token-holder download gate + bug forum: core logic (no I/O bindings)
// Shared by the Cloudflare Worker and the offline tests. Everything that talks
// to the network takes a `fetchFn` so it can be stubbed.

export const QAI = {
  policyId: "354a6c0acd846b195768ead31c92693ad26d82ba013e7df5d9777081",
  assetNameHex: "514149",            // "QAI"
  fingerprint: "asset1nylmp38l5uq2szj6kguellahjvpsj6a7uhwxzs",
};
export const KOIOS = "https://api.koios.rest/api/v1";

// ── bech32 (Cardano addresses: addr1…, stake1…) ──────────────────────────
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values) { const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let chk = 1; for (const v of values) { const b = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= G[i]; } return chk >>> 0; }
function hrpExpand(hrp) { const out = []; for (const c of hrp) out.push(c.charCodeAt(0) >> 5); out.push(0); for (const c of hrp) out.push(c.charCodeAt(0) & 31); return out; }
function toWords(bytes) { let acc = 0, bits = 0; const out = []; for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); } } if (bits) out.push((acc << (5 - bits)) & 31); return out; }
export function bech32Encode(hrp, bytes) {
  const words = toWords(bytes);
  const values = hrpExpand(hrp).concat(words).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  let s = hrp + "1"; for (const w of words) s += CHARSET[w];
  for (let i = 0; i < 6; i++) s += CHARSET[(mod >> (5 * (5 - i))) & 31];
  return s;
}
export function bech32Verify(str) {
  const s = String(str || "").toLowerCase(); const pos = s.lastIndexOf("1");
  if (pos < 1 || pos + 7 > s.length || s.length > 120) return false;
  const hrp = s.slice(0, pos); const data = [];
  for (const c of s.slice(pos + 1)) { const v = CHARSET.indexOf(c); if (v < 0) return false; data.push(v); }
  return polymod(hrpExpand(hrp).concat(data)) === 1;
}
export function hexToBytes(hex) { const h = String(hex || "").replace(/^0x/, ""); if (h.length % 2) throw new Error("odd hex"); const out = new Uint8Array(h.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; }
// CIP-30 returns addresses as hex CBOR bytes; header byte's high nibble is the
// type (0–7 payment, 14/15 reward), low nibble the network (1 mainnet).
export function hexAddressToBech32(hex) {
  const b = hexToBytes(hex); if (!b.length) throw new Error("empty address");
  const type = b[0] >> 4, net = b[0] & 0x0f;
  const isReward = type === 14 || type === 15;
  const hrp = (isReward ? "stake" : "addr") + (net === 1 ? "" : "_test");
  return bech32Encode(hrp, b);
}

// ── address classification ───────────────────────────────────────────────
export function classifyAddress(input) {
  const s = String(input || "").trim().toLowerCase();
  if (/^[0-9a-f]{58,}$/.test(s)) { try { return classifyAddress(hexAddressToBech32(s)); } catch { return { kind: "invalid" }; } }
  if (!bech32Verify(s)) return { kind: "invalid" };
  if (s.startsWith("stake1")) return { kind: "stake", address: s };
  if (s.startsWith("addr1")) return { kind: "payment", address: s };
  if (s.startsWith("stake_test1") || s.startsWith("addr_test1")) return { kind: "testnet", address: s };
  return { kind: "invalid" };
}

// ── holdings via Koios ───────────────────────────────────────────────────
async function koios(fetchFn, path, body, apiKey) {
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
  const r = await fetchFn(KOIOS + path, { method: "POST", headers, body: JSON.stringify(body) });
  if (r.status === 429) throw new Error("The blockchain lookup service is busy (rate limited). Try again in a minute.");
  if (!r.ok) throw new Error("Blockchain lookup failed (" + r.status + ").");
  return r.json();
}
function sumQai(rows) {
  let q = 0n;
  for (const row of rows || []) {
    if (String(row.policy_id || "").toLowerCase() === QAI.policyId && String(row.asset_name || "").toLowerCase() === QAI.assetNameHex) {
      try { q += BigInt(String(row.quantity || "0")); } catch {}
    }
  }
  return q;
}
// Returns { eligible, quantity (string), stake, checked: "account"|"address", reason? }
export async function checkHoldings(input, { fetchFn = fetch, minQai = 1n, koiosKey = "" } = {}) {
  const c = classifyAddress(input);
  if (c.kind === "invalid") return { eligible: false, reason: "That doesn't look like a Cardano address. Paste an address starting with addr1… or stake1…." };
  if (c.kind === "testnet") return { eligible: false, reason: "That's a testnet address. QAI lives on Cardano mainnet." };
  let stake = c.kind === "stake" ? c.address : null;
  if (!stake) {
    const info = await koios(fetchFn, "/address_info", { _addresses: [c.address] }, koiosKey);
    stake = info && info[0] && info[0].stake_address ? String(info[0].stake_address) : null;
    if (!info || !info.length) return { eligible: false, reason: "That address hasn't been seen on-chain yet (no transactions). Use an address that has received funds, or your stake1… address." };
  }
  let rows, checked;
  if (stake) { rows = await koios(fetchFn, "/account_assets", { _stake_addresses: [stake] }, koiosKey); checked = "account"; }
  else { rows = await koios(fetchFn, "/address_assets", { _addresses: [c.address] }, koiosKey); checked = "address"; }
  const q = sumQai(rows);
  const min = BigInt(minQai);
  return { eligible: q >= min, quantity: q.toString(), stake: stake || null, checked, minQai: min.toString(),
    reason: q >= min ? undefined : (q > 0n ? `This wallet holds ${q} QAI; at least ${min} is required.` : "No QAI found in this wallet (checked the whole account, not just one address).") };
}

// ── signed, short-lived download tokens (HMAC-SHA256, Web Crypto) ────────
const te = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
async function hmacKey(secret) { return crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
export async function signToken(secret, payload) {
  const body = b64u(te.encode(JSON.stringify(payload)));
  const sig = b64u(await crypto.subtle.sign("HMAC", await hmacKey(secret), te.encode(body)));
  return body + "." + sig;
}
export async function verifyToken(secret, token, now = Date.now()) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64u(sig), te.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
    if (!p || typeof p.exp !== "number" || p.exp < now) return null;
    return p;
  } catch { return null; } // malformed input is "invalid", never a crash
}

// ── forum post validation ────────────────────────────────────────────────
export const FORUM_CATEGORIES = ["bug", "crash", "trading", "markets", "ai-assistant", "encryption", "personal-cloud", "send-file", "install", "suggestion", "other"];
export function validatePost(input) {
  const s = (v, max) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, max);
  const post = {
    name: s(input.name, 60) || "Anonymous",
    email: s(input.email, 120),
    title: s(input.title, 140),
    body: s(input.body, 6000),
    category: FORUM_CATEGORIES.includes(String(input.category)) ? String(input.category) : "other",
    version: s(input.version, 32),
    os: s(input.os, 40),
    steps: s(input.steps, 3000),
  };
  if (input.website) return { ok: false, reason: "spam" };                 // honeypot
  if (post.title.length < 4) return { ok: false, reason: "Please give the note a short title." };
  if (post.body.length < 10) return { ok: false, reason: "Please describe what happened (at least a sentence)." };
  if (post.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(post.email)) return { ok: false, reason: "That email doesn't look right (leave it blank if you prefer)." };
  const links = (post.body.match(/https?:\/\//gi) || []).length;
  if (links > 3) return { ok: false, reason: "Too many links for a bug note." };
  return { ok: true, post };
}
export const escapeHtml = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export function postEmailHtml(post, meta = {}) {
  const row = (k, v) => v ? `<tr><td style="padding:4px 10px 4px 0;color:#667;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>` : "";
  return `<div style="font-family:-apple-system,Segoe UI,Inter,sans-serif;font-size:14px;color:#111;max-width:680px">
  <h2 style="margin:0 0 6px">🐞 ${escapeHtml(post.title)}</h2>
  <div style="color:#667;margin-bottom:12px">${escapeHtml(post.category)} · from ${escapeHtml(post.name)}${post.email ? " &lt;" + escapeHtml(post.email) + "&gt;" : ""} · ${escapeHtml(meta.when || new Date().toISOString())}</div>
  <table style="border-collapse:collapse;margin-bottom:12px">${row("App version", post.version)}${row("OS", post.os)}${row("Post id", meta.id)}${row("IP (hashed)", meta.ipHash)}</table>
  <h3 style="margin:14px 0 4px;font-size:14px">What happened</h3><pre style="white-space:pre-wrap;font:inherit;background:#f5f6f8;padding:10px;border-radius:8px">${escapeHtml(post.body)}</pre>
  ${post.steps ? `<h3 style="margin:14px 0 4px;font-size:14px">Steps to reproduce</h3><pre style="white-space:pre-wrap;font:inherit;background:#f5f6f8;padding:10px;border-radius:8px">${escapeHtml(post.steps)}</pre>` : ""}
  <p style="color:#889;font-size:12px;margin-top:16px">Sent by the QuantumAI site forum. Reply-to is set to the reporter when they left an email.</p></div>`;
}
