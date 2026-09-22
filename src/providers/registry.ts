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

export async function fetchAll(
  ticker: string,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<ProviderResult[]> {
  const providers = enabledProviders();
  return Promise.all(
    providers.map(async (p): Promise<ProviderResult> => {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        return await p.quote(ticker, signal);
      } catch (err) {
        return {
          source: p.name,
          ticker,
          error: err instanceof Error ? err.message : String(err),
        };
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
