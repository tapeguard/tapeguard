/**
 * Chain clients and configuration.
 *
 * Two keys, deliberately separate. The signer is what the system's trust
 * rests on and is allow-listed on the contract; the relayer only pays gas.
 * Keeping them apart means a compromised gas wallet is a funding problem
 * rather than a feed-integrity one, and the relayer can be rotated freely
 * without a `setSigner` transaction.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env["RPC_URL"] ?? "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = Number(process.env["CHAIN_ID"] ?? 4663);

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Explorer", url: "https://explorer.mainnet.chain.robinhood.com" },
  },
});

const asHex = (name: string): Hex | null => {
  const raw = process.env[name];
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} is not a 32-byte hex private key`);
  }
  return hex as Hex;
};

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  address: Address | null;
  signerKey: Hex | null;
  relayerKey: Hex | null;
}

export function chainConfig(): ChainConfig {
  const address = process.env["TAPEGUARD_ADDRESS"] ?? "";
  return {
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    address: /^0x[0-9a-fA-F]{40}$/.test(address) ? (address as Address) : null,
    signerKey: asHex("ORACLE_SIGNER_KEY"),
    relayerKey: asHex("RELAYER_KEY"),
  };
}

/**
 * What is missing before this deployment can write to the chain.
 *
 * Returned as a list rather than a boolean so a misconfiguration names itself
 * in `/api/health` instead of presenting as a feed that simply never updates.
 */
export function writeBlockers(cfg: ChainConfig = chainConfig()): string[] {
  const missing: string[] = [];
  if (!cfg.address) missing.push("TAPEGUARD_ADDRESS");
  if (!cfg.signerKey) missing.push("ORACLE_SIGNER_KEY");
  if (!cfg.relayerKey) missing.push("RELAYER_KEY");
  return missing;
}

export const publicClient = (): PublicClient =>
  createPublicClient({ chain: robinhoodChain, transport: http(RPC_URL) });

export function walletClient(key: Hex): WalletClient {
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: robinhoodChain,
    transport: http(RPC_URL),
  });
}

export const signerAddress = (key: Hex): Address => privateKeyToAccount(key).address;
