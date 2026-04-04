import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const upstream = await fetch("https://testnet.hashio.io/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const data = await upstream.text();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    return res.status(upstream.status).send(data);
  } catch (err: any) {
    return res.status(502).json({ error: err.message || "upstream error" });
  }
}
