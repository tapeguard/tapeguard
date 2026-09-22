/**
 * Consensus across price sources.
 *
 * Median, not mean: one source misquoting by a factor of ten moves a mean
 * and cannot move a median past its neighbours.
 */

export interface PricePoint {
  source: string;
  price: number;
}

export interface Consensus {
  price: number;
  sourceCount: number;
  /** Widest gap between any two sources, in bps of the median. */
  maxDeviationBps: number;
  sources: string[];
}

export function consensus(points: readonly PricePoint[]): Consensus | null {
  const usable = points.filter((p) => Number.isFinite(p.price) && p.price > 0);
  if (usable.length === 0) return null;

  const prices = usable.map((p) => p.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const price =
    prices.length % 2 === 1
      ? (prices[mid] as number)
      : ((prices[mid - 1] as number) + (prices[mid] as number)) / 2;

  const lo = prices[0] as number;
  const hi = prices[prices.length - 1] as number;
  const maxDeviationBps = usable.length > 1 ? ((hi - lo) / price) * 10_000 : 0;

  return {
    price,
    sourceCount: usable.length,
    maxDeviationBps,
    sources: usable.map((p) => p.source),
  };
}
