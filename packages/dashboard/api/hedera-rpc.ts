/**
 * Vercel serverless proxy for Hedera JSON-RPC.
 * Avoids CORS issues — browser calls /api/hedera-rpc, we forward to Hashio.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const upstream = await fetch("https://testnet.hashio.io/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}
