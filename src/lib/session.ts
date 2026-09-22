/**
 * NYSE session calendar.
 *
 * This module knows the *calendar* and nothing else: which days the exchange
 * is open, when the bell rings in New York wall-clock time, and what the last
 * instant was at which a regular-session print could have happened.
 *
 * It deliberately does NOT know about trading halts. A halt is not on any
 * calendar — the tape is scheduled open and simply stops printing. Conflating
 * the two is how an oracle ends up labelling a frozen price `TRADED`, so halt
 * detection lives in `guards/halt.ts` and consumes this module's output.
 *
 * No dependencies: the IANA zone `America/New_York` via `Intl` is the only
 * DST authority we need, and it is already correct in the runtime.
 */

/**
 * Session labels. A const object rather than a TypeScript `enum`: these
 * numbers are also the wire format the contract stores, so the values are
 * part of the interface and must be legible at the point of definition.
 */
export const Session = {
  REGULAR: 0,
  PRE: 1,
  POST: 2,
  CLOSED: 3,
  HOLIDAY: 4,
} as const;

export type Session = (typeof Session)[keyof typeof Session];

export const SESSION_NAME: Record<Session, string> = {
  [Session.REGULAR]: "REGULAR",
  [Session.PRE]: "PRE",
  [Session.POST]: "POST",
  [Session.CLOSED]: "CLOSED",
  [Session.HOLIDAY]: "HOLIDAY",
};

/** Minutes past ET midnight for each session boundary. */
const PRE_OPEN = 4 * 60;            // 04:00
const REGULAR_OPEN = 9 * 60 + 30;   // 09:30
const REGULAR_CLOSE = 16 * 60;      // 16:00
const EARLY_CLOSE = 13 * 60;        // 13:00 on half days
const POST_CLOSE = 20 * 60;         // 20:00
const POST_CLOSE_EARLY = 17 * 60;   // 17:00 on half days

export interface SessionState {
  session: Session;
  /** ET wall clock of the queried instant, for human-readable output. */
  etWallClock: string;
  /** True on a 13:00 ET half day. */
  isEarlyClose: boolean;
  /** Holiday name when `session` is HOLIDAY, else null. */
  holidayName: string | null;
  /** Unix seconds. Null on a non-trading day. */
  regularOpen: number | null;
  regularClose: number | null;
  /**
   * Latest instant at which a *regular-session* print could have occurred.
   * During REGULAR this is now; otherwise it is the previous regular close.
   * This is the anchor to reconcile upstream timestamps against: a vendor
   * that stamps a Saturday quote with fetch time cannot move this number.
   */
  lastTradableInstant: number;
  /**
   * The most recent regular close strictly before now — which during REGULAR
   * is *yesterday's* close, not this second.
   *
   * Distinct from `lastTradableInstant` on purpose, and both are needed.
   * Freshness asks "could a print have happened by now", so during REGULAR
   * the answer is now. Measuring a gap asks "how far has price travelled
   * since the last settled close", and answering that with `now` gives a
   * window of zero, which would divide by zero sigma and blind the
   * discontinuity test during exactly the hours it can be checked against a
   * live tape.
   */
  previousRegularClose: number;
  /** Next regular open, unix seconds. */
  nextOpen: number;
  secondsUntilNextOpen: number;
}

// ---------------------------------------------------------------------------
// ET wall-clock conversion
// ---------------------------------------------------------------------------

const ET_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface EtParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  minutesOfDay: number;
}

function etParts(unixSeconds: number): EtParts {
  const parts = ET_FORMAT.formatToParts(new Date(unixSeconds * 1000));
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Intl did not return a ${type} part`);
    return Number(found.value);
  };
  const hour = get("hour");
  const minute = get("minute");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute,
    second: get("second"),
    minutesOfDay: hour * 60 + minute,
  };
}

/**
 * Offset of America/New_York from UTC, in minutes, at a given instant.
 * Positive west of Greenwich is conventionally negative; this returns the
 * value to *subtract* from a wall clock to reach UTC (so -240 in EDT).
 */
function etOffsetMinutes(unixSeconds: number): number {
  const p = etParts(unixSeconds);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asIfUtc - unixSeconds * 1000) / 60_000;
}

/**
 * Convert an ET wall clock to unix seconds.
 *
 * Two passes: guess with the offset at the naive instant, then re-read the
 * offset at the corrected instant. One pass is wrong for a few hours twice a
 * year, on exactly the days a market calendar is most likely to be tested.
 */
export function etWallClockToUnix(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
): number {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0) + minutesOfDay * 60_000;
  let unix = Math.floor(naive / 1000);
  for (let pass = 0; pass < 2; pass++) {
    const offset = etOffsetMinutes(unix);
    unix = Math.floor((naive - offset * 60_000) / 1000);
  }
  return unix;
}

// ---------------------------------------------------------------------------
// Calendar arithmetic (all in ET civil dates, no Date objects)
// ---------------------------------------------------------------------------

type CivilDate = { year: number; month: number; day: number };

const iso = (d: CivilDate): string =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** 0 = Sunday. Civil date, no timezone involved. */
function weekday(d: CivilDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

function addDays(d: CivilDate, n: number): CivilDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day));
  t.setUTCDate(t.getUTCDate() + n);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** nth (1-based) given weekday of a month. */
function nthWeekday(year: number, month: number, dow: number, nth: number): CivilDate {
  const first: CivilDate = { year, month, day: 1 };
  const shift = (dow - weekday(first) + 7) % 7;
  return { year, month, day: 1 + shift + (nth - 1) * 7 };
}

/** Last given weekday of a month. */
function lastWeekday(year: number, month: number, dow: number): CivilDate {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last: CivilDate = { year, month, day: daysInMonth };
  return addDays(last, -((weekday(last) - dow + 7) % 7));
}

/**
 * Easter Sunday, Gregorian. Meeus/Jones/Butcher.
 *
 * Needed because the NYSE closes on Good Friday, which is not a federal
 * holiday and therefore missing from every US holiday list one might copy.
 */
function easterSunday(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

/**
 * Shift a fixed-date holiday to the day the exchange actually closes.
 *
 * Saturday moves to the preceding Friday, Sunday to the following Monday —
 * except that a Saturday 1 January does not close the preceding Friday,
 * because that Friday belongs to the previous year's calendar. Getting this
 * wrong invents a holiday on 31 December roughly once every seven years.
 */
function observed(d: CivilDate): CivilDate | null {
  const dow = weekday(d);
  if (dow === 6) {
    if (d.month === 1 && d.day === 1) return null;
    return addDays(d, -1);
  }
  if (dow === 0) return addDays(d, 1);
  return d;
}

/** Full-day closures, keyed by ISO date. */
export function holidaysFor(year: number): Map<string, string> {
  const out = new Map<string, string>();
  const put = (d: CivilDate | null, name: string): void => {
    if (d && d.year === year) out.set(iso(d), name);
  };

  put(observed({ year, month: 1, day: 1 }), "New Year's Day");
  put(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  put(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  put(addDays(easterSunday(year), -2), "Good Friday");
  put(lastWeekday(year, 5, 1), "Memorial Day");
  if (year >= 2022) put(observed({ year, month: 6, day: 19 }), "Juneteenth");
  put(observed({ year, month: 7, day: 4 }), "Independence Day");
  put(nthWeekday(year, 9, 1, 1), "Labor Day");
  put(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  put(observed({ year, month: 12, day: 25 }), "Christmas Day");

  // A Saturday 1 January closes the *following* year's 2 January? No — it
  // closes nothing. But a Sunday 31 December means 1 January falls on Monday
  // and is already handled above. The only cross-year case is the Saturday
  // New Year we declined, so nothing to add here.
  return out;
}

/** 13:00 ET half days, keyed by ISO date. */
export function earlyClosesFor(year: number): Map<string, string> {
  const out = new Map<string, string>();
  const holidays = holidaysFor(year);
  const put = (d: CivilDate, name: string): void => {
    const key = iso(d);
    const dow = weekday(d);
    if (dow === 0 || dow === 6) return;
    if (holidays.has(key)) return;
    out.set(key, name);
  };

  // Day after Thanksgiving is always the Friday after the fourth Thursday.
  put(addDays(nthWeekday(year, 11, 4, 4), 1), "Day after Thanksgiving");

  // 3 July, only when the 4th is itself a weekday session.
  const jul4 = weekday({ year, month: 7, day: 4 });
  if (jul4 >= 1 && jul4 <= 5) put({ year, month: 7, day: 3 }, "Independence Day Eve");

  // 24 December, only when it is a weekday and not the observed holiday.
  put({ year, month: 12, day: 24 }, "Christmas Eve");

  return out;
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

interface DayShape {
  isTradingDay: boolean;
  holidayName: string | null;
  isEarlyClose: boolean;
  closeMinutes: number;
  postCloseMinutes: number;
}

function dayShape(d: CivilDate): DayShape {
  const dow = weekday(d);
  if (dow === 0 || dow === 6) {
    return {
      isTradingDay: false,
      holidayName: null,
      isEarlyClose: false,
      closeMinutes: REGULAR_CLOSE,
      postCloseMinutes: POST_CLOSE,
    };
  }
  const key = iso(d);
  const holidayName = holidaysFor(d.year).get(key) ?? null;
  if (holidayName) {
    return {
      isTradingDay: false,
      holidayName,
      isEarlyClose: false,
      closeMinutes: REGULAR_CLOSE,
      postCloseMinutes: POST_CLOSE,
    };
  }
  const isEarlyClose = earlyClosesFor(d.year).has(key);
  return {
    isTradingDay: true,
    holidayName: null,
    isEarlyClose,
    closeMinutes: isEarlyClose ? EARLY_CLOSE : REGULAR_CLOSE,
    postCloseMinutes: isEarlyClose ? POST_CLOSE_EARLY : POST_CLOSE,
  };
}

/** Is the exchange scheduled to trade on this ET civil date? */
export function isTradingDay(year: number, month: number, day: number): boolean {
  return dayShape({ year, month, day }).isTradingDay;
}

/**
 * Walk back to the most recent regular close at or before `unixSeconds`.
 * Bounded at 12 days: the longest run of consecutive closures the NYSE
 * calendar can produce is a holiday adjoining a weekend, nowhere near that.
 */
function previousRegularClose(unixSeconds: number): number {
  const p = etParts(unixSeconds);
  let d: CivilDate = { year: p.year, month: p.month, day: p.day };
  let minutesNow = p.minutesOfDay;

  for (let i = 0; i < 12; i++) {
    const shape = dayShape(d);
    if (shape.isTradingDay && minutesNow >= shape.closeMinutes) {
      return etWallClockToUnix(d.year, d.month, d.day, shape.closeMinutes);
    }
    d = addDays(d, -1);
    minutesNow = 24 * 60; // every earlier day is considered fully elapsed
  }
  throw new Error("no regular close found within 12 days");
}

/** Next regular open strictly after, or exactly at, `unixSeconds`. */
function nextRegularOpen(unixSeconds: number): number {
  const p = etParts(unixSeconds);
  let d: CivilDate = { year: p.year, month: p.month, day: p.day };

  for (let i = 0; i < 12; i++) {
    const shape = dayShape(d);
    if (shape.isTradingDay) {
      const open = etWallClockToUnix(d.year, d.month, d.day, REGULAR_OPEN);
      if (open >= unixSeconds) return open;
    }
    d = addDays(d, 1);
  }
  throw new Error("no regular open found within 12 days");
}

/** Resolve the full session state at an instant. Defaults to now. */
export function sessionAt(unixSeconds: number = Math.floor(Date.now() / 1000)): SessionState {
  const p = etParts(unixSeconds);
  const d: CivilDate = { year: p.year, month: p.month, day: p.day };
  const shape = dayShape(d);
  const m = p.minutesOfDay;

  let session: Session;
  if (!shape.isTradingDay) {
    session = shape.holidayName ? Session.HOLIDAY : Session.CLOSED;
  } else if (m >= REGULAR_OPEN && m < shape.closeMinutes) {
    session = Session.REGULAR;
  } else if (m >= PRE_OPEN && m < REGULAR_OPEN) {
    session = Session.PRE;
  } else if (m >= shape.closeMinutes && m < shape.postCloseMinutes) {
    session = Session.POST;
  } else {
    session = Session.CLOSED;
  }

  const regularOpen = shape.isTradingDay
    ? etWallClockToUnix(d.year, d.month, d.day, REGULAR_OPEN)
    : null;
  const regularClose = shape.isTradingDay
    ? etWallClockToUnix(d.year, d.month, d.day, shape.closeMinutes)
    : null;

  const lastTradableInstant =
    session === Session.REGULAR ? unixSeconds : previousRegularClose(unixSeconds);

  const nextOpen = nextRegularOpen(unixSeconds);
  const priorClose = previousRegularClose(unixSeconds);

  return {
    session,
    etWallClock:
      `${iso(d)} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` +
      `:${String(p.second).padStart(2, "0")}`,
    isEarlyClose: shape.isEarlyClose,
    holidayName: shape.holidayName,
    regularOpen,
    regularClose,
    lastTradableInstant,
    previousRegularClose: priorClose,
    nextOpen,
    secondsUntilNextOpen: Math.max(0, nextOpen - unixSeconds),
  };
}

/** Hours the tape has been shut, measured to the last regular close. */
export function darkHours(unixSeconds: number = Math.floor(Date.now() / 1000)): number {
  const state = sessionAt(unixSeconds);
  if (state.session === Session.REGULAR) return 0;
  return (unixSeconds - state.lastTradableInstant) / 3600;
}
