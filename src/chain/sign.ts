/**
 * EIP-712 signing for a verdict.
 *
 * The digest computed here and the one computed by `TapeGuard._digest` must
 * agree byte for byte. If they disagree by a single field's order or width,
 * `ecrecover` returns a different address, the contract rejects every post as
 * coming from a stranger, and nothing about that failure points at the cause
 * — it looks like a key problem. `test/digest.test.ts` pins both sides
 * against a fixture the Solidity test itself writes.
 */

import { keccak256, toHex, hashTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Verdict } from "../lib/verdict.ts";

/** Fixed-point scale of the on-chain price. Matches TapeGuard.PRICE_SCALE. */
export const PRICE_SCALE = 100_000_000n;
const PRICE_DECIMALS = 8;

/**
 * Widths follow the Solidity struct exactly: bigint for uint64 and wider,
 * number below it. Not a style choice — viem encodes from these types, so a
 * field declared at the wrong width produces a different struct hash and a
 * signature that recovers to nobody.
 */
export interface OnChainVerdict {
  price: bigint; // uint128
  publishedAt: bigint; // uint64
  lastTradeTime: bigint; // uint64
  confidenceBps: number; // uint32
  flags: number; // uint16
  provenance: number; // uint8
  session: number; // uint8
  maxDeviationBps: number; // uint16
  sourceCount: number; // uint8
}

export const VERDICT_TYPES = {
  Verdict: [
    { name: "ticker", type: "bytes32" },
    { name: "price", type: "uint128" },
    { name: "publishedAt", type: "uint64" },
    { name: "lastTradeTime", type: "uint64" },
    { name: "confidenceBps", type: "uint32" },
    { name: "flags", type: "uint16" },
    { name: "provenance", type: "uint8" },
    { name: "session", type: "uint8" },
    { name: "maxDeviationBps", type: "uint16" },
    { name: "sourceCount", type: "uint8" },
  ],
} as const;

/**
 * Scale a price to fixed point through its decimal string.
 *
 * `Math.round(p * 1e8)` is close but not exact: 1e8 is large enough that the
 * multiplication lands on the wrong side of a representable value for some
 * ordinary prices, and the result is a silent one-unit error in the number a
 * liquidation reads. Going via `toFixed` makes the rounding decimal and
 * explicit.
 */
export function toScaledPrice(price: number): bigint {
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`cannot scale a non-finite or negative price: ${price}`);
  }
  const [whole = "0", frac = ""] = price.toFixed(PRICE_DECIMALS).split(".");
  return BigInt(whole) * PRICE_SCALE + BigInt(frac.padEnd(PRICE_DECIMALS, "0"));
}

export const fromScaledPrice = (scaled: bigint): number =>
  Number(scaled) / Number(PRICE_SCALE);

/** Project a verdict onto the tuple the contract stores. */
export function toOnChain(v: Verdict): OnChainVerdict {
  return {
    price: toScaledPrice(v.price),
    publishedAt: BigInt(Math.floor(Date.now() / 1000)),
    lastTradeTime: BigInt(v.lastTradeTime ?? 0),
    confidenceBps: Math.min(v.confidenceBps, 0xffff_ffff),
    flags: v.flags,
    provenance: v.provenance,
    session: v.session,
    // The contract field is uint16; a spread wider than 655% is a broken feed,
    // and saturating is better than wrapping to a small, believable number.
    maxDeviationBps: Math.min(v.maxDeviationBps, 0xffff),
    sourceCount: Math.min(v.sourceCount, 0xff),
  };
}

export interface Domain {
  chainId: number;
  verifyingContract: Address;
}

const domainOf = (d: Domain) =>
  ({
    name: "TapeGuard",
    version: "1",
    chainId: d.chainId,
    verifyingContract: d.verifyingContract,
  }) as const;

/** The ticker enters the struct hash as keccak256 of its UTF-8 bytes. */
export const tickerHash = (ticker: string): Hex => keccak256(toHex(ticker));

export function verdictDigest(
  domain: Domain,
  ticker: string,
  v: OnChainVerdict,
): Hex {
  return hashTypedData({
    domain: domainOf(domain),
    types: VERDICT_TYPES,
    primaryType: "Verdict",
    message: { ticker: tickerHash(ticker), ...v },
  });
}

export async function signVerdict(
  privateKey: Hex,
  domain: Domain,
  ticker: string,
  v: OnChainVerdict,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData({
    domain: domainOf(domain),
    types: VERDICT_TYPES,
    primaryType: "Verdict",
    message: { ticker: tickerHash(ticker), ...v },
  });
}

/**
 * Order signatures the way the contract requires.
 *
 * TapeGuard proves distinctness in O(n) by demanding ascending recovered
 * addresses, so an unsorted quorum is rejected even when every signature is
 * valid. Sorting is the caller's job and it is easy to forget with one signer,
 * because a single signature is trivially sorted and the requirement only
 * surfaces the day the threshold is raised.
 */
export function sortBySigner(
  signed: ReadonlyArray<{ signer: Address; signature: Hex }>,
): Hex[] {
  return [...signed]
    .sort((a, b) => (a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1))
    .map((s) => s.signature);
}
