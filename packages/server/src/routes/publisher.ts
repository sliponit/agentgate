import { Hono } from "hono";

const router = new Hono();

// In-memory store for demo purposes
const publisherStats: Record<
  string,
  { gasSpent: number; revenue: number; calls: number; endpoints: string[] }
> = {};

router.post("/register", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.url || !body?.pricePerCall || !body?.publisherAddress) {
    return c.json({ error: "Missing required fields: url, pricePerCall, publisherAddress" }, 400);
  }

  const { url, pricePerCall, publisherAddress, paymasterAddress } = body;

  if (!publisherStats[publisherAddress]) {
    publisherStats[publisherAddress] = { gasSpent: 0, revenue: 0, calls: 0, endpoints: [] };
  }
  publisherStats[publisherAddress].endpoints.push(url);

  return c.json({
    success: true,
    endpointId: Math.floor(Math.random() * 10000),
    url,
    pricePerCall,
    publisherAddress,
    paymasterAddress: paymasterAddress || null,
    message: "Endpoint registered (demo mode — no on-chain tx)",
  });
});

router.get("/stats/:address", (c) => {
  const address = c.req.param("address").toLowerCase();
  const stats = publisherStats[address] || {
    gasSpent: 0.003,
    revenue: 0.015,
    calls: 3,
    endpoints: ["https://agentgate.demo/api/weather", "https://agentgate.demo/api/prices"],
  };

  return c.json({
    address,
    gasSpentEth: stats.gasSpent,
    revenueUsdc: stats.revenue,
    totalCalls: stats.calls,
    roi: stats.gasSpent > 0 ? ((stats.revenue - stats.gasSpent) / stats.gasSpent) * 100 : 0,
    endpoints: stats.endpoints,
  });
});

router.get("/endpoints/:address", (c) => {
  const address = c.req.param("address").toLowerCase();
  const stats = publisherStats[address];

  return c.json({
    address,
    endpoints: stats?.endpoints ?? [
      "https://agentgate.demo/api/weather",
      "https://agentgate.demo/api/prices",
    ],
  });
});

export default router;
