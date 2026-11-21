import type { OhlcBar } from "@/lib/engine/tradingOptions";
import {
  computeAdxSnapshot,
  computeAdxTickTrajectory,
  updateBarsWithLivePrice,
} from "@/lib/engine/wyckoff";
import {
  DEFAULT_WATCHLIST_SYMBOLS,
  normalizeWatchlistSymbol,
  useUIStore,
} from "@/lib/store/uiStore";

function buildTrendingBars(count: number, direction: "up" | "down"): OhlcBar[] {
  const start = 1_700_000_000_000;
  const step = direction === "up" ? 85 : -85;
  const bars: OhlcBar[] = [];
  let px = direction === "up" ? 40_000 : 60_000;
  for (let i = 0; i < count; i++) {
    const open = px;
    const close = px + step;
    const high = Math.max(open, close) + 18;
    const low = Math.min(open, close) - 12;
    bars.push({
      openTime: start + i * 900_000,
      open,
      high,
      low,
      close,
      volume: 150 + i * 3,
    });
    px = close;
  }
  return bars;
}

function buildRangeBars(count: number): OhlcBar[] {
  const start = 1_700_000_000_000;
  const bars: OhlcBar[] = [];
  for (let i = 0; i < count; i++) {
    const swing = i % 2 === 0 ? 45 : -45;
    const open = 50_000;
    const close = 50_000 + swing;
    bars.push({
      openTime: start + i * 900_000,
      open,
      high: 50_080,
      low: 49_920,
      close,
      volume: 100,
    });
  }
  return bars;
}

describe("Real-Time ADX Watchlist Scanner Engine", () => {
  it("classifies sustained directional moves as trending/strong-trend with accurate DI polarity", () => {
    const bullBars = buildTrendingBars(45, "up");
    const bearBars = buildTrendingBars(45, "down");

    const bullSnap = computeAdxSnapshot(bullBars, undefined, 14);
    const bearSnap = computeAdxSnapshot(bearBars, undefined, 14);

    expect(bullSnap.adx).toBeGreaterThanOrEqual(40);
    expect(bullSnap.regime).toBe("strong-trend");
    expect(bullSnap.direction).toBe("bullish");
    expect(bullSnap.plusDi).toBeGreaterThan(bullSnap.minusDi);
    expect(bullSnap.recentAdx).toHaveLength(5);

    expect(bearSnap.adx).toBeGreaterThanOrEqual(40);
    expect(bearSnap.regime).toBe("strong-trend");
    expect(bearSnap.direction).toBe("bearish");
    expect(bearSnap.minusDi).toBeGreaterThan(bearSnap.plusDi);
    expect(bearSnap.recentAdx).toHaveLength(5);
  });

  it("classifies choppy sideways action as range-bound below ADX 20", () => {
    const rangeBars = buildRangeBars(45);
    const snap = computeAdxSnapshot(rangeBars, undefined, 14);

    expect(snap.adx).toBeLessThan(20);
    expect(snap.regime).toBe("range-bound");
    expect(snap.direction).toBe("neutral");
  });

  it("immutably merges live SSE tick price into trailing bar and updates ADX snapshot", () => {
    const baseBars = buildTrendingBars(40, "up");
    const lastBefore = { ...baseBars[baseBars.length - 1] };
    const spikedPrice = lastBefore.high + 650;

    const updated = updateBarsWithLivePrice(baseBars, spikedPrice);
    expect(updated).not.toBe(baseBars);
    expect(updated[updated.length - 1].close).toBe(spikedPrice);
    expect(updated[updated.length - 1].high).toBe(spikedPrice);
    // Original bar remains untouched
    expect(baseBars[baseBars.length - 1]).toEqual(lastBefore);

    const liveSnap = computeAdxSnapshot(baseBars, spikedPrice, 14);
    expect(liveSnap.barsCount).toBe(baseBars.length);
    expect(liveSnap.adx).toBeGreaterThan(25);
  });

  it("computes increasing, decreasing, and flat ADX sparkline trajectories over the last 5 ticks", () => {
    const rising = computeAdxTickTrajectory([21.2, 22.0, 22.8, 23.4, 24.1]);
    expect(rising.points).toEqual([21.2, 22.0, 22.8, 23.4, 24.1]);
    expect(rising.trend).toBe("increasing");
    expect(rising.netChange).toBeCloseTo(2.9, 4);
    expect(rising.lastStepChange).toBeCloseTo(0.7, 4);

    const falling = computeAdxTickTrajectory([31.0, 36.2, 35.1, 34.4, 33.6, 32.8]);
    // Keeps strictly the trailing 5 ticks
    expect(falling.points).toEqual([36.2, 35.1, 34.4, 33.6, 32.8]);
    expect(falling.trend).toBe("decreasing");
    expect(falling.netChange).toBeCloseTo(-3.4, 4);

    const flat = computeAdxTickTrajectory([18.4, 18.42, 18.41, 18.43, 18.42]);
    expect(flat.trend).toBe("flat");
  });

  it("normalizes OKX swap & spot tickers and toggles persisted watchlist symbols cleanly", () => {
    expect(normalizeWatchlistSymbol("btc-usdt-swap")).toBe("BTCUSDT");
    expect(normalizeWatchlistSymbol("sol")).toBe("SOLUSDT");
    expect(normalizeWatchlistSymbol("eth-usdt")).toBe("ETHUSDT");

    useUIStore.getState().resetWatchlist();
    expect(useUIStore.getState().watchlistSymbols).toEqual(DEFAULT_WATCHLIST_SYMBOLS);

    useUIStore.getState().toggleWatchlistSymbol("PEPE-USDT-SWAP");
    expect(useUIStore.getState().watchlistSymbols).toContain("PEPEUSDT");

    useUIStore.getState().toggleWatchlistSymbol("PEPEUSDT");
    expect(useUIStore.getState().watchlistSymbols).not.toContain("PEPEUSDT");

    useUIStore.getState().resetWatchlist();
  });
});
