import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { LocalFacilitatorClient } from "./services/localFacilitator";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/hono";
import {
  agentkitResourceServerExtension,
  createAgentBookVerifier,
  createAgentkitHooks,
  declareAgentkitExtension,
  InMemoryAgentKitStorage,
} from "@worldcoin/agentkit";

import { config, HEDERA } from "./config";
import { usdToTinybars } from "./services/hbarRate";
import weatherRouter from "./routes/weather";
import pricesRouter from "./routes/prices";
import publisherRouter from "./routes/publisher";
import proxyRouter from "./routes/proxy";

const payTo = config.publisherAddress as `0x${string}`;

// ── AgentKit setup ────────────────────────────────────────────────────────────
// AgentBook verifier queries the World Chain contract to confirm the calling
// agent was delegated by a real human who has a World ID.
const agentBook = createAgentBookVerifier();
const storage   = new InMemoryAgentKitStorage();
const hooks     = createAgentkitHooks({
  agentBook,
  storage,
  // WorldID-verified agents get 3 free calls; after that they pay HBAR like anyone else.
  // Agents without a valid AgentBook entry bypass the free-trial and go straight to payment.
  mode: { type: "free-trial", uses: 3 },
  onEvent: (event) => {
    switch (event.type) {
      case "agent_verified":
        console.log(`[AgentKit] ✅ Human-backed agent verified: ${event.address} (humanId: ${event.humanId?.slice(0, 10)}…) → free access granted`);
        break;
      case "agent_not_verified":
        console.log(`[AgentKit] ⚠ Agent ${event.address} not in World Chain AgentBook → payment required`);
        break;
      case "validation_failed":
        console.log(`[AgentKit] ✗ AgentKit header validation failed: ${event.error}`);
        break;
    }
  },
});

// ── x402 resource server ──────────────────────────────────────────────────────
// LocalFacilitatorClient: supports World Chain + Base without needing a live facilitator
// (demo mode — simulates settlement for non-Base-Sepolia chains)
const facilitatorClient = new LocalFacilitatorClient() as any;

// Scheme for Hedera Testnet — native HBAR payments
// Amount expressed in tinybars; live rate via shared hbarRate utility
const hederaEvmScheme = new ExactEvmScheme().registerMoneyParser(
  async (amount: number, network: string) => {
    if (network !== HEDERA) return null;
    const tinybars = await usdToTinybars(amount);
    return {
      amount: tinybars.toString(),
      asset:  "hbar",
      extra:  { name: "HBAR", decimals: 8, assetTransferMethod: "hedera-native" },
    };
  }
);

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(HEDERA, hederaEvmScheme)
  .registerExtension(agentkitResourceServerExtension);

// ── Protected route definitions ───────────────────────────────────────────────
const agentkitExt = declareAgentkitExtension({
  statement: "Verify your agent is backed by a real human",
  mode: { type: "free-trial", uses: 3 },
});

const routes = {
  "GET /api/weather/:city": {
    accepts: [
      { scheme: "exact" as const, price: "$0.01",  network: HEDERA, payTo },
    ],
    extensions: agentkitExt,
  },
  "GET /api/prices/:token": {
    accepts: [
      { scheme: "exact" as const, price: "$0.005", network: HEDERA, payTo },
    ],
    extensions: agentkitExt,
  },
};

// ── Hono app ──────────────────────────────────────────────────────────────────
const app = new Hono();

// Proxy routes — mounted BEFORE x402 middleware; handle their own 402 flow
// so each endpoint can have its own dynamic price from the on-chain registry.
app.route("/api/proxy", proxyRouter);

// Payment middleware (handles 402 challenge/response)
const httpServer = new x402HTTPResourceServer(resourceServer, routes).onProtectedRequest(
  hooks.requestHook
);
app.use(paymentMiddlewareFromHTTPServer(httpServer));

// Health check (unprotected)
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    endpoints: 2,
    agentkit: true,
    version: "1.0.0",
    protectedRoutes: Object.keys(routes),
  });
});

// Mount protected routes
app.route("/api/weather", weatherRouter);
app.route("/api/prices", pricesRouter);

// Publisher management (unprotected)
app.route("/api/publisher", publisherRouter);

// Request logger
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const payment = c.req.header("X-PAYMENT-RESPONSE") ? " [PAID]" : "";
  console.log(`${c.req.method} ${c.req.path} → ${c.res.status} ${ms}ms${payment}`);
});

// ── Start server ──────────────────────────────────────────────────────────────
serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`\n🚀 AgentGate Server running on port ${info.port}`);
    console.log(`\n📡 Protected endpoints:`);
    console.log(`   GET /api/weather/:city  — $0.01  HBAR (Hedera Testnet)`);
    console.log(`   GET /api/prices/:token  — $0.005 HBAR (Hedera Testnet)`);
    console.log(`\n🔀 Proxy endpoints (any registered API subscription):`);
    console.log(`   ANY /api/proxy/:endpointId  — HBAR payment → forward to upstream`);
    console.log(`\n🔓 Public endpoints:`);
    console.log(`   GET  /health`);
    console.log(`   POST /api/publisher/proxy-config   — register proxy (wallet-signed)`);
    console.log(`   GET  /api/publisher/proxy-config/:id`);
    console.log(`\n🆔 AgentKit: free-trial mode (3 uses), World Chain AgentBook`);
    console.log(`💳 Payments to: ${payTo}\n`);
  }
);

export default app;
