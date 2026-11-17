import { analyzeWyckoffCycle, WYCKOFF_CANONICAL_CURVE } from "@/lib/engine/wyckoff";
import type { OhlcBar } from "@/lib/engine/tradingOptions";

function buildSeries(prices: number[], volumeBase = 100): OhlcBar[] {
  const start = 1_700_000_100_000;
  return prices.map((close, i) => {
    const open = i === 0 ? close : prices[i - 1];
    return {
      openTime: start + i * 300_000,
      open,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      close,
      volume: volumeBase,
    };
  });
}

describe("analyzeWyckoffCycle", () => {
  it("detects Markup (uptrend) when price breaks out above prior range with positive EMA slope", () => {
    const prices = [
      // Base range 100..104
      102, 100.5, 103.5, 101, 103.8, 101.2, 103.6, 101.5, 103.9, 102,
      103.2, 102.5, 103.8, 103.0, 104.2, 105.0, 106.2, 107.8, 109.5, 111.2,
    ];
    const bars = buildSeries(prices, 140);
    const res = analyzeWyckoffCycle({
      bars,
      livePrice: 112.0,
      session: null,
      volumeProfile: null,
      currentOBI: 0.25,
    });

    expect(res.ready).toBe(true);
    expect(res.macroStage).toBe("markup");
    expect(res.cycleStep).toBeGreaterThanOrEqual(6);
    expect(res.cycleStep).toBeLessThanOrEqual(11);
    expect(res.creekResistance).toBeGreaterThan(res.iceSupport);
    expect(res.markers.length).toBeGreaterThanOrEqual(3);
    expect(res.markers.some((m) => m.code === "JAC")).toBe(true);
    expect(res.curvePoints).toHaveLength(WYCKOFF_CANONICAL_CURVE.length);
    for (const pt of res.curvePoints) {
      expect(Number.isFinite(pt.price)).toBe(true);
      expect(pt.price).toBeGreaterThan(0);
      expect(pt.volume).toBeGreaterThan(0);
      expect(pt.time).toBeGreaterThan(0);
    }
  });

  it("detects Markdown (downtrend) when price breaks below Ice support with negative slope", () => {
    const prices = [
      // Distribution range 100..104 then breakdown
      101, 103.8, 101.2, 103.5, 101.0, 103.2, 101.4, 102.8, 101.1, 102.5,
      101.5, 100.8, 99.6, 98.4, 97.1, 95.8, 94.2, 92.8, 91.5, 90.2,
    ];
    const bars = buildSeries(prices, 150);
    const res = analyzeWyckoffCycle({
      bars,
      livePrice: 89.8,
      session: null,
      volumeProfile: null,
      currentOBI: -0.3,
    });

    expect(res.ready).toBe(true);
    expect(res.macroStage).toBe("markdown");
    expect(res.cycleStep).toBeGreaterThanOrEqual(18);
    expect(res.markers.length).toBeGreaterThanOrEqual(3);
    expect(res.markers.some((m) => m.code === "BC")).toBe(true);
    expect(res.markers.some((m) => m.code === "SOW")).toBe(true);
    const seriesWithMarkers = res.series.filter((s) => s.marker);
    expect(seriesWithMarkers.length).toBe(res.markers.length);
    for (const s of seriesWithMarkers) {
      expect(s.marker!.price).toBeGreaterThan(0);
      expect(s.marker!.volume).toBe(150);
      expect(s.marker!.time).toBe(s.time);
    }
  });

  it("detects Accumulation & Spring event after a prior drop followed by support sweep and reclaim", () => {
    const priorDrop = [120, 117, 114, 111, 108, 105, 102, 100, 99, 101];
    const baseRange = [99.2, 102.0, 99.5, 101.8, 99.4, 101.5, 99.6, 101.2, 99.5, 100.4];
    const bars = buildSeries([...priorDrop, ...baseRange], 120);
    // Inject a Spring sweep below 99.2 on bar -3 that reclaimed inside
    bars[bars.length - 3].low = 97.4;
    bars[bars.length - 3].volume = 360;
    bars[bars.length - 1].close = 100.8;

    const res = analyzeWyckoffCycle({
      bars,
      livePrice: 100.9,
      session: null,
      volumeProfile: null,
      currentOBI: 0.22,
    });

    expect(res.ready).toBe(true);
    expect(res.macroStage).toBe("accumulation");
    expect(res.springDetected).toBe(true);
    expect(res.eventBadge).toBe("Spring");
    expect(res.cycleStep).toBeLessThan(WYCKOFF_CANONICAL_CURVE.length);

    const springMarker = res.markers.find((m) => m.code === "Spring");
    expect(springMarker).toBeDefined();
    expect(springMarker!.price).toBe(97.4);
    expect(springMarker!.volume).toBe(360);
    expect(springMarker!.volumeRatio).toBeGreaterThan(2);
    expect(springMarker!.time).toBe(bars[bars.length - 3].openTime);

    const springCurvePt = res.curvePoints.find(
      (pt) => pt.stage === "accumulation" && pt.label === "Spring"
    );
    expect(springCurvePt?.detected).toBe(true);
    expect(springCurvePt?.price).toBe(97.4);
    expect(springCurvePt?.volume).toBe(360);
  });

  it("returns ready=false safely when fewer than 6 bars exist", () => {
    const bars = buildSeries([100, 101, 102]);
    const res = analyzeWyckoffCycle({
      bars,
      livePrice: 102,
      session: null,
      volumeProfile: null,
      currentOBI: 0,
    });
    expect(res.ready).toBe(false);
    expect(res.series).toEqual([]);
    expect(res.markers).toEqual([]);
    expect(res.curvePoints).toHaveLength(WYCKOFF_CANONICAL_CURVE.length);
  });
});
