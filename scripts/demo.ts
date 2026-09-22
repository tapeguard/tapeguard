/**
 * Prints the verdict for each scenario the guards exist for.
 * `npm run demo`
 */
import { etWallClockToUnix } from "../src/lib/session.ts";
import { buildVerdict, type VerdictInput } from "../src/lib/verdict.ts";
import type { SourceObservation } from "../src/lib/guards/halt.ts";
import type { EarningsEvent } from "../src/lib/guards/earnings.ts";

const et = (y: number, m: number, d: number, hh: number, mm: number) =>
  etWallClockToUnix(y, m, d, hh * 60 + mm);

const TUE_NOON = et(2026, 9, 22, 12, 0);
const FRI_CLOSE = et(2026, 9, 25, 16, 0);
const MON_PRE = et(2026, 9, 28, 8, 0);

const s = (source: string, price: number, t: number | null): SourceObservation => ({
  source,
  price,
  lastTradeTime: t,
});

const earnings: EarningsEvent = {
  ticker: "NVDA",
  at: et(2026, 9, 25, 16, 30),
  timing: "amc",
  confirmed: true,
  rangeEndAt: null,
  source: "yahoo",
};

const scenarios: Array<[string, VerdictInput]> = [
  [
    "Live tape, two sources agreeing",
    {
      ticker: "NVDA",
      now: TUE_NOON,
      anchorPrice: 179.5,
      observations: [s("alpaca", 180.0, TUE_NOON - 3), s("finnhub", 180.02, TUE_NOON - 5)],
    },
  ],
  [
    "Live tape, one source only",
    {
      ticker: "NVDA",
      now: TUE_NOON,
      anchorPrice: 179.5,
      observations: [s("yahoo", 180.0, TUE_NOON - 3)],
    },
  ],
  [
    "Tape open, prints stopped (both sources)",
    {
      ticker: "NVDA",
      now: TUE_NOON,
      anchorPrice: 179.5,
      observations: [s("alpaca", 180, TUE_NOON - 400), s("finnhub", 180, TUE_NOON - 395)],
    },
  ],
  [
    "Weekend",
    {
      ticker: "NVDA",
      now: et(2026, 9, 26, 11, 0),
      anchorPrice: 180,
      observations: [s("alpaca", 180, FRI_CLOSE), s("finnhub", 180.01, FRI_CLOSE)],
    },
  ],
  [
    "10:1 split over the weekend",
    {
      ticker: "NVDA",
      now: MON_PRE,
      anchorPrice: 1800,
      observations: [s("alpaca", 180, FRI_CLOSE), s("finnhub", 180, FRI_CLOSE)],
    },
  ],
  [
    "Earnings: -25% open, release known",
    {
      ticker: "NVDA",
      now: MON_PRE,
      anchorPrice: 180,
      observations: [s("alpaca", 135, FRI_CLOSE), s("finnhub", 135, FRI_CLOSE)],
      earningsEvents: [earnings],
    },
  ],
  [
    "Earnings: -25% open, release UNKNOWN to us",
    {
      ticker: "NVDA",
      now: MON_PRE,
      anchorPrice: 180,
      observations: [s("alpaca", 135, FRI_CLOSE), s("finnhub", 135, FRI_CLOSE)],
    },
  ],
  [
    "Feed three days behind",
    {
      ticker: "NVDA",
      now: TUE_NOON,
      anchorPrice: 179.5,
      observations: [
        s("alpaca", 180, TUE_NOON - 3 * 86400),
        s("finnhub", 180, TUE_NOON - 3 * 86400),
      ],
    },
  ],
];

for (const [title, input] of scenarios) {
  const v = buildVerdict(input);
  const mark = v.safe ? "SAFE  " : "REFUSE";
  console.log(`\n${"-".repeat(76)}`);
  console.log(`${mark}  ${title}`);
  console.log(
    `        ${v.ticker} ${v.price}  ${v.provenanceName}  ` +
      `flags: ${v.flagNames}  band: +/-${(v.confidenceBps / 100).toFixed(2)}%`,
  );
  for (const r of v.reasons) console.log(`        . ${r}`);
}
console.log();
