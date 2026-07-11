// Cloudflare Pages Function: /api/cg
// Server-side proxy for market data. Browsers get rate-limited / CORS-blocked
// calling these APIs directly; proxying server-side fixes both.
//
// CoinGecko:     /api/cg?path=/coins/markets?...
// CoinMarketCap: /api/cg?cmc=/v1/cryptocurrency/listings/latest?...  (needs CMC_API_KEY)

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // ── CoinMarketCap branch ──
  const cmcPath = url.searchParams.get("cmc");
  if (cmcPath) {
    if (!env.CMC_API_KEY) {
      return new Response(JSON.stringify({ error: "CMC not configured" }), { status: 501, headers: cors });
    }
    if (!cmcPath.startsWith("/v1/") && !cmcPath.startsWith("/v2/")) {
      return new Response(JSON.stringify({ error: "Bad CMC path" }), { status: 400, headers: cors });
    }
    try {
      const r = await fetch("https://pro-api.coinmarketcap.com" + cmcPath, {
        headers: { "X-CMC_PRO_API_KEY": env.CMC_API_KEY, "Accept": "application/json" },
      });
      const body = await r.text();
      return new Response(body, { status: r.status, headers: { ...cors, "Cache-Control": r.ok ? "public, max-age=20" : "no-store" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "CMC fetch failed", detail: String(err) }), { status: 502, headers: cors });
    }
  }

  // ── Fear & Greed Index branch (alternative.me) ──
  const fng = url.searchParams.get("fng");
  if (fng) {
    try {
      const r = await fetch(`https://api.alternative.me/fng/?limit=${encodeURIComponent(fng)}`, { headers: { "Accept": "application/json" } });
      const body = await r.text();
      return new Response(body, { status: r.status, headers: { ...cors, "Cache-Control": "public, max-age=300" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "FNG fetch failed", detail: String(err) }), { status: 502, headers: cors });
    }
  }

  // ── CoinGecko branch ──
  let path = url.searchParams.get("path") || "";
  if (!path.startsWith("/")) {
    return new Response(JSON.stringify({ error: "Missing or invalid 'path'." }), { status: 400, headers: cors });
  }
  const allowed = ["/coins", "/simple", "/search", "/global", "/ping"];
  if (!allowed.some(a => path.startsWith(a))) {
    return new Response(JSON.stringify({ error: "Path not allowed." }), { status: 403, headers: cors });
  }

  const key = env.COINGECKO_API_KEY || "";
  const isPro = key.startsWith("CG-") && env.COINGECKO_PRO === "1";
  const base = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
  const headers = { "Accept": "application/json" };
  if (key) headers[isPro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = key;

  try {
    const r = await fetch(base + path, { headers });
    if (r.ok) {
      const body = await r.text();
      return new Response(body, { status: 200, headers: { ...cors, "Cache-Control": "public, max-age=15" } });
    }
    // CoinGecko failed (rate limit, outage). Try CoinMarketCap as a fallback
    // for simple price lookups, if a CMC key is configured.
    if (env.CMC_API_KEY) {
      const cmc = await cmcPriceFallback(path, env.CMC_API_KEY, cors);
      if (cmc) return cmc;
    }
    // No fallback available — return CoinGecko's original (error) response.
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (err) {
    // Network exception hitting CoinGecko — also try CMC.
    if (env.CMC_API_KEY) {
      try {
        const cmc = await cmcPriceFallback(path, env.CMC_API_KEY, cors);
        if (cmc) return cmc;
      } catch { /* fall through */ }
    }
    return new Response(JSON.stringify({ error: "Upstream fetch failed", detail: String(err) }), { status: 502, headers: cors });
  }
}

// Best-effort: translate a CoinGecko simple-price request into a CoinMarketCap
// quote and return it in a CoinGecko-compatible shape so the frontend needn't
// change. Only handles the common /simple/price?ids=...&vs_currencies=usd case.
async function cmcPriceFallback(path, cmcKey, cors) {
  try {
    const q = path.split("?")[1] || "";
    const params = new URLSearchParams(q);
    const ids = (params.get("ids") || "").split(",").filter(Boolean);
    if (!path.startsWith("/simple/price") || !ids.length) return null;

    // CMC uses slugs; ids from CoinGecko are usually slugs too (e.g. "cardano").
    const slugs = ids.join(",");
    const r = await fetch(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=" + encodeURIComponent(slugs) + "&convert=USD",
      { headers: { "X-CMC_PRO_API_KEY": cmcKey, "Accept": "application/json" } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    // Reshape CMC → CoinGecko simple/price format: { id: { usd, usd_24h_change } }
    const out = {};
    const bySlug = {};
    for (const k in (j.data || {})) {
      const coin = j.data[k];
      if (coin && coin.slug) bySlug[coin.slug] = coin;
    }
    for (const id of ids) {
      const coin = bySlug[id];
      const quote = coin?.quote?.USD;
      if (quote) out[id] = { usd: quote.price, usd_24h_change: quote.percent_change_24h };
    }
    if (!Object.keys(out).length) return null;
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { ...cors, "Cache-Control": "public, max-age=20", "X-Data-Source": "coinmarketcap-fallback" },
    });
  } catch { return null; }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
