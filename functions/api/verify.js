// POST /api/verify { address }  → { eligible, quantity, checked, token, expiresInMin, platforms } | { eligible:false, reason }
// Address may be addr1…, stake1…, or the hex CIP-30 form a browser wallet returns.
// Holdings are checked for the whole ACCOUNT (stake key) via Koios, so a cold
// wallet's funds split across many addresses still count.
import { json, needSecret, overLimit, sha256Hex, ipOf, checkHoldings, signToken, configuredPlatforms } from "../_gate.js";
export const onRequestOptions = () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
export async function onRequestPost({ request, env }) {
  const ns = needSecret(env); if (ns) return ns;
  const ip = ipOf(request);
  if (await overLimit(env, "verify:" + await sha256Hex(ip), 20, 600)) return json({ eligible: false, reason: "Too many checks from this connection. Try again in 10 minutes." }, 429);
  let body; try { body = await request.json(); } catch { return json({ eligible: false, reason: "Bad request." }, 400); }
  const address = String(body && body.address || "").trim();
  if (!address || address.length > 240) return json({ eligible: false, reason: "Paste a Cardano address." }, 400);
  let res;
  try { res = await checkHoldings(address, { fetchFn: fetch, minQai: BigInt(env.MIN_QAI || "1"), koiosKey: env.KOIOS_API_KEY || "", blockfrostKey: env.BLOCKFROST_API_KEY || "" }); }
  catch (e) { return json({ eligible: false, reason: String(e.message || e) }, 502); }
  if (!res.eligible) return json(res);
  const walletKey = "w:" + await sha256Hex(res.stake || address);
  if (await overLimit(env, walletKey, parseInt(env.DAILY_PER_WALLET || "5", 10), 86400)) return json({ eligible: true, quantity: res.quantity, reason: "This wallet has reached today's download limit. Try again tomorrow." }, 429);
  const ttlMin = parseInt(env.TOKEN_TTL_MIN || "15", 10);
  const token = await signToken(env.TOKEN_SECRET, { jti: crypto.randomUUID(), w: walletKey.slice(2, 18), exp: Date.now() + ttlMin * 60000 });
  return json({ eligible: true, quantity: res.quantity, checked: res.checked, token, expiresInMin: ttlMin, platforms: configuredPlatforms(env) });
}
