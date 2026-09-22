/**
 * Earnings calendar, from Nasdaq's public endpoint.
 *
 * Needs no key, and reports the one field that actually matters for a gap
 * model: whether a company reports before the open or after the close. That
 * decides which of two adjoining gaps carries the announcement, and getting
 * it wrong puts the widened band on the wrong night.
 *
 * The endpoint is indexed by date rather than by symbol, so a universe is
 * covered by walking a few days and filtering. That is also why the result
 * is cached for a day: the calendar changes when a company announces a date,
 * not continuously.
 */

import { etWallClockToUnix } from "../lib/session.ts";
import type { EarningsEvent } from "../lib/guards/earnings.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120 Safari/537.36";

/** ET minutes-past-midnight for each reporting slot. */
const BMO_MINUTES = 9 * 60 + 30; // just before the opening bell
const AMC_MINUTES = 16 * 60; // just after the closing bell
const UNKNOWN_MINUTES = 12 * 60; // midday; the guard widens both gaps anyway

/**
 * A calendar row as the endpoint actually delivers it.
 *
 * Fields are optional *and* nullable: this is parsed JSON from a service
 * that is free to omit a field or send null for it, and a type that admits
 * only `string | undefined` is a claim about someone else's serialiser.
 */
export interface NasdaqRow {
  symbol?: string | null;
  time?: string | null;
  name?: string | null;
}

function timingOf(raw: string | null | undefined): EarningsEvent["timing"] {
  switch (raw) {
    case "time-pre-market":
      return "bmo";
    case "time-after-hours":
      return "amc";
    default:
      // "time-not-supplied", or anything new. Reported as unknown rather than
      // guessed: the guard treats both adjoining gaps as exposed, which is
      // the safe reading, and a guess here would make it narrow on exactly
      // the night it was built for.
      return "unknown";
  }
}

const minutesFor = (timing: EarningsEvent["timing"]): number =>
  timing === "bmo" ? BMO_MINUTES : timing === "amc" ? AMC_MINUTES : UNKNOWN_MINUTES;

/** Civil date `days` after the ET date containing `from`. */
function addDaysIso(from: Date, days: number): { iso: string; y: number; m: number; d: number } {
  const t = new Date(from.getTime());
  t.setUTCDate(t.getUTCDate() + days);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { iso, y, m, d };
}

async function fetchDay(
  date: { iso: string; y: number; m: number; d: number },
  wanted: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<EarningsEvent[]> {
  const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date.iso}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`nasdaq HTTP ${res.status} for ${date.iso}`);

  const body = (await res.json()) as { data?: { rows?: NasdaqRow[] | null } };
  // A non-trading date returns rows: null rather than an empty array.
  const rows = body.data?.rows ?? [];

  const out: EarningsEvent[] = [];
  for (const row of rows) {
    const symbol = row.symbol?.trim().toUpperCase();
    if (!symbol || !wanted.has(symbol)) continue;
    const timing = timingOf(row.time);
    out.push({
      ticker: symbol,
      at: etWallClockToUnix(date.y, date.m, date.d, minutesFor(timing)),
      timing,
      // Nasdaq lists a specific date rather than a vendor's projected range,
      // so the date is taken as announced. `timing` still carries whatever
      // uncertainty remains about the hour.
      confirmed: true,
      rangeEndAt: null,
      source: "nasdaq",
    });
  }
  return out;
}

export interface EarningsFetch {
  events: EarningsEvent[];
  /** Dates that could not be read. Reported, not swallowed. */
  failures: Array<{ date: string; error: string }>;
}

/**
 * Walk a window of calendar dates and keep the tracked symbols.
 *
 * The window reaches backwards as well as forwards. A release that happened
 * last night is still inside the gap being priced this morning, so a
 * forward-only window would drop the widened band exactly when it applies.
 */
export async function fetchEarnings(
  tickers: readonly string[],
  opts: {
    back?: number;
    ahead?: number;
    now?: number;
    timeoutMs?: number;
    concurrency?: number;
  } = {},
): Promise<EarningsFetch> {
  const back = opts.back ?? 3;
  // Far enough ahead to hold the next quarter's reports. The guard filters
  // by window intersection so extra events are inert, and carrying them
  // makes the calendar observable: an operator seeing `tracked: 0` cannot
  // tell a working refresh from a broken one.
  const ahead = opts.ahead ?? 40;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const wanted = new Set(tickers.map((t) => t.toUpperCase()));
  const anchor = new Date(now * 1000);

  const days = Array.from({ length: back + ahead + 1 }, (_, i) => addDaysIso(anchor, i - back));

  // Windowed rather than all at once. Forty-odd simultaneous requests to a
  // free public endpoint is how a refresh turns into a rate limit, and a
  // rate limit here presents as a calendar that is quietly empty.
  const concurrency = opts.concurrency ?? 6;
  const timeoutMs = opts.timeoutMs ?? 8000;
  type Settled =
    | { ok: true; events: EarningsEvent[] }
    | { ok: false; date: string; error: string };
  const settled: Settled[] = [];

  for (let i = 0; i < days.length; i += concurrency) {
    const batch = await Promise.all(
      days.slice(i, i + concurrency).map(async (date): Promise<Settled> => {
        try {
          return { ok: true, events: await fetchDay(date, wanted, AbortSignal.timeout(timeoutMs)) };
        } catch (err) {
          return {
            ok: false,
            date: date.iso,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    settled.push(...batch);
  }

  return {
    events: settled.flatMap((s) => (s.ok ? s.events : [])),
    failures: settled.filter((s) => !s.ok).map((s) => ({ date: s.date, error: s.error })),
  };
}

/** Parse rows without fetching. Exported so the mapping can be tested. */
export function parseRows(
  rows: readonly NasdaqRow[],
  date: { y: number; m: number; d: number },
  tickers: readonly string[],
): EarningsEvent[] {
  const wanted = new Set(tickers.map((t) => t.toUpperCase()));
  const out: EarningsEvent[] = [];
  for (const row of rows) {
    const symbol = row.symbol?.trim().toUpperCase();
    if (!symbol || !wanted.has(symbol)) continue;
    const timing = timingOf(row.time);
    out.push({
      ticker: symbol,
      at: etWallClockToUnix(date.y, date.m, date.d, minutesFor(timing)),
      timing,
      confirmed: true,
      rangeEndAt: null,
      source: "nasdaq",
    });
  }
  return out;
}
