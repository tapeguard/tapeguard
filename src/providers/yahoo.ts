/**
 * Yahoo Finance, via the public chart endpoint.
 *
 * Needs no key and reports a real `regularMarketTime`, which makes it the
 * best free source for establishing freshness. It is NOT licensed for
 * commercial redistribution, so it is a development source and a
 * cross-check, never the sole basis of a production feed. Add a licensed
 * vendor before anything settles money against this.
 */

import type { PriceProvider, ProviderQuote } from "./types.ts";
import type { CorporateAction } from "../lib/guards/corpaction.ts";
import { sessionAt } from "../lib/session.ts";

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0 (compatible; tapeguard/0.1; +https://tapeguard.xyz)";

interface ChartMeta {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  chartPreviousClose?: number;
  exchangeTimezoneName?: string;
}

interface SplitEvent {
  date: number;
  numerator: number;
  denominator: number;
  splitRatio: string;
}

interface ChartResult {
  meta?: ChartMeta;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
  events?: { splits?: Record<string, SplitEvent> };
}

async function chart(
  ticker: string,
  query: string,
  signal: AbortSignal,
): Promise<ChartResult> {
  const res = await fetch(`${BASE}/${encodeURIComponent(ticker)}?${query}`, {
    headers: { "User-Agent": UA },
    signal,
  });
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status}`);
  const body = (await res.json()) as { chart?: { result?: ChartResult[]; error?: unknown } };
  const result = body.chart?.result?.[0];
  if (!result) throw new Error(`yahoo returned no result for ${ticker}`);
  return result;
}

export const yahoo: PriceProvider = {
  name: "yahoo",
  reportsPrintTime: true,
  // Yahoo aggregates across venues rather than reselling one, so it is its
  // own feed for independence purposes.
  feed: process.env["YAHOO_FEED"] ?? "yahoo",
  enabled: process.env["YAHOO_ENABLED"] !== "false",

  async quote(ticker: string, signal: AbortSignal): Promise<ProviderQuote> {
    const r = await chart(ticker, "interval=1d&range=5d", signal);
    const price = r.meta?.regularMarketPrice;
    const time = r.meta?.regularMarketTime;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error(`yahoo gave no usable price for ${ticker}`);
    }
    return {
      source: "yahoo",
      ticker,
      price,
      lastTradeTime: typeof time === "number" && time > 0 ? time : null,
    };
  },
};

/**
 * The close of the last completed regular session.
 *
 * Resolved against our own calendar rather than by taking the last element
 * of the array. During regular hours the final daily candle is *today's*
 * bar in progress, and its `close` field is the current price — so taking
 * the last element hands back today's price as yesterday's close, and every
 * gap measured against it is zero. The bug is invisible outside market
 * hours, which is when most testing happens.
 */
export async function previousClose(
  ticker: string,
  signal: AbortSignal,
  now: number = Math.floor(Date.now() / 1000),
): Promise<number> {
  const r = await chart(ticker, "interval=1d&range=10d", signal);
  const stamps = r.timestamp ?? [];
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  if (stamps.length === 0) throw new Error(`yahoo gave no candles for ${ticker}`);

  // A daily candle is stamped at its session's open, so the bar belonging to
  // the last completed close is the newest one that opened before it.
  const target = sessionAt(now).previousRegularClose;
  let best: number | null = null;
  let bestStamp = -1;
  for (let i = 0; i < stamps.length; i++) {
    const t = stamps[i] as number;
    const c = closes[i];
    if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) continue;
    if (t <= target && t > bestStamp) {
      bestStamp = t;
      best = c;
    }
  }
  if (best === null) throw new Error(`yahoo had no completed session for ${ticker}`);
  return best;
}

/** Splits announced or applied in the recent past and near future. */
export async function corporateActions(
  ticker: string,
  signal: AbortSignal,
): Promise<CorporateAction[]> {
  const r = await chart(ticker, "interval=1d&range=1mo&events=div,splits", signal);
  const splits = r.events?.splits ?? {};
  const out: CorporateAction[] = [];

  for (const ev of Object.values(splits)) {
    const { numerator, denominator, date } = ev;
    if (!(numerator > 0) || !(denominator > 0) || !(date > 0)) continue;
    // An N:D split turns each old share into N/D new ones, so the price is
    // multiplied by D/N.
    const impliedRatio = denominator / numerator;
    out.push({
      ticker: ticker.toUpperCase(),
      effectiveAt: date,
      kind: numerator > denominator ? "split" : "reverse_split",
      impliedRatio,
      label:
        numerator > denominator
          ? `${numerator}:${denominator} forward split`
          : `${denominator}:${numerator} reverse split`,
      source: "yahoo",
    });
  }
  return out;
}
