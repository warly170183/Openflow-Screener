// ============================================================
// LIQUIDITY LEVELS & ORDER BOOK WALL EXTRACTOR
// Aggregates live L2 Order Book bids and asks into price-tick
// clusters, detects statistical liquidity walls (vs median size),
// and filters levels near an active trade setup or chart range.
// ============================================================

import type { AggregatedOrderBook, NormalizedOrderBook } from "@/lib/types/market";

export interface LiquidityLevel {
  id: string;
  price: number;
  size: number;
  notionalUsd: number;
  side: "bid" | "ask";
  isWall: boolean;
  strengthRatio: number;
  shareOfMax: number;
  distancePct: number;
}

export interface ExtractedLiquidity {
  bids: LiquidityLevel[];
  asks: LiquidityLevel[];
  all: LiquidityLevel[];
  medianSize: number;
  wallThreshold: number;
  maxSize: number;
}

export interface ExtractLiquidityOptions {
  book: NormalizedOrderBook | AggregatedOrderBook | null;
  referencePrice: number;
  tickSize: number;
  maxPerSide?: number;
  minPrice?: number;
  maxPrice?: number;
  wallsOnly?: boolean;
}

function roundToPrecision(value: number, step: number): number {
  if (!(step > 0)) return value;
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step)) + 2));
  return Number(value.toFixed(decimals));
}

function aggregateSide(
  levels: readonly { price: number; size: number }[],
  side: "bid" | "ask",
  step: number
): { price: number; size: number }[] {
  const map = new Map<number, number>();
  for (const lvl of levels) {
    if (!(lvl.price > 0) || !(lvl.size > 0)) continue;
    const bucketIdx =
      side === "bid"
        ? Math.floor((lvl.price + 1e-12) / step)
        : Math.ceil((lvl.price - 1e-12) / step);
    const bucketPrice = roundToPrecision(bucketIdx * step, step);
    map.set(bucketPrice, (map.get(bucketPrice) ?? 0) + lvl.size);
  }
  return [...map.entries()].map(([price, size]) => ({ price, size }));
}

export function extractLiquidityLevels(options: ExtractLiquidityOptions): ExtractedLiquidity {
  const {
    book,
    referencePrice,
    tickSize,
    maxPerSide = 5,
    minPrice,
    maxPrice,
    wallsOnly = false,
  } = options;

  if (!book || (!book.bids.length && !book.asks.length)) {
    return { bids: [], asks: [], all: [], medianSize: 0, wallThreshold: 0, maxSize: 0 };
  }

  const ref =
    referencePrice > 0
      ? referencePrice
      : ((book.bids[0]?.price ?? 0) + (book.asks[0]?.price ?? 0)) / 2 ||
        book.bids[0]?.price ||
        book.asks[0]?.price ||
        0;

  if (!(ref > 0)) {
    return { bids: [], asks: [], all: [], medianSize: 0, wallThreshold: 0, maxSize: 0 };
  }

  const step = tickSize > 0 ? tickSize : Math.max(1e-6, ref * 0.0005);
  const rawBids = aggregateSide(book.bids, "bid", step);
  const rawAsks = aggregateSide(book.asks, "ask", step);

  const allSizes = [...rawBids, ...rawAsks]
    .map((l) => l.size)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);

  if (!allSizes.length) {
    return { bids: [], asks: [], all: [], medianSize: 0, wallThreshold: 0, maxSize: 0 };
  }

  const medianSize = allSizes[Math.floor(allSizes.length / 2)] || 0;
  const p90 = allSizes[Math.floor(allSizes.length * 0.9)] ?? 0;
  const wallThreshold =
    allSizes.length >= 25 ? Math.max(medianSize * 3.2, p90) : medianSize * 3.2;

  const inBounds = (price: number) => {
    if (minPrice !== undefined && price < minPrice) return false;
    if (maxPrice !== undefined && price > maxPrice) return false;
    return true;
  };

  const mapLevel = (lvl: { price: number; size: number }, side: "bid" | "ask"): LiquidityLevel => {
    const isWall = medianSize > 0 ? lvl.size >= wallThreshold : false;
    const strengthRatio = medianSize > 0 ? lvl.size / medianSize : 1;
    return {
      id: `${side}-${lvl.price}`,
      price: lvl.price,
      size: lvl.size,
      notionalUsd: lvl.price * lvl.size,
      side,
      isWall,
      strengthRatio,
      shareOfMax: 0,
      distancePct: ((lvl.price - ref) / ref) * 100,
    };
  };

  const bidCandidates = rawBids
    .filter((l) => inBounds(l.price))
    .map((l) => mapLevel(l, "bid"))
    .filter((l) => (!wallsOnly ? true : l.isWall))
    .sort((a, b) => b.size - a.size)
    .slice(0, maxPerSide);

  const askCandidates = rawAsks
    .filter((l) => inBounds(l.price))
    .map((l) => mapLevel(l, "ask"))
    .filter((l) => (!wallsOnly ? true : l.isWall))
    .sort((a, b) => b.size - a.size)
    .slice(0, maxPerSide);

  const combined = [...bidCandidates, ...askCandidates];
  const maxSize = combined.reduce((m, l) => Math.max(m, l.size), 0) || 1;
  for (const lvl of combined) {
    lvl.shareOfMax = lvl.size / maxSize;
  }

  const bids = [...bidCandidates].sort((a, b) => b.price - a.price);
  const asks = [...askCandidates].sort((a, b) => a.price - b.price);
  const all = [...combined].sort((a, b) => b.price - a.price);

  return {
    bids,
    asks,
    all,
    medianSize,
    wallThreshold,
    maxSize,
  };
}
