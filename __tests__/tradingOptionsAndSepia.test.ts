import { THEMES, THEME_OPTIONS, isLightTheme, resolveTheme } from "@/lib/theme";
import {
  DEFAULT_RISK_PCT,
  computeBollingerSeries,
  evaluateTradingOptions,
  mergeOhlcSeries,
  type OhlcBar,
} from "@/lib/engine/tradingOptions";
import {
  ARCH_CAPABILITY_SUITES,
  ARCH_CHANGELOG,
  ARCH_EDGES,
  ARCH_NODES,
  CADENCE_METRICS,
  TRACE_STEPS,
} from "@/lib/architecture/model";
import { createEmptyCandle } from "@/lib/engine/orderFlowEngine";
import { createSessionStats } from "@/lib/engine/analytics";

function makeBars(count: number, basePrice = 95000, volatility = 220, drift = 45): OhlcBar[] {
  const start = 1_700_000_100_000;
  const bars: OhlcBar[] = [];
  let px = basePrice;
  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i * 0.45) * (volatility * 0.4);
    const open = px;
    const close = px + drift + wave;
    const high = Math.max(open, close) + volatility * 0.6;
    const low = Math.min(open, close) - volatility * 0.55;
    bars.push({
      openTime: start + i * 300_000,
      open,
      high,
      low,
      close,
      volume: 100 + (i % 7) * 15,
    });
    px = close;
  }
  return bars;
}

describe("Sepia theme & architecture integrity", () => {
  it("registers sepia in THEMES, THEME_OPTIONS, and treats it as a light theme", () => {
    expect(THEMES.sepia).toBeDefined();
    expect(THEMES.sepia["--bg-base"]).toBe("#efe6d5");
    expect(THEMES.sepia["--text-primary"]).toBe("#2b2015");
    expect(THEME_OPTIONS.some((t) => t.value === "sepia" && t.mode === "light")).toBe(true);
    expect(resolveTheme("sepia")).toBe("sepia");
    expect(isLightTheme("sepia")).toBe(true);
  });

  it("keeps architecture nodes, edges, trace steps, cadence metrics, capability suites, and changelog links valid", () => {
    const nodeIds = new Set(ARCH_NODES.map((n) => n.id));
    for (const edge of ARCH_EDGES) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }
    for (const step of TRACE_STEPS) {
      expect(nodeIds.has(step.nodeId)).toBe(true);
    }
    for (const metric of CADENCE_METRICS) {
      expect(nodeIds.has(metric.nodeId)).toBe(true);
    }
    for (const entry of ARCH_CHANGELOG) {
      expect(nodeIds.has(entry.nodeId)).toBe(true);
      expect(entry.files.length).toBeGreaterThan(0);
    }
    expect(ARCH_CAPABILITY_SUITES.length).toBeGreaterThanOrEqual(5);
    for (const suite of ARCH_CAPABILITY_SUITES) {
      expect(nodeIds.has(suite.nodeId)).toBe(true);
      expect(suite.capabilities.length).toBeGreaterThan(0);
    }
  });
});

describe("Trading Options technical engine (ATR + Bollinger + 2-3% Risk)", () => {
  it("defaults riskPct to 2.5% (within 2-3% initial range) and computes valid Entry, SL, TP1, TP2", () => {
    expect(DEFAULT_RISK_PCT).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_RISK_PCT).toBeLessThanOrEqual(3);

    const bars = makeBars(40, 95000, 260, 35);
    const lastPrice = bars[bars.length - 1].close;
    const session = createSessionStats(bars[0].openTime, lastPrice);
    session.buyVolume = 620;
    session.sellVolume = 380;
    session.volume = 1000;
    session.vwap = lastPrice - 180;
    session.vwapStd = 140;

    const result = evaluateTradingOptions({
      symbol: "BTCUSDT",
      marketType: "perpetual",
      timeframe: "15m",
      currentPrice: lastPrice,
      tickSize: 10,
      bars,
      session,
      volumeProfile: null,
      currentOBI: 0.25,
      flowBars: [],
      derivatives: null,
      accountBalanceUsd: 10_000,
    });

    expect(result.ready).toBe(true);
    expect(result.volatility).not.toBeNull();
    expect(result.volatility!.atr).toBeGreaterThan(0);
    expect(result.volatility!.bollinger.upper).toBeGreaterThan(result.volatility!.bollinger.middle);
    expect(result.volatility!.bollinger.middle).toBeGreaterThan(result.volatility!.bollinger.lower);
    expect(result.options).toHaveLength(2);

    for (const opt of result.options) {
      expect(opt.riskPct).toBe(DEFAULT_RISK_PCT);
      expect(opt.riskUsd).toBeCloseTo(250, 4);
      if (opt.direction === "long") {
        expect(opt.stopLoss).toBeLessThan(opt.entry);
        expect(opt.tp1).toBeGreaterThan(opt.entry);
        expect(opt.tp2).toBeGreaterThan(opt.tp1);
      } else {
        expect(opt.stopLoss).toBeGreaterThan(opt.entry);
        expect(opt.tp1).toBeLessThan(opt.entry);
        expect(opt.tp2).toBeLessThan(opt.tp1);
      }
    }
  });

  it("widens Stop Loss distance when ATR & Bollinger volatility increases", () => {
    const lowVolBars = makeBars(35, 3000, 12, 0);
    const highVolBars = makeBars(35, 3000, 120, 0);

    const lowRes = evaluateTradingOptions({
      symbol: "ETHUSDT",
      marketType: "perpetual",
      timeframe: "5m",
      currentPrice: lowVolBars[lowVolBars.length - 1].close,
      tickSize: 0.5,
      bars: lowVolBars,
      session: null,
      volumeProfile: null,
      currentOBI: 0,
      flowBars: [],
      derivatives: null,
    });

    const highRes = evaluateTradingOptions({
      symbol: "ETHUSDT",
      marketType: "perpetual",
      timeframe: "5m",
      currentPrice: highVolBars[highVolBars.length - 1].close,
      tickSize: 0.5,
      bars: highVolBars,
      session: null,
      volumeProfile: null,
      currentOBI: 0,
      flowBars: [],
      derivatives: null,
    });

    expect(highRes.volatility!.stopDistance).toBeGreaterThan(lowRes.volatility!.stopDistance * 3);
  });

  it("scales riskUsd and position size proportionally when user adjusts riskPct", () => {
    const bars = makeBars(30, 50000, 200, 10);
    const price = bars[bars.length - 1].close;

    const r2 = evaluateTradingOptions({
      symbol: "BTCUSDT",
      marketType: "perpetual",
      timeframe: "5m",
      currentPrice: price,
      tickSize: 5,
      bars,
      session: null,
      volumeProfile: null,
      currentOBI: 0.1,
      flowBars: [],
      derivatives: null,
      riskPct: 2,
      accountBalanceUsd: 20_000,
    });

    const r4 = evaluateTradingOptions({
      symbol: "BTCUSDT",
      marketType: "perpetual",
      timeframe: "5m",
      currentPrice: price,
      tickSize: 5,
      bars,
      session: null,
      volumeProfile: null,
      currentOBI: 0.1,
      flowBars: [],
      derivatives: null,
      riskPct: 4,
      accountBalanceUsd: 20_000,
    });

    expect(r2.options[0].riskUsd).toBeCloseTo(400, 4);
    expect(r4.options[0].riskUsd).toBeCloseTo(800, 4);
    expect(r4.options[0].positionNotionalUsd).toBeCloseTo(r2.options[0].positionNotionalUsd * 2, 4);
    expect(r4.options[0].stopLoss).toBe(r2.options[0].stopLoss);
  });

  it("merges historical OKX klines with live footprint candles cleanly", () => {
    const hist = makeBars(5, 90000, 100, 10);
    const live = createEmptyCandle(hist[4].openTime, "5m");
    live.open = hist[4].open;
    live.high = hist[4].high + 50;
    live.low = hist[4].low;
    live.close = hist[4].close + 25;
    live.volume = hist[4].volume + 10;

    const merged = mergeOhlcSeries(hist, [], live, "5m");
    expect(merged).toHaveLength(5);
    expect(merged[4].high).toBe(hist[4].high + 50);
    expect(merged[4].close).toBe(hist[4].close + 25);

    const { current } = computeBollingerSeries(merged, 20, 2);
    expect(current).not.toBeNull();
    expect(current!.samples).toBe(5);
  });
});
