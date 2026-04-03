import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

export const config = {
  port: Number(process.env.PORT) || 4021,
  // Official x402 facilitator — supports eip155:84532 (Base Sepolia)
  // World Chain facilitator (x402-worldchain.vercel.app) has no /supported endpoint
  facilitatorUrl:
    process.env.FACILITATOR_URL ||
    "https://www.x402.org/facilitator",
  publisherAddress:
    process.env.PUBLISHER_ADDRESS ||
    "0x000000000000000000000000000000000000dead",
  rpcUrl: process.env.RPC_URL || "https://testnet.hashio.io/api",
};

export const WORLD_CHAIN = "eip155:480";
export const BASE = "eip155:8453";
export const WORLD_USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
