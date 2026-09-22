import { test } from "node:test";
import assert from "node:assert/strict";
import { Session, etWallClockToUnix } from "../src/lib/session.ts";
import { Flag, Provenance, hasFlag } from "../src/lib/flags.ts";
import { requireInstrument } from "../src/lib/universe.ts";
import { checkEarnings, type EarningsEvent } from "../src/lib/guards/earnings.ts";
import { buildVerdict, NO_CLAIM_BPS, GAP_FLOOR_BPS } from "../src/lib/verdict.ts";
import type { SourceObservation } from "../src/lib/guards/halt.ts";

const et = (y: number, m: number, d: number, hh: number, mm: number): number =>
  etWallClockToUnix(y, m, d, hh * 60 + mm);

// September 2026: the 21st is a Monday, the 22nd a Tuesday, the 25th a Friday.
const TUE_NOON = et(2026, 9, 22, 12, 0);
const MON_CLOSE = et(2026, 9, 21, 16, 0);
const FRI_CLOSE = et(2026, 9, 25, 16, 0);
const SAT_11 = et(2026, 9, 26, 11, 0);
const MON_PRE = et(2026, 9, 28, 8, 0);

const src = (source: string, price: number, lastTradeTime: number | null): SourceObservation => ({
  source,
  price,
  lastTradeTime,
});

// ---------------------------------------------------------------------------
// Earnings guard
// ---------------------------------------------------------------------------

const nvdaEarnings = (over: Partial<EarningsEvent> = {}): EarningsEvent => ({
  ticker: "NVDA",
  at: et(2026, 9, 25, 16, 30), // after Friday's close
  timing: "amc",
  confirmed: true,
  rangeEndAt: null,
  source: "yahoo",
  ...over,
});

test("an ETF is never given earnings", () => {
  const v = checkEarnings({
    instrument: requireInstrument("SPY"),
    events: [{ ...nvdaEarnings(), ticker: "SPY" }],
    windowStart: FRI_CLOSE,
    windowEnd: MON_PRE,
  });
  assert.equal(v.flags, Flag.NONE);
  assert.equal(v.sigmaMultiple, 1);
  assert.match(v.reason, /does not report earnings/);
});

test("a confirmed release inside the window widens the gap sigma", () => {
  const v = checkEarnings({
    instrument: requireInstrument("NVDA"),
    events: [nvdaEarnings()],
    windowStart: FRI_CLOSE,
    windowEnd: MON_PRE,
  });
  assert.ok(hasFlag(v.flags, Flag.EARNINGS_WINDOW));
  assert.equal(v.sigmaMultiple, 3.5);
  assert.match(v.reason, /after the close \(confirmed\)/);
});

test("an unstated report time exposes both adjoining gaps", () => {
  const v = checkEarnings({
    instrument: requireInstrument("NVDA"),
    events: [nvdaEarnings({ timing: "unknown" })],
    windowStart: FRI_CLOSE,
    windowEnd: MON_PRE,
  });
  assert.ok(hasFlag(v.flags, Flag.EARNINGS_WINDOW));
  assert.match(v.reason, /both adjoining gaps are treated as exposed/);
});

test("a projected date is padded rather than trusted", () => {
  // Far enough out that a confirmed date would miss the window entirely.
  const far = et(2026, 9, 29, 16, 30);
  const confirmed = checkEarnings({
    instrument: requireInstrument("NVDA"),
    events: [nvdaEarnings({ at: far, confirmed: true })],
    windowStart: FRI_CLOSE,
    windowEnd: MON_PRE,
  });
  assert.equal(confirmed.flags, Flag.NONE);

  const projected = checkEarnings({
    instrument: requireInstrument("NVDA"),
    events: [nvdaEarnings({ at: far, confirmed: false, rangeEndAt: far + 86400 })],
    windowStart: FRI_CLOSE,
    windowEnd: MON_PRE,
  });
  assert.ok(hasFlag(projected.flags, Flag.EARNINGS_WINDOW));
  assert.match(projected.reason, /not confirmed by the company/);
});

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

test("a live print with two fresh sources is the only safe state", () => {
  const v = buildVerdict({
    ticker: "NVDA",
    now: TUE_NOON,
    anchorPrice: 179.5,
    observations: [
      src("alpaca", 180.0, TUE_NOON - 3),
      src("finnhub", 180.02, TUE_NOON - 5),
    ],
  });
  assert.equal(v.provenance, Provenance.TRADED);
  assert.equal(v.flags, Flag.NONE);
  assert.equal(v.safe, true);
  assert.equal(v.sourceCount, 2);
  assert.equal(v.price, 180.01); // median of two is their midpoint
  // Live band is the regular base plus the real source spread: 8 + 1.1bps.
  assert.equal(v.confidenceBps, 9);
});

test("a single source is never safe, even with a fresh print", () => {
  const v = buildVerdict({
    ticker: "NVDA",
    now: TUE_NOON,
    anchorPrice: 179.5,
    observations: [src("yahoo", 180.0, TUE_NOON - 3)],
  });
  assert.equal(v.provenance, Provenance.TRADED);
  assert.ok(hasFlag(v.flags, Flag.SINGLE_SOURCE));
  assert.equal(v.safe, false);
  assert.equal(v.maxDeviationBps, 0);
  assert.match(v.reasons.join(" "), /not because sources agree/);
});

test("a shut tape is DERIVED and says the price was never printed", () => {
  const v = buildVerdict({
    ticker: "NVDA",
    now: SAT_11,
    anchorPrice: 180,
    observations: [src("alpaca", 180, FRI_CLOSE), src("finnhub", 180.01, FRI_CLOSE)],
  });
  assert.equal(v.session, Session.CLOSED);
  assert.equal(v.provenance, Provenance.DERIVED);
  assert.equal(v.safe, false);
  assert.equal(v.darkHours, 19);
  // 1.96 * sigma(150bps over 19h) ~ 298bps.
  assert.ok(v.confidenceBps > 280 && v.confidenceBps < 320, `band ${v.confidenceBps}`);
  assert.match(v.reasons.join(" "), /model output, not an observed print/);
});

test("a corroborated halt during regular hours becomes HALTED", () => {
  const v = buildVerdict({
    ticker: "NVDA",
    now: TUE_NOON,
    anchorPrice: 179.5,
    observations: [
      src("alpaca", 180, TUE_NOON - 400),
      src("finnhub", 180, TUE_NOON - 395),
    ],
  });
  assert.equal(v.provenance, Provenance.HALTED);
  assert.equal(v.safe, false);
  assert.match(v.reasons.join(" "), /The tape has stopped, not a vendor/);
});

test("data that missed a session is STALE, not halted", () => {
  // Three days behind during regular hours. Both sources agree on the stale
  // timestamp, so the halt guard would happily call it a corroborated halt —
  // but a feed three days behind is a data outage, and saying "halt" would
  // send an operator to look at the exchange instead of at the pipeline.
  const v = buildVerdict({
    ticker: "NVDA",
    now: TUE_NOON,
    anchorPrice: 179.5,
    observations: [
      src("alpaca", 180, TUE_NOON - 3 * 86400),
      src("finnhub", 180, TUE_NOON - 3 * 86400),
    ],
  });
  assert.equal(v.provenance, Provenance.STALE);
  assert.match(v.reasons.join(" "), /has missed a session/);
});

test("a split blows the band out to a value nobody can misread", () => {
  const v = buildVerdict({
    ticker: "NVDA",
    now: MON_PRE,
    anchorPrice: 1800,
    observations: [src("alpaca", 180, FRI_CLOSE), src("finnhub", 180, FRI_CLOSE)],
  });
  assert.ok(hasFlag(v.flags, Flag.DISCONTINUITY));
  assert.ok(hasFlag(v.flags, Flag.SPLIT_PENDING));
  assert.equal(v.safe, false);
  // An integrator that reads `price` and ignores `flags` still cannot read
  // this band as tight.
  assert.equal(v.confidenceBps, NO_CLAIM_BPS);
});

test("an earnings move is widened, not called a corporate action", () => {
  // NVDA reports after Friday's close and opens 25% lower on Monday. That is
  // a real, correct price that the market genuinely made.
  const observations = [src("alpaca", 135, FRI_CLOSE), src("finnhub", 135, FRI_CLOSE)];

  const withEarnings = buildVerdict({
    ticker: "NVDA",
    now: MON_PRE,
    anchorPrice: 180,
    observations,
    earningsEvents: [nvdaEarnings()],
  });
  assert.ok(hasFlag(withEarnings.flags, Flag.EARNINGS_WINDOW));
  assert.equal(
    hasFlag(withEarnings.flags, Flag.DISCONTINUITY),
    false,
    "a 25% earnings move is 4.5 sigma of an earnings night, not a discontinuity",
  );

  // The same move, with the release unknown to us, is 16 sigma of an ordinary
  // night and trips the guard. This is why the earnings check must run first:
  // otherwise it cries corporate action on real prices four times a year.
  const blind = buildVerdict({
    ticker: "NVDA",
    now: MON_PRE,
    anchorPrice: 180,
    observations,
  });
  assert.ok(hasFlag(blind.flags, Flag.DISCONTINUITY));

  // And the suppression is not blanket: a 10:1 split on the same earnings
  // night is still 44 sigma after the multiplier and is still caught.
  const splitOnEarningsNight = buildVerdict({
    ticker: "NVDA",
    now: MON_PRE,
    anchorPrice: 1800,
    observations,
    earningsEvents: [nvdaEarnings()],
  });
  assert.ok(hasFlag(splitOnEarningsNight.flags, Flag.SPLIT_PENDING));
});

test("the band never tightens because a session label changed", () => {
  // The failure this rules out: at 04:00 the label flips CLOSED -> PRE while
  // the anchor is still Friday's close and nothing has printed. A formula
  // keyed on the label narrows the band; a stale anchor does not become
  // trustworthy because a bell rang.
  const observations = [src("alpaca", 180, FRI_CLOSE), src("finnhub", 180, FRI_CLOSE)];
  const before = buildVerdict({
    ticker: "NVDA",
    now: et(2026, 9, 28, 3, 59),
    anchorPrice: 180,
    observations,
  });
  const after = buildVerdict({
    ticker: "NVDA",
    now: et(2026, 9, 28, 4, 1),
    anchorPrice: 180,
    observations,
  });
  assert.equal(before.session, Session.CLOSED);
  assert.equal(after.session, Session.PRE);
  assert.ok(
    after.confidenceBps >= before.confidenceBps,
    `band narrowed across the label change: ${before.confidenceBps} -> ${after.confidenceBps}`,
  );
});

test("a gap band is never tighter than the floor", () => {
  const v = buildVerdict({
    ticker: "SPY",
    now: et(2026, 9, 25, 16, 1), // one minute after the close
    anchorPrice: 600,
    observations: [src("alpaca", 600, FRI_CLOSE), src("finnhub", 600, FRI_CLOSE)],
  });
  assert.equal(v.provenance, Provenance.DERIVED);
  assert.ok(v.confidenceBps >= GAP_FLOOR_BPS);
});

test("every verdict carries its reasoning in order", () => {
  const v = buildVerdict({
    ticker: "NVDA",
    now: TUE_NOON,
    anchorPrice: 179.5,
    observations: [src("alpaca", 180, TUE_NOON - 3), src("finnhub", 180.02, TUE_NOON - 5)],
  });
  assert.ok(v.reasons.length >= 3);
  assert.match(v.reasons[0] as string, /^Session REGULAR/);
  assert.match(v.reasons.at(-1) as string, /^Safe: live print, no flags/);
});
