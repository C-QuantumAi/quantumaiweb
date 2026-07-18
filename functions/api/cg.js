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

  // ── Exchange candles branch: real OHLCV from Coinbase / Binance / Binance US ──
  // Query: /api/cg?ex=BTC&interval=5m&limit=300
  // Tries providers in order and returns the first that yields real candles,
  // normalized to [{t,o,h,l,c,v}]. Done server-side to avoid browser CORS and
  // regional geo-blocks (Binance blocks some IPs; the proxy tries US too).
  const exSym = url.searchParams.get("ex");
  if (exSym) {
    const interval = url.searchParams.get("interval") || "1h";
    const limit = Math.min(1000, parseInt(url.searchParams.get("limit") || "300", 10));
    const sym = exSym.toUpperCase();

    const out = await fetchExchangeCandles(sym, interval, limit);
    if (out && out.length) {
      return new Response(JSON.stringify({ source: out._source, candles: out }), {
        status: 200, headers: { ...cors, "Cache-Control": "public, max-age=15" },
      });
    }
    // Nothing worked — tell the caller so it can fall back to CoinGecko.
    return new Response(JSON.stringify({ candles: [], source: null }), {
      status: 200, headers: { ...cors, "Cache-Control": "no-store" },
    });
  }

  // ── Market structure branch: funding rate, open interest, order book ──
  // Query: /api/cg?struct=BTC
  const structSym = url.searchParams.get("struct");
  if (structSym) {
    try {
      const data = await fetchMarketStructure(structSym);
      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...cors, "Cache-Control": "public, max-age=20" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "structure fetch failed", detail: String(err) }), { status: 502, headers: cors });
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

// ── Exchange candle helpers ──────────────────────────────────────────
// Interval strings differ per exchange; map our canonical intervals across.
const BINANCE_INTERVAL = {
  "1m":"1m","5m":"5m","15m":"15m","30m":"30m","1h":"1h","4h":"4h",
  "1d":"1d","1w":"1w","1M":"1M",
};
// Coinbase uses granularity in SECONDS and only supports a fixed set.
const COINBASE_GRANULARITY = {
  "1m":60,"5m":300,"15m":900,"1h":3600,"6h":21600,"1d":86400,
};

// Quote currency preferences per provider.
async function fetchExchangeCandles(sym, interval, limit) {
  // 1) Coinbase (best for US-hosted; real candles; no key)
  try {
    const g = COINBASE_GRANULARITY[interval];
    if (g) {
      const r = await fetch(`https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=${g}`, {
        headers: { "Accept": "application/json", "User-Agent": "QuantumAI/1.0" },
      });
      if (r.ok) {
        const rows = await r.json();
        // Coinbase returns [ time, low, high, open, close, volume ], newest first
        if (Array.isArray(rows) && rows.length) {
          const candles = rows.slice(0, limit).reverse().map(x => ({
            t: x[0] * 1000, o: x[3], h: x[2], l: x[1], c: x[4], v: x[5],
          }));
          candles._source = "coinbase";
          return candles;
        }
      }
    }
  } catch {}

  // 2) Binance global (real candles, no key; may be geo-blocked on some IPs)
  const bi = BINANCE_INTERVAL[interval];
  if (bi) {
    for (const host of ["https://api.binance.com", "https://api.binance.us"]) {
      try {
        const r = await fetch(`${host}/api/v3/klines?symbol=${sym}USDT&interval=${bi}&limit=${limit}`, {
          headers: { "Accept": "application/json" },
        });
        if (r.ok) {
          const rows = await r.json();
          // Binance kline: [openTime,open,high,low,close,volume,...]
          if (Array.isArray(rows) && rows.length) {
            const candles = rows.map(x => ({
              t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5],
            }));
            candles._source = host.includes(".us") ? "binance-us" : "binance";
            return candles;
          }
        }
      } catch {}
    }
  }

  return null; // caller falls back to CoinGecko
}

// ── Market structure: funding, open interest, order book ─────────────
// All free, no API keys. Fetched server-side (avoids CORS + geo-blocks).
export async function fetchMarketStructure(sym) {
  const out = { funding: null, openInterest: null, book: null, source: null };
  const S = sym.toUpperCase();

  // Funding rate + open interest from Binance futures (try global, then US-safe Bybit)
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${S}USDT`);
    if (r.ok) {
      const j = await r.json();
      if (j && j.lastFundingRate != null) {
        out.funding = {
          rate: +j.lastFundingRate,              // e.g. 0.0001 = 0.01% per 8h
          annualized: +j.lastFundingRate * 3 * 365,
          markPrice: +j.markPrice,
          nextFundingTime: j.nextFundingTime,
        };
        out.source = "binance-futures";
      }
    }
  } catch {}

  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${S}USDT`);
    if (r.ok) {
      const j = await r.json();
      if (j && j.openInterest != null) out.openInterest = { contracts: +j.openInterest };
    }
  } catch {}

  // Fallback for funding: Bybit (different region availability)
  if (!out.funding) {
    try {
      const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${S}USDT`);
      if (r.ok) {
        const j = await r.json();
        const t = j?.result?.list?.[0];
        if (t?.fundingRate != null) {
          out.funding = {
            rate: +t.fundingRate,
            annualized: +t.fundingRate * 3 * 365,
            markPrice: +t.markPrice,
          };
          if (t.openInterest != null) out.openInterest = { contracts: +t.openInterest };
          out.source = "bybit";
        }
      }
    } catch {}
  }

  // Order book depth from Coinbase (spot, US-friendly, no key)
  try {
    const r = await fetch(`https://api.exchange.coinbase.com/products/${S}-USD/book?level=2`, {
      headers: { "User-Agent": "QuantumAI/1.0" },
    });
    if (r.ok) {
      const j = await r.json();
      const bids = (j.bids || []).slice(0, 50).map(b => [+b[0], +b[1]]);
      const asks = (j.asks || []).slice(0, 50).map(a => [+a[0], +a[1]]);
      if (bids.length && asks.length) {
        const bidVal = bids.reduce((s, b) => s + b[0] * b[1], 0);
        const askVal = asks.reduce((s, a) => s + a[0] * a[1], 0);
        const total = bidVal + askVal;
        out.book = {
          bestBid: bids[0][0],
          bestAsk: asks[0][0],
          spreadPct: ((asks[0][0] - bids[0][0]) / bids[0][0]) * 100,
          bidValue: bidVal,
          askValue: askVal,
          // >50% means more resting buy interest near the top of book
          imbalancePct: total ? (bidVal / total) * 100 : 50,
          topBids: bids.slice(0, 8),
          topAsks: asks.slice(0, 8),
        };
      }
    }
  } catch {}

  return out;
}
