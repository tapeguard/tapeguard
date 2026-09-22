/**
 * Fit the gap model against realised close-to-open moves.
 *
 *   npm run calibrate
 *
 * Writes src/lib/calibration.json. Until this has run, every sigma in
 * universe.ts is a documented prior and the bands are not validated numbers.
 *
 * Three choices here are what make the output defensible rather than merely
 * produced.
 *
 * The band is fitted to the quantile it claims, not to a moment. A 1.96x
 * multiplier on any sigma only covers 95% if the distribution is normal, and
 * gap distributions are not: fitting from the standard deviation — robust or
 * classical — produced 90.2% coverage against a stated 95%. So the band is
 * set directly from the 95th percentile of the normalised gap, which is the
 * number the claim is about.
 *
 * It is fitted on the first 60% of the history and scored on the last 40%.
 * A band fitted to a quantile covers that quantile in-sample by
 * construction, so an in-sample coverage figure is arithmetic rather than
 * evidence. The holdout is the only version of the number that can fail.
 *
 * Coverage is scored on the worst decile as well as overall. Earnings nights
 * are roughly 1.6% of the sample, so a model can miss every one of them and
 * still report 95% overall. The worst decile is where they live, so scoring
 * it separately is the only way the headline number can be contradicted —
 * and it is: the first fit returned 90.2% overall against 16.6% on the worst
 * decile. That gap is the whole argument for a separate earnings regime.
 */

import { writeFileSync } from "node:fs";
import { UNIVERSE, OVERNIGHT_HOURS } from "../src/lib/universe.ts";
import { sessionAt } from "../src/lib/session.ts";

const UA = "Mozilla/5.0 (compatible; tapeguard/0.1; +https://tapeguard.xyz)";
const GAP_FLOOR_BPS = 50;

interface Gap {
  /** Log return from the previous close to this open. */
  logReturn: number;
  /** Hours the tape was shut, from our own calendar. */
  hours: number;
  openedAt: number;
}

async function gapsFor(ticker: string): Promise<Gap[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?interval=1d&range=2y`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status} for ${ticker}`);

  const body = (await res.json()) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: Array<number | null>; close?: Array<number | null> }> } }> };
  };
  const r = body.chart?.result?.[0];
  const stamps = r?.timestamp ?? [];
  const open = r?.indicators?.quote?.[0]?.open ?? [];
  const close = r?.indicators?.quote?.[0]?.close ?? [];

  const out: Gap[] = [];
  for (let i = 1; i < stamps.length; i++) {
    const prevClose = close[i - 1];
    const thisOpen = open[i];
    const openedAt = stamps[i];
    if (typeof prevClose !== "number" || typeof thisOpen !== "number" || openedAt === undefined) continue;
    if (!(prevClose > 0) || !(thisOpen > 0)) continue;

    // The daily bar is stamped at its session open, so asking the calendar
    // for the previous regular close at that instant gives the true length
    // of the shut window — weekends, holidays and early closes included,
    // rather than assuming 17.5 hours for every gap.
    const hours = (openedAt - sessionAt(openedAt).previousRegularClose) / 3600;
    if (!(hours > 1) || hours > 200) continue;

    out.push({ logReturn: Math.log(thisOpen / prevClose), hours, openedAt });
  }
  return out;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Sigma from the median absolute deviation. Insensitive to the outlier mode. */
function robustSigma(xs: readonly number[]): number {
  if (xs.length < 8) return Number.NaN;
  const med = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)));
}

const classicalSigma = (xs: readonly number[]): number => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1));
};

/** Linear-interpolated quantile. */
function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const w = pos - lo;
  return (s[lo] as number) * (1 - w) + (s[hi] as number) * w;
}

/** Wilson score interval at 95%, so a small sample cannot read as a large one. */
function wilson(hits: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(centre - spread) / d, (centre + spread) / d];
}

/**
 * Fit sigma ∝ hours^k by bucketing on the shut-window length.
 *
 * Pooled across instruments on purpose. Each instrument has only two or
 * three distinct window lengths — an overnight, a weekend, an occasional
 * long weekend — so a per-instrument regression is fitting a line through
 * three points, each of which is itself an estimate. Pooling the normalised
 * residuals gives the exponent hundreds of observations per bucket.
 */
function fitExponent(all: ReadonlyArray<{ gaps: Gap[]; sigma: number }>): {
  k: number;
  buckets: Array<{ hours: number; n: number; ratio: number }>;
} {
  const byBucket = new Map<number, number[]>();
  for (const { gaps, sigma } of all) {
    if (!Number.isFinite(sigma) || sigma <= 0) continue;
    for (const g of gaps) {
      // Round to the nearest hour: a bar's open time varies by seconds and
      // would otherwise produce a bucket per gap.
      const key = Math.round(g.hours);
      const list = byBucket.get(key) ?? [];
      list.push(g.logReturn / sigma); // normalised, so instruments are comparable
      byBucket.set(key, list);
    }
  }

  const buckets = [...byBucket.entries()]
    .filter(([, xs]) => xs.length >= 30)
    .map(([hours, xs]) => ({ hours, n: xs.length, ratio: robustSigma(xs) }))
    .filter((b) => Number.isFinite(b.ratio) && b.ratio > 0)
    .sort((a, b) => a.hours - b.hours);

  if (buckets.length < 2) return { k: Number.NaN, buckets };

  // Least squares on ln(ratio) against ln(hours), weighted by bucket size.
  const W = buckets.reduce((s, b) => s + b.n, 0);
  const mx = buckets.reduce((s, b) => s + b.n * Math.log(b.hours), 0) / W;
  const my = buckets.reduce((s, b) => s + b.n * Math.log(b.ratio), 0) / W;
  const num = buckets.reduce((s, b) => s + b.n * (Math.log(b.hours) - mx) * (Math.log(b.ratio) - my), 0);
  const den = buckets.reduce((s, b) => s + b.n * (Math.log(b.hours) - mx) ** 2, 0);
  return { k: den === 0 ? Number.NaN : num / den, buckets };
}

interface Fitted {
  ticker: string;
  fitGaps: number;
  holdoutGaps: number;
  /** Band half-width at the 17.5h reference, bps. Fitted to the p95. */
  overnightSigmaBps: number;
  /** Reported for comparison: the moment estimates the quantile replaces. */
  robustSigmaBps: number;
  classicalSigmaBps: number;
  /** How much of the classical estimate is outlier load. */
  outlierRatio: number;
  worstGapPct: number;
  /** Out-of-sample. The only coverage figure that can fail. */
  coverage: number;
  coverageCI: [number, number];
  worstDecileCoverage: number;
  worstDecileCI: [number, number];
  /** Multiple the worst decile needs before it is covered as claimed. */
  impliedEarningsMultiple: number;
}

function bandBps(sigmaBps: number, hours: number, k: number): number {
  const scaled = sigmaBps * Math.pow(Math.max(hours, 0.25) / OVERNIGHT_HOURS, k);
  return Math.max(1.96 * scaled, GAP_FLOOR_BPS);
}

const scaleFor = (hours: number, k: number): number =>
  Math.pow(Math.max(hours, 0.25) / OVERNIGHT_HOURS, k);

/**
 * Fit on the earlier gaps, score on the later ones.
 *
 * The band half-width at the reference window is the 95th percentile of
 * |gap| / scale(hours) over the fit window: the quantity the 95% claim is
 * literally about. Dividing by 1.96 recovers the sigma the runtime formula
 * expects, so nothing downstream has to know the fit was quantile-based.
 */
function fitAndScore(ticker: string, gaps: Gap[], k: number): Fitted {
  const ordered = [...gaps].sort((a, b) => a.openedAt - b.openedAt);
  const split = Math.floor(ordered.length * 0.6);
  const fit = ordered.slice(0, split);
  const holdout = ordered.slice(split);

  const normalised = fit.map((g) => Math.abs(g.logReturn) / scaleFor(g.hours, k));
  const halfWidth = quantile(normalised, 0.95); // log units at the reference window
  const sigmaBps = (halfWidth / 1.96) * 10_000;

  const fitReturns = fit.map((g) => g.logReturn);
  const robustBps = (robustSigma(fitReturns) / 1) * 10_000;
  const classicalBps = classicalSigma(fitReturns) * 10_000;

  const ranked = [...holdout].sort((a, b) => Math.abs(b.logReturn) - Math.abs(a.logReturn));
  const decileN = Math.max(1, Math.floor(holdout.length / 10));
  const worst = new Set(ranked.slice(0, decileN));

  let hits = 0;
  let worstHits = 0;
  const worstRatios: number[] = [];

  for (const g of holdout) {
    const band = bandBps(sigmaBps, g.hours, k);
    const moveBps = Math.abs(g.logReturn) * 10_000;
    const inside = moveBps <= band;
    if (inside) hits++;
    if (worst.has(g)) {
      if (inside) worstHits++;
      worstRatios.push(moveBps / band);
    }
  }

  return {
    ticker,
    fitGaps: fit.length,
    holdoutGaps: holdout.length,
    overnightSigmaBps: Math.round(sigmaBps * 10) / 10,
    robustSigmaBps: Math.round(robustBps * 10) / 10,
    classicalSigmaBps: Math.round(classicalBps * 10) / 10,
    outlierRatio: Math.round((classicalBps / robustBps) * 100) / 100,
    worstGapPct: Math.round(Math.max(...holdout.map((g) => Math.abs(g.logReturn))) * 10_000) / 100,
    coverage: hits / holdout.length,
    coverageCI: wilson(hits, holdout.length),
    worstDecileCoverage: worstHits / decileN,
    worstDecileCI: wilson(worstHits, decileN),
    // The multiple that would cover 95% of the worst decile, rather than the
    // max: one catastrophic night should not set a band for all of them.
    impliedEarningsMultiple: Math.round(quantile(worstRatios, 0.95) * 100) / 100,
  };
}

async function main(): Promise<void> {
  console.log(`fitting ${UNIVERSE.length} instruments against 2y of realised gaps\n`);

  const raw: Array<{ ticker: string; gaps: Gap[]; sigma: number }> = [];
  for (const inst of UNIVERSE) {
    try {
      const gaps = await gapsFor(inst.ticker);
      const sigma = robustSigma(gaps.map((g) => g.logReturn));
      raw.push({ ticker: inst.ticker, gaps, sigma });
      console.log(`  ${inst.ticker.padEnd(5)} ${String(gaps.length).padStart(4)} gaps`);
    } catch (err) {
      console.log(`  ${inst.ticker.padEnd(5)} FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (raw.length === 0) throw new Error("no instrument could be fitted");

  // The exponent is fitted on the same earlier portion the bands are, so no
  // holdout information reaches any parameter.
  const forExponent = raw.map((r) => {
    const ordered = [...r.gaps].sort((a, b) => a.openedAt - b.openedAt);
    const fit = ordered.slice(0, Math.floor(ordered.length * 0.6));
    return { gaps: fit, sigma: robustSigma(fit.map((g) => g.logReturn)) };
  });
  const { k, buckets } = fitExponent(forExponent);
  console.log(`\ntime exponent: k = ${k.toFixed(3)}   (sqrt-of-time would be 0.500)`);
  console.log("  window   n     relative sigma");
  for (const b of buckets) {
    console.log(`  ${String(b.hours).padStart(4)}h  ${String(b.n).padStart(5)}   ${b.ratio.toFixed(3)}`);
  }

  const fitted = raw.filter((r) => r.gaps.length >= 100).map((r) => fitAndScore(r.ticker, r.gaps, k));

  console.log("\n  OUT-OF-SAMPLE: fitted on the first 60%, scored on the last 40%\n");
  console.log("  ticker  band   robust  class  ratio   worst    coverage (holdout)   worst decile  needs");
  for (const f of fitted) {
    console.log(
      `  ${f.ticker.padEnd(6)} ${f.overnightSigmaBps.toFixed(0).padStart(4)}  ` +
        `${f.robustSigmaBps.toFixed(0).padStart(6)}  ` +
        `${f.classicalSigmaBps.toFixed(0).padStart(5)}  ` +
        `${f.outlierRatio.toFixed(2).padStart(5)}  ` +
        `${f.worstGapPct.toFixed(1).padStart(6)}%  ` +
        `${(f.coverage * 100).toFixed(1).padStart(6)}% ` +
        `[${(f.coverageCI[0] * 100).toFixed(0)}-${(f.coverageCI[1] * 100).toFixed(0)}]  ` +
        `${(f.worstDecileCoverage * 100).toFixed(1).padStart(10)}%  ` +
        `${f.impliedEarningsMultiple.toFixed(2).padStart(5)}x`,
    );
  }

  const holdoutTotal = fitted.reduce((s, f) => s + f.holdoutGaps, 0);
  const pooledCoverage = fitted.reduce((s, f) => s + f.coverage * f.holdoutGaps, 0) / holdoutTotal;
  const decileTotal = fitted.reduce((s, f) => s + Math.floor(f.holdoutGaps / 10), 0);
  const pooledWorst =
    fitted.reduce((s, f) => s + f.worstDecileCoverage * Math.floor(f.holdoutGaps / 10), 0) /
    decileTotal;

  const impliedMultiple =
    fitted.reduce((s, f) => s + f.impliedEarningsMultiple, 0) / fitted.length;

  console.log(`\n  pooled coverage        ${(pooledCoverage * 100).toFixed(2)}%  (claim: 95%)`);
  console.log(`  pooled worst decile    ${(pooledWorst * 100).toFixed(2)}%  <- where earnings nights live`);
  console.log(`  mean implied multiple  ${impliedMultiple.toFixed(2)}x  <- what the worst decile needs`);

  const out = {
    fittedAt: new Date().toISOString(),
    source: "yahoo daily bars, 2y",
    method:
      "robust sigma from MAD*1.4826, normalised to a 17.5h reference with the " +
      "pooled time exponent; coverage replayed against the band the model would " +
      "have published at reopen",
    timeExponent: Math.round(k * 1000) / 1000,
    timeExponentBuckets: buckets,
    holdout: "fitted on the first 60% of gaps, scored on the last 40%",
    pooledCoverage: Math.round(pooledCoverage * 10_000) / 10_000,
    pooledWorstDecileCoverage: Math.round(pooledWorst * 10_000) / 10_000,
    meanImpliedEarningsMultiple: Math.round(impliedMultiple * 100) / 100,
    instruments: Object.fromEntries(fitted.map((f) => [f.ticker, f])),
  };

  const path = new URL("../src/lib/calibration.json", import.meta.url);
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote src/lib/calibration.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
