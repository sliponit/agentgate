import { useEffect, useState, useCallback } from "react";
import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import { hederaTestnet, NETWORKS, DEPLOYMENTS, NetworkId } from "../lib/chains";
import { PAYMASTER_ABI, REGISTRY_ABI, ENTRYPOINT_ABI } from "../lib/abi";

export interface OnChainData {
  deployerBalance: string;
  paymasterDeposit: string;
  dailyBudget: string;
  dailySpent: string;
  remainingBudget: string;
  totalCalls: number;
  totalSponsored: string;
  lastReset: Date | null;
  totalEndpoints: number;
  endpoints: EndpointData[];
  lastUpdated: Date | null;
  loading: boolean;
  error: string | null;
}

export interface EndpointData {
  id: number;
  publisher: string;
  url: string;
  pricePerCall: string;
  paymaster: string;
  active: boolean;
  totalCalls: number;
  totalRevenue: string;
  registeredAt: Date;
  // Proxy metadata (fetched from server, not on-chain)
  proxyName?: string;
  requireWorldId?: boolean;
}

const INITIAL: OnChainData = {
  deployerBalance: "—",
  paymasterDeposit: "—",
  dailyBudget: "—",
  dailySpent: "—",
  remainingBudget: "—",
  totalCalls: 0,
  totalSponsored: "—",
  lastReset: null,
  totalEndpoints: 0,
  endpoints: [],
  lastUpdated: null,
  loading: true,
  error: null,
};

function getClient(networkId: NetworkId) {
  const cfg = NETWORKS[networkId];
  const chain = networkId === "hedera" ? hederaTestnet : baseSepolia;
  return createPublicClient({ chain, transport: http(cfg.rpc) });
}

export function useOnChainData(networkId: NetworkId) {
  const [data, setData] = useState<OnChainData>(INITIAL);

  const fetch = useCallback(async () => {
    const client = getClient(networkId);
    const d = DEPLOYMENTS[networkId];

    try {
      const results = await Promise.allSettled([
        client.getBalance({ address: d.deployer }),                                                                                        // 0
        client.readContract({ address: d.entryPoint, abi: ENTRYPOINT_ABI, functionName: "balanceOf", args: [d.paymaster] }),               // 1
        client.readContract({ address: d.paymaster,  abi: PAYMASTER_ABI,  functionName: "totalCalls" }),                                   // 2
        client.readContract({ address: d.paymaster,  abi: PAYMASTER_ABI,  functionName: "getTotalSponsored" }),                            // 3
        client.readContract({ address: d.publisherRegistry, abi: REGISTRY_ABI, functionName: "nextEndpointId" }),                         // 4
      ]);

      function val<T>(r: PromiseSettledResult<unknown>, fallback: T): T {
        return r.status === "fulfilled" ? (r.value as T) : fallback;
      }

      const deployerBalance  = val<bigint>(results[0], 0n);
      const paymasterDeposit = val<bigint>(results[1], 0n);
      const totalCalls       = val<bigint>(results[2], 0n);
      const totalSponsored   = val<bigint>(results[3], 0n);
      const nextId           = val<bigint>(results[4], 0n);

      results.forEach((r, i) => {
        if (r.status === "rejected") {
          console.warn(`[useOnChainData] call ${i} failed:`, r.reason?.shortMessage || r.reason?.message || r.reason);
        }
      });

      // Fetch all registered endpoints
      // Fetch all endpoints in parallel (much faster than sequential)
      const epPromises = Array.from({ length: Number(nextId) }, (_, i) =>
        client.readContract({
          address: d.publisherRegistry,
          abi: REGISTRY_ABI,
          functionName: "endpoints",
          args: [BigInt(i)],
        }).catch(() => null)
      );
      const epResults = await Promise.all(epPromises);

      const endpoints: EndpointData[] = [];
      for (const ep of epResults) {
        if (!ep) continue;
        const typed = ep as readonly [bigint, `0x${string}`, string, bigint, `0x${string}`, boolean, bigint, bigint, bigint, boolean];
        if (!typed[2]) continue;
        endpoints.push({
          id: Number(typed[0]),
          publisher: typed[1],
          url: typed[2],
          pricePerCall: (Number(typed[3]) / 1_000_000).toFixed(4),
          paymaster: typed[4],
          active: typed[5],
          totalCalls: Number(typed[6]),
          totalRevenue: (Number(typed[7]) / 1_000_000).toFixed(4),
          registeredAt: new Date(Number(typed[8]) * 1000),
          requireWorldId: typed[9],
        });
      }

      setData({
        deployerBalance:  parseFloat(formatEther(deployerBalance)).toFixed(4),
        paymasterDeposit: parseFloat(formatEther(paymasterDeposit)).toFixed(6),
        dailyBudget:      "—",
        dailySpent:       "—",
        remainingBudget:  "—",
        totalCalls:       Number(totalCalls),
        totalSponsored:   parseFloat(formatEther(totalSponsored)).toFixed(8),
        lastReset:        null,
        totalEndpoints:   endpoints.length,
        endpoints,
        lastUpdated:      new Date(),
        loading: false,
        error: null,
      });
    } catch (e: any) {
      setData((prev) => ({ ...prev, loading: false, error: e.message }));
    }
  }, [networkId]);

  useEffect(() => {
    setData({ ...INITIAL, loading: true });
    fetch();
  }, [fetch]);

  return { data, refetch: fetch };
}
