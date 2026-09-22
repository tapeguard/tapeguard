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

/** Default per-provider timeout. A slow upstream must not stall the feed. */
export const PROVIDER_TIMEOUT_MS = 4000;

/** Distinct underlying feeds among a set of providers. */
export const distinctFeeds = (providers: readonly PriceProvider[]): number =>
  new Set(providers.map((p) => p.feed)).size;
