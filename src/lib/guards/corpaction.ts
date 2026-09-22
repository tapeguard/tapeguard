/**
 * Corporate-action guard.
 *
 * This is the failure an equity oracle has that a crypto oracle does not.
 * NVIDIA splits 10:1 and the price goes from $1,000 to $100 overnight: a 90%
 * drop, against an overnight sigma of 150bps. Nothing about the company
 * changed and no holder lost anything, but a feed that publishes the number
 * with a +/-2.9% band has just told every lending protocol on the chain to
 * liquidate every position at once.
 *
 * Two detectors, deliberately independent.
 *
 *   checkSchedule        reads a corporate-actions feed. Precise when it is
 *                        reachable and current.
 *   checkDiscontinuity   reads nothing. Cannot be taken down, cannot go
 *                        stale, and covers actions no feed announced.
 *
 * The second is the one that matters, because it is the one that still works
 * on the morning a vendor is down.
 */

import { Flag } from "../flags.ts";
import { sigmaOverHours } from "../universe.ts";

/**
 * A move must exceed this many sigma before a corporate action is even
 * considered. Below it, an ordinary market move explains everything and
 * hypothesis-fitting would only invent splits out of volatile Tuesdays.
 */
export const RAW_IMPLAUSIBLE_SIGMA = 8;

/**
 * After dividing out a candidate ratio, the residual move must be this
 * ordinary for the hypothesis to stand. A split does not stop the stock from
 * also moving on the day, so the residual is allowed to be a normal gap —
 * but not another outlier.
 */
export const ADJUSTED_PLAUSIBLE_SIGMA = 4;

/**
 * How impossible a candidate ratio must itself be, in sigma, before the
 * hypothesis is stated as a finding rather than a possibility.
 *
 * This bound exists because the heuristic has a real blind spot, and the
 * honest response is to bound the claim rather than hide it. A 4:3 split
 * moves the price to 0.75 of the anchor. So does a 25% earnings drop. From
 * price alone the two are the same observation, and no threshold separates
 * them, because there is nothing there to separate.
 *
 * The heuristic's power comes from moves that are impossible as prices — a
 * 10:1 lands at 0.1, which is 126 sigma of any ordinary night and roughly
 * 36 sigma even of an earnings one. Nothing a market does reaches there.
 * The fractional splits sit at 12 to 22 sigma, squarely inside the range a
 * bad quarter reaches, so a claim there would be a coin flip wearing a
 * decimal point.
 *
 * Below this bar the move is still refused — it is still not an ordinary
 * gap — but it is reported as ambiguous and handed to `checkSchedule`,
 * which reads an actual corporate-actions feed and resolves precisely the
 * cases this test cannot.
 */
export const DECISIVE_RATIO_SIGMA = 25;

export interface SplitHypothesis {
  /** Implied newPrice/anchorPrice if this action occurred. 0.1 for a 10:1. */
  impliedRatio: number;
  label: string;
  /** How ordinary the move becomes once this ratio is divided out, in sigma. */
  adjustedSigma: number;
  /**
   * How impossible this ratio is as a price move, in sigma. Only a decisive
   * ratio is reported as a finding; see `DECISIVE_RATIO_SIGMA`.
   */
  ratioSigma: number;
  decisive: boolean;
}

export interface DiscontinuityVerdict {
  flags: number;
  /** Size of the raw move in sigma of the window being priced. */
  rawSigma: number;
  rawMovePct: number;
  /** The corporate action that explains the move, if one does. */
  hypothesis: SplitHypothesis | null;
  reason: string;
}

/** Candidate price ratios for the corporate actions that actually occur. */
function candidates(): ReadonlyArray<{ impliedRatio: number; label: string }> {
  const out: Array<{ impliedRatio: number; label: string }> = [];
  const whole = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 100];
  for (const n of whole) {
    out.push({ impliedRatio: 1 / n, label: `${n}:1 forward split` });
    out.push({ impliedRatio: n, label: `1:${n} reverse split` });
  }
  // Fractional splits are rarer but real: 3-for-2 and 5-for-4 both happen.
  for (const [n, m] of [
    [3, 2],
    [5, 4],
    [5, 2],
    [4, 3],
    [7, 5],
  ] as Array<[number, number]>) {
    out.push({ impliedRatio: m / n, label: `${n}:${m} forward split` });
    out.push({ impliedRatio: n / m, label: `${m}:${n} reverse split` });
  }
  return out;
}

const CANDIDATES = candidates();

/**
 * Decide whether a price move is a price move.
 *
 * The test is not "is this move large". It is: the raw move is impossible as
 * a price move, yet dividing it by exactly one clean split ratio turns it
 * into an ordinary overnight gap. A crash does not land on a clean fraction.
 * A split always does.
 */
export function checkDiscontinuity(args: {
  ticker: string;
  anchorPrice: number;
  newPrice: number;
  overnightSigmaBps: number;
  darkHours: number;
}): DiscontinuityVerdict {
  const { ticker, anchorPrice, newPrice, overnightSigmaBps, darkHours } = args;

  if (!(anchorPrice > 0) || !(newPrice > 0) || !Number.isFinite(anchorPrice) || !Number.isFinite(newPrice)) {
    return {
      flags: Flag.DISCONTINUITY,
      rawSigma: Number.POSITIVE_INFINITY,
      rawMovePct: Number.NaN,
      hypothesis: null,
      reason:
        `Non-positive or non-finite price for ${ticker} ` +
        `(anchor ${anchorPrice}, new ${newPrice}). No move can be assessed; refusing.`,
    };
  }

  const move = newPrice / anchorPrice;
  const logMove = Math.log(move);
  const sigmaLog = sigmaOverHours(overnightSigmaBps, darkHours) / 10_000;
  const rawSigma = Math.abs(logMove) / sigmaLog;
  const rawMovePct = (move - 1) * 100;

  if (rawSigma <= RAW_IMPLAUSIBLE_SIGMA) {
    return {
      flags: Flag.NONE,
      rawSigma,
      rawMovePct,
      hypothesis: null,
      reason:
        `Move of ${rawMovePct.toFixed(2)}% over ${darkHours.toFixed(1)}h is ` +
        `${rawSigma.toFixed(1)} sigma. Ordinary market movement.`,
    };
  }

  let best: SplitHypothesis | null = null;
  for (const candidate of CANDIDATES) {
    const adjustedSigma = Math.abs(Math.log(move / candidate.impliedRatio)) / sigmaLog;
    if (adjustedSigma >= ADJUSTED_PLAUSIBLE_SIGMA) continue;
    const ratioSigma = Math.abs(Math.log(candidate.impliedRatio)) / sigmaLog;
    const hypothesis: SplitHypothesis = {
      ...candidate,
      adjustedSigma,
      ratioSigma,
      decisive: ratioSigma >= DECISIVE_RATIO_SIGMA,
    };
    if (best === null || adjustedSigma < best.adjustedSigma) best = hypothesis;
  }

  if (best?.decisive) {
    return {
      flags: Flag.DISCONTINUITY | Flag.SPLIT_PENDING,
      rawSigma,
      rawMovePct,
      hypothesis: best,
      reason:
        `Move of ${rawMovePct.toFixed(2)}% is ${rawSigma.toFixed(0)} sigma, which is ` +
        `not a price move. Dividing by ${best.impliedRatio.toFixed(4)} leaves ` +
        `${best.adjustedSigma.toFixed(1)} sigma, an ordinary gap. This is a ` +
        `${best.label}, not a repricing. Refusing until the anchor is restated.`,
    };
  }

  if (best) {
    return {
      flags: Flag.DISCONTINUITY,
      rawSigma,
      rawMovePct,
      hypothesis: best,
      reason:
        `Move of ${rawMovePct.toFixed(2)}% is ${rawSigma.toFixed(0)} sigma and is not an ` +
        `ordinary gap. It is consistent with a ${best.label}, but that ratio is only ` +
        `${best.ratioSigma.toFixed(0)} sigma from no move at all, which a genuinely bad ` +
        `quarter also reaches. Price alone cannot separate the two, so no corporate ` +
        `action is claimed. Refusing, and deferring to the corporate-actions feed.`,
    };
  }

  return {
    flags: Flag.DISCONTINUITY,
    rawSigma,
    rawMovePct,
    hypothesis: null,
    reason:
      `Move of ${rawMovePct.toFixed(2)}% is ${rawSigma.toFixed(0)} sigma and no ` +
      `clean split ratio explains it. Either a genuine dislocation or a ` +
      `corporate action outside the known forms. Refusing either way: a band ` +
      `fitted on ordinary gaps makes no claim about this.`,
  };
}

// ---------------------------------------------------------------------------
// Scheduled feed
// ---------------------------------------------------------------------------

export interface CorporateAction {
  ticker: string;
  /** Unix seconds of the ex-date, at the open. */
  effectiveAt: number;
  kind: "split" | "reverse_split" | "special_dividend";
  /** Implied newPrice/anchorPrice across the action. */
  impliedRatio: number;
  label: string;
  source: string;
}

/**
 * Seconds after an action's ex-date during which the flag stays raised.
 *
 * The flag cannot be dropped the instant the ex-date passes. A provider's
 * stored close is still the pre-split number until it restates its history,
 * and the restatement is not simultaneous across vendors. Two days covers a
 * weekend ex-date, which is when this is most likely to be wrong.
 */
export const POST_ACTION_HOLD_SEC = 2 * 24 * 3600;

export interface ScheduleVerdict {
  flags: number;
  action: CorporateAction | null;
  reason: string;
}

/**
 * Raise SPLIT_PENDING when a known action falls inside the window this quote
 * spans — from `POST_ACTION_HOLD_SEC` ago through the next open.
 *
 * The forward edge matters as much as the backward one. A price published on
 * Friday evening for a Monday ex-date is accurate and about to become
 * incomparable, so a consumer holding it over the weekend needs the warning
 * before the action, not after.
 */
export function checkSchedule(args: {
  ticker: string;
  actions: readonly CorporateAction[];
  now: number;
  throughUnix: number;
}): ScheduleVerdict {
  const { ticker, actions, now, throughUnix } = args;
  const from = now - POST_ACTION_HOLD_SEC;
  const upper = Math.max(throughUnix, now);

  const relevant = actions
    .filter((a) => a.ticker.toUpperCase() === ticker.toUpperCase())
    .filter((a) => a.effectiveAt >= from && a.effectiveAt <= upper)
    .sort((a, b) => Math.abs(a.effectiveAt - now) - Math.abs(b.effectiveAt - now));

  const action = relevant[0];
  if (!action) {
    return {
      flags: Flag.NONE,
      action: null,
      reason: `No scheduled corporate action for ${ticker} in the window being priced.`,
    };
  }

  const when = new Date(action.effectiveAt * 1000).toISOString().slice(0, 10);
  const tense = action.effectiveAt > now ? "takes effect" : "took effect";
  return {
    flags: Flag.SPLIT_PENDING,
    action,
    reason:
      `${action.label} for ${ticker} ${tense} ${when} (${action.source}). ` +
      `Prices either side of it are not comparable.`,
  };
}
