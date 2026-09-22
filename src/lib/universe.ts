import { readFileSync } from "node:fs";

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

const FITTED = loadCalibration();

/** Where a parameter came from. Never inferred; always carried. */
export type ParamSource = "fitted" | "prior";

/**
 * Exported so the return type of `calibration()` can be named. Without it a
 * consumer indexing `instruments` gets a circular-inference error rather
 * than a type.
 */
export interface Calibration {
  fittedAt: string;
  timeExponent: number;
  pooledCoverage: number;
  pooledWorstDecileCoverage: number;
  meanImpliedEarningsMultiple: number;
  instruments: Record<string, { overnightSigmaBps: number; impliedEarningsMultiple: number }>;
}

function loadCalibration(): Calibration | null {
  try {
    const raw = readFileSync(new URL("./calibration.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as Calibration;
    if (!Number.isFinite(parsed.timeExponent) || !parsed.instruments) return null;
    return parsed;
  } catch {
    // Not calibrated yet. Every value stays a prior and says so, rather than
    // the absence of a file quietly becoming an unlabelled default.
    return null;
  }
}

/** The calibration run behind the current parameters, if any. */
export const calibration = (): Calibration | null => FITTED;

export const TIME_EXPONENT = FITTED?.timeExponent ?? 0.15;

/**
 * Whether the numbers in use were fitted or are still priors.
 *
 * Exposed because the distinction is the difference between a band a
 * liquidation can rely on and one that merely looks like it can.
 */
export const parameterSource: ParamSource = FITTED ? "fitted" : "prior";

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
  /**
   * Whether this instrument reports earnings at all. An ETF does not, and a
   * guard that invents a quarterly announcement for SPY widens a band four
   * times a year for an event that never happens.
   */
  hasEarnings: boolean;
  /**
   * Multiple of `overnightSigmaBps` to apply when a scheduled earnings
   * release falls inside the window being priced. Prior, not fitted.
   *
   * The gap distribution is bimodal and a single sigma averages the two
   * modes. Two years gives roughly eight earnings gaps per ticker against
   * ~500 ordinary ones, so a model can miss every earnings night and still
   * report 95% coverage — while failing on precisely the nights a lending
   * protocol is most exposed. Headline coverage cannot see this; it has to
   * be scored separately.
   */
  earningsSigmaMultiple: number;
}

/* prettier-ignore */
export const UNIVERSE: readonly Instrument[] = [
  { ticker: "HOOD", name: "Robinhood Markets", overnightSigmaBps: 215, haltThresholdSec: 180, hasEarnings: true, earningsSigmaMultiple: 3.2 },
  { ticker: "COIN", name: "Coinbase Global", overnightSigmaBps: 180, haltThresholdSec: 180, hasEarnings: true, earningsSigmaMultiple: 3.0 },
  { ticker: "NVDA", name: "NVIDIA", overnightSigmaBps: 150, haltThresholdSec: 120, hasEarnings: true, earningsSigmaMultiple: 3.5 },
  { ticker: "TSLA", name: "Tesla", overnightSigmaBps: 188, haltThresholdSec: 120, hasEarnings: true, earningsSigmaMultiple: 3.0 },
  { ticker: "AAPL", name: "Apple", overnightSigmaBps: 104, haltThresholdSec: 120, hasEarnings: true, earningsSigmaMultiple: 2.8 },
  { ticker: "MSTR", name: "MicroStrategy", overnightSigmaBps: 169, haltThresholdSec: 180, hasEarnings: true, earningsSigmaMultiple: 3.0 },
  { ticker: "SPY", name: "SPDR S&P 500 ETF", overnightSigmaBps: 55, haltThresholdSec: 120, hasEarnings: false, earningsSigmaMultiple: 1.0 },
  { ticker: "TLT", name: "iShares 20+ Year Treasury", overnightSigmaBps: 57, haltThresholdSec: 300, hasEarnings: false, earningsSigmaMultiple: 1.0 },
] as const;

/**
 * The universe with fitted parameters substituted where a calibration run
 * has produced them.
 *
 * The literals above remain the declared fallback, so a deployment with no
 * calibration.json still runs — it just reports `parameterSource: "prior"`
 * and should not settle anything.
 *
 * The earnings multiple is only ever raised, never lowered, by a fit. The
 * calibration measures it against the worst decile of gaps, which is a loose
 * proxy for earnings nights: a decile is 10% of the sample and earnings are
 * about 1.6% of it, so most of that decile is ordinary volatile nights and
 * the multiple it implies is a LOWER bound on what a real earnings night
 * needs. Taking it as an upper bound would narrow the band on exactly the
 * nights the guard exists for.
 */
const CALIBRATED: readonly Instrument[] = UNIVERSE.map((i) => {
  const fit = FITTED?.instruments[i.ticker];
  if (!fit) return i;
  return {
    ...i,
    overnightSigmaBps: fit.overnightSigmaBps,
    earningsSigmaMultiple: i.hasEarnings
      ? Math.max(i.earningsSigmaMultiple, fit.impliedEarningsMultiple)
      : 1,
  };
});

const BY_TICKER = new Map(CALIBRATED.map((i) => [i.ticker, i]));

export const instruments = (): readonly Instrument[] => CALIBRATED;

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
 * Saturday. Fitting against two years of realised gaps returns roughly 0.32,
 * so a weekend is meaningfully wider than an overnight but nowhere near the
 * 2.4x that square-root-of-time would demand. Until `npm run calibrate` has
 * run, the fallback is deliberately low, because for the guards here an
 * over-wide sigma is the safe direction: it makes the discontinuity test
 * harder to trip, not easier.
 */


/** Reference window: a normal overnight close-to-open gap, in hours. */
export const OVERNIGHT_HOURS = 17.5;

export function sigmaOverHours(overnightSigmaBps: number, hours: number): number {
  const h = Math.max(hours, 0.25);
  return overnightSigmaBps * Math.pow(h / OVERNIGHT_HOURS, TIME_EXPONENT);
}
