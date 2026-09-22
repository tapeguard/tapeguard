/**
 * The verdict: one decision, assembled from the guards.
 *
 * Order matters here, so it is explicit rather than emergent.
 */

import { Session, SESSION_NAME, sessionAt } from "./session.ts";
import { Flag, Provenance, PROVENANCE_NAME, describeFlags, hasFlag } from "./flags.ts";
import { requireInstrument, sigmaOverHours, type Instrument } from "./universe.ts";
import { consensus, type PricePoint } from "./consensus.ts";
import { checkHalt, type OfficialHalt, type SourceObservation } from "./guards/halt.ts";
import {
  checkDiscontinuity,
  checkSchedule,
  type CorporateAction,
} from "./guards/corpaction.ts";
import { checkEarnings, type EarningsEvent } from "./guards/earnings.ts";

/** Band for a live print, bps, before source dispersion is added. */
export const BASE_REGULAR_BPS = 8;
export const BASE_PREPOST_BPS = 35;

/**
 * Floor for a gap band, bps.
 *
 * Without a floor the band collapses when a session *label* changes while
 * the data has not improved at all: at 09:30 the label flips from CLOSED to
 * REGULAR and a naive formula narrows the band, although the anchor is still
 * Friday's close and nothing has printed. A stale anchor does not become
 * trustworthy because a bell rang.
 */
export const GAP_FLOOR_BPS = 50;

/**
 * The band reported when a discontinuity is detected, bps. 100%.
 *
 * Deliberately absurd. When the anchor and the new price are separated by a
 * corporate action, every band computed from that anchor is meaningless —
 * but some integrator will read `price` and ignore `flags`, because someone
 * always does. A band of 10,000bps cannot be mistaken for a tight one, so
 * the failure is loud in the field a careless consumer actually reads.
 */
export const NO_CLAIM_BPS = 10_000;

/**
 * How far our freshest print may lag the last instant a print could have
 * happened, before the data is behind the market rather than merely old.
 *
 * Longer than any single closure, so a normal weekend cannot trip it.
 */
export const MAX_ANCHOR_LAG_SEC = 26 * 3600;

export interface VerdictInput {
  ticker: string;
  now?: number;
  /** One entry per source that answered, with its reported print time. */
  observations: readonly SourceObservation[];
  /** Last price actually seen on the tape, to measure the move against. */
  anchorPrice: number;
  corporateActions?: readonly CorporateAction[];
  earningsEvents?: readonly EarningsEvent[];
  officialHalt?: OfficialHalt | null;
}

export interface Verdict {
  ticker: string;
  /** The price to publish: median across sources. */
  price: number;
  anchorPrice: number;
  provenance: Provenance;
  provenanceName: string;
  flags: number;
  flagNames: string;
  confidenceBps: number;
  session: Session;
  sessionName: string;
  lastTradeTime: number | null;
  darkHours: number;
  sourceCount: number;
  maxDeviationBps: number;
  /** True only when the provenance is TRADED and no flag is raised. */
  safe: boolean;
  /** Why, in order. Every line is one guard's finding. */
  reasons: string[];
}

export function bandBps(args: {
  provenance: Provenance;
  session: Session;
  instrument: Instrument;
  darkHours: number;
  maxDeviationBps: number;
  sigmaMultiple: number;
  flags: number;
}): number {
  const { provenance, session, instrument, darkHours, maxDeviationBps, sigmaMultiple, flags } =
    args;

  if (hasFlag(flags, Flag.DISCONTINUITY)) return NO_CLAIM_BPS;

  if (provenance === Provenance.TRADED) {
    const base = session === Session.REGULAR ? BASE_REGULAR_BPS : BASE_PREPOST_BPS;
    return base + maxDeviationBps;
  }

  const sigma = sigmaOverHours(instrument.overnightSigmaBps, darkHours) * sigmaMultiple;
  const twoSided = 1.96 * sigma + maxDeviationBps;
  return Math.max(twoSided, GAP_FLOOR_BPS);
}

export function buildVerdict(input: VerdictInput): Verdict {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const instrument = requireInstrument(input.ticker);
  const state = sessionAt(now);
  const reasons: string[] = [];

  const points: PricePoint[] = input.observations.map((o) => ({
    source: o.source,
    price: o.price,
  }));
  const agreed = consensus(points);
  if (!agreed) {
    throw new Error(`no usable price for ${instrument.ticker}: every source failed`);
  }

  let flags = Flag.NONE;
  reasons.push(
    `Session ${SESSION_NAME[state.session]} at ${state.etWallClock} ET` +
      (state.holidayName ? ` (${state.holidayName})` : "") +
      (state.isEarlyClose ? " (early close)" : "") +
      ".",
  );

  // Independence first: everything downstream is weaker without it, and a
  // consumer should see that before it sees any number derived from it.
  const feeds = new Set(input.observations.map((o) => o.feed ?? o.source));
  if (agreed.sourceCount === 1) {
    flags |= Flag.SINGLE_SOURCE;
    reasons.push(
      `Only "${agreed.sources[0]}" resolved, so the cross-source spread is 0 because ` +
        `there was nothing to compare against, not because sources agree.`,
    );
  } else if (feeds.size === 1) {
    // Several vendors, one tape. The median cannot outvote a bad print they
    // all inherited, and their spread is zero for the same reason a single
    // source's is: there is nothing there to disagree.
    flags |= Flag.SINGLE_SOURCE;
    reasons.push(
      `${agreed.sourceCount} vendors (${agreed.sources.join(", ")}) all read one feed ` +
        `("${[...feeds][0]}"). That is one source wearing ${agreed.sourceCount} hats, ` +
        `not ${agreed.sourceCount} opinions.`,
    );
  } else {
    reasons.push(
      `${agreed.sourceCount} sources across ${feeds.size} feeds ` +
        `(${agreed.sources.join(", ")}), median taken, ` +
        `spread ${agreed.maxDeviationBps.toFixed(1)}bps.`,
    );
  }

  const timestamped = input.observations.filter((o) => o.lastTradeTime !== null);
  const freshestPrint =
    timestamped.length > 0 ? Math.max(...timestamped.map((o) => o.lastTradeTime as number)) : null;

  // 1. Halt. Runs before staleness so a live tape that stopped is named as a
  //    halt rather than filed as old data.
  const halt = checkHalt({
    instrument,
    session: state.session,
    observations: input.observations,
    now,
    officialHalt: input.officialHalt ?? null,
  });
  flags |= halt.flags;

  // 2. Anchor lag. Our data has missed a session that already happened, which
  //    is a different failure from a halt and from an honestly shut tape.
  const anchorLag = freshestPrint === null ? null : state.lastTradableInstant - freshestPrint;
  const behindMarket = anchorLag !== null && anchorLag > MAX_ANCHOR_LAG_SEC;

  let provenance: Provenance;
  if (freshestPrint === null) {
    provenance = Provenance.STALE;
    reasons.push("No source reported a print time, so freshness cannot be established.");
  } else if (behindMarket) {
    provenance = Provenance.STALE;
    reasons.push(
      `Freshest print is ${((anchorLag as number) / 3600).toFixed(1)}h behind the last ` +
        `instant a print could have happened. The data has missed a session.`,
    );
  } else if (halt.halted) {
    provenance = Provenance.HALTED;
    reasons.push(halt.reason);
  } else if (state.session === Session.REGULAR) {
    provenance = Provenance.TRADED;
    reasons.push(halt.reason);
  } else {
    provenance = Provenance.DERIVED;
    reasons.push(
      `Tape is shut; last regular close was ` +
        `${new Date(state.lastTradableInstant * 1000).toISOString()}. This price is a ` +
        `model output, not an observed print.`,
    );
    if (halt.flags !== Flag.NONE) reasons.push(halt.reason);
  }

  // 3. Corporate actions. The feed check and the feedless check are both run:
  //    the feed is precise when reachable, the heuristic still works when not.
  const windowEnd = state.nextOpen;
  const schedule = checkSchedule({
    ticker: instrument.ticker,
    actions: input.corporateActions ?? [],
    now,
    throughUnix: windowEnd,
  });
  if (schedule.flags !== Flag.NONE) {
    flags |= schedule.flags;
    reasons.push(schedule.reason);
  }

  // 4. Earnings, BEFORE the discontinuity test, because it sets the sigma that
  //    test measures against. An earnings night genuinely moves a stock 25%,
  //    which is 18 sigma of an ordinary night and 5 sigma of an earnings one.
  //    Checked against the ordinary sigma, the guard would cry corporate
  //    action four times a year per ticker on real, correct prices.
  //
  //    A split still clears the bar either way: 10:1 is 153 sigma ordinary
  //    and 44 sigma earnings-adjusted, and dividing out the ratio still
  //    leaves nothing. The multiplier suppresses false alarms, not detections.
  const earnings = checkEarnings({
    instrument,
    events: input.earningsEvents ?? [],
    windowStart: freshestPrint ?? state.previousRegularClose,
    windowEnd,
  });
  if (earnings.flags !== Flag.NONE) {
    flags |= earnings.flags;
    reasons.push(earnings.reason);
  }

  // 5. Discontinuity. Measured from the last settled close to the price now,
  //    which is the window a corporate action would sit inside. This uses
  //    `previousRegularClose`, not `lastTradableInstant`: the latter is `now`
  //    during REGULAR and would give a zero-length window.
  const hoursSinceClose = (now - state.previousRegularClose) / 3600;
  const discontinuity = checkDiscontinuity({
    ticker: instrument.ticker,
    anchorPrice: input.anchorPrice,
    newPrice: agreed.price,
    overnightSigmaBps: instrument.overnightSigmaBps * earnings.sigmaMultiple,
    darkHours: hoursSinceClose,
  });
  if (discontinuity.flags !== Flag.NONE) {
    flags |= discontinuity.flags;
    reasons.push(discontinuity.reason);
  }

  // Source dispersion beyond tolerance is its own warning: the median is
  // still the best estimate, but the sources do not agree on what is true.
  if (agreed.sourceCount > 1 && agreed.maxDeviationBps > instrument.overnightSigmaBps) {
    flags |= Flag.SOURCE_DIVERGENT;
    reasons.push(
      `Sources disagree by ${agreed.maxDeviationBps.toFixed(0)}bps, wider than this ` +
        `instrument's whole overnight sigma (${instrument.overnightSigmaBps}bps).`,
    );
  }

  const darkHours =
    provenance === Provenance.TRADED
      ? 0
      : provenance === Provenance.HALTED
        ? Math.max((halt.secondsSinceLastPrint ?? 0) / 3600, 1 / 60)
        : (now - state.lastTradableInstant) / 3600;

  const confidenceBps = bandBps({
    provenance,
    session: state.session,
    instrument,
    darkHours,
    maxDeviationBps: agreed.maxDeviationBps,
    sigmaMultiple: earnings.sigmaMultiple,
    flags,
  });

  const safe = provenance === Provenance.TRADED && flags === Flag.NONE;
  reasons.push(
    safe
      ? `Safe: live print, no flags. Band +/-${(confidenceBps / 100).toFixed(2)}%.`
      : `Refused by default: provenance ${PROVENANCE_NAME[provenance]}, flags ` +
        `${describeFlags(flags)}. Band +/-${(confidenceBps / 100).toFixed(2)}%.`,
  );

  return {
    ticker: instrument.ticker,
    price: agreed.price,
    anchorPrice: input.anchorPrice,
    provenance,
    provenanceName: PROVENANCE_NAME[provenance],
    flags,
    flagNames: describeFlags(flags),
    confidenceBps: Math.round(confidenceBps),
    session: state.session,
    sessionName: SESSION_NAME[state.session],
    lastTradeTime: freshestPrint,
    darkHours,
    sourceCount: agreed.sourceCount,
    maxDeviationBps: Math.round(agreed.maxDeviationBps),
    safe,
    reasons,
  };
}
