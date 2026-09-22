import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRows, type NasdaqRow } from "../src/providers/earnings.ts";
import { etWallClockToUnix } from "../src/lib/session.ts";

const at = (y: number, m: number, d: number, hh: number, mm: number): number =>
  etWallClockToUnix(y, m, d, hh * 60 + mm);

const UNIVERSE = ["NVDA", "AAPL", "TSLA"];
const OCT29 = { y: 2026, m: 10, d: 29 };

test("the reporting slot decides which gap carries the announcement", () => {
  const rows = [
    { symbol: "NVDA", time: "time-pre-market" },
    { symbol: "AAPL", time: "time-after-hours" },
    { symbol: "TSLA", time: "time-not-supplied" },
  ];
  const events = parseRows(rows, OCT29, UNIVERSE);
  const by = (t: string) => events.find((e) => e.ticker === t)!;

  assert.equal(by("NVDA").timing, "bmo");
  assert.equal(by("NVDA").at, at(2026, 10, 29, 9, 30));

  assert.equal(by("AAPL").timing, "amc");
  assert.equal(by("AAPL").at, at(2026, 10, 29, 16, 0));

  // Not guessed. The guard treats both adjoining gaps as exposed, which is
  // the safe reading; picking one would make the band narrow on exactly the
  // night it exists for.
  assert.equal(by("TSLA").timing, "unknown");
  assert.equal(by("TSLA").at, at(2026, 10, 29, 12, 0));
});

test("an unrecognised or absent time value degrades to unknown, not to a guess", () => {
  const cases: Array<[string, NasdaqRow]> = [
    ["a value we do not know", { symbol: "NVDA", time: "time-lunch-maybe" }],
    ["an explicit null", { symbol: "NVDA", time: null }],
    ["the field omitted", { symbol: "NVDA" }],
  ];
  for (const [label, row] of cases) {
    const events = parseRows([row], OCT29, UNIVERSE);
    assert.equal(events[0]?.timing, "unknown", label);
  }
});

test("only tracked symbols are kept, and matching ignores case and padding", () => {
  const rows: NasdaqRow[] = [
    { symbol: " nvda ", time: "time-after-hours" },
    { symbol: "CTAS", time: "time-pre-market" },
    { symbol: null, time: "time-pre-market" }, // the service may send null
    { time: "time-pre-market" }, // or omit the field entirely
  ];
  const events = parseRows(rows, OCT29, UNIVERSE);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.ticker, "NVDA");
});

test("announcement instants follow the zone across the DST boundary", () => {
  // US DST ends on 1 November 2026, so midday sits at a different UTC offset
  // either side of it. A fixed offset would put one of these an hour wrong,
  // and an hour is the whole distance between a close and an after-hours
  // release.
  const before = parseRows([{ symbol: "NVDA", time: "time-not-supplied" }], OCT29, UNIVERSE);
  const after = parseRows(
    [{ symbol: "NVDA", time: "time-not-supplied" }],
    { y: 2026, m: 11, d: 4 },
    UNIVERSE,
  );
  assert.equal(new Date(before[0]!.at * 1000).toISOString(), "2026-10-29T16:00:00.000Z");
  assert.equal(new Date(after[0]!.at * 1000).toISOString(), "2026-11-04T17:00:00.000Z");
});

test("a listed date is taken as announced", () => {
  // Nasdaq publishes a specific date rather than a vendor's projected range,
  // so `confirmed` is true and the remaining uncertainty lives in `timing`.
  const events = parseRows([{ symbol: "NVDA", time: "time-after-hours" }], OCT29, UNIVERSE);
  assert.equal(events[0]?.confirmed, true);
  assert.equal(events[0]?.rangeEndAt, null);
  assert.equal(events[0]?.source, "nasdaq");
});

test("an empty calendar is empty, not an error", () => {
  assert.deepEqual(parseRows([], OCT29, UNIVERSE), []);
});
