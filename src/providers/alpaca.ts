/**
 * Alpaca market data, free tier.
 *
 * Reports a genuine exchange print time on every trade, which makes it the
 * most useful free corroborating source for halt detection. The free tier
 * is IEX only — see `feed` below, and `FEEDS` in types.ts for why that
 * matters more than the source count.
 */

import type { PriceProvider, ProviderQuote } from "./types.ts";

const KEY = process.env["ALPACA_API_KEY"] ?? "";
const SECRET = process.env["ALPACA_API_SECRET"] ?? "";

interface LatestTrade {
  trade?: { t?: string; p?: number };
}

export const alpaca: PriceProvider = {
  name: "alpaca",
  reportsPrintTime: true,
  // The free tier serves IEX, which is a single venue carrying a few percent
  // of consolidated volume. Declared so the registry can tell two vendors
  // apart from two feeds.
  feed: process.env["ALPACA_FEED"] ?? "iex",
  enabled: KEY !== "" && SECRET !== "",

  async quote(ticker: string, signal: AbortSignal): Promise<ProviderQuote> {
    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(ticker)}/trades/latest`,
      {
        headers: { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET },
        signal,
      },
    );
    if (!res.ok) throw new Error(`alpaca HTTP ${res.status}`);
    const body = (await res.json()) as LatestTrade;
    const price = body.trade?.p;
    const stamp = body.trade?.t;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error(`alpaca gave no usable price for ${ticker}`);
    }
    const parsed = stamp ? Math.floor(Date.parse(stamp) / 1000) : Number.NaN;
    return {
      source: "alpaca",
      ticker,
      price,
      lastTradeTime: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    };
  },
};
