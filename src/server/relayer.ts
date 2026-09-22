/**
 * The relayer: build verdicts, sign them, put them on chain.
 *
 * A long-lived process on a VM rather than a scheduled function. It holds a
 * funded key, it should not be restarted on every invocation, and it is not
 * subject to a host's cron-frequency limits — the failure being avoided is a
 * platform rejecting a sub-daily schedule at deploy time while the last good
 * build keeps serving a feed that has quietly stopped updating.
 */

import { formatEther, type Address } from "viem";
import { UNIVERSE } from "../lib/universe.ts";
import { Session, sessionAt } from "../lib/session.ts";
import { describeFlags } from "../lib/flags.ts";
import { allVerdicts } from "./feed.ts";
import { TAPEGUARD_ABI } from "../chain/abi.ts";
import {
  chainConfig,
  publicClient,
  signerAddress,
  walletClient,
  writeBlockers,
} from "../chain/client.ts";
import { signVerdict, toOnChain, type OnChainVerdict } from "../chain/sign.ts";
import type { Verdict } from "../lib/verdict.ts";

const num = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

const PRICE_MOVE_BPS = num("RELAY_PRICE_MOVE_BPS", 10);
const BAND_MOVE_BPS = num("RELAY_BAND_MOVE_BPS", 15);
const MAX_ONCHAIN_AGE = num("RELAY_MAX_ONCHAIN_AGE", 3 * 3600);
const LOW_BALANCE_ETH = num("RELAY_LOW_BALANCE_ETH", 0.0005);

/**
 * Run one tick and exit.
 *
 * For verifying a deployment before letting it spend anything, and for
 * driving the relayer from an external scheduler if that is ever preferred
 * to the long-lived unit. The long-lived unit remains the default because a
 * scheduler that silently stops firing is indistinguishable, from outside,
 * from a feed with nothing to say.
 */
const ONCE = process.env["RELAY_ONCE"] === "true";

/** Do everything except send, and report what would have been posted. */
const DRY = process.env["RELAY_DRY"] === "true";

/** Tighter while the tape prints, loose while it does not. */
const tickMs = (now: number): number =>
  sessionAt(now).session === Session.REGULAR ? 20_000 : 300_000;

const log = (...args: unknown[]): void =>
  console.log(new Date().toISOString(), ...args);

interface Stored {
  price: bigint;
  publishedAt: bigint;
  confidenceBps: number;
  flags: number;
  provenance: number;
}

async function readStored(address: Address, ticker: string): Promise<Stored | null> {
  try {
    const v = (await publicClient().readContract({
      address,
      abi: TAPEGUARD_ABI,
      functionName: "getVerdict",
      args: [ticker],
    })) as unknown as Stored;
    return v;
  } catch {
    // Never posted, which the contract signals by reverting NotPosted. That
    // is material by definition, so it is not an error worth logging.
    return null;
  }
}

interface Decision {
  post: boolean;
  why: string;
}

/**
 * Decide whether a verdict is worth the gas.
 *
 * The rule that matters: **a change of flags or provenance always posts**,
 * regardless of how little the price moved.
 *
 * A materiality filter keyed on price and band alone is exactly backwards for
 * this product. A stock halts, or goes ex-split tomorrow, and the number does
 * not move at all — so a price-only filter suppresses the update precisely
 * when the feed has something urgent to say, and the chain keeps serving a
 * clean TRADED verdict through the event the guards exist to catch.
 */
function decide(v: Verdict, stored: Stored | null, now: number): Decision {
  if (!stored) return { post: true, why: "never posted" };

  if (Number(stored.flags) !== v.flags) {
    return {
      post: true,
      why: `flags ${describeFlags(Number(stored.flags))} -> ${describeFlags(v.flags)}`,
    };
  }
  if (Number(stored.provenance) !== v.provenance) {
    return { post: true, why: `provenance ${stored.provenance} -> ${v.provenance}` };
  }

  const age = now - Number(stored.publishedAt);
  if (age > MAX_ONCHAIN_AGE) {
    return { post: true, why: `on-chain age ${(age / 3600).toFixed(1)}h` };
  }

  const storedPrice = Number(stored.price) / 1e8;
  if (storedPrice > 0) {
    const moveBps = Math.abs((v.price - storedPrice) / storedPrice) * 10_000;
    if (moveBps >= PRICE_MOVE_BPS) {
      return { post: true, why: `price moved ${moveBps.toFixed(1)}bps` };
    }
  }

  const bandMove = Math.abs(v.confidenceBps - Number(stored.confidenceBps));
  if (bandMove >= BAND_MOVE_BPS) {
    return { post: true, why: `band moved ${bandMove}bps` };
  }

  return { post: false, why: "nothing material changed" };
}

async function tick(): Promise<void> {
  const cfg = chainConfig();
  const blockers = writeBlockers(cfg);
  if (blockers.length > 0) {
    log(`idle: missing ${blockers.join(", ")}`);
    return;
  }
  const address = cfg.address as Address;
  const signerKey = cfg.signerKey!;
  const relayerKey = cfg.relayerKey!;

  const now = Math.floor(Date.now() / 1000);
  const { verdicts, failures } = await allVerdicts();
  for (const f of failures) log(`  ! ${f.ticker}: ${f.error}`);
  if (verdicts.length === 0) return;

  const stored = await Promise.all(verdicts.map((v) => readStored(address, v.ticker)));

  const due: Array<{ ticker: string; v: OnChainVerdict; why: string }> = [];
  for (const [i, v] of verdicts.entries()) {
    const d = decide(v, stored[i] ?? null, now);
    if (d.post) due.push({ ticker: v.ticker, v: toOnChain(v), why: d.why });
  }

  if (due.length === 0) return;
  const verb = DRY ? "would post" : "posting";
  log(`${verb} ${due.length}/${verdicts.length}: ${due.map((d) => `${d.ticker} (${d.why})`).join(", ")}`);
  if (DRY) return;

  const signatures = await Promise.all(
    due.map(async (d) => {
      // One signer today. The contract takes an array and a threshold, so
      // going to 2-of-3 is a transaction rather than a redeploy — but with
      // one key the trust assumption is one key, and saying otherwise would
      // be a claim the deployment cannot back.
      const sig = await signVerdict(
        signerKey,
        { chainId: cfg.chainId, verifyingContract: address },
        d.ticker,
        d.v,
      );
      return [sig];
    }),
  );

  const wallet = walletClient(relayerKey);
  const account = wallet.account!;
  const pub = publicClient();

  const balance = await pub.getBalance({ address: account.address });
  if (Number(formatEther(balance)) < LOW_BALANCE_ETH) {
    log(`  ! relayer ${account.address} is low: ${formatEther(balance)} ETH`);
  }

  // Batch from two upwards. A batch of one pays the helper's call overhead to
  // save nothing, and more importantly all of them land in one block: posted
  // separately they land across many, and a consumer reading mid-round gets a
  // snapshot that existed at no instant.
  //
  // The two branches are written out rather than built as one union object:
  // viem correlates functionName with args at the call site, and a union
  // defeats that, which would mean losing the type check on exactly the
  // argument tuple whose field order the signature commits to.
  try {
    let hash: `0x${string}`;
    if (due.length >= 2) {
      // Simulate first. An eth_call is free and answers the same question a
      // receipt would, so an unacceptable verdict is caught before it is paid
      // for. postVerdicts reports per-item success in its return value, and
      // nothing observes that without waiting for a receipt.
      const { request } = await pub.simulateContract({
        address,
        abi: TAPEGUARD_ABI,
        account,
        functionName: "postVerdicts",
        args: [due.map((d) => d.ticker), due.map((d) => d.v), signatures],
      });
      hash = await wallet.writeContract(request);
    } else {
      const only = due[0]!;
      const { request } = await pub.simulateContract({
        address,
        abi: TAPEGUARD_ABI,
        account,
        functionName: "postVerdict",
        args: [only.ticker, only.v, signatures[0]!],
      });
      hash = await wallet.writeContract(request);
    }
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    log(`  ${receipt.status} ${hash} gas ${receipt.gasUsed}`);
  } catch (err) {
    log(`  ! send failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

async function main(): Promise<void> {
  const cfg = chainConfig();
  log("tapeguard relayer");
  log(`  chain    ${cfg.chainId} via ${cfg.rpcUrl}`);
  log(`  contract ${cfg.address ?? "(unset)"}`);
  log(`  signer   ${cfg.signerKey ? signerAddress(cfg.signerKey) : "(unset)"}`);
  log(`  relayer  ${cfg.relayerKey ? signerAddress(cfg.relayerKey) : "(unset)"}`);
  log(`  universe ${UNIVERSE.map((i) => i.ticker).join(" ")}`);

  const blockers = writeBlockers(cfg);
  if (blockers.length > 0) log(`  waiting on ${blockers.join(", ")}`);

  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      log(`${sig}, stopping after this tick`);
      stopping = true;
    });
  }

  if (ONCE) {
    await tick();
    return;
  }

  while (!stopping) {
    const started = Date.now();
    try {
      await tick();
    } catch (err) {
      // A bad tick must never kill the process: systemd would restart it, but
      // a crash loop on a persistent upstream fault is a feed that is down
      // rather than a feed that is degraded.
      log(`! tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const wait = Math.max(1000, tickMs(Math.floor(Date.now() / 1000)) - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
