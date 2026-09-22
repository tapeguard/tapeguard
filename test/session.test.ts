import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Session,
  sessionAt,
  holidaysFor,
  earlyClosesFor,
  isTradingDay,
  etWallClockToUnix,
  darkHours,
} from "../src/lib/session.ts";

/** Helper: unix seconds for an ET wall clock, hh:mm. */
const et = (y: number, m: number, d: number, hh: number, mm: number): number =>
  etWallClockToUnix(y, m, d, hh * 60 + mm);

test("Good Friday closes the exchange although it is not a federal holiday", () => {
  // Easter 2026 is 5 April, so Good Friday is 3 April.
  assert.equal(holidaysFor(2026).get("2026-04-03"), "Good Friday");
  assert.equal(isTradingDay(2026, 4, 3), false);
  // 2027: Easter is 28 March, Good Friday 26 March.
  assert.equal(holidaysFor(2027).get("2027-03-26"), "Good Friday");
});

test("the 2026 holiday calendar matches the published NYSE dates", () => {
  const h = holidaysFor(2026);
  const expected: Array<[string, string]> = [
    ["2026-01-01", "New Year's Day"],          // Thursday
    ["2026-01-19", "Martin Luther King Jr. Day"],
    ["2026-02-16", "Washington's Birthday"],
    ["2026-04-03", "Good Friday"],
    ["2026-05-25", "Memorial Day"],
    ["2026-06-19", "Juneteenth"],
    ["2026-07-03", "Independence Day"],        // 4 July is a Saturday
    ["2026-09-07", "Labor Day"],
    ["2026-11-26", "Thanksgiving Day"],
    ["2026-12-25", "Christmas Day"],
  ];
  for (const [date, name] of expected) {
    assert.equal(h.get(date), name, `expected ${name} on ${date}`);
  }
  assert.equal(h.size, expected.length, "no extra closures invented");
});

test("a Saturday New Year does not close the preceding 31 December", () => {
  // 1 January 2022 fell on a Saturday. The exchange traded Friday 31 Dec 2021.
  assert.equal(holidaysFor(2021).has("2021-12-31"), false);
  assert.equal(isTradingDay(2021, 12, 31), true);
  // And a Sunday New Year moves forward to the Monday.
  assert.equal(holidaysFor(2023).get("2023-01-02"), "New Year's Day");
});

test("half days are the day after Thanksgiving and Christmas Eve", () => {
  const e = earlyClosesFor(2026);
  assert.equal(e.get("2026-11-27"), "Day after Thanksgiving");
  assert.equal(e.get("2026-12-24"), "Christmas Eve"); // a Thursday in 2026
  // 4 July 2026 is a Saturday, so 3 July is the observed holiday, not a half
  // day. A naive implementation double-books it.
  assert.equal(e.has("2026-07-03"), false);
});

test("an early close ends the regular session at 13:00 ET", () => {
  // 13:30 ET on the day after Thanksgiving: regular hours are over.
  const s = sessionAt(et(2026, 11, 27, 13, 30));
  assert.equal(s.session, Session.POST);
  assert.equal(s.isEarlyClose, true);
  assert.equal(s.regularClose, et(2026, 11, 27, 13, 0));
  // 12:30 ET is still open.
  assert.equal(sessionAt(et(2026, 11, 27, 12, 30)).session, Session.REGULAR);
});

test("session boundaries land on the right side of the bell", () => {
  const day = (hh: number, mm: number) => sessionAt(et(2026, 9, 22, hh, mm)).session;
  assert.equal(day(3, 59), Session.CLOSED);
  assert.equal(day(4, 0), Session.PRE);
  assert.equal(day(9, 29), Session.PRE);
  assert.equal(day(9, 30), Session.REGULAR);
  assert.equal(day(15, 59), Session.REGULAR);
  assert.equal(day(16, 0), Session.POST);
  assert.equal(day(19, 59), Session.POST);
  assert.equal(day(20, 0), Session.CLOSED);
});

test("DST is resolved from the zone, not a fixed offset", () => {
  // 22 September 2026 is EDT (UTC-4): the open is 13:30 UTC.
  assert.equal(new Date(et(2026, 9, 22, 9, 30) * 1000).toISOString(), "2026-09-22T13:30:00.000Z");
  // 15 January 2026 is EST (UTC-5): the same bell is 14:30 UTC.
  assert.equal(new Date(et(2026, 1, 15, 9, 30) * 1000).toISOString(), "2026-01-15T14:30:00.000Z");
});

test("lastTradableInstant ignores the clock and finds the last real close", () => {
  // Saturday. The last regular print was Friday 16:00 ET.
  const sat = sessionAt(et(2026, 9, 26, 11, 0));
  assert.equal(sat.session, Session.CLOSED);
  assert.equal(sat.lastTradableInstant, et(2026, 9, 25, 16, 0));

  // During REGULAR the anchor is now: a print could be happening this second.
  const live = et(2026, 9, 22, 11, 0);
  assert.equal(sessionAt(live).lastTradableInstant, live);

  // The Monday after a Friday holiday reaches back past both.
  // 3 July 2026 is the observed Independence Day, so Thursday 2 July closes it.
  const mon = sessionAt(et(2026, 7, 6, 8, 0));
  assert.equal(mon.session, Session.PRE);
  assert.equal(mon.lastTradableInstant, et(2026, 7, 2, 16, 0));
});

test("darkHours measures the shut window, and is zero while open", () => {
  assert.equal(darkHours(et(2026, 9, 22, 11, 0)), 0);
  // Saturday 11:00 ET is 19 hours after Friday's 16:00 close.
  assert.equal(darkHours(et(2026, 9, 26, 11, 0)), 19);
  // A 62-hour weekend: Monday 06:00 ET after a Friday 16:00 close.
  assert.equal(darkHours(et(2026, 9, 28, 6, 0)), 62);
});

test("nextOpen skips weekends and holidays", () => {
  // Saturday -> Monday 09:30.
  assert.equal(sessionAt(et(2026, 9, 26, 11, 0)).nextOpen, et(2026, 9, 28, 9, 30));
  // Thursday 2 July 17:00, with Friday 3 July closed -> Monday 6 July.
  assert.equal(sessionAt(et(2026, 7, 2, 17, 0)).nextOpen, et(2026, 7, 6, 9, 30));
  // Before the bell on a trading day, nextOpen is today.
  assert.equal(sessionAt(et(2026, 9, 22, 8, 0)).nextOpen, et(2026, 9, 22, 9, 30));
});

test("a holiday is labelled HOLIDAY, a weekend only CLOSED", () => {
  const h = sessionAt(et(2026, 11, 26, 11, 0));
  assert.equal(h.session, Session.HOLIDAY);
  assert.equal(h.holidayName, "Thanksgiving Day");
  const w = sessionAt(et(2026, 9, 26, 11, 0));
  assert.equal(w.session, Session.CLOSED);
  assert.equal(w.holidayName, null);
});
