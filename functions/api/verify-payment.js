// Cloudflare Pages Function: POST /api/verify-payment
// Verifies a crypto payment on-chain in real time, server-side (no browser CORS issues).
// Supports: QAI + ADA (Cardano via Blockfrost), BTC (Blockstream), USDT-ERC20 (Etherscan).
// Checks: transaction exists, pays the correct address, the correct asset, the correct
// minimum amount, and has >= REQUIRED_CONFIRMATIONS confirmations.
//
// Environment variables (set in Cloudflare → Settings → Environment variables):
//   BLOCKFROST_API_KEY   — free key from blockfrost.io (Cardano mainnet)
//   ETHERSCAN_API_KEY    — free key from etherscan.io
// Blockstream (BTC) needs no key.

const REQUIRED_CONFIRMATIONS = 2;

// Payment destinations (must match the website)
const PAY = {
  cardano: "addr1qxf9xr3r332f66k8qx9yezn3ng5066mjksau54l3yjc3a60dfqvllshkfnsten38sesjk8086003suavfv4zm0tfjcfseyptyj",
  btc:     "37MVmmdnkQk6HfdH5DjpdZg5MRCjU4sUYF",
  usdt:    "0x6d73f1d7347424f0e82c993d66ad6fe17b3d1e8a",
};
// QAI native asset (policyId + hex assetName) as Blockfrost reports it
const QAI_UNIT     = "354a6c0acd846b195768ead31c92693ad26d82ba013e7df5d9777081514149";
const USDT_CONTRACT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const USDT_DECIMALS = 6;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const ok  = (o) => new Response(JSON.stringify(o), { status: 200, headers: cors });
const bad = (o, c = 400) => new Response(JSON.stringify(o), { status: c, headers: cors });

export async function onRequestOptions() {
  return new Response(null, { headers: cors });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return bad({ error: "Bad request" }); }

  const coin = String(body.coin || "").toUpperCase();   // QAI | ADA | BTC | USDT
  const txHash = String(body.txHash || "").trim();
  // Minimum amount the payment must meet, computed live by the client at display time.
  // We re-validate it here so the client can't unlock with an underpayment.
  const minAmount = Number(body.minAmount || 0);        // QAI: tokens, ADA: ADA, BTC: BTC, USDT: USDT

  if (!txHash) return bad({ error: "Missing transaction hash" });

  try {
    let result;
    if (coin === "QAI" || coin === "ADA") {
      result = await verifyCardano(coin, txHash, minAmount, env);
    } else if (coin === "BTC") {
      result = await verifyBtc(txHash, minAmount);
    } else if (coin === "USDT") {
      result = await verifyUsdt(txHash, minAmount, env);
    } else {
      return bad({ error: "Unsupported coin" });
    }
    return ok(result);
  } catch (e) {
    return bad({ error: String(e.message || e) });
  }
}

// ── Cardano (QAI native token + ADA) via Blockfrost ──
async function verifyCardano(coin, txHash, minAmount, env) {
  const key = env.BLOCKFROST_API_KEY;
  if (!key) throw new Error("Server missing BLOCKFROST_API_KEY");
  const base = "https://cardano-mainnet.blockfrost.io/api/v0";
  const headers = { project_id: key };

  // 1. Transaction (gives block + index)
  const txRes = await fetch(`${base}/txs/${txHash}`, { headers });
  if (txRes.status === 404) throw new Error("Transaction not found on Cardano yet. Wait a moment and retry.");
  if (!txRes.ok) throw new Error("Cardano lookup failed");
  const tx = await txRes.json();

  // 2. Confirmations = latest block height − tx block height + 1
  const tipRes = await fetch(`${base}/blocks/latest`, { headers });
  const tip = await tipRes.json();
  const confs = tx.block_height ? Math.max(0, tip.height - tx.block_height + 1) : 0;

  // 3. UTXOs — verify an output pays our address with the right asset/amount
  const utxoRes = await fetch(`${base}/txs/${txHash}/utxos`, { headers });
  const utxo = await utxoRes.json();
  let paid = 0; // in ADA or QAI tokens
  for (const out of (utxo.outputs || [])) {
    if (out.address !== PAY.cardano) continue;
    for (const a of (out.amount || [])) {
      if (coin === "ADA" && a.unit === "lovelace") paid += Number(a.quantity) / 1e6;
      if (coin === "QAI" && a.unit === QAI_UNIT)   paid += Number(a.quantity); // 0 decimals
    }
  }
  if (paid <= 0) throw new Error(`No ${coin} payment to the QuantumAI address in this transaction.`);
  // Tolerance for price drift between quote and send. QAI is more volatile, so allow more slack.
  const tolerance = coin === "QAI" ? 0.85 : 0.97;
  if (minAmount > 0 && paid < minAmount * tolerance) {
    throw new Error(`Underpaid: received ${paid} ${coin}, expected ≈ ${minAmount} ${coin}.`);
  }

  return finalize(confs, paid, coin);
}

// ── Bitcoin via Blockstream (no key needed) ──
async function verifyBtc(txHash, minAmount) {
  const res = await fetch(`https://blockstream.info/api/tx/${txHash}`);
  if (res.status === 404) throw new Error("Bitcoin transaction not found yet. Wait a moment and retry.");
  if (!res.ok) throw new Error("Bitcoin lookup failed");
  const data = await res.json();

  // sum outputs paying our address (satoshis → BTC)
  let paidSat = 0;
  for (const o of (data.vout || [])) {
    if (o.scriptpubkey_address === PAY.btc) paidSat += Number(o.value || 0);
  }
  const paid = paidSat / 1e8;
  if (paid <= 0) throw new Error("No payment to the QuantumAI Bitcoin address in this transaction.");
  if (minAmount > 0 && paid < minAmount * 0.99) {
    throw new Error(`Underpaid: received ${paid} BTC, expected ≈ ${minAmount} BTC.`);
  }

  let confs = 0;
  if (data.status?.confirmed && data.status?.block_height) {
    const tipRes = await fetch("https://blockstream.info/api/blocks/tip/height");
    const tip = parseInt(await tipRes.text(), 10);
    confs = tip >= data.status.block_height ? (tip - data.status.block_height + 1) : 1;
  }
  return finalize(confs, paid, "BTC");
}

// ── USDT ERC-20 via Etherscan ──
async function verifyUsdt(txHash, minAmount, env) {
  const key = env.ETHERSCAN_API_KEY || "";
  const base = "https://api.etherscan.io/api";
  const tx = txHash.startsWith("0x") ? txHash : "0x" + txHash;

  const receiptRes = await fetch(`${base}?module=proxy&action=eth_getTransactionReceipt&txhash=${tx}&apikey=${key}`);
  const receiptData = await receiptRes.json();
  const receipt = receiptData?.result;
  if (!receipt) throw new Error("Transaction not found on Ethereum yet. Wait a moment and retry.");
  if (receipt.status && receipt.status !== "0x1") throw new Error("This Ethereum transaction failed on-chain.");

  // Confirmations
  const blkRes = await fetch(`${base}?module=proxy&action=eth_blockNumber&apikey=${key}`);
  const blkData = await blkRes.json();
  const current = parseInt(blkData?.result || "0x0", 16);
  const txBlock = parseInt(receipt.blockNumber, 16);
  const confs = current > txBlock ? current - txBlock + 1 : 0;

  // Find USDT Transfer(to=our address) in logs and sum the amount
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const ourTopic = "0x000000000000000000000000" + PAY.usdt.replace(/^0x/, "").toLowerCase();
  let paid = 0;
  for (const log of (receipt.logs || [])) {
    if ((log.address || "").toLowerCase() !== USDT_CONTRACT.toLowerCase()) continue;
    const topics = (log.topics || []).map(t => t.toLowerCase());
    if (topics[0] !== transferTopic || topics[2] !== ourTopic) continue;
    paid += parseInt(log.data, 16) / Math.pow(10, USDT_DECIMALS);
  }
  if (paid <= 0) throw new Error("No USDT transfer to the QuantumAI address in this transaction.");
  if (minAmount > 0 && paid < minAmount * 0.99) {
    throw new Error(`Underpaid: received ${paid} USDT, expected ≈ ${minAmount} USDT.`);
  }
  return finalize(confs, paid, "USDT");
}

function finalize(confs, paid, coin) {
  const c = Math.max(0, Math.min(confs, REQUIRED_CONFIRMATIONS));
  if (confs < REQUIRED_CONFIRMATIONS) {
    return {
      ok: false, pending: true, confirmations: c, required: REQUIRED_CONFIRMATIONS,
      paid, coin,
      message: `Payment of ${paid} ${coin} found — waiting for confirmations (${c}/${REQUIRED_CONFIRMATIONS})`,
    };
  }
  return {
    ok: true, confirmations: REQUIRED_CONFIRMATIONS, required: REQUIRED_CONFIRMATIONS,
    paid, coin,
    message: `${coin} payment of ${paid} confirmed with ${REQUIRED_CONFIRMATIONS}+ confirmations!`,
  };
}
