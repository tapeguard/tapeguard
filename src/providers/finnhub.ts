/**
 * Finnhub, free tier.
 *
 * `t` is the quote timestamp rather than a guaranteed last-print time, and
 * on the free tier it can carry the poll time on a quiet symbol. It is
 * therefore admitted as a price but NOT as a freshness witness: see
 * `reportsPrintTime` below.
 *
 * That distinction is the whole reason halt detection works. A vendor that
 * stamps a stale quote with the current clock makes a frozen tape look
 * live, which is precisely the failure the halt guard exists to catch.
 */

import type { PriceProvider, ProviderQuote } from "./types.ts";

const KEY = process.env["FINNHUB_API_KEY"] ?? "";

interface FinnhubQuote {
  c?: number;
  pc?: number;
  t?: number;
}

export const finnhub: PriceProvider = {
  name: "finnhub",
  // Deliberately false on the free tier. Set FINNHUB_PRINT_TIME=true only
  // after verifying against a paid plan that `t` moves with the tape and
  // not with the request.
  reportsPrintTime: process.env["FINNHUB_PRINT_TIME"] === "true",
  feed: process.env["FINNHUB_FEED"] ?? "finnhub",
  enabled: KEY !== "",

  async quote(ticker: string, signal: AbortSignal): Promise<ProviderQuote> {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${KEY}`,
      { signal },
    );
    if (!res.ok) throw new Error(`finnhub HTTP ${res.status}`);
    const body = (await res.json()) as FinnhubQuote;
    const price = body.c;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error(`finnhub gave no usable price for ${ticker}`);
    }
    return {
      source: "finnhub",
      ticker,
      price,
      lastTradeTime: typeof body.t === "number" && body.t > 0 ? body.t : null,
    };
  },
};
