/**
 * The tracked instruments and their per-instrument parameters.
 *
 * `overnightSigmaBps` is the standard deviation of the close-to-open log
 * return, in basis points. These are PRIORS, stated as such: they are drawn
 * from published realised-volatility ranges, not regressed against this
 * repository's own gap history. `npm run calibrate` will replace them, and
 * until it has run, nothing here should settle money.
 *
 * Saying so matters. A band presented as "fitted" while the running service
 * uses a prior is not a rounding error, it is a false claim about how much
 * validation stands behind the number a liquidation reads.
 */

export interface Instrument {
  ticker: string;
  name: string;
  /** Std dev of the close-to-open log return, bps. Prior, not fitted. */
  overnightSigmaBps: number;
  /**
   * Seconds without a print, during a scheduled-open tape, before a halt is
   * suspected. Liquid names print continuously; the threshold is set by how
   * stale a *provider* is allowed to look, not by market activity.
   */
  haltThresholdSec: number;
}

export const UNIVERSE: readonly Instrument[] = [
  { ticker: "HOOD", name: "Robinhood Markets", overnightSigmaBps: 215, haltThresholdSec: 180 },
  { ticker: "COIN", name: "Coinbase Global", overnightSigmaBps: 180, haltThresholdSec: 180 },
  { ticker: "NVDA", name: "NVIDIA", overnightSigmaBps: 150, haltThresholdSec: 120 },
  { ticker: "TSLA", name: "Tesla", overnightSigmaBps: 188, haltThresholdSec: 120 },
  { ticker: "AAPL", name: "Apple", overnightSigmaBps: 104, haltThresholdSec: 120 },
  { ticker: "MSTR", name: "MicroStrategy", overnightSigmaBps: 169, haltThresholdSec: 180 },
  { ticker: "SPY", name: "SPDR S&P 500 ETF", overnightSigmaBps: 55, haltThresholdSec: 120 },
  { ticker: "TLT", name: "iShares 20+ Year Treasury", overnightSigmaBps: 57, haltThresholdSec: 300 },
] as const;

const BY_TICKER = new Map(UNIVERSE.map((i) => [i.ticker, i]));

export const instrument = (ticker: string): Instrument | undefined =>
  BY_TICKER.get(ticker.toUpperCase());

export function requireInstrument(ticker: string): Instrument {
  const found = instrument(ticker);
  if (!found) throw new Error(`unknown ticker: ${ticker}`);
  return found;
}

/**
 * Sigma of the log return over a window of `hours`, in bps.
 *
 * The exponent is not 0.5. Calendar time is a poor clock for market risk:
 * information arrives around the close and the open, not evenly through a
 * Saturday, so a weekend's realised dispersion is only modestly wider than
 * an overnight gap despite being ~3.7x the clock hours. `TIME_EXPONENT` is a
 * placeholder pending calibration against realised gaps — it is deliberately
 * set above the value a short fit tends to produce, because for the guards
 * in this package an over-wide sigma is the safe direction: it makes the
 * discontinuity test harder to trip, not easier.
 */
export const TIME_EXPONENT = 0.15;

/** Reference window: a normal overnight close-to-open gap, in hours. */
export const OVERNIGHT_HOURS = 17.5;

export function sigmaOverHours(overnightSigmaBps: number, hours: number): number {
  const h = Math.max(hours, 0.25);
  return overnightSigmaBps * Math.pow(h / OVERNIGHT_HOURS, TIME_EXPONENT);
}
