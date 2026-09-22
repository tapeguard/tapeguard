/** Common shape every price provider normalises to. */
export interface ProviderQuote {
  source: string;
  ticker: string;
  price: number;
  /**
   * Unix seconds of the print this provider reports, or null when it does
   * not report a genuine print time. A source without one may contribute a
   * price but must never establish freshness.
   */
  lastTradeTime: number | null;
}

export interface ProviderError {
  source: string;
  ticker: string;
  error: string;
}

export type ProviderResult = ProviderQuote | ProviderError;

export const isQuote = (r: ProviderResult): r is ProviderQuote => !("error" in r);

export interface PriceProvider {
  readonly name: string;
  /** True when the provider reports genuine exchange print times. */
  readonly reportsPrintTime: boolean;
  /**
   * The underlying market data feed, not the vendor selling it.
   *
   * Counting vendors overstates independence. Several cheap providers
   * resell the same IEX tape, and three vendors agreeing on one feed is one
   * source wearing three hats: the median cannot outvote a bad print they
   * all inherited, and their cross-source spread is zero for the same
   * reason a single source's is. Declaring the feed lets the registry count
   * what actually matters.
   */
  readonly feed: string;
  readonly enabled: boolean;
  quote(ticker: string, signal: AbortSignal): Promise<ProviderQuote>;
}

/**
 * Default per-provider timeout.
 *
 * Eight seconds, not four. Providers are fetched in parallel, so this bounds
 * one round rather than accumulating across the universe — and four seconds
 * was aggressive enough that an ordinarily slow provider timed out on about
 * half of reads, which surfaced as SINGLE_SOURCE on rows that had two
 * perfectly good sources. Dropping a source to save four seconds is the
 * wrong trade when the whole product is about having two.
 */
export const PROVIDER_TIMEOUT_MS = 8000;

/** Distinct underlying feeds among a set of providers. */
export const distinctFeeds = (providers: readonly PriceProvider[]): number =>
  new Set(providers.map((p) => p.feed)).size;
