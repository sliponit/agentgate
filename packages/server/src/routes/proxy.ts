/**
 * proxy.ts
 *
 * Handles GET/POST /api/proxy/:endpointId
 *
 * Flow:
 *   1. No PAYMENT-SIGNATURE  → return 402 with Hedera payment terms
 *                              (amount = endpoint price in tinybars, live rate)
 *   2. PAYMENT-SIGNATURE present → verify via Hedera Mirror Node
 *   3. Valid payment → forward request to backend URL with injected auth headers
 *   4. Return upstream response verbatim
 */

import { Hono } from "hono";
import { createPublicClient, http } from "viem";
import { defineChain } from "viem";
import { proxyStore } from "../services/proxyStore";
import { HederaFacilitatorClient } from "../services/hederaFacilitator";
import { usdToTinybars } from "../services/hbarRate";
import { config } from "../config";

const HEDERA_RPC  = process.env.HEDERA_TESTNET_RPC || "https://testnet.hashio.io/api";
const REGISTRY    = (process.env.PUBLISHER_REGISTRY || "0xFBCee3E39A0909549fbc28cac37141d01f946189") as `0x${string}`;
const PAYTO       = config.publisherAddress as `0x${string}`;

const hederaChain = defineChain({
  id: 296, name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: { default: { http: [HEDERA_RPC] } },
});

const REGISTRY_ABI = [
  {
    name: "endpoints",
    type: "function",
    inputs:  [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "id",           type: "uint256" },
      { name: "publisher",    type: "address" },
      { name: "url",          type: "string"  },
      { name: "pricePerCall", type: "uint256" },
      { name: "paymaster",    type: "address" },
      { name: "active",       type: "bool"    },
      { name: "totalCalls",   type: "uint256" },
      { name: "totalRevenue", type: "uint256" },
      { name: "registeredAt", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

const facilitator = new HederaFacilitatorClient();

const router = new Hono();

// ── GET or POST /api/proxy/:endpointId[/*] ─────────────────────────────────
router.all("/:endpointId/*", async (c) => {
  const endpointId = parseInt(c.req.param("endpointId"), 10);
  if (isNaN(endpointId)) {
    return c.json({ error: "Invalid endpoint ID" }, 400);
  }

  // 1. Proxy config must exist
  const proxyConfig = proxyStore.get(endpointId);
  if (!proxyConfig) {
    return c.json({ error: `No proxy config for endpoint #${endpointId}. Register via POST /api/publisher/proxy-config` }, 404);
  }

  // 2. Read endpoint from chain to get price + publisher address
  let priceUsd = 0.01; // fallback (registry stores USD, 6 decimals)
  let payTo     = PAYTO;
  try {
    const client = createPublicClient({ chain: hederaChain, transport: http(HEDERA_RPC) });
    const ep = await client.readContract({
      address: REGISTRY, abi: REGISTRY_ABI,
      functionName: "endpoints", args: [BigInt(endpointId)],
    }) as readonly [bigint, `0x${string}`, string, bigint, `0x${string}`, boolean, bigint, bigint, bigint];

    if (!ep[5]) return c.json({ error: "Endpoint is inactive" }, 403);
    priceUsd = Number(ep[3]) / 1_000_000;
    payTo     = ep[1]; // publisher address is the recipient
  } catch (err: any) {
    console.warn(`[proxy] Could not read endpoint #${endpointId} from chain:`, err.message);
  }

  // 3. Check for payment
  const paymentHeader = c.req.header("PAYMENT-SIGNATURE") || c.req.header("payment-signature");

  if (!paymentHeader) {
    // Return a proper 402 challenge
    const amount  = await usdToTinybars(priceUsd);
    const accepts = [{
      scheme:  "exact",
      network: "eip155:296",
      payTo,
      amount:  amount.toString(),
      asset:   "hbar",
      extra:   { name: "HBAR", decimals: 8, assetTransferMethod: "hedera-native" },
    }];
    const paymentRequired = { x402Version: 1, accepts };
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");
    c.header("PAYMENT-REQUIRED", encoded);
    c.header("Content-Type", "application/json");
    return c.json(paymentRequired, 402);
  }

  // 4. Verify payment
  let paymentPayload: any;
  try {
    paymentPayload = JSON.parse(Buffer.from(paymentHeader, "base64").toString("utf-8"));
  } catch {
    return c.json({ error: "Invalid PAYMENT-SIGNATURE header (not base64 JSON)" }, 400);
  }

  const amount         = await usdToTinybars(priceUsd);
  const requirements   = { scheme: "exact", network: "eip155:296", payTo, amount: amount.toString(), asset: "hbar" };
  const verifyResult   = await facilitator.verify(paymentPayload, requirements);

  if (!verifyResult.isValid) {
    console.warn(`[proxy] Payment invalid for endpoint #${endpointId}: ${verifyResult.invalidReason}`);
    return c.json({ error: `Payment invalid: ${verifyResult.invalidReason}` }, 402);
  }

  console.log(`[proxy] ✅ Payment verified for endpoint #${endpointId} ($${priceUsd} USD → ${amount} tinybars HBAR)`);

  // 5. Forward to upstream backend
  const method      = c.req.method;
  const bodyBuffer  = method !== "GET" && method !== "HEAD" ? await c.req.arrayBuffer() : undefined;

  // Build upstream headers: forward content-type + inject publisher auth headers
  const upstreamHeaders: Record<string, string> = {};
  const ct = c.req.header("content-type");
  if (ct) upstreamHeaders["content-type"] = ct;
  const accept = c.req.header("accept");
  if (accept) upstreamHeaders["accept"] = accept;

  // Inject the publisher's private auth headers (API keys etc.)
  for (const [k, v] of Object.entries(proxyConfig.injectHeaders)) {
    upstreamHeaders[k.toLowerCase()] = v;
  }

  // Forward path suffix after /api/proxy/:id/
  const rawPath   = c.req.path; // e.g. /api/proxy/5/v1/messages
  const suffix    = rawPath.replace(new RegExp(`^/api/proxy/${endpointId}`), ""); // → /v1/messages
  const upstream  = proxyConfig.backendUrl.replace(/\/$/, "") + suffix;
  const qs        = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream + qs, {
      method,
      headers: upstreamHeaders,
      body:    bodyBuffer,
    });
  } catch (err: any) {
    console.error(`[proxy] Upstream fetch failed:`, err.message);
    return c.json({ error: `Upstream error: ${err.message}` }, 502);
  }

  console.log(`[proxy] ← upstream ${upstreamRes.status} for endpoint #${endpointId} → ${upstream}`);

  // Return upstream response verbatim (preserve content-type, status)
  const upstreamBody = await upstreamRes.arrayBuffer();
  const upCt         = upstreamRes.headers.get("content-type") || "application/json";
  return new Response(upstreamBody, {
    status:  upstreamRes.status,
    headers: { "content-type": upCt },
  });
});

export default router;
