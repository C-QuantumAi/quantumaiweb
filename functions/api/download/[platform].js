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
  // Private GitHub release: ask the API for the asset with a token; GitHub
  // answers 302 to a short-lived, pre-signed download URL (valid ~minutes).
  // We hand THAT to the verified holder. The repo stays private, the token
  // never leaves the server, and no stable public URL for the file exists.
  const ghAsset = env["GH_ASSET_" + platform.toUpperCase()];
  if (env.GITHUB_TOKEN && env.GITHUB_RELEASE_REPO && ghAsset) {
    try {
      const r = await githubAssetUrl(env.GITHUB_TOKEN, env.GITHUB_RELEASE_REPO, env.GITHUB_RELEASE_TAG || "latest", ghAsset);
      if (r.url) return Response.redirect(r.url, 302);
      if (r.reason === "no-release") return json({ error: `No published release found in ${env.GITHUB_RELEASE_REPO}. Drafts and pre-releases don't count as "latest" — open the release on GitHub and click Publish release (or set GITHUB_RELEASE_TAG to its tag).` }, 404);
      return json({ error: `The release ${r.tag || ""} has no file named "${ghAsset}". Files on it: ${r.assets && r.assets.length ? r.assets.join(", ") : "(none)"}. Set GH_ASSET_${platform.toUpperCase()} to one of those exact names (GitHub turns spaces into dots).` }, 404);
    } catch (e) { return json({ error: "Couldn't fetch the installer from the release: " + String(e.message || e) }, 502); }
  }
  return json({ error: "No installer configured for this platform." }, 404);
}

// Resolve a release asset to GitHub's temporary pre-signed URL (no proxying).
export async function githubAssetUrl(token, repo, tag, assetName, fetchFn = fetch) {
  const h = { Authorization: "Bearer " + token, "User-Agent": "QuantumAI-site/1.0", "X-GitHub-Api-Version": "2022-11-28" };
  const relPath = tag === "latest" ? "releases/latest" : "releases/tags/" + encodeURIComponent(tag);
  const rel = await fetchFn(`https://api.github.com/repos/${repo}/${relPath}`, { headers: { ...h, Accept: "application/vnd.github+json" } });
  if (rel.status === 404) return { url: null, reason: "no-release" };
  if (rel.status === 401 || rel.status === 403) throw new Error("GitHub refused the token (" + rel.status + "). Check GITHUB_TOKEN has Contents: Read-only on " + repo + ".");
  if (!rel.ok) throw new Error("GitHub release lookup failed (" + rel.status + ")");
  const data = await rel.json();
  const names = (data.assets || []).map(a => a.name);
  const asset = (data.assets || []).find(a => a.name === assetName);
  if (!asset) return { url: null, reason: "no-asset", tag: data.tag_name, assets: names };
  // Asking for the binary with redirect:"manual" yields the pre-signed location without downloading it.
  const bin = await fetchFn(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, { headers: { ...h, Accept: "application/octet-stream" }, redirect: "manual" });
  const loc = bin.headers.get("location");
  if (loc) return { url: loc, tag: data.tag_name };
  throw new Error("GitHub did not provide a download location (" + bin.status + ")");
}
