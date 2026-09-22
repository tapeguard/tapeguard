/**
 * Provenance and risk flags.
 *
 * These answer two different questions, which is why they are two fields.
 *
 *   provenance  where did this number come from?
 *   flags       why should you not act on it right now?
 *
 * A single enum cannot hold both. Consider a stock splitting 10:1 tomorrow
 * morning: today's price is a perfect live print, so the provenance is
 * genuinely TRADED — and the number becomes incomparable in sixteen hours.
 * An enum forces a choice between saying TRADED (true, and dangerous) and
 * STALE (false, the price is seconds old). Flags let both be said at once.
 *
 * The numbers are the on-chain wire format. Never renumber; append only.
 */

export const Provenance = {
  /** Observed print, tape scheduled open, prints arriving. */
  TRADED: 0,
  /** Model output. The tape is shut and this price was never printed. */
  DERIVED: 1,
  /** Too old to use for anything. */
  STALE: 2,
  /** Tape scheduled OPEN but prints have stopped arriving. */
  HALTED: 3,
} as const;

export type Provenance = (typeof Provenance)[keyof typeof Provenance];

export const PROVENANCE_NAME: Record<Provenance, string> = {
  [Provenance.TRADED]: "TRADED",
  [Provenance.DERIVED]: "DERIVED",
  [Provenance.STALE]: "STALE",
  [Provenance.HALTED]: "HALTED",
};

export const Flag = {
  NONE: 0,
  /** A corporate action makes this price incomparable to the next one. */
  SPLIT_PENDING: 1 << 0,
  /** A scheduled earnings release falls inside the window being priced. */
  EARNINGS_WINDOW: 1 << 1,
  /** The move is statistically impossible as a price move. */
  DISCONTINUITY: 1 << 2,
  /** Sources disagree beyond tolerance. */
  SOURCE_DIVERGENT: 1 << 3,
  /**
   * Only one upstream resolved.
   *
   * Reported because the alternative is worse. A one-source feed computes a
   * cross-source spread of zero, and a consumer reads zero as "every source
   * agrees" when it means "there was nothing to disagree with". Silence and
   * consensus must not serialise to the same number.
   */
  SINGLE_SOURCE: 1 << 4,
  /** A halt was suspected but could not be corroborated by a second source. */
  HALT_UNCONFIRMED: 1 << 5,
} as const;

export type Flag = (typeof Flag)[keyof typeof Flag];

const FLAG_NAMES: Array<[number, string]> = [
  [Flag.SPLIT_PENDING, "SPLIT_PENDING"],
  [Flag.EARNINGS_WINDOW, "EARNINGS_WINDOW"],
  [Flag.DISCONTINUITY, "DISCONTINUITY"],
  [Flag.SOURCE_DIVERGENT, "SOURCE_DIVERGENT"],
  [Flag.SINGLE_SOURCE, "SINGLE_SOURCE"],
  [Flag.HALT_UNCONFIRMED, "HALT_UNCONFIRMED"],
];

export const hasFlag = (flags: number, flag: number): boolean => (flags & flag) !== 0;

export function flagNames(flags: number): string[] {
  return FLAG_NAMES.filter(([bit]) => (flags & bit) !== 0).map(([, name]) => name);
}

export function describeFlags(flags: number): string {
  const names = flagNames(flags);
  return names.length === 0 ? "none" : names.join(" | ");
}
