/**
 * Provider registry: fetch every enabled source in parallel, tolerate the
 * ones that fail, and never let a slow upstream stall the feed.
 */

import {
  PROVIDER_TIMEOUT_MS,
  isQuote,
  type PriceProvider,
  type ProviderResult,
} from "./types.ts";
import { yahoo } from "./yahoo.ts";
import { alpaca } from "./alpaca.ts";
import { finnhub } from "./finnhub.ts";
import type { SourceObservation } from "../lib/guards/halt.ts";

export const PROVIDERS: readonly PriceProvider[] = [yahoo, alpaca, finnhub];

export const enabledProviders = (): PriceProvider[] => PROVIDERS.filter((p) => p.enabled);

/**
 * What each provider last actually did.
 *
 * Configured is not the same as working. A key that is a placeholder, a
 * typo, revoked, or past its quota leaves the provider looking enabled while
 * every request 401s — and a deployment that counts it reports two
 * independent feeds and a corroborable halt when it has neither.
 *
 * The verdict path is unaffected, because a failed provider contributes no
 * observation and SINGLE_SOURCE is raised on what resolved. But health is
 * read by an operator deciding whether to trust the feed, and it must not
 * answer from the config file.
 */
export interface ProviderOutcome {
  /** Unix seconds of the last request that succeeded, if any. */
  lastOkAt: number | null;
  /** Unix seconds of the last request that failed, if any. */
  lastErrorAt: number | null;
  lastError: string | null;
}

/**
 * How long a success stands for before a provider is treated as down.
 *
 * Judging a provider by its most recent attempt alone makes the summary
 * flap: one rate-limited request in a burst of eight flips the whole
 * deployment to "cannot corroborate halts" while the provider is answering
 * perfectly well a second later. A recent success is the honest signal —
 * long enough to ride out a blip, short enough that a genuinely dead
 * provider stops counting.
 */
export const OUTCOME_GRACE_SEC = 300;

const outcomes = new Map<string, ProviderOutcome>();

export const providerOutcomes = (): ReadonlyMap<string, ProviderOutcome> => outcomes;

function record(name: string, ok: boolean, at: number, error?: string): void {
  const prev = outcomes.get(name) ?? { lastOkAt: null, lastErrorAt: null, lastError: null };
  outcomes.set(
    name,
    ok
      ? { ...prev, lastOkAt: at }
      : { ...prev, lastErrorAt: at, lastError: error ?? "unknown" },
  );
}

/** Has this provider answered recently enough to be counted? */
export function isWorking(name: string, now = Math.floor(Date.now() / 1000)): boolean {
  const o = outcomes.get(name);
  return o?.lastOkAt != null && now - o.lastOkAt <= OUTCOME_GRACE_SEC;
}

/** Providers that have answered within the grace window. */
export function workingProviders(): PriceProvider[] {
  return enabledProviders().filter((p) => isWorking(p.name));
}

export async function fetchAll(
  ticker: string,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<ProviderResult[]> {
  const providers = enabledProviders();
  return Promise.all(
    providers.map(async (p): Promise<ProviderResult> => {
      const signal = AbortSignal.timeout(timeoutMs);
      const at = Math.floor(Date.now() / 1000);
      try {
        const quote = await p.quote(ticker, signal);
        record(p.name, true, at);
        return quote;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        record(p.name, false, at, error);
        return { source: p.name, ticker, error };
      }
    }),
  );
}

/**
 * Normalise results into the observations the guards consume.
 *
 * A provider that does not report genuine print times has its timestamp
 * erased here rather than at the guard. It may contribute a price to the
 * median; it may not make a stale feed look fresh.
 */
export function toObservations(results: readonly ProviderResult[]): SourceObservation[] {
  const byName = new Map(PROVIDERS.map((p) => [p.name, p]));
  return results.filter(isQuote).map((q) => {
    const provider = byName.get(q.source);
    return {
      source: q.source,
      price: q.price,
      lastTradeTime: provider?.reportsPrintTime ? q.lastTradeTime : null,
      feed: provider?.feed ?? q.source,
    };
  });
}
