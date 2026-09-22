import { test } from "node:test";
import assert from "node:assert/strict";
import type { Calibration } from "../src/lib/universe.ts";
import {
  UNIVERSE,
  TIME_EXPONENT,
  calibration,
  instruments,
  parameterSource,
  requireInstrument,
  sigmaOverHours,
  OVERNIGHT_HOURS,
} from "../src/lib/universe.ts";

test("the parameter source is stated, never inferred", () => {
  const c = calibration();
  assert.equal(parameterSource, c ? "fitted" : "prior");
});

test("a loaded calibration actually reaches the numbers in use", () => {
  const c = calibration();
  if (!c) {
    // Not calibrated. The declared literals must then be what is served, so
    // an absent file cannot quietly become an unlabelled default.
    for (const [i, declared] of UNIVERSE.entries()) {
      assert.equal(instruments()[i]?.overnightSigmaBps, declared.overnightSigmaBps);
    }
    return;
  }
  assert.equal(TIME_EXPONENT, c.timeExponent);
  for (const inst of instruments()) {
    const fit: Calibration["instruments"][string] | undefined = c.instruments[inst.ticker];
    if (!fit) continue;
    assert.equal(
      inst.overnightSigmaBps,
      fit.overnightSigmaBps,
      `${inst.ticker} is serving a sigma the fit did not produce`,
    );
  }
});

test("a fit may raise the earnings multiple but never lower it", () => {
  const c = calibration();
  if (!c) return;
  for (const [i, declared] of UNIVERSE.entries()) {
    const live = instruments()[i]!;
    if (!declared.hasEarnings) {
      assert.equal(live.earningsSigmaMultiple, 1, "an ETF must not acquire a multiple");
      continue;
    }
    // The fit measures the multiple against the worst decile of gaps, which
    // is a loose proxy: a decile is 10% of the sample and earnings are about
    // 1.6% of it, so most of that decile is ordinary volatile nights. The
    // number it implies is a lower bound, and taking it as an upper bound
    // would narrow the band on exactly the nights the guard exists for.
    assert.ok(
      live.earningsSigmaMultiple >= declared.earningsSigmaMultiple,
      `${declared.ticker} multiple fell from ${declared.earningsSigmaMultiple} to ${live.earningsSigmaMultiple}`,
    );
  }
});

test("the time scaling is anchored at the reference window", () => {
  // Whatever k is fitted to, one overnight window must scale by exactly 1,
  // or every band silently shifts when the exponent is refitted.
  assert.equal(sigmaOverHours(150, OVERNIGHT_HOURS), 150);
});

test("a longer shut window is never given a tighter sigma", () => {
  const sigma = requireInstrument("NVDA").overnightSigmaBps;
  const overnight = sigmaOverHours(sigma, OVERNIGHT_HOURS);
  const weekend = sigmaOverHours(sigma, 65.5);
  const longWeekend = sigmaOverHours(sigma, 89.5);
  assert.ok(weekend > overnight, "a weekend must not be tighter than an overnight");
  assert.ok(longWeekend > weekend, "a long weekend must not be tighter than a weekend");
  // And not by the square root of time either: a weekend is 3.7x the clock
  // hours, so sqrt-of-time would demand ~1.9x the sigma.
  assert.ok(weekend / overnight < 1.9, "the exponent has drifted towards sqrt-of-time");
});
