import { extractLiquidityLevels } from "@/lib/engine/liquidityLevels";
import type { NormalizedOrderBook } from "@/lib/types/market";

function makeSampleBook(): NormalizedOrderBook {
  return {
    venue: "okx-futures",
    symbol: "BTCUSDT",
    timestamp: 1_700_000_000_000,
    localTimestamp: 1_700_000_000_050,
    bids: [
      { price: 94000, size: 2.1 },
      { price: 93950, size: 2.4 },
      { price: 93900, size: 18.5 }, // strong wall
      { price: 93850, size: 1.9 },
      { price: 93800, size: 2.0 },
      { price: 93600, size: 14.0 }, // secondary wall
      { price: 91000, size: 50.0 }, // far away order outside tight trade range
    ],
    asks: [
      { price: 94050, size: 2.0 },
      { price: 94100, size: 2.3 },
      { price: 94200, size: 22.0 }, // strong ask wall
      { price: 94250, size: 1.8 },
      { price: 94350, size: 11.5 }, // secondary ask wall
      { price: 94500, size: 2.2 },
      { price: 98000, size: 65.0 }, // far away ask wall
    ],
  };
}

describe("extractLiquidityLevels", () => {
  it("extracts strongest bid/ask liquidity pools and flags walls above median threshold", () => {
    const book = makeSampleBook();
    const res = extractLiquidityLevels({
      book,
      referencePrice: 94025,
      tickSize: 10,
      maxPerSide: 4,
    });

    expect(res.bids.length).toBeGreaterThanOrEqual(2);
    expect(res.asks.length).toBeGreaterThanOrEqual(2);
    expect(res.medianSize).toBeGreaterThan(0);

    const wallPrices = res.all.filter((l) => l.isWall).map((l) => l.price);
    expect(wallPrices).toContain(93900);
    expect(wallPrices).toContain(94200);
  });

  it("filters liquidity pools to the nearby price bounds around a trade setup", () => {
    const book = makeSampleBook();
    const nearby = extractLiquidityLevels({
      book,
      referencePrice: 94025,
      tickSize: 10,
      maxPerSide: 3,
      minPrice: 93500,
      maxPrice: 94600,
    });

    // Distant walls at 91000 and 98000 must be excluded
    expect(nearby.all.some((l) => l.price === 91000)).toBe(false);
    expect(nearby.all.some((l) => l.price === 98000)).toBe(false);
    expect(nearby.bids.map((b) => b.price)).toContain(93900);
    expect(nearby.asks.map((a) => a.price)).toContain(94200);
    expect(nearby.asks[0].distancePct).toBeGreaterThan(0);
    expect(nearby.bids[0].distancePct).toBeLessThan(0);
  });

  it("supports wallsOnly mode and empty books gracefully", () => {
    const empty = extractLiquidityLevels({
      book: null,
      referencePrice: 94000,
      tickSize: 10,
    });
    expect(empty.all).toEqual([]);

    const book = makeSampleBook();
    const walls = extractLiquidityLevels({
      book,
      referencePrice: 94025,
      tickSize: 10,
      maxPerSide: 5,
      wallsOnly: true,
    });
    expect(walls.all.length).toBeGreaterThan(0);
    expect(walls.all.every((l) => l.isWall)).toBe(true);
  });
});
