// GET /api/release → what's on the latest published release (version, files, sizes, date).
// Public, cached. Read with the same token the download endpoint uses, so the
// Downloads page always shows the version that will actually be served.
import { json, PLATFORMS } from "../_gate.js";
export async function onRequestGet({ env }) {
  const repo = env.GITHUB_RELEASE_REPO, token = env.GITHUB_TOKEN;
  if (!repo || !token) return json({ ok: false, reason: "release source not configured" }, 200, { "Cache-Control": "public, max-age=60" });
  const tag = env.GITHUB_RELEASE_TAG || "latest";
  const relPath = tag === "latest" ? "releases/latest" : "releases/tags/" + encodeURIComponent(tag);
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/${relPath}`, { headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "User-Agent": "QuantumAI-site/1.0", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!r.ok) return json({ ok: false, reason: "no published release (" + r.status + ")" }, 200, { "Cache-Control": "public, max-age=60" });
    const d = await r.json();
    const assets = {};
    for (const p of PLATFORMS) {
      const name = env["GH_ASSET_" + p.toUpperCase()];
      const a = name && (d.assets || []).find(x => x.name === name);
      if (a) assets[p] = { name: a.name, size: a.size, updatedAt: a.updated_at };
    }
    const version = String(d.tag_name || "").replace(/^v/i, "");
    return json({ ok: true, version, tag: d.tag_name, name: d.name, publishedAt: d.published_at, assets }, 200, { "Cache-Control": "public, max-age=600" });
  } catch (e) { return json({ ok: false, reason: String(e.message || e) }, 200, { "Cache-Control": "public, max-age=60" }); }
}
