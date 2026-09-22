/**
 * Halt detection.
 *
 * A halt is invisible to a calendar. The tape is scheduled open, the session
 * label says REGULAR, and prints simply stop arriving — LULD volatility
 * pauses, news-pending halts, regulatory halts. A feed that trusts the
 * calendar hands a frozen price to a liquidation path and labels it TRADED.
 *
 * The hard part is not noticing the silence. It is telling apart:
 *
 *   the exchange stopped printing       -> a halt, refuse the price
 *   our vendor stopped delivering       -> a data problem, use another source
 *
 * Both look identical through one connection, which is why a single-source
 * feed cannot make this call and must say so rather than guess. With two
 * independent timestamped sources the question is decidable: if the freshest
 * print across all of them is stale, the silence is the market's.
 */

import { Session } from "../session.ts";
import { Flag } from "../flags.ts";
import type { Instrument } from "../universe.ts";

export interface SourceObservation {
  source: string;
  price: number;
  /**
   * Unix seconds of the print this source reports. Null when the source does
   * not report a genuine print time — such a source may contribute a price
   * but can never establish freshness, so it is excluded from this test.
   */
  lastTradeTime: number | null;
  /**
   * The underlying feed this source resells, when known. Two vendors on one
   * feed are one source for independence purposes. Defaults to the source
   * name, which treats every source as its own feed.
   */
  feed?: string;
}

/** An entry from an exchange halt feed, when one is reachable. */
export interface OfficialHalt {
  code: string;
  reason: string;
  haltedAt: number;
  resumedAt: number | null;
}

export type HaltConfidence = "official" | "corroborated" | "unconfirmed" | "none";

export interface HaltVerdict {
  halted: boolean;
  confidence: HaltConfidence;
  flags: number;
  /** Age of the freshest print across timestamped sources, seconds. */
  secondsSinceLastPrint: number | null;
  thresholdSec: number;
  /** Number of sources that reported a genuine print time. */
  timestampedSources: number;
  /**
   * Distinct underlying feeds among those sources. This, not the source
   * count, is what corroboration needs.
   */
  independentFeeds: number;
  /** Spread between the oldest and freshest source timestamp, seconds. */
  sourceTimestampSpreadSec: number | null;
  reason: string;
}

export function checkHalt(args: {
  instrument: Instrument;
  session: Session;
  observations: readonly SourceObservation[];
  now: number;
  officialHalt?: OfficialHalt | null;
}): HaltVerdict {
  const { instrument, session, observations, now } = args;
  const officialHalt = args.officialHalt ?? null;
  const thresholdSec = instrument.haltThresholdSec;

  const base = {
    flags: Flag.NONE,
    thresholdSec,
    secondsSinceLastPrint: null as number | null,
    timestampedSources: 0,
    independentFeeds: 0,
    sourceTimestampSpreadSec: null as number | null,
  };

  // An official halt notice is authoritative and needs no corroboration.
  if (officialHalt && officialHalt.resumedAt === null) {
    return {
      ...base,
      halted: true,
      confidence: "official",
      reason:
        `Exchange halt ${officialHalt.code} in force since ` +
        `${new Date(officialHalt.haltedAt * 1000).toISOString()}: ${officialHalt.reason}.`,
    };
  }

  // Outside regular hours the staleness test has no power. Pre- and post-market
  // prints are sporadic by nature, so minutes of silence is ordinary there and
  // says nothing about whether trading is permitted. Refusing a stale
  // pre-market price is the staleness rule's job, not this one's.
  if (session !== Session.REGULAR) {
    return {
      ...base,
      halted: false,
      confidence: "none",
      reason: "Tape is not in regular hours; the silence test does not apply.",
    };
  }

  const timestamped = observations.filter(
    (o): o is SourceObservation & { lastTradeTime: number } => o.lastTradeTime !== null,
  );

  if (timestamped.length === 0) {
    return {
      ...base,
      halted: false,
      confidence: "none",
      reason:
        "No source reported a genuine print time, so print freshness is unknown. " +
        "Staleness cannot be assessed and a halt cannot be ruled out.",
    };
  }

  const feeds = new Set(timestamped.map((o) => o.feed ?? o.source));
  const times = timestamped.map((o) => o.lastTradeTime);
  const freshest = Math.max(...times);
  const oldest = Math.min(...times);
  const age = now - freshest;
  const spread = freshest - oldest;

  const measured = {
    ...base,
    secondsSinceLastPrint: age,
    timestampedSources: timestamped.length,
    independentFeeds: feeds.size,
    sourceTimestampSpreadSec: spread,
  };

  // At least one source has a recent print, so the tape is printing. A wide
  // spread between sources now means a lagging vendor, not a halt — worth
  // flagging, because the laggard's price is the one that would mislead.
  if (age <= thresholdSec) {
    const laggingVendor = spread > thresholdSec && timestamped.length > 1;
    return {
      ...measured,
      halted: false,
      confidence: "none",
      flags: laggingVendor ? Flag.SOURCE_DIVERGENT : Flag.NONE,
      reason: laggingVendor
        ? `Freshest print is ${age}s old, but sources disagree by ${spread}s ` +
          `on when it happened. One vendor is lagging; the tape is printing.`
        : `Freshest print is ${age}s old, inside the ${thresholdSec}s threshold.`,
    };
  }

  // Every timestamped source is stale. With two or more independent FEEDS
  // that is the market's silence, not one connection's. Counting vendors
  // instead of feeds would let three resellers of one IEX tape "corroborate"
  // each other, when their common silence is a single observation.
  if (feeds.size >= 2) {
    return {
      ...measured,
      halted: true,
      confidence: "corroborated",
      reason:
        `No print for ${age}s during regular hours, across ${feeds.size} independent ` +
        `feeds (${[...feeds].join(", ")}) via ` +
        `${timestamped.map((o) => o.source).join(", ")}. ` +
        `Threshold is ${thresholdSec}s. The tape has stopped, not a vendor.`,
    };
  }

  // One feed, and it is stale. A halt and a broken connection are the same
  // observation here. Refuse the price, and say why the call is unconfirmed
  // rather than dress a guess up as a detection.
  const via = timestamped.map((o) => o.source).join(", ");
  return {
    ...measured,
    halted: true,
    confidence: "unconfirmed",
    flags: Flag.HALT_UNCONFIRMED | Flag.SINGLE_SOURCE,
    reason:
      `No print for ${age}s during regular hours, but every timestamped source ` +
      `(${via}) reads the same feed "${[...feeds][0]}". A halt and a stalled feed ` +
      `are indistinguishable from one vantage point, so this is refused as ` +
      `unconfirmed. Add a source on a genuinely different feed to decide it.`,
  };
}
