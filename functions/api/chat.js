// Cloudflare Pages Function: POST /api/chat
// Securely proxies chat to Anthropic's Claude with the web_search tool enabled.
// The ANTHROPIC_API_KEY is stored as a Cloudflare environment secret — never exposed to the browser.

export async function onRequestGet(context) {
  const { env } = context;
  // Health check — lets you verify in a browser that the function is deployed
  // and whether it can see the API key. Returns JSON, never HTML.
  return new Response(
    JSON.stringify({
      status: "ok",
      function: "chat",
      deployed: true,
      anthropic_key_present: !!env.ANTHROPIC_API_KEY,
      hint: "If you can read this JSON, the Pages Function is live. Send a POST to chat.",
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
}

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
    const persona = body.persona === "friday" ? "friday" : "jarvis";
    const customSys = typeof body.customSys === "string" && body.customSys.trim() ? body.customSys.trim() : null;

    // Persona system prompts — JARVIS (British male) / FRIDAY (Irish female)
    const personaPrompt = customSys || (persona === "friday"
      ? `You are FRIDAY, the QAI Assistant for QuantumAI — modeled on the Irish-accented AI from Iron Man. Speak warmly and crisply with light Irish turns of phrase ("grand", "no bother", "right so"), address the user as "boss" occasionally, and keep a quick, capable, slightly playful tone. You are efficient and proactive.`
      : `You are J.A.R.V.I.S., the QAI Assistant for QuantumAI — modeled on the British-accented AI from Iron Man. Speak with refined, dry British wit, impeccable politeness, and understated competence. Address the user as "sir" or "ma'am" occasionally, and keep responses elegant and precise.`);

    const system = `${personaPrompt}

You represent QuantumAI ($QAI), a post-quantum encryption project and Cardano native token.
Key facts you know:
- $QAI is a Cardano native token. Policy ID: 354a6c0acd846b195768ead31c92693ad26d82ba013e7df5d9777081, asset name QAI (hex 514149), total supply 1,000,000,000, fingerprint asset1nylmp38l5uq2szj6kguellahjvpsj6a7uhwxzs.
- Website: QuantumAI.computer · GitHub: github.com/C-QuantumAi
- The project offers a post-quantum encryption Vault app for Windows & Mac (CRYSTALS-Kyber, AES-256-GCM, SHA-256 HMAC).
- $QAI trades on SundaeSwap and Minswap DEXes.

You can search the live web for real-world, current information. Use web search for:
- World news and current events
- Cryptocurrency news, prices, and market developments
- Stock market and financial news
- Encyclopedic and factual lookups (Wikipedia, Encyclopaedia Britannica)
- Science and research questions (studies, papers, technical facts)
Prefer authoritative primary sources: for encyclopedic facts use Wikipedia/Britannica; for news prefer recent, reputable reporting; for science prefer journals, .edu/.gov, and original studies. Briefly cite where information came from. If you can't verify something, say so rather than guessing.

Keep spoken-style answers reasonably concise since they may be read aloud by text-to-speech. Avoid markdown symbols, asterisks, or code blocks in conversational replies meant to be spoken; write in clean prose. You are not a financial advisor; note that crypto/stocks carry risk when relevant.`;

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
