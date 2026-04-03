import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// ERC-4337 EntryPoint v0.7 addresses (same across all EVM chains)
const ENTRYPOINT_ADDRESSES: Record<string, string> = {
  hedera: "0x0000000000000000000000000000000000000000", // Placeholder — deploy your own on Hedera
  baseSepolia: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789", // Official v0.6
  hardhat: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = (await ethers.provider.getNetwork()).name;

  console.log(`\n🚀 Deploying AgentGate contracts`);
  console.log(`📡 Network: ${network} (chainId: ${(await ethers.provider.getNetwork()).chainId})`);
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // 1. Deploy PublisherRegistry
  console.log("📝 Deploying PublisherRegistry...");
  const PublisherRegistry = await ethers.getContractFactory("PublisherRegistry");
  const registry = await PublisherRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`✅ PublisherRegistry deployed: ${registryAddress}`);

  // 2. Deploy AgentGatePaymaster
  const entryPointAddress = ENTRYPOINT_ADDRESSES[network] || ENTRYPOINT_ADDRESSES["hardhat"];
  const dailyBudget = ethers.parseEther("0.01"); // 0.01 ETH daily budget

  console.log(`\n⛽ Deploying AgentGatePaymaster...`);
  console.log(`   EntryPoint: ${entryPointAddress}`);
  console.log(`   Daily budget: ${ethers.formatEther(dailyBudget)} ETH`);

  const AgentGatePaymaster = await ethers.getContractFactory("AgentGatePaymaster");
  const paymaster = await AgentGatePaymaster.deploy(entryPointAddress, dailyBudget);
  await paymaster.waitForDeployment();
  const paymasterAddress = await paymaster.getAddress();
  console.log(`✅ AgentGatePaymaster deployed: ${paymasterAddress}`);

  // 3. Fund the Paymaster with a small initial deposit
  console.log(`\n💸 Funding Paymaster with 0.005 ETH...`);
  try {
    const fundTx = await paymaster.deposit({ value: ethers.parseEther("0.005") });
    await fundTx.wait();
    console.log(`✅ Paymaster funded. Tx: ${fundTx.hash}`);
  } catch (e) {
    console.log(`⚠️  Funding skipped (EntryPoint may not be deployed on this network)`);
  }

  // 4. Register a demo endpoint
  console.log(`\n🌐 Registering demo weather endpoint...`);
  const registerTx = await registry.registerEndpoint(
    "https://agentgate.demo/api/weather",
    10000, // $0.01 USDC (6 decimals)
    paymasterAddress
  );
  await registerTx.wait();
  console.log(`✅ Demo endpoint registered. Tx: ${registerTx.hash}`);

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🎉 DEPLOYMENT COMPLETE`);
  console.log(`${"=".repeat(60)}`);
  console.log(`PublisherRegistry:   ${registryAddress}`);
  console.log(`AgentGatePaymaster:  ${paymasterAddress}`);
  console.log(`Network:             ${network}`);
  console.log(`${"=".repeat(60)}\n`);

  // Save addresses to a JSON file for other packages to use
  const addresses = {
    network,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    PublisherRegistry: registryAddress,
    AgentGatePaymaster: paymasterAddress,
    deployedAt: new Date().toISOString(),
  };

  const fs = await import("fs");
  const outputPath = path.resolve(__dirname, `../deployments/${network}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
  console.log(`📄 Addresses saved to deployments/${network}.json`);

  return addresses;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
