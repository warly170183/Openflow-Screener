import { EventEmitter } from "node:events";
import { createTerminalStore } from "@/lib/store/terminalStore";
import { MarketDataManager } from "@/lib/managers/marketDataManager";
import type { BaseExchangeAdapter } from "@/lib/adapters/base";
import type { NormalizedOrderBook, NormalizedTrade, Venue } from "@/lib/types/market";

class FakeAdapter extends EventEmitter {
  readonly venue: Venue = "okx-futures";
  readonly symbol = "BTC-USDT-SWAP";
  connectCalls = 0;
  disconnectCalls = 0;

  connect(): void {
    this.connectCalls += 1;
    this.emit("status", {
      venue: this.venue,
      status: "live",
      lastHeartbeat: Date.now(),
      reconnectAttempts: 0,
    });
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  pushTrade(trade: NormalizedTrade): void {
    this.emit("trade", trade);
  }

  pushBook(book: NormalizedOrderBook): void {
    this.emit("orderbook", book);
  }
}

let activeFake: FakeAdapter | null = null;
const releaseSpy = jest.fn();

jest.mock("@/lib/session/adapterPool", () => ({
  acquireAdapter: jest.fn(() => {
    activeFake = new FakeAdapter();
    activeFake.connect();
    return activeFake as unknown as BaseExchangeAdapter;
  }),
  releaseAdapter: jest.fn((...args: unknown[]) => {
    releaseSpy(...args);
    activeFake?.disconnect();
  }),
}));

function makeTrade(id: string, timestamp: number, price: number, quantity = 1): NormalizedTrade {
  return {
    id,
    venue: "okx-futures",
    symbol: "BTC-USDT-SWAP",
    timestamp,
    localTimestamp: timestamp + 5,
    price,
    quantity,
    quoteVolume: price * quantity,
    side: "buy",
    marketType: "perpetual",
  };
}

describe("timeframe switching & data preservation", () => {
  beforeEach(() => {
    activeFake = null;
    releaseSpy.mockClear();
  });

  it("preserves live market state when setTimeframe changes timeframe in terminalStore", () => {
    const store = createTerminalStore();
    const t = Date.UTC(2026, 10, 15, 10, 0, 0);
    store.getState().applyMarketDataBatch({
      trades: [makeTrade("t1", t, 90000, 2)],
      orderBook: {
        venue: "okx-futures",
        symbol: "BTC-USDT-SWAP",
        timestamp: t,
        localTimestamp: t,
        bids: [{ price: 89990, size: 5, venue: "okx-futures" }],
        asks: [{ price: 90010, size: 4, venue: "okx-futures" }],
      },
      aggregatedBook: null,
      candle: null,
      volumeProfile: null,
      ticker: {
        venue: "okx-futures",
        symbol: "BTC-USDT-SWAP",
        price: 90000,
        open: 89900,
        high: 90000,
        low: 89900,
        change: 100,
        changePct: 0.11,
        volume: 2,
        timestamp: t,
      },
      obi: { timestamp: t, value: 0.12, bidVolume: 5, askVolume: 4 },
      obiPricePoints: [{ time: t, obi: 0.12, price: 90000 }],
      flowBars: [],
      liveBar: null,
      session: null,
      connections: [{ venue: "okx-futures", status: "live", lastHeartbeat: t, reconnectAttempts: 0 }],
      liquidations: [],
      derivatives: null,
      oiPoints: [],
      bigTrades: [],
      clock: t,
      depthVersion: 0,
      microEvents: [],
      venueBuckets: null,
    });

    store.getState().setTimeframe("1m");
    expect(store.getState().timeframe).toBe("1m");
    expect(store.getState().recentTrades).toHaveLength(1);
    expect(store.getState().orderBook?.bids[0]?.price).toBe(89990);
    expect(store.getState().obiPriceHistory).toHaveLength(1);
    expect(store.getState().connections["okx-futures"]?.status).toBe("live");
  });

  it("re-aggregates buffered trades across timeframes without disconnecting the live adapter", () => {
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);

    try {
      manager.subscribe("okx-futures", "BTCUSDT", "perpetual", "5m", 10, 3, ["okx-futures"]);
      expect(activeFake).not.toBeNull();
      const adapter = activeFake!;

      const base = Date.UTC(2026, 10, 15, 10, 0, 0);
      adapter.pushBook({
        venue: "okx-futures",
        symbol: "BTC-USDT-SWAP",
        timestamp: base,
        localTimestamp: base,
        bids: [{ price: 90000, size: 3, venue: "okx-futures" }],
        asks: [{ price: 90010, size: 2, venue: "okx-futures" }],
      });
      // Three trades across 10:00, 10:01, and 10:02 (all inside one 5m candle, three 1m candles)
      adapter.pushTrade(makeTrade("1", base + 10_000, 90000, 1));
      adapter.pushTrade(makeTrade("2", base + 70_000, 90020, 2));
      adapter.pushTrade(makeTrade("3", base + 130_000, 90040, 1.5));
      manager.flushNow();

      expect(store.getState().candles).toHaveLength(0);
      const c5m = store.getState().currentCandle!;
      expect(c5m.closeTime - c5m.openTime + 1).toBe(300_000);
      expect(c5m.volume).toBeCloseTo(4.5);

      // Switch to 1m: must keep the adapter connected and build 2 completed + 1 live candle
      store.getState().setTimeframe("1m");
      manager.subscribe("okx-futures", "BTCUSDT", "perpetual", "1m", store.getState().tickSize, 3, ["okx-futures"]);

      expect(adapter.disconnectCalls).toBe(0);
      expect(releaseSpy).not.toHaveBeenCalled();
      expect(store.getState().timeframe).toBe("1m");
      expect(store.getState().candles).toHaveLength(2);
      expect(store.getState().candles[0].openTime).toBe(base);
      expect(store.getState().candles[1].openTime).toBe(base + 60_000);
      const c1m = store.getState().currentCandle!;
      expect(c1m.openTime).toBe(base + 120_000);
      expect(c1m.closeTime - c1m.openTime + 1).toBe(60_000);
      expect(store.getState().orderBook?.bids[0]?.price).toBe(90000);

      // Out-of-order older trade (10:00:30) merges chronologically without corrupting latest candle
      adapter.pushTrade(makeTrade("0-early", base + 30_000, 89980, 0.5));
      manager.flushNow();
      expect(store.getState().candles).toHaveLength(2);
      expect(store.getState().candles[0].openTime).toBe(base);
      expect(store.getState().candles[0].volume).toBeCloseTo(1.5);
      expect(store.getState().currentCandle?.openTime).toBe(base + 120_000);

      // Switch to 15m: all 4 trades merge into 1 live 15m candle
      store.getState().setTimeframe("15m");
      manager.subscribe("okx-futures", "BTCUSDT", "perpetual", "15m", store.getState().tickSize, 3, ["okx-futures"]);

      expect(adapter.disconnectCalls).toBe(0);
      expect(store.getState().candles).toHaveLength(0);
      const c15m = store.getState().currentCandle!;
      expect(c15m.closeTime - c15m.openTime + 1).toBe(900_000);
      expect(c15m.volume).toBeCloseTo(5.0);
    } finally {
      manager.disconnect();
    }
  });
});
