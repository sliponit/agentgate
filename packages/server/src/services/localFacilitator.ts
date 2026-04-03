/**
 * LocalFacilitatorClient
 *
 * A stub facilitator for demo/hackathon use.
 * - getSupported(): returns World Chain + Base Sepolia + Base mainnet
 * - verify(): delegates to real facilitator for Base Sepolia, simulates success for others
 * - settle(): simulates success (returns fake tx hash)
 *
 * This lets the server start up and serve 402 challenges on any chain
 * without needing a live facilitator for World Chain.
 */

import { HTTPFacilitatorClient } from "@x402/core/http";

const WORLD_CHAIN = "eip155:480";
const BASE_MAINNET = "eip155:8453";
const BASE_SEPOLIA = "eip155:84532";

const SUPPORTED_KINDS = {
  kinds: [
    { x402Version: 2, scheme: "exact", network: WORLD_CHAIN },
    { x402Version: 2, scheme: "exact", network: BASE_MAINNET },
    { x402Version: 2, scheme: "exact", network: BASE_SEPOLIA },
  ],
};

const REAL_FACILITATOR_URL = "https://www.x402.org/facilitator";

export class LocalFacilitatorClient {
  private realClient: HTTPFacilitatorClient;

  constructor() {
    this.realClient = new HTTPFacilitatorClient({ url: REAL_FACILITATOR_URL });
  }

  /**
   * Return hardcoded supported kinds — no network request needed.
   */
  async getSupported(): Promise<typeof SUPPORTED_KINDS> {
    return SUPPORTED_KINDS;
  }

  /**
   * Verify payment — delegate to real facilitator for Base Sepolia,
   * simulate success for other chains (demo mode).
   */
  async verify(paymentPayload: any, paymentRequirements: any): Promise<any> {
    const network = paymentRequirements?.network || "";

    if (network === BASE_SEPOLIA) {
      try {
        return await this.realClient.verify(paymentPayload, paymentRequirements);
      } catch {
        // Fallback to demo mode
      }
    }

    // Demo mode: accept all payments
    console.log(`[LocalFacilitator] DEMO: accepting payment on ${network}`);
    return {
      isValid: true,
      invalidReason: null,
    };
  }

  /**
   * Settle payment — delegate to real facilitator for Base Sepolia,
   * simulate success for other chains.
   */
  async settle(paymentPayload: any, paymentRequirements: any): Promise<any> {
    const network = paymentRequirements?.network || "";

    if (network === BASE_SEPOLIA) {
      try {
        return await this.realClient.settle(paymentPayload, paymentRequirements);
      } catch {
        // Fallback to demo mode
      }
    }

    // Demo mode: fake transaction hash
    const fakeTxHash = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("")}`;
    console.log(`[LocalFacilitator] DEMO: simulated settlement on ${network}: ${fakeTxHash}`);

    return {
      success: true,
      transaction: fakeTxHash,
      network,
    };
  }
}
