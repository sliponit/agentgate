/**
 * HederaFacilitatorClient
 *
 * A real x402 facilitator for Hedera Testnet (eip155:296).
 * Payments are native HBAR transfers (simple ETH sends via Hedera JSON-RPC relay).
 *
 * Verification strategy:
 *   - Agent pre-pays (broadcasts HBAR transfer), includes tx hash in payment payload
 *   - We verify via Hedera Mirror Node REST API (3s finality, no separate settle needed)
 *   - Mirror Node `contracts/results/{hash}` returns amount (tinybars), to, result
 *
 * Amount units: tinybars (1 HBAR = 10^8 tinybars)
 * Wire conversion: value_wei = tinybars * 10^8  (Hedera EVM uses 1 ETH = 100 HBAR)
 */

const HEDERA_TESTNET = "eip155:296";
const MIRROR_NODE = "https://testnet.mirrornode.hedera.com";

// Prevents a single tx hash from being replayed across concurrent requests.
// In-memory; resets on restart. Sufficient for demo — persistent store needed in prod.
const usedTxHashes = new Set<string>();

export class HederaFacilitatorClient {
  async getSupported() {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: HEDERA_TESTNET }],
    };
  }

  async verify(paymentPayload: any, paymentRequirements: any): Promise<any> {
    const txHash = paymentPayload?.payload?.transaction;

    if (!txHash) {
      return { isValid: false, invalidReason: "missing transaction hash in payload" };
    }

    // Reject replayed tx hashes (race-condition double-spend protection)
    if (usedTxHashes.has(txHash)) {
      return { isValid: false, invalidReason: `transaction ${txHash} has already been used` };
    }
    // Reserve the hash immediately — before any async work — to close the race window
    usedTxHashes.add(txHash);

    // Give Mirror Node a moment to index (Hedera ~3s finality)
    await new Promise((r) => setTimeout(r, 1500));

    try {
      const url = `${MIRROR_NODE}/api/v1/contracts/results/${txHash}`;
      console.log(`[HederaFacilitator] Verifying tx: ${url}`);
      interface MirrorResult {
        result?: string;
        to?: string;
        amount?: number;
        _status?: { messages?: unknown[] };
      }

      const res = await fetch(url);
      const data = await res.json() as MirrorResult;

      if (data._status?.messages) {
        // Not found — wait a bit more and retry once
        await new Promise((r) => setTimeout(r, 3000));
        const res2 = await fetch(url);
        const data2 = await res2.json() as MirrorResult;
        if (data2._status?.messages) {
          return { isValid: false, invalidReason: `transaction not found on Mirror Node: ${txHash}` };
        }
        return this._checkResult(data2, paymentRequirements);
      }

      return this._checkResult(data, paymentRequirements);
    } catch (err: any) {
      // Release the reservation so the agent can retry with the same tx after a network hiccup
      usedTxHashes.delete(txHash);
      console.error("[HederaFacilitator] Mirror Node error:", err.message);
      return { isValid: false, invalidReason: `Mirror Node error: ${err.message}` };
    }
  }

  private _checkResult(data: any, paymentRequirements: any): any {
    // Must be successful
    if (data.result !== "SUCCESS") {
      return { isValid: false, invalidReason: `transaction failed on-chain: ${data.result}` };
    }

    // Recipient check — both sides must be present and must match.
    // Previously used `if (payTo && to && ...)` which silently skipped the check
    // when either value was falsy. Now we hard-fail on missing data.
    const payTo = (paymentRequirements.payTo || "").toLowerCase();
    if (!payTo) {
      return { isValid: false, invalidReason: "payment requirements missing payTo address" };
    }
    const to = (data.to || "").toLowerCase();
    if (!to) {
      return { isValid: false, invalidReason: "Mirror Node response missing recipient address (tx may not be a transfer)" };
    }
    if (to !== payTo) {
      return {
        isValid: false,
        invalidReason: `wrong recipient: sent to ${data.to}, expected ${paymentRequirements.payTo}`,
      };
    }

    // Amount must be sufficient (in tinybars)
    // x402 v2 uses `amount`, v1 uses `maxAmountRequired`
    const requiredStr = paymentRequirements.amount || paymentRequirements.maxAmountRequired || "0";
    const required = BigInt(requiredStr);
    const sent = BigInt(data.amount || "0");
    if (sent < required) {
      return {
        isValid: false,
        invalidReason: `insufficient amount: sent ${sent} tinybars, required ${required} tinybars`,
      };
    }

    console.log(
      `[HederaFacilitator] ✅ Payment verified: ${sent} tinybars to ${data.to} (tx: ${data.hash})`
    );
    return { isValid: true, invalidReason: null };
  }

  async settle(paymentPayload: any, _paymentRequirements: any): Promise<any> {
    // Hedera has ~3s absolute finality — if verify() passed, it's already settled
    const txHash = paymentPayload?.payload?.transaction;
    console.log(`[HederaFacilitator] ✅ Settle (instant finality): ${txHash}`);
    return {
      success: true,
      transaction: txHash,
      network: HEDERA_TESTNET,
    };
  }
}
