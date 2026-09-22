import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recoverAddress, type Address, type Hex } from "viem";
import { verdictDigest, toScaledPrice, sortBySigner } from "../src/chain/sign.ts";

/**
 * Cross-implementation agreement.
 *
 * The fixture is written by `contracts/test/Digest.t.sol`, which computes the
 * digest inside the contract that will verify it. If the TypeScript signer
 * and the Solidity verifier disagree by one field's order or width, the
 * struct hash differs, ecrecover returns some other address, and every post
 * is rejected as coming from a stranger -- a failure whose symptom points at
 * the key rather than at the encoding. Regenerate with `forge test`.
 */
interface Fixture {
  chainId: number;
  verifyingContract: Address;
  signer: Address;
  ticker: string;
  domainSeparator: Hex;
  digest: Hex;
  signature: Hex;
  verdict: {
    price: string;
    publishedAt: string;
    lastTradeTime: string;
    confidenceBps: number;
    flags: number;
    provenance: number;
    session: number;
    maxDeviationBps: number;
    sourceCount: number;
  };
}

const fx = JSON.parse(
  readFileSync(new URL("./fixtures/digest.json", import.meta.url), "utf8"),
) as Fixture;

const onChain = {
  price: BigInt(fx.verdict.price),
  publishedAt: BigInt(fx.verdict.publishedAt),
  lastTradeTime: BigInt(fx.verdict.lastTradeTime),
  confidenceBps: fx.verdict.confidenceBps,
  flags: fx.verdict.flags,
  provenance: fx.verdict.provenance,
  session: fx.verdict.session,
  maxDeviationBps: fx.verdict.maxDeviationBps,
  sourceCount: fx.verdict.sourceCount,
};

test("the TypeScript digest equals the one the contract computed", () => {
  const ours = verdictDigest(
    { chainId: fx.chainId, verifyingContract: fx.verifyingContract },
    fx.ticker,
    onChain,
  );
  assert.equal(ours, fx.digest);
});

test("the contract's signature recovers to its allow-listed signer", async () => {
  const recovered = await recoverAddress({ hash: fx.digest, signature: fx.signature });
  assert.equal(recovered.toLowerCase(), fx.signer.toLowerCase());
});

test("the digest is bound to the chain and the contract", () => {
  const base = { chainId: fx.chainId, verifyingContract: fx.verifyingContract };
  const otherChain = verdictDigest({ ...base, chainId: fx.chainId + 1 }, fx.ticker, onChain);
  const otherContract = verdictDigest(
    { ...base, verifyingContract: "0x000000000000000000000000000000000000dEaD" },
    fx.ticker,
    onChain,
  );
  // A verdict signed for the testnet deployment must not post to mainnet.
  assert.notEqual(otherChain, fx.digest);
  assert.notEqual(otherContract, fx.digest);
});

test("every field is load-bearing in the digest", () => {
  const domain = { chainId: fx.chainId, verifyingContract: fx.verifyingContract };
  const base = verdictDigest(domain, fx.ticker, onChain);

  // Each mutation must move the digest. A field that does not is a field the
  // signature does not actually commit to, which is a forgery surface.
  const mutations: Array<[string, typeof onChain]> = [
    ["price", { ...onChain, price: onChain.price + 1n }],
    ["publishedAt", { ...onChain, publishedAt: onChain.publishedAt + 1n }],
    ["lastTradeTime", { ...onChain, lastTradeTime: onChain.lastTradeTime + 1n }],
    ["confidenceBps", { ...onChain, confidenceBps: onChain.confidenceBps + 1 }],
    ["flags", { ...onChain, flags: onChain.flags + 1 }],
    ["provenance", { ...onChain, provenance: onChain.provenance + 1 }],
    ["session", { ...onChain, session: onChain.session + 1 }],
    ["maxDeviationBps", { ...onChain, maxDeviationBps: onChain.maxDeviationBps + 1 }],
    ["sourceCount", { ...onChain, sourceCount: onChain.sourceCount + 1 }],
  ];
  for (const [field, mutated] of mutations) {
    assert.notEqual(verdictDigest(domain, fx.ticker, mutated), base, `${field} is not committed`);
  }
  assert.notEqual(verdictDigest(domain, "AAPL", onChain), base, "ticker is not committed");
});

test("price scaling is decimal, not floating point", () => {
  assert.equal(toScaledPrice(227.38), 22_738_000_000n);
  assert.equal(toScaledPrice(0.1), 10_000_000n);
  // The case that motivates going through toFixed: 1e8 is large enough that
  // the naive multiply lands on the wrong side of a representable value.
  assert.equal(toScaledPrice(1.005), 100_500_000n);
  assert.equal(toScaledPrice(8.87), 887_000_000n);
  assert.equal(toScaledPrice(0), 0n);
  assert.throws(() => toScaledPrice(-1));
  assert.throws(() => toScaledPrice(Number.NaN));
});

test("signatures sort ascending by recovered signer", () => {
  const lo = "0x1111111111111111111111111111111111111111" as Address;
  const hi = "0xffffffffffffffffffffffffffffffffffffffff" as Address;
  const sorted = sortBySigner([
    { signer: hi, signature: "0xbb" },
    { signer: lo, signature: "0xaa" },
  ]);
  // The contract proves distinctness by demanding this order, so an unsorted
  // quorum is rejected even when every signature is valid.
  assert.deepEqual(sorted, ["0xaa", "0xbb"]);
});
