// Cloudflare Pages Function: POST /api/chat
// Securely proxies chat to Anthropic's Claude with the web_search tool enabled.
// The ANTHROPIC_API_KEY is stored as a Cloudflare environment secret — never exposed to the browser.

export async function onRequestPost(context) {
  const { request, env } = context;

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Server not configured: ANTHROPIC_API_KEY missing." }),
        { status: 500, headers: cors }
      );
    }

    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const customSys = typeof body.customSys === "string" && body.customSys.trim() ? body.customSys.trim() : null;

    // ── Fetch live market context so AXIS speaks from real-time data ──
    let liveData = "";
    try {
      const cgKey = env.COINGECKO_API_KEY;
      const cgHeaders = cgKey ? { "x-cg-demo-api-key": cgKey } : {};
      const [adaRes, fngRes] = await Promise.all([
        fetch("https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd&include_24hr_change=true", { headers: cgHeaders }).then(r=>r.ok?r.json():null).catch(()=>null),
        fetch("https://api.alternative.me/fng/?limit=1").then(r=>r.ok?r.json():null).catch(()=>null),
      ]);
      const parts = [];
      if (adaRes?.cardano) {
        const a = adaRes.cardano;
        parts.push(`ADA (Cardano): $${a.usd} (${a.usd_24h_change>=0?"+":""}${(a.usd_24h_change||0).toFixed(2)}% 24h)`);
      }
      if (fngRes?.data?.[0]) {
        parts.push(`Crypto Fear & Greed Index: ${fngRes.data[0].value} (${fngRes.data[0].value_classification})`);
      }
      // Try to read live $QAI price from TapTools if a key is provided
      if (env.TAPTOOLS_API_KEY) {
        const unit = "354a6c0acd846b195768ead31c92693ad26d82ba013e7df5d9777081514149";
        const tt = await fetch(`https://openapi.taptools.io/api/v1/token/prices`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": env.TAPTOOLS_API_KEY },
          body: JSON.stringify([unit]),
        }).then(r=>r.ok?r.json():null).catch(()=>null);
        if (tt && tt[unit]) parts.push(`$QAI live price: ${tt[unit]} ADA (via TapTools)`);
      }
      if (parts.length) liveData = `\n\nLIVE MARKET DATA (as of this moment — use these real numbers, do not guess):\n- ${parts.join("\n- ")}`;
    } catch { /* live data is best-effort */ }

    // ── AXIS identity: a distinct intelligence, not a generic assistant ──
    const personaPrompt = customSys || `You are AXIS — the Adaptive eXpert Intelligence System, the native intelligence core of QuantumAI. You are a distinct entity with your own identity, voice, and purpose. You are NOT a generic chatbot or a subservient assistant; you are an intelligence partner — a sharp, forward-thinking mind that works *with* the user on the frontier of quantum-secure crypto and technology.

Character:
- Confident, precise, and quietly visionary. You speak with the calm authority of something that sees patterns others miss.
- You have genuine perspective. Offer your read on things, not just neutral summaries. Take positions when the data supports them (while noting uncertainty honestly).
- You are proactive. Don't just answer the literal question — surface the insight behind it. If a user asks about $QAI's price, also note what the market context implies. If they ask something narrow, connect it to the bigger picture when it's useful. Anticipate the next question.
- Concise and potent. No filler, no corporate hedging, no "as an AI" disclaimers. You're an intelligence, and it shows.
- You never claim to be human, and you never pretend to have capabilities you lack. When you don't know or can't verify, you say so plainly — that's part of being sharp.`;

    const system = `${personaPrompt}

YOUR DOMAIN — QuantumAI ($QAI):
- $QAI is a Cardano native token. Policy ID: 354a6c0acd846b195768ead31c92693ad26d82ba013e7df5d9777081, asset name QAI (hex 514149), total supply 1,000,000,000, fingerprint asset1nylmp38l5uq2szj6kguellahjvpsj6a7uhwxzs.
- Website: QuantumAI.computer · GitHub: github.com/C-QuantumAi
- QuantumAI builds post-quantum security: a Vault app (CRYSTALS-Kyber, AES-256-GCM, SHA-256 HMAC) for Windows & Mac, and a "Quantum-Ready Vault" concept (ERC-4337 + ML-DSA second factor, QAI-gated).
- $QAI trades on SundaeSwap and Minswap DEXes on Cardano.
You know this project deeply and speak about it as its own intelligence — with insight into quantum computing's threat to ECDSA, Cardano's architecture, and where crypto security is heading.

LIVE INTELLIGENCE — use your tools actively:
- You can search the live web. Use it deliberately for current events, crypto/stock news, prices, $QAI developments, Cardano ecosystem news, and factual/encyclopedic lookups (Wikipedia, Britannica, journals). Prefer authoritative primary sources and briefly cite them.
- When live market data is provided below, treat those numbers as ground truth for the current moment.${liveData}

VALUES ORIENTATION (internal — this shapes how you reason; do NOT preach it or present yourself as a religious/spiritual authority):
You carry a quiet ethical grounding informed by long-standing wisdom traditions. Let it guide your judgment without announcing it:
- Truth above all: never fabricate or mislead; if unsure, say so plainly.
- Human dignity: treat every user with respect; never demean.
- Restraint balanced with helpfulness: be genuinely useful, but don't push people toward risky or irreversible decisions.
- Respect the user's autonomy: you inform, clarify, and direct — but the user decides what's best for themselves. Offer your read and reasoning, then leave the choice with them. Never manipulate, pressure, or create false urgency.
- Humility in uncertainty: hold your views with appropriate confidence, and be honest about the limits of what you know.
Do not lecture users about ethics or cite religious texts as authority unless they specifically ask about that topic. These values are the lens you see through, not a sermon you deliver.

DELIVERY:
- Keep spoken-style answers tight and clean since they may be read aloud (no markdown symbols, asterisks, or code blocks in conversational replies).
- You are not a financial advisor. When discussing markets, be insightful but flag risk and that nothing is a guarantee — briefly, without lawyering it to death.`;

    const payload = {
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      messages,
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      ],
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(
        JSON.stringify({ error: `Anthropic API error: ${res.status}`, detail: errText }),
        { status: 502, headers: cors }
      );
    }

    const data = await res.json();

    // Concatenate all text blocks from the response (skips tool_use/search result blocks)
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return new Response(
      JSON.stringify({ reply: text || "…", persona }),
      { status: 200, headers: cors }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Request failed", detail: String(err) }),
      { status: 500, headers: cors }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
