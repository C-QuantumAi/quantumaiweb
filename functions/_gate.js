// Shared helpers for the token-holder gate + forum Pages Functions.
// (Leading underscore: Cloudflare Pages does not route files that start with "_".)
import { checkHoldings, signToken, verifyToken, validatePost, postEmailHtml } from "../shared/gate-core.mjs";
export { checkHoldings, signToken, verifyToken, validatePost, postEmailHtml };

export const PLATFORMS = ["win", "msi", "mac", "linux"]; // win = .exe installer, msi = .msi, mac = .dmg
export const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...extra } });
export async function sha256Hex(s) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
export const ipOf = (req) => req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "0.0.0.0";
// Fixed-window counter in KV; true when over the limit. Without KV, no limiting (dev).
export async function overLimit(env, key, limit, windowSec) {
  if (!env.GATE) return false;
  const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const cur = parseInt((await env.GATE.get(k)) || "0", 10) + 1;
  await env.GATE.put(k, String(cur), { expirationTtl: windowSec + 5 });
  return cur > limit;
}
export function configuredPlatforms(env) { return PLATFORMS.filter(p => env["R2_KEY_" + p.toUpperCase()] || env["DOWNLOAD_URL_" + p.toUpperCase()] || (env.GITHUB_TOKEN && env.GITHUB_RELEASE_REPO && env["GH_ASSET_" + p.toUpperCase()])); }
export const needSecret = (env) => env.TOKEN_SECRET ? null : json({ error: "Server not configured: set the TOKEN_SECRET environment variable in Cloudflare Pages." }, 500);
