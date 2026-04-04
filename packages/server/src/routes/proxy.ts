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
import { proxyStore, callTracker } from "../services/proxyStore";
import { HederaFacilitatorClient } from "../services/hederaFacilitator";
import { usdToTinybars } from "../services/hbarRate";
import { validateAgentKitHeader } from "../services/agentkit";
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

/** Forward the request to the upstream backend (shared by free-trial + paid paths) */
async function forwardToUpstream(c: any, proxyConfig: any, endpointId: number): Promise<Response> {
  const method     = c.req.method;
  const bodyBuffer = method !== "GET" && method !== "HEAD" ? await c.req.arrayBuffer() : undefined;

  const upstreamHeaders: Record<string, string> = {};
  const ct = c.req.header("content-type");
  if (ct) upstreamHeaders["content-type"] = ct;
  const accept = c.req.header("accept");
  if (accept) upstreamHeaders["accept"] = accept;

  for (const [k, v] of Object.entries(proxyConfig.injectHeaders as Record<string, string>)) {
    upstreamHeaders[k.toLowerCase()] = v;
  }

  const rawPath  = c.req.path;
  const suffix   = rawPath.replace(new RegExp(`^/api/proxy/${endpointId}`), "");
  const upstream = proxyConfig.backendUrl.replace(/\/$/, "") + suffix;
  const qs       = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream + qs, { method, headers: upstreamHeaders, body: bodyBuffer });
  } catch (err: any) {
    console.error(`[proxy] Upstream fetch failed:`, err.message);
    return c.json({ error: `Upstream error: ${err.message}` }, 502);
  }

  console.log(`[proxy] ← upstream ${upstreamRes.status} for endpoint #${endpointId} → ${upstream}`);
  const upstreamBody = await upstreamRes.arrayBuffer();
  const upCt = upstreamRes.headers.get("content-type") || "application/json";
  return new Response(upstreamBody, { status: upstreamRes.status, headers: { "content-type": upCt } });
}

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

  // 3. WorldID free-trial check (before payment)
  // If publisher requires WorldID and agent provides a valid proof with AgentBook membership,
  // grant up to 3 free calls before requiring HBAR payment.
  const agentkitHeader = c.req.header("agentkit") ?? c.req.header("AGENTKIT");
  let worldIdVerified = false;
  let worldIdAddress: string | undefined;

  if (agentkitHeader) {
    const akResult = await validateAgentKitHeader(agentkitHeader, c.req.url);
    if (akResult.valid && akResult.humanId) {
      worldIdVerified = true;
      worldIdAddress = akResult.address;
      console.log(`[proxy] ✅ WorldID verified: ${akResult.address} (humanId: ${akResult.humanId.slice(0, 10)}…)`);

      // Free-trial: skip payment for verified agents
      const trial = callTracker.checkFreeTrial(akResult.address!, endpointId);
      if (trial.allowed) {
        callTracker.consumeFreeTrial(akResult.address!, endpointId);
        callTracker.record(endpointId, akResult.address!, true);
        console.log(`[proxy] 🎟  Free-trial call ${trial.used + 1}/3 for ${akResult.address} on endpoint #${endpointId}`);
        // Skip payment — jump straight to forwarding (step 5)
        return await forwardToUpstream(c, proxyConfig, endpointId);
      }
      console.log(`[proxy] Free-trial exhausted for ${akResult.address} on endpoint #${endpointId} — payment required`);
    } else if (akResult.valid && !akResult.humanId) {
      console.log(`[proxy] AgentKit valid but not in AgentBook: ${akResult.address} — no free-trial`);
    } else {
      // Invalid agentkit header — if WorldID is required, reject immediately
      if (proxyConfig.requireWorldId) {
        return c.json({ error: `WorldID verification failed: ${akResult.error}`, requireWorldId: true }, 403);
      }
    }
  }

  // If WorldID is required but no valid proof provided, reject before payment
  if (proxyConfig.requireWorldId && !worldIdVerified) {
    const amount = await usdToTinybars(priceUsd);
    const paymentRequired: any = {
      x402Version: 1,
      accepts: [{
        scheme: "exact", network: "eip155:296", payTo,
        amount: amount.toString(), asset: "hbar",
        extra: { name: "HBAR", decimals: 8, assetTransferMethod: "hedera-native" },
      }],
      requireWorldId: true,
      worldIdInfo: "This endpoint requires WorldID. Include a valid `agentkit` header. Verified agents get 3 free calls.",
    };
    c.header("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(paymentRequired)).toString("base64"));
    return c.json(paymentRequired, 402);
  }

  // 4. Check for payment
  const paymentHeader = c.req.header("PAYMENT-SIGNATURE") || c.req.header("payment-signature");

  if (!paymentHeader) {
    const amount  = await usdToTinybars(priceUsd);
    const accepts = [{
      scheme:  "exact",
      network: "eip155:296",
      payTo,
      amount:  amount.toString(),
      asset:   "hbar",
      extra:   { name: "HBAR", decimals: 8, assetTransferMethod: "hedera-native" },
    }];
    const paymentRequired: any = { x402Version: 1, accepts, endpointName: proxyConfig.name };
    if (proxyConfig.requireWorldId) {
      paymentRequired.requireWorldId = true;
      paymentRequired.freeTrialInfo = "WorldID-verified agents get 3 free calls. Include `agentkit` header for free-trial.";
    }
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");
    c.header("PAYMENT-REQUIRED", encoded);
    c.header("Content-Type", "application/json");
    return c.json(paymentRequired, 402);
  }

  // 5. Verify payment
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
  callTracker.record(endpointId, worldIdAddress || "unknown", false);

  // 6. Forward to upstream backend
  return await forwardToUpstream(c, proxyConfig, endpointId);
});

export default router;
