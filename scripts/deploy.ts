/**
 * Deploy TapeGuard.
 *
 *   npm run deploy -- local
 *   npm run deploy -- rh-testnet
 *   DEPLOY_CONFIRM=yes npm run deploy -- rh-mainnet
 *
 * Every guard here exists because the alternative is an irreversible
 * transaction against the wrong chain, the wrong balance, or the wrong key.
 */

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  formatEther,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

interface Target {
  name: string;
  url: string;
  chainId: number;
  live: boolean;
}

const TARGETS: Target[] = [
  { name: "local", url: "http://127.0.0.1:8545", chainId: 31337, live: false },
  { name: "arb-sepolia", url: "https://sepolia-rollup.arbitrum.io/rpc", chainId: 421614, live: false },
  { name: "rh-testnet", url: "https://rpc.testnet.chain.robinhood.com", chainId: 46630, live: false },
  { name: "rh-mainnet", url: "https://rpc.mainnet.chain.robinhood.com", chainId: 4663, live: true },
];

function artifact(): { abi: readonly unknown[]; bytecode: Hex } {
  const raw = readFileSync(new URL("../out/TapeGuard.sol/TapeGuard.json", import.meta.url), "utf8");
  const json = JSON.parse(raw) as { abi: unknown[]; bytecode: { object: string } };
  const object = json.bytecode?.object ?? "";
  if (!object.startsWith("0x") || object.length < 100) {
    throw new Error("no bytecode in the artifact — run `forge build` first");
  }
  return { abi: json.abi, bytecode: object as Hex };
}

function requireKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set`);
  const hex = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${name} is not a 32-byte hex key`);
  return hex;
}

async function main(): Promise<void> {
  const name = process.argv[2];
  const target = TARGETS.find((t) => t.name === name);
  if (!target) {
    console.error(`usage: npm run deploy -- <${TARGETS.map((t) => t.name).join("|")}>`);
    process.exit(1);
  }

  const deployerKey = requireKey("DEPLOYER_KEY");
  const signerKey = requireKey("ORACLE_SIGNER_KEY");
  const deployer = privateKeyToAccount(deployerKey);
  const signer = privateKeyToAccount(signerKey);

  // Separate keys on purpose. The signer is what the system's trust rests on
  // and is allow-listed on the contract; the deployer is a hot wallet that
  // only pays gas and can be rotated without touching the contract.
  if (deployer.address.toLowerCase() === signer.address.toLowerCase()) {
    throw new Error("DEPLOYER_KEY and ORACLE_SIGNER_KEY are the same key; use two");
  }

  const chain = defineChain({
    id: target.chainId,
    name: target.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [target.url] } },
  });
  const pub = createPublicClient({ chain, transport: http(target.url) });
  const wallet = createWalletClient({ account: deployer, chain, transport: http(target.url) });

  console.log(`deploying TapeGuard to ${target.name}`);
  console.log(`  rpc       ${target.url}`);
  console.log(`  deployer  ${deployer.address}`);
  console.log(`  signer    ${signer.address}   (allow-listed at construction)`);

  // Ask the chain what it is rather than trusting the label on the URL. An
  // RPC that has been repointed, or a copied config, is otherwise found out
  // by an irreversible transaction.
  const actual = await pub.getChainId();
  if (actual !== target.chainId) {
    throw new Error(`RPC reports chainId ${actual}, expected ${target.chainId} — refusing`);
  }
  console.log(`  chainId   ${actual}  verified against the RPC`);

  const { abi, bytecode } = artifact();
  // estimateGas over the encoded deploy data, not estimateContractGas: the
  // latter encodes a function call and a constructor is not one, so it fails
  // looking for a selector that was never meant to exist.
  const deployData = encodeDeployData({ abi, bytecode, args: [signer.address] } as never);
  const gas = await pub.estimateGas({ account: deployer, data: deployData });
  const gasPrice = await pub.getGasPrice();
  const cost = gas * gasPrice;
  const balance = await pub.getBalance({ address: deployer.address });

  console.log(`  gas       ${gas} at ${formatEther(gasPrice * 10n ** 9n)} gwei`);
  console.log(`  cost      ~${formatEther(cost)} ETH`);
  console.log(`  balance   ${formatEther(balance)} ETH`);

  if (balance < cost) {
    throw new Error(`deployer holds ${formatEther(balance)} ETH, needs ~${formatEther(cost)}`);
  }

  if (target.live && process.env["DEPLOY_CONFIRM"] !== "yes") {
    console.error(`\n${target.name} is a live chain. Re-run with DEPLOY_CONFIRM=yes to proceed.`);
    process.exit(1);
  }

  const hash = await wallet.deployContract({
    abi,
    bytecode,
    args: [signer.address],
  } as never);
  console.log(`\n  tx        ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  const address = receipt.contractAddress as Address;
  if (receipt.status !== "success" || !address) throw new Error("deployment reverted");

  // Read the contract back rather than assuming the constructor did what it
  // says. A deployment that silently allow-listed nobody produces a feed that
  // rejects every post as coming from a stranger.
  const [onChainSigner, threshold] = await Promise.all([
    pub.readContract({ address, abi, functionName: "isSigner", args: [signer.address] }),
    pub.readContract({ address, abi, functionName: "threshold" }),
  ]);
  if (onChainSigner !== true) throw new Error("signer was not allow-listed by the constructor");

  console.log(`  address   ${address}`);
  console.log(`  block     ${receipt.blockNumber}   gas used ${receipt.gasUsed}`);
  console.log(`  signer    allow-listed, threshold ${threshold}`);
  console.log(`\nnext:`);
  console.log(`  TAPEGUARD_ADDRESS=${address}`);
  console.log(`  RELAY_ONCE=true RELAY_DRY=true node src/server/relayer.ts   # check, spend nothing`);
  console.log(`  then drop RELAY_DRY and let systemd take over\n`);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
