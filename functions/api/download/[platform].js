// GET /api/download/:platform?t=TOKEN → streams the installer from R2, or 302s to an unlisted URL.
// Tokens are short-lived (TOKEN_TTL_MIN) and good for a few fetches (retry + a second platform).
import { json, needSecret, verifyToken, PLATFORMS } from "../../_gate.js";
export async function onRequestGet({ request, env, params }) {
  const ns = needSecret(env); if (ns) return ns;
  const platform = String(params.platform || "").toLowerCase();
  if (!PLATFORMS.includes(platform)) return json({ error: "Unknown platform." }, 404);
  const url = new URL(request.url);
  const p = await verifyToken(env.TOKEN_SECRET, url.searchParams.get("t") || "");
  if (!p) return json({ error: "This download link has expired or is invalid. Verify your wallet again to get a fresh one." }, 403);
  if (env.GATE) {
    const k = "jti:" + p.jti; const used = parseInt((await env.GATE.get(k)) || "0", 10) + 1;
    if (used > 4) return json({ error: "This download link has already been used. Verify again for a fresh one." }, 403);
    await env.GATE.put(k, String(used), { expirationTtl: 3600 });
  }
  const KEY = env["R2_KEY_" + platform.toUpperCase()], URLX = env["DOWNLOAD_URL_" + platform.toUpperCase()];
  if (env.DOWNLOADS && KEY) {
    const obj = await env.DOWNLOADS.get(KEY);
    if (!obj) return json({ error: "The installer for this platform hasn't been uploaded yet." }, 404);
    const name = KEY.split("/").pop();
    return new Response(obj.body, { headers: { "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`, "Content-Length": String(obj.size), "Cache-Control": "private, no-store" } });
  }
  if (URLX) return Response.redirect(URLX, 302);
  return json({ error: "No installer configured for this platform." }, 404);
}
