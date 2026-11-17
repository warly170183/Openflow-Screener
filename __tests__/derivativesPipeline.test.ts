import { EventEmitter } from "events";
import type { Venue } from "@/lib/types/market";

// Fake adapters stand in for the WebSocket feeds so the manager → store
// pipeline can be driven deterministically.
const fakes = new Map<Venue, EventEmitter>();
jest.mock("@/lib/session/adapterPool", () => ({
  acquireAdapter: (venue: Venue) => {
    const adapter = new EventEmitter();
    fakes.set(venue, adapter);
    return adapter;
  },
  releaseAdapter: () => undefined,
}));

import { createTerminalStore } from "@/lib/store/terminalStore";
import { MarketDataManager } from "@/lib/managers/marketDataManager";

function trade(venue: Venue, price: number, timestamp: number) {
  return { id: `${venue}-${timestamp}`, venue, symbol: "BTCUSDT", timestamp, localTimestamp: timestamp, price, quantity: 1, quoteVolume: price, side: "buy", marketType: "perpetual" };
}

describe("derivatives pipeline", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
    fakes.clear();
  });
  afterEach(() => jest.useRealTimers());

  it("delivers liquidations, merged derivatives and sampled open interest to the store", () => {
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);
    const venues: Venue[] = ["okx-futures"];
    manager.subscribe("okx-futures", "BTCUSDT", "perpetual", "5m", 10, 3, venues);

    const okx = fakes.get("okx-futures")!;
    const now = Date.now();
    okx.emit("trade", trade("okx-futures", 50_000, now));
    okx.emit("liquidation", { id: "l1", venue: "okx-futures", symbol: "BTCUSDT", timestamp: now, localTimestamp: now, price: 49_900, quantity: 2, quoteVolume: 99_800, side: "long" });
    okx.emit("derivatives", { venue: "okx-futures", timestamp: now, openInterest: 100, fundingRate: 0.0001, markPrice: 50_010, indexPrice: 50_000 });
    okx.emit("derivatives", { venue: "okx-futures", timestamp: now + 1, nextFundingTime: now + 3_600_000 });
    jest.advanceTimersByTime(60);

    let state = store.getState();
    expect(state.liquidations).toHaveLength(1);
    expect(state.liquidations[0]).toMatchObject({ side: "long", quoteVolume: 99_800 });
    expect(state.derivatives).toMatchObject({ openInterest: 100, primaryFundingRate: 0.0001, nextFundingTime: now + 3_600_000 });
    expect(state.derivatives!.basisBps).toBeCloseTo(2);

    jest.advanceTimersByTime(1100);
    state = store.getState();
    expect(state.oiHistory.length).toBeGreaterThan(0);
    expect(state.oiHistory.at(-1)).toMatchObject({ openInterest: 100, price: 50_000 });
    expect(state.derivatives!.openInterest).toBe(100);

    // Ignores data when disconnected or switched to spot.
    manager.subscribe("okx-spot", "BTCUSDT", "spot", "5m", 10, 3, ["okx-spot"]);
    okx.emit("liquidation", { id: "stale", venue: "okx-futures", symbol: "BTCUSDT", timestamp: now, localTimestamp: now, price: 1, quantity: 1, quoteVolume: 1, side: "short" });
    jest.advanceTimersByTime(60);
    expect(store.getState().liquidations).toHaveLength(0);
    manager.disconnect();
  });

  it("drops replayed (stale) and duplicate liquidations", () => {
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);
    manager.subscribe("okx-futures", "BTCUSDT", "perpetual", "5m", 10, 3, ["okx-futures"]);
    const okx = fakes.get("okx-futures")!;
    const now = Date.now();
    const base = { venue: "okx-futures", symbol: "BTC-USDT-SWAP", localTimestamp: now, price: 100, quantity: 1, quoteVolume: 100, side: "short" };
    okx.emit("liquidation", { ...base, id: "old", timestamp: now - 9 * 3_600_000 });
    okx.emit("liquidation", { ...base, id: "fresh", timestamp: now - 1000 });
    okx.emit("liquidation", { ...base, id: "fresh", timestamp: now - 1000 });
    jest.advanceTimersByTime(60);
    expect(store.getState().liquidations.map((l) => l.id)).toEqual(["fresh"]);
    manager.disconnect();
  });

  it("samples depth each second and reports absorption to the store", () => {
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);
    manager.subscribe("okx-futures", "BTCUSDT", "perpetual", "1m", 10, 3, ["okx-futures"]);
    const okx = fakes.get("okx-futures")!;
    const t0 = Date.now();
    const book = (venue: string, bid: number) => ({ venue, symbol: "BTCUSDT", timestamp: t0, localTimestamp: t0, bids: [{ price: bid, size: 4 }], asks: [{ price: bid + 10, size: 3 }] });
    okx.emit("orderbook", book("okx-futures", 50_000));
    let n = 0;
    const emit = (price: number, quantity: number, side: "buy" | "sell", timestamp: number) =>
      okx.emit("trade", { ...trade("okx-futures", price, timestamp), id: `okx-${++n}`, quantity, quoteVolume: price * quantity, side });
    for (let w = 0; w < 7; w++) {
      for (let i = 0; i < 10; i++) emit(50_000 + (i % 2) * 10, 1, i % 2 ? "buy" : "sell", t0 + w * 10_000 + i * 500);
    }
    for (let i = 0; i < 40; i++) emit(50_000, 1, "sell", t0 + 70_000 + i * 100);
    emit(50_010, 1, "buy", t0 + 80_500);
    jest.advanceTimersByTime(2_100);

    const state = store.getState();
    expect(manager.depthHistory.size).toBeGreaterThan(0);
    expect(state.depthVersion).toBe(manager.depthHistory.version);
    const snap = manager.depthHistory.get(manager.depthHistory.lastSeq)!;
    const bidIndex = Math.round(50_000 / manager.depthHistory.tick);
    expect(snap.size[[...snap.index].indexOf(bidIndex)]).toBe(4);
    expect(state.microEvents.filter((e) => e.kind === "absorption").map((e) => [e.side, e.price])).toContainEqual(["bid", 50_000]);
    manager.disconnect();
    expect(manager.depthHistory.size).toBe(0);
  });

  it("does not sample open interest for spot markets", () => {
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);
    manager.subscribe("okx-spot", "BTCUSDT", "spot", "5m", 10, 3, ["okx-spot"]);
    fakes.get("okx-spot")!.emit("trade", { ...trade("okx-spot", 50_000, Date.now()), marketType: "spot" });
    jest.advanceTimersByTime(20_000);
    expect(store.getState().oiHistory).toHaveLength(0);
    manager.disconnect();
  });
});
