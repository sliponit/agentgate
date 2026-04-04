/**
 * proxyStore.ts
 *
 * In-memory store for proxy endpoint configurations.
 * Maps endpointId (from PublisherRegistry) to a backend URL + headers to inject.
 *
 * Security: only the endpoint's on-chain publisher can register a config,
 * verified via EIP-191 wallet signature before storing.
 */

export interface ProxyConfig {
  endpointId:      number;
  name:            string;                   // human-readable name (e.g. "GPT-4o Chat")
  backendUrl:      string;
  injectHeaders:   Record<string, string>;  // e.g. {"x-api-key": "sk-ant-..."}
  publisherAddr:   string;                  // lowercase
  requireWorldId:  boolean;                 // if true, agents must provide valid WorldID proof
  registeredAt:    Date;
}

const store = new Map<number, ProxyConfig>();

// ── Call tracking (in-memory) ──────────────────────────────────────────────
// Per-endpoint total calls + per-agent call log
interface CallRecord {
  agentAddress: string;
  timestamp:    number;
  freeTrial:    boolean;  // true = free-trial call, false = paid
}

const endpointCalls = new Map<number, CallRecord[]>();

// Free-trial usage: key = "address:endpointId" → count
const FREE_TRIAL_LIMIT = 3;
const freeTrialUsage = new Map<string, number>();

export const callTracker = {
  record(endpointId: number, agentAddress: string, freeTrial: boolean) {
    const calls = endpointCalls.get(endpointId) || [];
    calls.push({ agentAddress: agentAddress.toLowerCase(), timestamp: Date.now(), freeTrial });
    endpointCalls.set(endpointId, calls);
  },

  getStats(endpointId: number) {
    const calls = endpointCalls.get(endpointId) || [];
    const totalCalls = calls.length;
    const freeTrialCalls = calls.filter(c => c.freeTrial).length;
    const paidCalls = totalCalls - freeTrialCalls;
    const uniqueAgents = new Set(calls.map(c => c.agentAddress)).size;
    return { totalCalls, freeTrialCalls, paidCalls, uniqueAgents };
  },

  getAgentStats(endpointId: number, agentAddress: string) {
    const calls = endpointCalls.get(endpointId) || [];
    const agentCalls = calls.filter(c => c.agentAddress === agentAddress.toLowerCase());
    const freeUsed = agentCalls.filter(c => c.freeTrial).length;
    return { totalCalls: agentCalls.length, freeUsed, freeRemaining: Math.max(0, FREE_TRIAL_LIMIT - freeUsed) };
  },

  checkFreeTrial(agentAddress: string, endpointId: number): { allowed: boolean; used: number } {
    const key = `${agentAddress.toLowerCase()}:${endpointId}`;
    const used = freeTrialUsage.get(key) || 0;
    return { allowed: used < FREE_TRIAL_LIMIT, used };
  },

  consumeFreeTrial(agentAddress: string, endpointId: number): void {
    const key = `${agentAddress.toLowerCase()}:${endpointId}`;
    freeTrialUsage.set(key, (freeTrialUsage.get(key) || 0) + 1);
  },

  getAllStats() {
    const result: Record<number, ReturnType<typeof callTracker.getStats>> = {};
    for (const [id] of endpointCalls) {
      result[id] = this.getStats(id);
    }
    return result;
  },
};

export const proxyStore = {
  set(config: ProxyConfig) {
    store.set(config.endpointId, config);
  },

  get(endpointId: number): ProxyConfig | undefined {
    return store.get(endpointId);
  },

  delete(endpointId: number) {
    store.delete(endpointId);
  },

  all(): ProxyConfig[] {
    return Array.from(store.values());
  },
};
