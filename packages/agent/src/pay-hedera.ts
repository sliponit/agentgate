/**
 * pay-hedera.ts
 *
 * Demonstrates a real dual-protocol flow:
 *
 *   1. Agent builds WorldID AgentKit proof (SIWE signed by agent wallet)
 *   2. Agent calls the endpoint WITH the agentkit header
 *      → Server verifies WorldID BEFORE issuing payment details
 *      → If not in AgentBook: 403 immediately (agent never pays)
 *      → If verified: 402 with payment details (or 200 on free trial)
 *   3. Agent sends native HBAR on Hedera Testnet
 *   4. Agent retries with PAYMENT-SIGNATURE (HBAR proof) + agentkit header
 *   5. Server verifies both → serves the response
 *
 * Usage: tsx src/pay-hedera.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type Address,
} from "viem";
import { defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { formatSIWEMessage } from "@worldcoin/agentkit";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ─── Config ──────────────────────────────────────────────────────────────────
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as Hex;
const SERVER_URL        = process.env.SERVER_URL || "http://localhost:4021";
const HEDERA_RPC        = process.env.HEDERA_TESTNET_RPC || "https://testnet.hashio.io/api";
const MIRROR_NODE       = "https://testnet.mirrornode.hedera.com";

if (!AGENT_PRIVATE_KEY) throw new Error("AGENT_PRIVATE_KEY not set in .env");

// Hedera Testnet EVM chain definition
const hederaTestnet = defineChain({
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: { default: { http: [HEDERA_RPC] } },
  blockExplorers: {
    default: { name: "HashScan", url: "https://hashscan.io/testnet" },
  },
});

// Hedera EVM unit conversion (per Hedera JSON-RPC Relay docs):
// 1 HBAR = 10^8 tinybars
// 1 ETH (EVM) = 1 HBAR = 10^18 wei (EVM)
// → 1 tinybar = 10^18 / 10^8 = 10^10 wei
// → value_wei = tinybars * 10^10
const WEI_PER_TINYBAR = 10_000_000_000n; // 10^10

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n" + "═".repeat(62));
  console.log("🤖 AgentGate — x402 Payment on Hedera Testnet (HBAR)");
  console.log("═".repeat(62));

  const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
  console.log(`\n👤 Agent wallet:  ${account.address}`);
  console.log(`🌐 Server:        ${SERVER_URL}`);
  console.log(`⛓  Network:       Hedera Testnet (eip155:296)`);

  // Viem clients for Hedera
  const publicClient = createPublicClient({ chain: hederaTestnet, transport: http(HEDERA_RPC) });
  const walletClient = createWalletClient({ account, chain: hederaTestnet, transport: http(HEDERA_RPC) });

  // Check balance
  const balanceWei = await publicClient.getBalance({ address: account.address });
  const balanceHbar = Number(balanceWei) / 1e18;
  console.log(`💰 Balance:       ${balanceHbar.toFixed(4)} HBAR`);

  // ── Step 1: Build WorldID AgentKit proof FIRST (before any payment) ──────
  // Server requires agentkit on the initial request so it can verify WorldID
  // before issuing payment details. This prevents paying and then getting a 403.
  console.log(`\n🆔 Step 1: Constructing WorldID AgentKit proof…`);

  const endpoint  = `${SERVER_URL}/api/weather/rome`;
  const serverUrl = new URL(SERVER_URL);
  const nonce     = Math.random().toString(36).slice(2, 18);
  const issuedAt  = new Date().toISOString();

  const siweInfo = {
    domain:    serverUrl.hostname, // AgentKit validates against hostname only (no port)
    uri:       endpoint,
    version:   "1",
    chainId:   "eip155:296",
    type:      "eip191" as const,
    nonce,
    issuedAt,
    statement: "Verify your agent is backed by a real human",
  };

  const siweMessage   = formatSIWEMessage(siweInfo, account.address);
  const siweSignature = await walletClient.signMessage({ message: siweMessage });

  const agentKitPayload = {
    domain:    siweInfo.domain,
    address:   account.address,
    statement: siweInfo.statement,
    uri:       siweInfo.uri,
    version:   siweInfo.version,
    chainId:   siweInfo.chainId,
    type:      "eip191",
    nonce,
    issuedAt,
    signature: siweSignature,
  };

  const agentKitHeader = Buffer.from(JSON.stringify(agentKitPayload)).toString("base64");
  console.log(`   ✅ AgentKit proof built (address: ${account.address})`);

  // ── Step 2: Initial request with agentkit proof → 402 (or 200 free trial) ─
  console.log(`\n📡 Step 2: GET ${endpoint} (with agentkit header)`);

  const res1 = await fetch(endpoint, {
    headers: { "agentkit": agentKitHeader },
  });
  console.log(`   → Status: ${res1.status} ${res1.statusText}`);

  if (res1.status === 403) {
    const body = await res1.text();
    console.error(`\n🚫 WorldID check failed — NOT paying (wallet safe):`);
    console.error(`   ${body}`);
    console.log("\n" + "═".repeat(62) + "\n");
    return;
  }

  if (res1.status === 200) {
    const data = await res1.json();
    console.log(`\n🎉 Free trial access granted! API response:`);
    console.log(`   ${JSON.stringify(data, null, 2).split("\n").join("\n   ")}`);
    console.log("\n" + "═".repeat(62) + "\n");
    return;
  }

  if (res1.status !== 402) {
    const body = await res1.text();
    throw new Error(`Expected 402 but got ${res1.status}: ${body}`);
  }

  // ── Step 3: Parse payment requirements ────────────────────────────────────
  const paymentRequiredHeader = res1.headers.get("PAYMENT-REQUIRED") || res1.headers.get("X-PAYMENT-REQUIRED");
  if (!paymentRequiredHeader) throw new Error("No PAYMENT-REQUIRED header in 402 response");

  const paymentRequired = JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString("utf-8"));
  console.log(`\n📋 Step 3: Payment Required`);
  console.log(`   Accepts ${paymentRequired.accepts?.length ?? paymentRequired.length ?? "?"} payment options`);

  // Find Hedera option
  const accepts = paymentRequired.accepts || paymentRequired;
  const hederaOption = (Array.isArray(accepts) ? accepts : [accepts]).find(
    (a: any) => a.network === "eip155:296"
  );

  if (!hederaOption) {
    console.log("   Available networks:", accepts.map((a: any) => a.network));
    throw new Error("Server did not offer a Hedera (eip155:296) payment option");
  }

  // x402 v2 field is `amount`, not `maxAmountRequired`
  const tinybarsRequired = BigInt(hederaOption.amount || hederaOption.maxAmountRequired);
  const hbarRequired     = Number(tinybarsRequired) / 1e8;
  const weiRequired      = tinybarsRequired * WEI_PER_TINYBAR;

  console.log(`   Network:         ${hederaOption.network}`);
  console.log(`   Asset:           HBAR (native)`);
  console.log(`   Required:        ${tinybarsRequired} tinybars (≈ ${hbarRequired.toFixed(6)} HBAR)`);
  console.log(`   Pay to:          ${hederaOption.payTo}`);

  // ── Step 4: Send HBAR ──────────────────────────────────────────────────────
  console.log(`\n💸 Step 4: Sending ${hbarRequired.toFixed(6)} HBAR to ${hederaOption.payTo}…`);

  const txHash = await walletClient.sendTransaction({
    to: hederaOption.payTo as Address,
    value: weiRequired,
  });

  console.log(`   ✅ Tx submitted:  ${txHash}`);
  console.log(`   🔗 https://hashscan.io/testnet/tx/${txHash}`);

  // ── Step 5: Wait for confirmation (Hedera ~3s finality) ───────────────────
  console.log(`\n⏳ Step 5: Waiting for Hedera confirmation (~3s)…`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`);

  if (receipt.status !== "success") {
    throw new Error(`Transaction failed on-chain: ${txHash}`);
  }

  // ── Step 6: Build x402 payment payload and retry ─────────────────────────
  // x402 v1 format: matching checks only scheme + network (avoids rate-drift issues)
  const paymentPayload = {
    x402Version: 1,
    scheme:      "exact",
    network:     "eip155:296",
    accepted: {
      scheme:  "exact",
      network: "eip155:296",
    },
    payload: {
      transaction: txHash,
      from:        account.address,
      to:          hederaOption.payTo,
      amount:      tinybarsRequired.toString(),
      asset:       "hbar",
    },
  };

  const encodedPayment = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  console.log(`\n🔁 Step 6: Retrying with PAYMENT-SIGNATURE + agentkit headers…`);
  const res2 = await fetch(endpoint, {
    headers: {
      "PAYMENT-SIGNATURE": encodedPayment,
      "agentkit":          agentKitHeader,  // WorldID proof — server verifies on World Chain
    },
  });

  console.log(`   → Status: ${res2.status} ${res2.statusText}`);

  // ── Step 6: Result ─────────────────────────────────────────────────────────
  if (res2.status === 200) {
    const data = await res2.json();
    console.log(`\n🎉 SUCCESS! API response received:`);
    console.log(`   ${JSON.stringify(data, null, 2).split("\n").join("\n   ")}`);

    console.log(`\n📊 Summary:`);
    console.log(`   Agent paid:        ${hbarRequired.toFixed(6)} HBAR (≈ $${(hbarRequired * 0.087).toFixed(4)})`);
    console.log(`   Publisher:         ${hederaOption.payTo}`);
    console.log(`   Tx on-chain:       https://hashscan.io/testnet/tx/${txHash}`);
    console.log(`   Payment standard:  x402 on Hedera Testnet`);
    console.log(`   Identity proof:    WorldID AgentKit (World Chain AgentBook)`);
    console.log(`   Agent address:     ${account.address}`);
  } else {
    const errBody = await res2.text();
    console.error(`\n❌ Payment rejected (${res2.status}): ${errBody}`);
  }

  console.log("\n" + "═".repeat(62) + "\n");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  if (err.details) console.error("   Details:", err.details);
  process.exit(1);
});
