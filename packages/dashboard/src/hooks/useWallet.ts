import { useState, useCallback } from "react";
import { createWalletClient, custom, createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { hederaTestnet, NETWORKS } from "../lib/chains";
import type { NetworkId } from "../lib/chains";

export interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    chainId: null,
    connected: false,
    connecting: false,
    error: null,
  });

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setState((s) => ({ ...s, error: "No wallet detected (install Rabby or MetaMask)" }));
      return;
    }
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
      const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
      setState({
        address: address as `0x${string}`,
        chainId: parseInt(chainIdHex, 16),
        connected: true,
        connecting: false,
        error: null,
      });
    } catch (e: any) {
      setState((s) => ({ ...s, connecting: false, error: e.message }));
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({ address: null, chainId: null, connected: false, connecting: false, error: null });
  }, []);

  const switchNetwork = useCallback(async (networkId: NetworkId) => {
    if (!window.ethereum) return;
    const net = NETWORKS[networkId];
    const chainHex = "0x" + net.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      setState((s) => ({ ...s, chainId: net.chainId }));
    } catch (e: any) {
      // Chain not added — add it
      if (e.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: chainHex,
              chainName: net.label,
              nativeCurrency: { name: net.currency, symbol: net.currency, decimals: 18 },
              rpcUrls: [net.rpc],
              blockExplorerUrls: [net.explorerBase],
            }],
          });
          setState((s) => ({ ...s, chainId: net.chainId }));
        } catch (addErr: any) {
          setState((s) => ({ ...s, error: addErr.message }));
        }
      } else {
        setState((s) => ({ ...s, error: e.message }));
      }
    }
  }, []);

  /** Write a contract function. Returns tx hash. value = optional ETH to send (payable). */
  const writeContract = useCallback(
    async (
      networkId: NetworkId,
      contractAddr: `0x${string}`,
      abi: any[],
      functionName: string,
      args: any[],
      value?: bigint
    ) => {
      if (!window.ethereum || !state.address) throw new Error("Wallet not connected");

      const chain = networkId === "hedera" ? hederaTestnet : baseSepolia;
      const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
      const publicClient = createPublicClient({ chain, transport: http(NETWORKS[networkId].rpc) });

      // Hedera JSON-RPC rejects eth_estimateGas if gas price is below the network minimum
      // (MetaMask surfaces that as "Missing or invalid parameters").
      const HEDERA_MIN_GAS_WEI = 1_300_000_000_000n; // 1300 Gwei — above typical 1020+ Gwei floor
      let gasPrice: bigint | undefined;
      if (networkId === "hedera") {
        try {
          const gp = await publicClient.getGasPrice();
          gasPrice = gp < HEDERA_MIN_GAS_WEI ? HEDERA_MIN_GAS_WEI : gp;
        } catch {
          gasPrice = HEDERA_MIN_GAS_WEI;
        }
      }

      // Hedera JSON-RPC rejects gasPrice in eth_call (simulateContract) and also rejects
      // eth_estimateGas outright ("Missing or invalid parameters"). We must skip simulation
      // and provide an explicit gas limit so MetaMask never calls eth_estimateGas.
      const HEDERA_GAS_LIMIT = 500_000n;

      let hash: `0x${string}`;
      if (networkId === "hedera") {
        hash = await walletClient.writeContract({
          address: contractAddr,
          abi,
          functionName,
          args,
          account: state.address,
          chain: hederaTestnet,
          gas: HEDERA_GAS_LIMIT,
          gasPrice,
          ...(value !== undefined ? { value } : {}),
        } as any);
      } else {
        const { request } = await publicClient.simulateContract({
          address: contractAddr,
          abi,
          functionName,
          args,
          account: state.address,
          ...(value !== undefined ? { value } : {}),
        });
        hash = await walletClient.writeContract({ ...request });
      }
      return hash;
    },
    [state.address]
  );

  return { state, connect, disconnect, switchNetwork, writeContract };
}
