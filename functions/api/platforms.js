// GET /api/platforms → which installers are configured + minimum QAI (public, cacheable)
import { json, configuredPlatforms } from "../_gate.js";
export async function onRequestGet({ env }) {
  return json({ platforms: configuredPlatforms(env), minQai: env.MIN_QAI || "1", gateReady: !!env.TOKEN_SECRET }, 200, { "Cache-Control": "public, max-age=60" });
}
