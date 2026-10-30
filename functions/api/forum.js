// Bug forum.
//   POST /api/forum  { name?, email?, category, title, body, steps?, version?, os?, website(honeypot) }
//        → stores the note (KV, 1 year) and emails it to FORUM_TO via Resend.
//   GET  /api/forum?limit=50 → recent public notes (emails never returned).
import { json, overLimit, sha256Hex, ipOf, validatePost, postEmailHtml } from "../_gate.js";
export const onRequestOptions = () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });

async function sendEmail(env, post, meta) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY not set" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FORUM_FROM || "QuantumAI Forum <onboarding@resend.dev>",
      to: [env.FORUM_TO || "cardano.quantumai@gmail.com"],
      reply_to: post.email || undefined,
      subject: `[QAI Vault ${post.category}] ${post.title}`.slice(0, 180),
      html: postEmailHtml(post, meta),
      text: `${post.title}\n${post.category} · ${post.name}${post.email ? " <" + post.email + ">" : ""}\nVersion: ${post.version}  OS: ${post.os}\n\n${post.body}\n\n${post.steps ? "Steps:\n" + post.steps : ""}`,
    }),
  });
  return r.ok ? { ok: true } : { ok: false, reason: "email provider responded " + r.status };
}

export async function onRequestPost({ request, env }) {
  const ip = ipOf(request);
  if (await overLimit(env, "forum:" + await sha256Hex(ip), 5, 3600)) return json({ ok: false, reason: "You've posted a lot recently — please wait an hour." }, 429);
  let body; try { body = await request.json(); } catch { return json({ ok: false, reason: "Bad request." }, 400); }
  const v = validatePost(body || {});
  if (!v.ok) return v.reason === "spam" ? json({ ok: true, id: "ok" }) : json({ ok: false, reason: v.reason }, 400); // honeypot: pretend success
  const id = Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 8);
  const when = new Date().toISOString();
  const ipHash = (await sha256Hex(ip + (env.TOKEN_SECRET || ""))).slice(0, 12);
  if (env.GATE) await env.GATE.put("post:" + String(9999999999999 - Date.now()).padStart(13, "0") + ":" + id, JSON.stringify({ id, when, ...v.post }), { expirationTtl: 60 * 60 * 24 * 365 });
  const mail = await sendEmail(env, v.post, { id, when, ipHash });
  return json({ ok: true, id, emailed: mail.ok, note: mail.ok ? undefined : "Saved to the board. Email delivery isn't configured yet (" + mail.reason + ")." });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url); const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  if (!env.GATE) return json({ posts: [], note: "Board storage (KV) not bound yet." });
  const list = await env.GATE.list({ prefix: "post:", limit });
  const posts = [];
  for (const k of list.keys) { const v = await env.GATE.get(k.name); if (!v) continue; try { const p = JSON.parse(v); delete p.email; posts.push(p); } catch {} }
  return json({ posts }, 200, { "Cache-Control": "public, max-age=30" });
}
