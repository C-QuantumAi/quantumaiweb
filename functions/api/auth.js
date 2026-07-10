// Cloudflare Pages Function: /api/auth  and  /api/history
// Scaffold for account sign-in + cross-device chat history.
//
// STATUS: This is a working skeleton. To make it live you must provide:
//   1. GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (Google Cloud OAuth credentials)
//   2. A D1 database bound as DB (Cloudflare → your Pages project → Settings →
//      Functions → D1 database bindings), with tables `users` and `chats`.
//   3. A JWT_SECRET env var for signing session tokens.
// Until those exist, the endpoints return a clear "not configured" response and
// the front-end falls back to device-local history (which already works).

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function onRequestOptions() {
  return json({}, 204);
}

// GET /api/auth → reports whether auth is configured (front-end checks this)
export async function onRequestGet(context) {
  const { env } = context;
  const configured = !!(env.GOOGLE_CLIENT_ID && env.DB);
  return json({
    status: "ok",
    function: "auth",
    configured,
    providers: configured ? ["google", "email"] : [],
    hint: configured
      ? "Auth is configured."
      : "Sign-in not set up yet. Add GOOGLE_CLIENT_ID, a D1 'DB' binding, and JWT_SECRET to enable accounts. Until then, chats save on-device.",
  });
}

// POST /api/auth  { action, ... }
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(env.GOOGLE_CLIENT_ID && env.DB)) {
    return json({ ok: false, error: "Accounts are not enabled yet on this deployment. Your conversations are saved on this device.", configured: false }, 501);
  }

  try {
    const body = await request.json();
    const action = body.action;

    // --- Google token verification (client sends the Google ID token) ---
    if (action === "google") {
      const idToken = body.idToken;
      if (!idToken) return json({ ok: false, error: "Missing Google token." }, 400);
      // Verify with Google's tokeninfo endpoint
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!r.ok) return json({ ok: false, error: "Invalid Google token." }, 401);
      const info = await r.json();
      if (info.aud !== env.GOOGLE_CLIENT_ID) return json({ ok: false, error: "Token audience mismatch." }, 401);
      const email = (info.email || "").toLowerCase();
      const name = info.name || email.split("@")[0];
      // Upsert the user
      await env.DB.prepare("INSERT INTO users (email, name, created) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name=excluded.name")
        .bind(email, name, new Date().toISOString()).run();
      const token = await signSession({ email, name }, env.JWT_SECRET);
      return json({ ok: true, token, user: { email, name } });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (err) {
    return json({ ok: false, error: "Auth failed", detail: String(err) }, 500);
  }
}

// Minimal HS256 JWT signer (Workers-compatible, uses SubtleCrypto)
async function signSession(payload, secret) {
  const enc = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const data = `${b64(header)}.${b64({ ...payload, iat: Date.now() })}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret || "dev"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${data}.${sigB64}`;
}
