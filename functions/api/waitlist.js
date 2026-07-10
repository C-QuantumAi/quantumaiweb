// Cloudflare Pages Function: POST /api/waitlist
// Stores Quantum Vault beta signups. Uses a KV namespace bound as WAITLIST if
// configured; otherwise still returns ok so the front-end UX works (you can add
// the KV binding later in Settings → Functions → KV namespace bindings).

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const body = await request.json();
    const email = (body.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid email." }), { status: 400, headers: cors });
    }
    const record = {
      email,
      chains: Array.isArray(body.chains) ? body.chains.slice(0, 10) : [],
      walletAddr: typeof body.walletAddr === "string" ? body.walletAddr.slice(0, 120) : null,
      qaiBalance: Number(body.qaiBalance) || 0,
      ts: new Date().toISOString(),
      ua: request.headers.get("user-agent") || "",
    };

    // Persist to KV if a binding named WAITLIST exists
    if (env.WAITLIST && typeof env.WAITLIST.put === "function") {
      const key = `wl:${Date.now()}:${email}`;
      await env.WAITLIST.put(key, JSON.stringify(record));
    }
    // (No KV bound yet → we still succeed so signups aren't blocked;
    //  add the binding later to start durably storing them.)

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: "Request failed", detail: String(err) }), { status: 500, headers: cors });
  }
}

export async function onRequestGet(context) {
  // Simple health check — never returns HTML
  return new Response(
    JSON.stringify({ status: "ok", function: "waitlist", kv_bound: !!(context.env && context.env.WAITLIST) }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
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
