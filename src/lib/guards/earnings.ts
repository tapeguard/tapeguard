/**
 * Earnings-window guard.
 *
 * The distribution of overnight gaps is bimodal: ordinary nights, and the
 * four nights a year a company reports. A single fitted sigma averages the
 * two, which produces a band that is too wide on most nights and far too
 * narrow on the nights that matter.
 *
 * Headline coverage cannot detect this. Two years gives roughly eight
 * earnings gaps per ticker against some five hundred ordinary ones, so a
 * model can miss *every* earnings night and still report ~95% coverage. The
 * 1.6% of nights it fails on are the nights a lending protocol is most
 * exposed, so earnings coverage has to be scored as its own number.
 *
 * Two honesty rules are built in.
 *
 *   Unknown report time widens BOTH adjoining gaps rather than guessing one.
 *   An unconfirmed vendor date widens the window rather than pretending to
 *   a precision the vendor did not claim.
 */

import { Flag } from "../flags.ts";
import type { Instrument } from "../universe.ts";

export interface EarningsEvent {
  ticker: string;
  /** Unix seconds of the announcement, or of the vendor's estimated date. */
  at: number;
  /**
   * When the company reports relative to the session.
   * `bmo` before the open, `amc` after the close, `unknown` not supplied.
   */
  timing: "bmo" | "amc" | "unknown";
  /**
   * False when the vendor supplied a date *range*, which means it is
   * projecting from last year's calendar rather than reporting a date the
   * company announced.
   */
  confirmed: boolean;
  /** Far end of the vendor's range for an unconfirmed date. */
  rangeEndAt: number | null;
  source: string;
}

export interface EarningsVerdict {
  flags: number;
  event: EarningsEvent | null;
  /** Multiply the gap sigma by this. 1 when no release is in the window. */
  sigmaMultiple: number;
  reason: string;
}

/**
 * Hours either side of an announcement that the guard treats as exposed.
 *
 * A release lands between a close and an open, not at an instant a vendor
 * can pin down, and the reaction continues into the next session. Six hours
 * covers an after-close release through the following pre-market.
 */
const ANNOUNCEMENT_PAD_SEC = 6 * 3600;

/** Extra padding when the vendor is projecting a date rather than reporting one. */
const UNCONFIRMED_PAD_SEC = 36 * 3600;

function exposure(event: EarningsEvent): { from: number; to: number } {
  // An unknown report time could be either side of the session, so the
  // exposure spans both adjoining gaps. Picking one at random is how a guard
  // ends up narrow on exactly the night it was built for.
  const pad = event.timing === "unknown" ? 18 * 3600 : ANNOUNCEMENT_PAD_SEC;
  const extra = event.confirmed ? 0 : UNCONFIRMED_PAD_SEC;
  const end = event.rangeEndAt ?? event.at;
  return { from: event.at - pad - extra, to: end + pad + extra };
}

export function checkEarnings(args: {
  instrument: Instrument;
  events: readonly EarningsEvent[];
  /** The window this quote spans: last print through next open. */
  windowStart: number;
  windowEnd: number;
}): EarningsVerdict {
  const { instrument, events, windowStart, windowEnd } = args;

  if (!instrument.hasEarnings) {
    return {
      flags: Flag.NONE,
      event: null,
      sigmaMultiple: 1,
      reason: `${instrument.ticker} is an ETF and does not report earnings.`,
    };
  }

  const hit = events
    .filter((e) => e.ticker.toUpperCase() === instrument.ticker.toUpperCase())
    .map((e) => ({ event: e, span: exposure(e) }))
    .filter(({ span }) => span.from <= windowEnd && span.to >= windowStart)
    .sort((a, b) => a.span.from - b.span.from)[0];

  if (!hit) {
    return {
      flags: Flag.NONE,
      event: null,
      sigmaMultiple: 1,
      reason: `No earnings release for ${instrument.ticker} in the window being priced.`,
    };
  }

  const { event } = hit;
  const when = new Date(event.at * 1000).toISOString().slice(0, 10);
  const timing =
    event.timing === "bmo"
      ? "before the open"
      : event.timing === "amc"
        ? "after the close"
        : "at an unstated time, so both adjoining gaps are treated as exposed";
  const certainty = event.confirmed
    ? "confirmed"
    : `projected by ${event.source}, not confirmed by the company, so the window is padded`;

  return {
    flags: Flag.EARNINGS_WINDOW,
    event,
    sigmaMultiple: instrument.earningsSigmaMultiple,
    reason:
      `${instrument.ticker} reports ${when} ${timing} (${certainty}). ` +
      `Gap sigma multiplied by ${instrument.earningsSigmaMultiple.toFixed(1)}: a band ` +
      `fitted on ordinary nights makes no claim about an earnings night.`,
  };
}
