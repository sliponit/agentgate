const { ethers } = require("ethers");
const { formatSIWEMessage } = require("@worldcoin/agentkit");

const RPC = "https://agentgate-frontend.vercel.app/api/hedera-rpc";
const ENDPOINT = "https://agentgate.onrender.com/api/proxy/1";
const KEY = "0xd8990d585dd02953971d40e5d07677ff5f5337d387845c75e7c4ccdab120c252";
const WEI_PER_TINYBAR = 10_000_000_000n;

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const body = JSON.stringify({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "What is AgentGate in 10 words?" }],
  });

  console.log("Agent:", wallet.address);

  // Step 1: 402
  console.log("\n[1] Calling endpoint...");
  const r1 = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const challenge = JSON.parse(
    Buffer.from(r1.headers.get("payment-required"), "base64").toString()
  );
  const acc = challenge.accepts[0];
  console.log(
    "    402 — Pay",
    (Number(BigInt(acc.amount)) / 1e8).toFixed(4),
    "HBAR | WorldID required:",
    challenge.requireWorldId
  );

  // Step 2: Build WorldID proof
  console.log("\n[2] Signing WorldID proof (SIWE)...");
  const nonce = Math.random().toString(36).slice(2, 18);
  const siweInfo = {
    domain: "agentgate.onrender.com",
    uri: ENDPOINT,
    version: "1",
    chainId: "eip155:296",
    type: "eip191",
    nonce,
    issuedAt: new Date().toISOString(),
    statement: "Verify your agent is backed by a real human",
  };
  const msg = formatSIWEMessage(siweInfo, wallet.address);
  const sig = await wallet.signMessage(msg);
  const ak = Buffer.from(
    JSON.stringify({ ...siweInfo, address: wallet.address, signature: sig })
  ).toString("base64");
  console.log("    Signed!");

  // Step 3: Try free-trial
  console.log("\n[3] Trying free-trial (WorldID only, no payment)...");
  const r2 = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", agentkit: ak },
    body,
  });
  console.log("    Status:", r2.status);
  if (r2.status === 200) {
    const data = await r2.json();
    console.log(
      "\n    FREE TRIAL! OpenAI says:",
      data.choices?.[0]?.message?.content
    );
    return;
  }

  // Step 4: Pay HBAR
  const tinybars = BigInt(acc.amount);
  console.log(
    "\n[4] Free-trial used — paying",
    (Number(tinybars) / 1e8).toFixed(4),
    "HBAR..."
  );
  const tx = await wallet.sendTransaction({
    to: acc.payTo,
    value: tinybars * WEI_PER_TINYBAR,
    gasPrice: ethers.parseUnits("1300", "gwei"),
    gasLimit: 21000,
  });
  console.log("    Tx:", tx.hash);
  await tx.wait();
  console.log("    Confirmed on Hedera!");

  // Step 5: Retry with payment + WorldID
  console.log("\n[5] Retrying with payment + WorldID...");
  const nonce2 = Math.random().toString(36).slice(2, 18);
  const si2 = { ...siweInfo, nonce: nonce2, issuedAt: new Date().toISOString() };
  const sig2 = await wallet.signMessage(
    formatSIWEMessage(si2, wallet.address)
  );
  const ak2 = Buffer.from(
    JSON.stringify({ ...si2, address: wallet.address, signature: sig2 })
  ).toString("base64");
  const payment = Buffer.from(
    JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network: "eip155:296",
      payload: {
        transaction: tx.hash,
        from: wallet.address,
        to: acc.payTo,
        amount: tinybars.toString(),
        asset: "hbar",
      },
    })
  ).toString("base64");
  const r3 = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      agentkit: ak2,
      "payment-signature": payment,
    },
    body,
  });
  console.log("    Status:", r3.status);
  if (r3.status === 200) {
    const data = await r3.json();
    console.log(
      "\n    OpenAI says:",
      data.choices?.[0]?.message?.content
    );
    console.log("\n    Paid:", (Number(tinybars) / 1e8).toFixed(4), "HBAR");
    console.log(
      "    Tx: https://hashscan.io/testnet/tx/" + tx.hash
    );
  } else {
    console.log("    Error:", await r3.text());
  }
})().catch((e) => console.error(e.message));
