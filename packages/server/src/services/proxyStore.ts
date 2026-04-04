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
  endpointId:     number;
  backendUrl:     string;
  injectHeaders:  Record<string, string>;  // e.g. {"x-api-key": "sk-ant-..."}
  publisherAddr:  string;                  // lowercase
  registeredAt:   Date;
}

const store = new Map<number, ProxyConfig>();

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
