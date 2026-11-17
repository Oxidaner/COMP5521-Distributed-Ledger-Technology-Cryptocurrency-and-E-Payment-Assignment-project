import { getAddress } from "ethers";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface ConnectedWallet {
  account: string;
  chainId: number;
}

export function parseChainId(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  return Number(BigInt(value));
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export async function connectMetaMask(
  provider: Eip1193Provider | undefined =
    typeof window === "undefined" ? undefined : window.ethereum,
): Promise<ConnectedWallet> {
  if (!provider) throw new Error("MetaMask was not found in this browser.");

  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("MetaMask did not return an account.");
  }

  const chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
  if (chainId === null) {
    throw new Error("MetaMask returned an invalid chain ID.");
  }

  return { account: getAddress(accounts[0]), chainId };
}

export async function switchMetaMaskNetwork(
  chainId: 11155111 | 421614,
  provider: Eip1193Provider | undefined =
    typeof window === "undefined" ? undefined : window.ethereum,
): Promise<void> {
  if (!provider) throw new Error("MetaMask was not found in this browser.");
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${chainId.toString(16)}` }],
  });
}
