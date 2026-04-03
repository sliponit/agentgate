import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentGatePaymaster, PublisherRegistry } from "../typechain-types";

describe("AgentGatePaymaster", function () {
  let paymaster: AgentGatePaymaster;
  let registry: PublisherRegistry;
  let owner: any;
  let agent: any;

  // Mock EntryPoint for testing
  const MOCK_ENTRYPOINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
  const DAILY_BUDGET = ethers.parseEther("0.1");

  beforeEach(async function () {
    [owner, agent] = await ethers.getSigners();

    // Deploy PublisherRegistry
    const RegistryFactory = await ethers.getContractFactory("PublisherRegistry");
    registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();

    // Deploy Paymaster with mock EntryPoint
    const PaymasterFactory = await ethers.getContractFactory("AgentGatePaymaster");
    paymaster = await PaymasterFactory.deploy(MOCK_ENTRYPOINT, DAILY_BUDGET);
    await paymaster.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await paymaster.owner()).to.equal(owner.address);
    });

    it("should set the correct daily budget", async function () {
      expect(await paymaster.dailyBudget()).to.equal(DAILY_BUDGET);
    });

    it("should start with zero daily spent", async function () {
      expect(await paymaster.dailySpent()).to.equal(0);
    });
  });

  describe("Budget Management", function () {
    it("should return full budget when nothing spent", async function () {
      const remaining = await paymaster.getRemainingBudget();
      expect(remaining).to.equal(DAILY_BUDGET);
    });

    it("should allow owner to update daily budget", async function () {
      const newBudget = ethers.parseEther("0.5");
      await paymaster.setDailyBudget(newBudget);
      expect(await paymaster.dailyBudget()).to.equal(newBudget);
    });

    it("should reject budget update from non-owner", async function () {
      await expect(
        paymaster.connect(agent).setDailyBudget(ethers.parseEther("1.0"))
      ).to.be.reverted;
    });
  });

  describe("Endpoint Management", function () {
    it("should register an endpoint", async function () {
      const url = "https://agentgate.demo/api/weather";
      await expect(paymaster.registerEndpoint(url))
        .to.emit(paymaster, "EndpointRegistered");
    });

    it("should deregister an endpoint", async function () {
      const url = "https://agentgate.demo/api/weather";
      await paymaster.registerEndpoint(url);
      await expect(paymaster.deregisterEndpoint(url))
        .to.emit(paymaster, "EndpointDeregistered");
    });

    it("should reject endpoint registration from non-owner", async function () {
      await expect(
        paymaster.connect(agent).registerEndpoint("https://test.com")
      ).to.be.reverted;
    });
  });

  describe("Stats", function () {
    it("should start with zero total sponsored", async function () {
      expect(await paymaster.getTotalSponsored()).to.equal(0);
    });

    it("should start with zero total calls", async function () {
      expect(await paymaster.totalCalls()).to.equal(0);
    });
  });
});

describe("PublisherRegistry", function () {
  let registry: PublisherRegistry;
  let publisher: any;
  let other: any;

  beforeEach(async function () {
    [publisher, other] = await ethers.getSigners();

    const RegistryFactory = await ethers.getContractFactory("PublisherRegistry");
    registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();
  });

  describe("Endpoint Registration", function () {
    it("should register an endpoint and emit event", async function () {
      const url = "https://api.example.com/weather";
      const price = 10000; // $0.01 USDC
      const paymaster = "0x0000000000000000000000000000000000000000";

      await expect(registry.registerEndpoint(url, price, paymaster))
        .to.emit(registry, "EndpointRegistered")
        .withArgs(0, publisher.address, url, price, paymaster);
    });

    it("should return correct endpoint data", async function () {
      const url = "https://api.example.com/prices";
      await registry.registerEndpoint(url, 5000, ethers.ZeroAddress);

      const endpoint = await registry.getEndpoint(0);
      expect(endpoint.url).to.equal(url);
      expect(endpoint.pricePerCall).to.equal(5000);
      expect(endpoint.isActive).to.equal(true);
      expect(endpoint.publisher).to.equal(publisher.address);
    });

    it("should track publisher endpoints", async function () {
      await registry.registerEndpoint("https://api.example.com/a", 1000, ethers.ZeroAddress);
      await registry.registerEndpoint("https://api.example.com/b", 2000, ethers.ZeroAddress);

      const ids = await registry.getPublisherEndpoints(publisher.address);
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(0);
      expect(ids[1]).to.equal(1);
    });

    it("should increment endpoint ID", async function () {
      await registry.registerEndpoint("https://api.example.com/1", 1000, ethers.ZeroAddress);
      await registry.registerEndpoint("https://api.example.com/2", 1000, ethers.ZeroAddress);
      expect(await registry.getTotalEndpoints()).to.equal(2);
    });
  });

  describe("Endpoint Management", function () {
    beforeEach(async function () {
      await registry.registerEndpoint("https://api.example.com/test", 1000, ethers.ZeroAddress);
    });

    it("should deactivate an endpoint", async function () {
      await expect(registry.deactivateEndpoint(0))
        .to.emit(registry, "EndpointDeactivated")
        .withArgs(0, publisher.address);

      const endpoint = await registry.getEndpoint(0);
      expect(endpoint.isActive).to.equal(false);
    });

    it("should reactivate an endpoint", async function () {
      await registry.deactivateEndpoint(0);
      await expect(registry.activateEndpoint(0))
        .to.emit(registry, "EndpointActivated");

      const endpoint = await registry.getEndpoint(0);
      expect(endpoint.isActive).to.equal(true);
    });

    it("should reject deactivation by non-publisher", async function () {
      await expect(
        registry.connect(other).deactivateEndpoint(0)
      ).to.be.revertedWith("Not endpoint publisher");
    });

    it("should update paymaster address", async function () {
      const newPaymaster = other.address;
      await registry.updatePaymaster(0, newPaymaster);

      const endpoint = await registry.getEndpoint(0);
      expect(endpoint.paymasterAddress).to.equal(newPaymaster);
    });

    it("should check sponsored status", async function () {
      expect(await registry.isSponsored(0)).to.equal(false); // no paymaster set

      await registry.updatePaymaster(0, other.address);
      expect(await registry.isSponsored(0)).to.equal(true);
    });
  });

  describe("Call Recording", function () {
    beforeEach(async function () {
      await registry.registerEndpoint("https://api.example.com/test", 1000, ethers.ZeroAddress);
    });

    it("should record a call and update stats", async function () {
      await registry.recordCall(0);

      const endpoint = await registry.getEndpoint(0);
      expect(endpoint.totalCalls).to.equal(1);
      expect(endpoint.totalRevenue).to.equal(1000);
    });

    it("should reject call recording for inactive endpoint", async function () {
      await registry.deactivateEndpoint(0);
      await expect(registry.recordCall(0)).to.be.revertedWith("Endpoint inactive");
    });
  });
});
