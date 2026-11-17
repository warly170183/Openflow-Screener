import { RollingVapTracker } from "@/lib/screener/vapEngine";
import { SymbolTracker } from "@/lib/screener/symbolTracker";
import type { NormalizedTrade } from "@/lib/types/market";
import { InternalScreenerService } from "../server/screenerService";
import { OkxMessageParser, type FeedSink } from "../server/okxFeed";

const T0 = Math.floor(1_700_000_000_000 / 60_000) * 60_000;
const SYMBOL = "BTC-USDT-SWAP";

let nextId = 0;
function makeTrade(
  timestamp: number,
  price: number,
  quantity: number,
  side: "buy" | "sell",
  symbol = SYMBOL
): NormalizedTrade {
  return {
    id: `vap-t-${++nextId}`,
    venue: "okx-futures",
    symbol,
    timestamp,
    localTimestamp: timestamp,
    price,
    quantity,
    quoteVolume: price * quantity,
    side,
    marketType: "perpetual",
  };
}

describe("RollingVapTracker", () => {
  it("computes Volume-at-Price POC, VAH, VAL and pocDistancePct", () => {
    const tracker = new RollingVapTracker();
    // Tick size for ~50000 perp is 5 (50000 * 0.0001 = 5).
    // Cluster heaviest volume at 50010, lighter tails at 50000, 50005, 50015, 50020.
    tracker.onTrade(makeTrade(T0 + 1000, 50000, 5, "sell"));
    tracker.onTrade(makeTrade(T0 + 2000, 50005, 10, "buy"));
    tracker.onTrade(makeTrade(T0 + 3000, 50010, 40, "buy"));
    tracker.onTrade(makeTrade(T0 + 4000, 50010, 30, "sell"));
    tracker.onTrade(makeTrade(T0 + 5000, 50015, 10, "buy"));
    tracker.onTrade(makeTrade(T0 + 6000, 50020, 5, "sell"));

    const summary = tracker.summary(T0 + 7000, 50020);
    expect(summary.pocPrice).toBe(50010);
    expect(summary.pocVolume).toBe(70);
    expect(summary.valPrice).toBeLessThanOrEqual(50010);
    expect(summary.vahPrice).toBeGreaterThanOrEqual(50010);
    expect(summary.pocDistancePct).toBeCloseTo((50020 - 50010) / 50010, 6);
    expect(summary.vapLevelsCount).toBe(5);
    expect(summary.vapLevels.some((l) => l.isPoc && l.price === 50010)).toBe(true);
  });

  it("detects Bid/Ask imbalances and consecutive stacked imbalances", () => {
    const tracker = new RollingVapTracker();
    // First print establishes tickSize = 5 for price ~50000
    // Build 3 consecutive ascending levels (50000, 50005, 50010) with >= 3x ask imbalance.
    for (const px of [50000, 50005, 50010]) {
      tracker.onTrade(makeTrade(T0 + 1000, px, 2, "sell"));
      tracker.onTrade(makeTrade(T0 + 1500, px, 8, "buy"));
    }
    // Add one sell-side imbalance away from the stack at 50020
    tracker.onTrade(makeTrade(T0 + 2000, 50020, 1, "buy"));
    tracker.onTrade(makeTrade(T0 + 2500, 50020, 5, "sell"));

    const summary = tracker.summary(T0 + 3000, 50010);
    expect(summary.askImbalances).toBe(3);
    expect(summary.bidImbalances).toBe(1);
    expect(summary.imbalanceNet).toBe(2);
    expect(summary.stackedImbalance).toEqual({
      direction: "buy",
      count: 3,
      startPrice: 50000,
      endPrice: 50010,
    });
  });

  it("prunes expired slots outside the rolling window", () => {
    const tracker = new RollingVapTracker({
      vapWindowMs: 5 * 60_000,
      imbalanceWindowMs: 2 * 60_000,
    });
    tracker.onTrade(makeTrade(T0, 100, 50, "buy"));
    tracker.onTrade(makeTrade(T0, 100, 10, "sell"));

    expect(tracker.summary(T0 + 60_000, 100).askImbalances).toBe(1);
    // After imbalance window (2m) expires, imbalance resets while 5m VAP still holds POC.
    const mid = tracker.summary(T0 + 3 * 60_000, 100);
    expect(mid.askImbalances).toBe(0);
    expect(mid.pocPrice).toBe(100);

    // Once beyond 5m VAP window, slot is pruned.
    const expired = tracker.summary(T0 + 7 * 60_000, 100);
    expect(expired.pocPrice).toBeNull();
    expect(expired.vapLevelsCount).toBe(0);
  });
});

describe("InternalScreenerService + SymbolTracker order flow pipeline", () => {
  it("processes simulated OKX WebSocket trade frames into VAP, imbalances, and volume z-scores", async () => {
    let sinkRef: FeedSink | null = null;
    let fakeNow = T0 + 930_000;
    const emitted: number[] = [];

    const service = new InternalScreenerService({
      disableTimers: true,
      store: null,
      now: () => fakeNow,
      loadSwaps: async () => ({
        symbols: [SYMBOL],
        contractValues: new Map([[SYMBOL, 0.01]]),
      }),
      createFeed: (_mode, swaps, sink) => {
        sinkRef = sink;
        return {
          start: () => undefined,
          stop: () => undefined,
          health: () => ({
            connected: true,
            lastMessageAt: fakeNow,
            reconnects: 0,
            symbols: swaps.symbols.length,
          }),
        };
      },
    });

    const unsub = service.subscribe((scan) => {
      emitted.push(scan.rows.length);
    });

    await service.start();
    expect(sinkRef).not.toBeNull();

    const parser = new OkxMessageParser(new Map([[SYMBOL, 0.01]]), sinkRef!, () => fakeNow);

    // Feed 15 minutes of baseline OKX trade messages (1/sec around 50000).
    for (let s = 0; s < 900; s++) {
      const ts = T0 + s * 1000;
      parser.handle(
        JSON.stringify({
          arg: { channel: "trades", instId: SYMBOL },
          data: [
            {
              tradeId: `base-${s}`,
              instId: SYMBOL,
              px: String(50000 + (s % 2) * 5),
              sz: String(90 + (s % 3) * 10),
              side: s % 2 === 0 ? "buy" : "sell",
              ts: String(ts),
            },
          ],
        })
      );
    }

    // Feed aggressive stacked buy breakout across 50010, 50015, 50020, 50025 (above baseline)
    for (let i = 0; i < 31; i++) {
      const ts = T0 + 900_000 + i * 1000;
      const px = 50010 + (i % 4) * 5;
      parser.handle(
        JSON.stringify({
          arg: { channel: "trades", instId: SYMBOL },
          data: [
            {
              tradeId: `burst-sell-${i}`,
              instId: SYMBOL,
              px: String(px),
              sz: "10",
              side: "sell",
              ts: String(ts),
            },
            {
              tradeId: `burst-buy-${i}`,
              instId: SYMBOL,
              px: String(px),
              sz: "5000",
              side: "buy",
              ts: String(ts + 100),
            },
          ],
        })
      );
    }

    fakeNow = T0 + 931_000;
    const scan = service.scanNow(fakeNow);
    unsub();

    expect(service.health()).toMatchObject({
      engine: "internal",
      mode: "okx",
      trackedSymbols: 1,
    });
    expect(emitted).toEqual([1]);
    expect(scan.rows).toHaveLength(1);

    const btc = scan.rows[0];
    expect(btc.symbol).toBe(SYMBOL);
    expect(btc.pocPrice).not.toBeNull();
    expect(btc.vahPrice).not.toBeNull();
    expect(btc.valPrice).not.toBeNull();
    expect(btc.askImbalances).toBeGreaterThanOrEqual(3);
    expect(btc.stackedImbalance?.direction).toBe("buy");
    expect(btc.volumeZ).not.toBeNull();
    expect(btc.volumeZ!).toBeGreaterThan(2.5);

    await service.stop();
  });

  it("SymbolTracker includes VAP and imbalance fields in metrics even on minimal activity", () => {
    const tracker = new SymbolTracker(SYMBOL);
    tracker.onTrade(makeTrade(T0, 100, 5, "buy"));
    const m = tracker.metrics(T0 + 1000);
    expect(m.pocPrice).toBe(100);
    expect(m.vahPrice).toBe(100);
    expect(m.valPrice).toBe(100);
    expect(m.askImbalances).toBe(0);
    expect(m.bidImbalances).toBe(0);
    expect(m.stackedImbalance).toBeNull();
    expect(m.volumeZ).toBeNull();
  });
});
