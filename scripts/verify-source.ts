/**
 * Is a provider's timestamp a print time, or its own clock?
 *
 *   FINNHUB_API_KEY=... npm run verify:source -- finnhub
 *
 * This decides whether a source may witness freshness, which decides whether
 * a halt can ever be corroborated. It is the one provider property that
 * cannot be read off a pricing page: a vendor that stamps a stale quote with
 * the current time makes a frozen tape look live, which is exactly the
 * failure halt detection exists to catch.
 *
 * The test is simple and only decisive while the tape is shut. Poll several
 * times over a minute. A genuine print time cannot move, because no print is
 * happening. A poll time moves with every request.
 *
 * So run it on a weekend, overnight, or in the pre-market — not during
 * regular hours, when both behave identically and the test proves nothing.
 */

import { SESSION_NAME, Session, sessionAt } from "../src/lib/session.ts";
import { PROVIDERS } from "../src/providers/registry.ts";

const POLLS = 5;
const GAP_MS = 12_000;

async function main(): Promise<void> {
  const name = process.argv[2];
  const provider = PROVIDERS.find((p) => p.name === name);
  if (!provider) {
    console.error(`usage: npm run verify:source -- <${PROVIDERS.map((p) => p.name).join("|")}>`);
    process.exit(1);
  }
  if (!provider.enabled) {
    console.error(`${name} is not enabled; set its API key first`);
    process.exit(1);
  }

  const state = sessionAt();
  console.log(`verifying "${provider.name}" (feed: ${provider.feed})`);
  console.log(`  session          ${SESSION_NAME[state.session]} at ${state.etWallClock} ET`);
  console.log(`  declared         reportsPrintTime = ${provider.reportsPrintTime}`);

  if (state.session === Session.REGULAR) {
    console.log(`
  The tape is OPEN. A real print time and a poll time both advance right now,
  so this test cannot separate them. Run it while the tape is shut.
`);
    process.exit(1);
  }

  console.log(`  last real print  ${new Date(state.lastTradableInstant * 1000).toISOString()}`);
  console.log(`\n  polling ${POLLS} times, ${GAP_MS / 1000}s apart...\n`);

  const seen: Array<{ wall: number; stamp: number | null }> = [];
  for (let i = 0; i < POLLS; i++) {
    const wall = Math.floor(Date.now() / 1000);
    try {
      const q = await provider.quote("NVDA", AbortSignal.timeout(8000));
      seen.push({ wall, stamp: q.lastTradeTime });
      console.log(
        `    ${new Date(wall * 1000).toISOString().slice(11, 19)}  ` +
          `reported ${q.lastTradeTime === null ? "(none)" : new Date(q.lastTradeTime * 1000).toISOString()}`,
      );
    } catch (err) {
      console.log(`    poll failed: ${err instanceof Error ? err.message : err}`);
      seen.push({ wall, stamp: null });
    }
    if (i < POLLS - 1) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  const stamps = seen.map((s) => s.stamp).filter((s): s is number => s !== null);
  if (stamps.length < 2) {
    console.log("\n  Not enough answers to judge. Leave reportsPrintTime as it is.\n");
    process.exit(1);
  }

  const moved = Math.max(...stamps) - Math.min(...stamps);
  const elapsed = (seen.at(-1)?.wall ?? 0) - (seen[0]?.wall ?? 0);
  const anchor = state.lastTradableInstant;
  const aheadOfLastPrint = Math.max(...stamps) - anchor;

  console.log(`\n  timestamp moved  ${moved}s over ${elapsed}s of polling`);
  console.log(`  vs last print    ${aheadOfLastPrint >= 0 ? "+" : ""}${aheadOfLastPrint}s`);

  // Moving at roughly the rate of the wall clock, while the tape is shut, is
  // the signature of a poll time. Allow a little slack for a vendor that
  // updates on a coarse cadence.
  const tracksClock = moved > elapsed * 0.5;
  // A stamp well past the last possible print is fabricated freshness even
  // if it happens to be static between two polls.
  const impossible = aheadOfLastPrint > 300;

  console.log();
  if (tracksClock || impossible) {
    console.log("  VERDICT: this is a poll time, not a print time.");
    console.log("           The tape is shut, so nothing printed — yet the stamp moved.");
    console.log(`           Keep ${provider.name.toUpperCase()}_PRINT_TIME unset (false).`);
    console.log("           It may contribute a price; it must not witness freshness.");
  } else {
    console.log("  VERDICT: consistent with a genuine print time.");
    console.log("           It held still while the tape was shut, which a poll time");
    console.log("           would not. Re-run on another shut session before relying");
    console.log(`           on it, then set ${provider.name.toUpperCase()}_PRINT_TIME=true.`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
