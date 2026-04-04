/**
 * hbarRate.ts
 *
 * Converts a USD amount to tinybars using the live Hedera Mirror Node exchange rate.
 * 1 HBAR = 10^8 tinybars. Rate is cached for 60 seconds.
 */

const MIRROR_NODE    = "https://testnet.mirrornode.hedera.com";
const CACHE_TTL_MS   = 60_000;
const FALLBACK_RATE  = 11.43; // ~$0.0875/HBAR

let cachedRate: number   = FALLBACK_RATE;
let cacheExpiry: number  = 0;

export async function usdToTinybars(usdAmount: number): Promise<bigint> {
  const now = Date.now();
  if (now > cacheExpiry) {
    try {
      const res  = await fetch(`${MIRROR_NODE}/api/v1/network/exchangerate`);
      const data = await res.json() as { current_rate: { cent_equivalent: number; hbar_equivalent: number } };
      const { cent_equivalent, hbar_equivalent } = data.current_rate;
      const usdPerHbar = cent_equivalent / 100 / hbar_equivalent;
      cachedRate  = 1 / usdPerHbar;
      cacheExpiry = now + CACHE_TTL_MS;
    } catch {
      // keep previous rate
    }
  }
  const tinybars = Math.ceil(usdAmount * cachedRate * 1e8);
  return BigInt(tinybars);
}
