/**
 * Builds verdicts for the whole universe, with the caching a public endpoint
 * needs so upstream rate limits are not the thing that takes the feed down.
 */

import { UNIVERSE, calibration, parameterSource } from "../lib/universe.ts";
import { buildVerdict, type Verdict } from "../lib/verdict.ts";
import { sessionAt, Session } from "../lib/session.ts";
import {
  fetchAll,
  toObservations,
  enabledProviders,
  providerOutcomes,
  workingProviders,
  isWorking,
  OUTCOME_GRACE_SEC,
} from "../providers/registry.ts";
import { chainConfig, signerAddress, writeBlockers } from "../chain/client.ts";
import { previousClose, corporateActions } from "../providers/yahoo.ts";
import { fetchEarnings } from "../providers/earnings.ts";
import type { CorporateAction } from "../lib/guards/corpaction.ts";
import type { EarningsEvent } from "../lib/guards/earnings.ts";

interface Cached<T> {
  value: T;
  at: number;
}

const verdictCache = new Map<string, Cached<Verdict>>();
const anchorCache = new Map<string, Cached<number>>();
const actionCache = new Map<string, Cached<CorporateAction[]>>();
const earningsCache = new Map<string, Cached<EarningsEvent[]>>();

/**
 * A live tape changes every second; a shut one does not change for hours.
 * Polling a weekend at the regular-hours cadence spends a rate limit to
 * learn nothing.
 */
function verdictTtlMs(now: number): number {
  return sessionAt(now).session === Session.REGULAR ? 12_000 : 90_000;
}

/** The anchor only moves at a close, so it is held across the whole session. */
const ANCHOR_TTL_MS = 10 * 60_000;
const ACTION_TTL_MS = 6 * 60 * 60_000;

const fresh = <T>(c: Cached<T> | undefined, ttl: number, now: number): c is Cached<T> =>
  c !== undefined && now - c.at < ttl;

async function anchorFor(ticker: string, nowMs: number, nowSec: number): Promise<number> {
  const hit = anchorCache.get(ticker);
  if (fresh(hit, ANCHOR_TTL_MS, nowMs)) return hit.value;
  const value = await previousClose(ticker, AbortSignal.timeout(6000), nowSec);
  anchorCache.set(ticker, { value, at: nowMs });
  return value;
}

async function actionsFor(ticker: string, nowMs: number): Promise<CorporateAction[]> {
  const hit = actionCache.get(ticker);
  // Captured before the freshness check: the type guard narrows `hit` away in
  // the stale branch, and a stale list is still better than none.
  const stale = hit?.value ?? [];
  if (fresh(hit, ACTION_TTL_MS, nowMs)) return hit.value;
  try {
    const value = await corporateActions(ticker, AbortSignal.timeout(6000));
    actionCache.set(ticker, { value, at: nowMs });
    return value;
  } catch {
    // A corporate-actions feed that is down must not take the feed down with
    // it. The heuristic guard covers this case without any feed at all, which
    // is the reason it exists.
    return stale;
  }
}

/**
 * Earnings for the whole universe, refreshed on a timer rather than on read.
 *
 * The calendar is indexed by date, so covering the universe costs a request
 * per day walked. Doing that inside a page render would put a dozen HTTP
 * round trips on the critical path of every cold request, to learn something
 * that changes when a company announces a date — not continuously.
 *
 * So reads are served from cache and a stale cache triggers a refresh in the
 * background. The first read after a restart sees an empty calendar, which
 * costs a widened band on one tick and never blocks a response.
 */
const EARNINGS_TTL_MS = 6 * 60 * 60_000;
let earningsAt = 0;
let earningsInFlight: Promise<void> | null = null;
export let earningsFailures: Array<{ date: string; error: string }> = [];

export function setEarnings(ticker: string, events: EarningsEvent[], nowMs = Date.now()): void {
  earningsCache.set(ticker.toUpperCase(), { value: events, at: nowMs });
}

export async function refreshEarnings(): Promise<void> {
  const tickers = UNIVERSE.map((i) => i.ticker);
  const { events, failures } = await fetchEarnings(tickers);
  earningsFailures = failures;

  // Replace wholesale. A symbol whose release was cancelled or moved out of
  // the window must lose its event, and merging would keep it forever.
  for (const t of tickers) earningsCache.set(t, { value: [], at: Date.now() });
  for (const e of events) {
    const slot = earningsCache.get(e.ticker);
    if (slot) slot.value.push(e);
  }
  earningsAt = Date.now();
}

function earningsFor(ticker: string): EarningsEvent[] {
  if (Date.now() - earningsAt > EARNINGS_TTL_MS && !earningsInFlight) {
    earningsInFlight = refreshEarnings()
      .catch((err) => {
        // A calendar that cannot be read must not take the feed down. The
        // cost is a band that is not widened, which is reported in health.
        console.error("earnings refresh failed:", err instanceof Error ? err.message : err);
      })
      .finally(() => {
        earningsInFlight = null;
      });
  }
  return earningsCache.get(ticker.toUpperCase())?.value ?? [];
}

export async function verdictFor(ticker: string, force = false): Promise<Verdict> {
  const upper = ticker.toUpperCase();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  const hit = verdictCache.get(upper);
  if (!force && fresh(hit, verdictTtlMs(nowSec), nowMs)) return hit.value;

  const [results, anchorPrice, actions] = await Promise.all([
    fetchAll(upper),
    anchorFor(upper, nowMs, nowSec),
    actionsFor(upper, nowMs),
  ]);

  const verdict = buildVerdict({
    ticker: upper,
    now: nowSec,
    observations: toObservations(results),
    anchorPrice,
    corporateActions: actions,
    earningsEvents: earningsFor(upper),
  });

  verdictCache.set(upper, { value: verdict, at: nowMs });
  return verdict;
}

/** Every instrument. A failure on one is reported, not propagated. */
export async function allVerdicts(): Promise<{
  verdicts: Verdict[];
  failures: Array<{ ticker: string; error: string }>;
}> {
  const settled = await Promise.all(
    UNIVERSE.map(async (i) => {
      try {
        return { ok: true as const, verdict: await verdictFor(i.ticker) };
      } catch (err) {
        return {
          ok: false as const,
          ticker: i.ticker,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  return {
    verdicts: settled.filter((s) => s.ok).map((s) => s.verdict),
    failures: settled.filter((s) => !s.ok).map((s) => ({ ticker: s.ticker, error: s.error })),
  };
}

export function health(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const state = sessionAt(now);
  const providers = enabledProviders();
  const outcomes = providerOutcomes();
  const working = workingProviders();
  // Counted from providers that actually answered, not from providers that
  // are configured. A placeholder or revoked key otherwise reports a feed
  // this deployment does not have.
  const feeds = new Set(working.map((p) => p.feed));
  return {
    ok: working.length > 0,
    sessionState: {
      session: state.session,
      etWallClock: state.etWallClock,
      isEarlyClose: state.isEarlyClose,
      holiday: state.holidayName,
      nextOpen: state.nextOpen,
      secondsUntilNextOpen: state.secondsUntilNextOpen,
    },
    providers: providers.map((p) => {
      const o = outcomes.get(p.name);
      return {
        name: p.name,
        feed: p.feed,
        reportsPrintTime: p.reportsPrintTime,
        configured: true,
        // null until it has been tried, so "not yet asked" is not reported
        // as either working or broken.
        working: o?.lastOkAt == null && o?.lastErrorAt == null ? null : isWorking(p.name),
        lastOkAt: o?.lastOkAt ?? null,
        lastErrorAt: o?.lastErrorAt ?? null,
        lastError: o?.lastError ?? null,
      };
    }),
    providerGraceSec: OUTCOME_GRACE_SEC,
    // Stated plainly, because a one-feed deployment cannot corroborate a halt
    // and must not look like one that can. Halt corroboration further needs
    // sources that witness print times, so a working provider with
    // reportsPrintTime false does not count towards it.
    independentFeeds: feeds.size,
    canCorroborateHalts:
      new Set(working.filter((p) => p.reportsPrintTime).map((p) => p.feed)).size >= 2,
    cachedVerdicts: verdictCache.size,
    earnings: {
      lastRefresh: earningsAt === 0 ? null : Math.floor(earningsAt / 1000),
      // Said plainly: with no calendar loaded, EARNINGS_WINDOW cannot fire,
      // and a band that is never widened looks identical to one that did not
      // need widening.
      loaded: earningsAt !== 0,
      tracked: [...earningsCache.values()].reduce((n, c) => n + c.value.length, 0),
      next: nextEarnings(),
      failures: earningsFailures.length,
    },
    calibration: calibrationStatus(),
    chain: chainStatus(),
  };
}

/**
 * Whether the bands in use were fitted or are still priors.
 *
 * Reported first-class because it is the difference between a band a
 * liquidation can rely on and one that merely looks like it can, and nothing
 * else in the payload distinguishes them.
 */
function calibrationStatus(): Record<string, unknown> {
  const c = calibration();
  if (!c) {
    return { source: parameterSource, fittedAt: null, note: "not calibrated; every sigma is a prior" };
  }
  return {
    source: parameterSource,
    fittedAt: c.fittedAt,
    timeExponent: c.timeExponent,
    // Out of sample: fitted on the first 60% of the history, scored on the
    // last 40%. An in-sample figure for a quantile-fitted band is arithmetic
    // rather than evidence.
    coverage: c.pooledCoverage,
    worstDecileCoverage: c.pooledWorstDecileCoverage,
  };
}

/**
 * What the chain side can and cannot do right now.
 *
 * `blockers` is a list rather than a boolean so a misconfigured deployment
 * names what is missing, instead of presenting as a feed that simply never
 * updates — the two look identical from outside and have entirely different
 * fixes.
 */
/** The soonest scheduled release per instrument, for operators. */
function nextEarnings(): Array<{ ticker: string; at: number; timing: string }> {
  const out: Array<{ ticker: string; at: number; timing: string }> = [];
  const now = Math.floor(Date.now() / 1000);
  for (const [ticker, slot] of earningsCache) {
    const soonest = slot.value
      .filter((e) => e.at >= now)
      .sort((a, b) => a.at - b.at)[0];
    if (soonest) out.push({ ticker, at: soonest.at, timing: soonest.timing });
  }
  return out.sort((a, b) => a.at - b.at);
}

function chainStatus(): Record<string, unknown> {
  const cfg = chainConfig();
  const blockers = writeBlockers(cfg);
  return {
    chainId: cfg.chainId,
    contract: cfg.address,
    signer: cfg.signerKey ? signerAddress(cfg.signerKey) : null,
    relayer: cfg.relayerKey ? signerAddress(cfg.relayerKey) : null,
    canWrite: blockers.length === 0,
    blockers,
    // One key today. The contract takes a threshold, so raising it is a
    // transaction rather than a redeploy — but until it is raised, saying
    // anything other than 1 would be a claim this deployment cannot back.
    signerThreshold: 1,
  };
}
