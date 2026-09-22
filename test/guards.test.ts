import { test } from "node:test";
import assert from "node:assert/strict";
import { Session, etWallClockToUnix } from "../src/lib/session.ts";
import { Flag, hasFlag, describeFlags } from "../src/lib/flags.ts";
import { requireInstrument } from "../src/lib/universe.ts";
import { checkHalt } from "../src/lib/guards/halt.ts";
import {
  checkDiscontinuity,
  checkSchedule,
  type CorporateAction,
} from "../src/lib/guards/corpaction.ts";

const NVDA = requireInstrument("NVDA"); // overnight sigma 150bps, halt 120s

// At exactly one overnight window the time scaling is 1, so sigma in log
// terms is the quoted bps directly: 150bps -> 0.0150. Every figure below is
// hand-checkable against that.
const OVERNIGHT = 17.5;

// ---------------------------------------------------------------------------
// Corporate actions
// ---------------------------------------------------------------------------

test("a 10:1 split is not a 90% crash", () => {
  const v = checkDiscontinuity({
    ticker: "NVDA",
    anchorPrice: 1000,
    newPrice: 100,
    overnightSigmaBps: NVDA.overnightSigmaBps,
    darkHours: OVERNIGHT,
  });
  // |ln(0.1)| / 0.015 = 153 sigma. Against a +/-2.9% band, this is the move
  // that liquidates every position on the chain at once.
  assert.ok(v.rawSigma > 150, `expected >150 sigma, got ${v.rawSigma.toFixed(1)}`);
  assert.ok(hasFlag(v.flags, Flag.DISCONTINUITY));
  assert.ok(hasFlag(v.flags, Flag.SPLIT_PENDING));
  assert.equal(v.hypothesis?.label, "10:1 forward split");
  assert.ok(v.hypothesis!.adjustedSigma < 0.01);
});

test("a split detected through a real move on top of it", () => {
  // The stock split 10:1 AND rose 1% overnight. This is the case a naive
  // exact-ratio match misses, and it is the normal case.
  const v = checkDiscontinuity({
    ticker: "NVDA",
    anchorPrice: 1000,
    newPrice: 101,
    overnightSigmaBps: NVDA.overnightSigmaBps,
    darkHours: OVERNIGHT,
  });
  assert.equal(v.hypothesis?.label, "10:1 forward split");
  // ln(1.01)/0.015 = 0.66 sigma of residual: an ordinary gap.
  assert.ok(v.hypothesis!.adjustedSigma < 1);
  assert.ok(hasFlag(v.flags, Flag.SPLIT_PENDING));
});

test("a reverse split is caught in the other direction", () => {
  const v = checkDiscontinuity({
    ticker: "NVDA",
    anchorPrice: 2,
    newPrice: 20,
    overnightSigmaBps: NVDA.overnightSigmaBps,
    darkHours: OVERNIGHT,
  });
  assert.equal(v.hypothesis?.label, "1:10 reverse split");
  assert.ok(hasFlag(v.flags, Flag.SPLIT_PENDING));
});

test("an ordinary move raises nothing", () => {
  const v = checkDiscontinuity({
    ticker: "NVDA",
    anchorPrice: 100,
    newPrice: 101,
    overnightSigmaBps: NVDA.overnightSigmaBps,
    darkHours: OVERNIGHT,
  });
  assert.equal(v.flags, Flag.NONE);
  assert.equal(v.hypothesis, null);
  assert.ok(v.rawSigma < 1);
});

test("a genuine crash is refused, but not called a split", () => {
  // Down 45%: 40 sigma, so not a price move under any band fitted on ordinary
  // gaps. The nearest clean ratio is 1/2, and dividing by it still leaves
  // 6.4 sigma of residual, so the split hypothesis does not stand.
  const v = checkDiscontinuity({
    ticker: "NVDA",
    anchorPrice: 100,
    newPrice: 55,
    overnightSigmaBps: NVDA.overnightSigmaBps,
    darkHours: OVERNIGHT,
  });
  assert.ok(v.rawSigma > 35);
  assert.ok(hasFlag(v.flags, Flag.DISCONTINUITY), "must still refuse");
  assert.equal(hasFlag(v.flags, Flag.SPLIT_PENDING), false, "must not invent a split");
  assert.equal(v.hypothesis, null);
  assert.match(v.reason, /no clean split ratio explains it/);
});

test("a low-volatility instrument trips at a smaller move", () => {
  // SPY's overnight sigma is 55bps, so 8 sigma is a ~4.4% gap. The threshold
  // is per-instrument for exactly this reason: one global percentage would be
  // numb on SPY and hysterical on HOOD.
  const spy = requireInstrument("SPY");
  const quiet = checkDiscontinuity({
    ticker: "SPY",
    anchorPrice: 600,
    newPrice: 618, // +3.0%, 5.4 sigma
    overnightSigmaBps: spy.overnightSigmaBps,
    darkHours: OVERNIGHT,
  });
  assert.equal(quiet.flags, Flag.NONE);

  const violent = checkDiscontinuity({
    ticker: "SPY",
    anchorPrice: 600,
    newPrice: 540, // -10%, 19 sigma
    overnightSigmaBps: spy.overnightSigmaBps,
    darkHours: OVERNIGHT,
  });
  assert.ok(hasFlag(violent.flags, Flag.DISCONTINUITY));
});

test("a non-positive price is refused rather than divided by", () => {
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const v = checkDiscontinuity({
      ticker: "NVDA",
      anchorPrice: bad,
      newPrice: 100,
      overnightSigmaBps: NVDA.overnightSigmaBps,
      darkHours: OVERNIGHT,
    });
    assert.ok(hasFlag(v.flags, Flag.DISCONTINUITY), `anchor ${bad} must refuse`);
  }
});

test("a scheduled action flags before the ex-date, not only after", () => {
  const now = etWallClockToUnix(2026, 9, 25, 18 * 60); // Friday evening
  const monday = etWallClockToUnix(2026, 9, 28, 9 * 60 + 30);
  const actions: CorporateAction[] = [
    {
      ticker: "NVDA",
      effectiveAt: monday,
      kind: "split",
      impliedRatio: 0.25,
      label: "4:1 forward split",
      source: "yahoo",
    },
  ];

  // A price published Friday evening is accurate and about to become
  // incomparable. The consumer holding it over the weekend needs the warning
  // now, not on Monday.
  const ahead = checkSchedule({ ticker: "NVDA", actions, now, throughUnix: monday });
  assert.ok(hasFlag(ahead.flags, Flag.SPLIT_PENDING));
  assert.match(ahead.reason, /takes effect 2026-09-28/);

  // And it stays raised after the ex-date, because a vendor's stored close is
  // still the pre-split number until it restates its history.
  const after = checkSchedule({
    ticker: "NVDA",
    actions,
    now: monday + 3600,
    throughUnix: monday + 3600,
  });
  assert.ok(hasFlag(after.flags, Flag.SPLIT_PENDING));
  assert.match(after.reason, /took effect/);

  // Another ticker's split is not this ticker's problem.
  const other = checkSchedule({ ticker: "AAPL", actions, now, throughUnix: monday });
  assert.equal(other.flags, Flag.NONE);
});

// ---------------------------------------------------------------------------
// Halts
// ---------------------------------------------------------------------------

const REGULAR_NOON = etWallClockToUnix(2026, 9, 22, 12 * 60);

test("two stale sources during regular hours is a corroborated halt", () => {
  const v = checkHalt({
    instrument: NVDA,
    session: Session.REGULAR,
    now: REGULAR_NOON,
    observations: [
      { source: "alpaca", price: 180, lastTradeTime: REGULAR_NOON - 400 },
      { source: "finnhub", price: 180.02, lastTradeTime: REGULAR_NOON - 395 },
    ],
  });
  assert.equal(v.halted, true);
  assert.equal(v.confidence, "corroborated");
  assert.equal(v.secondsSinceLastPrint, 395);
  assert.match(v.reason, /The tape has stopped, not a vendor/);
});

test("one stale source cannot tell a halt from a dead connection", () => {
  const v = checkHalt({
    instrument: NVDA,
    session: Session.REGULAR,
    now: REGULAR_NOON,
    observations: [{ source: "yahoo", price: 180, lastTradeTime: REGULAR_NOON - 400 }],
  });
  // Still refused — but labelled as a guess, not a detection.
  assert.equal(v.halted, true);
  assert.equal(v.confidence, "unconfirmed");
  assert.ok(hasFlag(v.flags, Flag.HALT_UNCONFIRMED));
  assert.ok(hasFlag(v.flags, Flag.SINGLE_SOURCE));
  assert.match(v.reason, /Add a second timestamped source/);
});

test("one lagging vendor is not a halt", () => {
  // This is the distinction a single-source feed cannot make. Alpaca has a
  // print from 4 seconds ago, so the tape is demonstrably printing; Yahoo is
  // simply behind.
  const v = checkHalt({
    instrument: NVDA,
    session: Session.REGULAR,
    now: REGULAR_NOON,
    observations: [
      { source: "alpaca", price: 180, lastTradeTime: REGULAR_NOON - 4 },
      { source: "yahoo", price: 179.1, lastTradeTime: REGULAR_NOON - 600 },
    ],
  });
  assert.equal(v.halted, false);
  assert.ok(hasFlag(v.flags, Flag.SOURCE_DIVERGENT));
  assert.equal(v.sourceTimestampSpreadSec, 596);
  assert.match(v.reason, /One vendor is lagging; the tape is printing/);
});

test("a fresh print raises nothing", () => {
  const v = checkHalt({
    instrument: NVDA,
    session: Session.REGULAR,
    now: REGULAR_NOON,
    observations: [
      { source: "alpaca", price: 180, lastTradeTime: REGULAR_NOON - 3 },
      { source: "finnhub", price: 180.01, lastTradeTime: REGULAR_NOON - 5 },
    ],
  });
  assert.equal(v.halted, false);
  assert.equal(v.flags, Flag.NONE);
  assert.equal(v.confidence, "none");
});

test("the silence test does not run outside regular hours", () => {
  // Pre- and post-market prints are sporadic by nature, so minutes of silence
  // there says nothing about whether trading is permitted. Refusing a stale
  // pre-market price is the staleness rule's job, not this guard's.
  for (const session of [Session.PRE, Session.POST, Session.CLOSED, Session.HOLIDAY]) {
    const v = checkHalt({
      instrument: NVDA,
      session,
      now: REGULAR_NOON,
      observations: [{ source: "yahoo", price: 180, lastTradeTime: REGULAR_NOON - 9999 }],
    });
    assert.equal(v.halted, false, `session ${session} must not report a halt`);
    assert.match(v.reason, /does not apply/);
  }
});

test("an official halt notice needs no corroboration", () => {
  const v = checkHalt({
    instrument: NVDA,
    session: Session.REGULAR,
    now: REGULAR_NOON,
    observations: [{ source: "alpaca", price: 180, lastTradeTime: REGULAR_NOON - 2 }],
    officialHalt: {
      code: "LUDP",
      reason: "Volatility trading pause",
      haltedAt: REGULAR_NOON - 60,
      resumedAt: null,
    },
  });
  // The print is 2 seconds old, so silence-detection would have passed it.
  assert.equal(v.halted, true);
  assert.equal(v.confidence, "official");
  assert.match(v.reason, /LUDP/);
});

test("a resumed halt is no longer a halt", () => {
  const v = checkHalt({
    instrument: NVDA,
    session: Session.REGULAR,
    now: REGULAR_NOON,
    observations: [
      { source: "alpaca", price: 180, lastTradeTime: REGULAR_NOON - 2 },
      { source: "finnhub", price: 180, lastTradeTime: REGULAR_NOON - 3 },
    ],
    officialHalt: {
      code: "LUDP",
      reason: "Volatility trading pause",
      haltedAt: REGULAR_NOON - 600,
      resumedAt: REGULAR_NOON - 120,
    },
  });
  assert.equal(v.halted, false);
});

test("a source with no print time cannot establish freshness", () => {
  const v = checkHalt({
    instrument: NVDA,
    session: Session.REGULAR,
    now: REGULAR_NOON,
    observations: [{ source: "twelvedata", price: 180, lastTradeTime: null }],
  });
  assert.equal(v.timestampedSources, 0);
  assert.equal(v.halted, false);
  assert.match(v.reason, /a halt cannot be ruled out/);
});

test("flag names serialise for humans", () => {
  assert.equal(describeFlags(Flag.NONE), "none");
  assert.equal(
    describeFlags(Flag.DISCONTINUITY | Flag.SPLIT_PENDING),
    "SPLIT_PENDING | DISCONTINUITY",
  );
});
