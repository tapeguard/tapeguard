/**
 * Builds verdicts for the whole universe, with the caching a public endpoint
 * needs so upstream rate limits are not the thing that takes the feed down.
 */

import { UNIVERSE } from "../lib/universe.ts";
import { buildVerdict, type Verdict } from "../lib/verdict.ts";
import { sessionAt, Session } from "../lib/session.ts";
import { fetchAll, toObservations, enabledProviders } from "../providers/registry.ts";
import { chainConfig, signerAddress, writeBlockers } from "../chain/client.ts";
import { previousClose, corporateActions } from "../providers/yahoo.ts";
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

export function setEarnings(ticker: string, events: EarningsEvent[], nowMs = Date.now()): void {
  earningsCache.set(ticker.toUpperCase(), { value: events, at: nowMs });
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
    earningsEvents: earningsCache.get(upper)?.value ?? [],
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
  const feeds = new Set(providers.map((p) => p.feed));
  return {
    ok: providers.length > 0,
    sessionState: {
      session: state.session,
      etWallClock: state.etWallClock,
      isEarlyClose: state.isEarlyClose,
      holiday: state.holidayName,
      nextOpen: state.nextOpen,
      secondsUntilNextOpen: state.secondsUntilNextOpen,
    },
    providers: providers.map((p) => ({
      name: p.name,
      feed: p.feed,
      reportsPrintTime: p.reportsPrintTime,
    })),
    // Stated plainly, because a one-feed deployment cannot corroborate a halt
    // and must not look like one that can.
    independentFeeds: feeds.size,
    canCorroborateHalts: feeds.size >= 2,
    cachedVerdicts: verdictCache.size,
    chain: chainStatus(),
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
