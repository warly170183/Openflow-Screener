import {
  analyzeWyckoffCycle,
  projectHistoricalCycleOverlay,
  WYCKOFF_CANONICAL_CURVE,
} from "@/lib/engine/wyckoff";
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

    expect(res.avgVolume).toBeGreaterThan(120);
    expect(res.climaxThresholdVolume).toBeCloseTo(res.avgVolume * 1.5, 6);
    expect(res.climaxBarCount).toBeGreaterThanOrEqual(1);
    expect(res.correlatedClimaxCount).toBeGreaterThanOrEqual(1);
    const springSeriesBar = res.series.find((s) => s.marker?.code === "Spring");
    expect(springSeriesBar?.isClimax).toBe(true);
    expect(springSeriesBar?.effortLabel).toMatch(/Clímax|Pico Climático|Churn/);
  });

  it("flags high-volume churn bars with compressed candle body even below 1.5x spike", () => {
    const basePrices = [
      100, 102, 104, 106, 108, 110, 112, 114, 116, 115.5,
      115.2, 115.4, 115.1, 115.3, 115.0, 115.2, 115.1, 115.0,
    ];
    const bars = buildSeries(basePrices, 100);
    // Inject high-volume churn bar (1.35x volume, big wicks, tiny body)
    const churnIdx = bars.length - 4;
    bars[churnIdx].open = 115.1;
    bars[churnIdx].close = 115.12;
    bars[churnIdx].high = 117.2;
    bars[churnIdx].low = 113.8;
    bars[churnIdx].volume = 138;

    const res = analyzeWyckoffCycle({
      bars,
      livePrice: 115.0,
      session: null,
      volumeProfile: null,
      currentOBI: -0.2,
    });

    expect(res.ready).toBe(true);
    expect(res.series[churnIdx].isChurn).toBe(true);
    expect(res.series[churnIdx].isClimax).toBe(true);
    expect(res.climaxBarCount).toBeGreaterThanOrEqual(1);
    expect(res.windowStartTime).toBe(bars[0].openTime);
    expect(res.windowEndTime).toBe(bars[bars.length - 1].openTime);
  });

  it("calculates MACD(12,26,9), momentum bias, and bullish crossover when price reverses upward", () => {
    // 25 downtrending bars followed by 12 strong upward bars to guarantee positive MACD crossover
    const down = Array.from({ length: 24 }, (_, i) => 120 - i * 0.8);
    const up = Array.from({ length: 12 }, (_, i) => 101.6 + i * 1.6);
    const bars = buildSeries([...down, ...up], 140);

    const res = analyzeWyckoffCycle({
      bars,
      livePrice: up[up.length - 1] + 0.5,
      session: null,
      volumeProfile: null,
      currentOBI: 0.3,
    });

    expect(res.ready).toBe(true);
    expect(res.windowStartTime).toBe(bars[0].openTime);
    expect(res.windowEndTime).toBe(bars[bars.length - 1].openTime);
    expect(res.macdBias).toBe("bullish");
    expect(res.macdCurrent).toBeGreaterThan(res.macdSignalCurrent);
    expect(res.macdHistogramCurrent).toBeGreaterThan(0);
    expect(res.macdCrossCount).toBeGreaterThanOrEqual(1);
    expect(res.series.some((s) => s.macdCross === "bullish")).toBe(true);
    expect(res.macdMomentumLabel).toMatch(/Alcista/);
  });

  it("computes historical phase durations in hours/days and cycle maturity across multi-phase history", () => {
    // Construct a full multi-stage sequence: downtrend -> accumulation base -> markup rally -> distribution top
    const drop = Array.from({ length: 14 }, (_, i) => 120 - i * 1.4);
    const accum = [100.4, 102.0, 100.6, 102.2, 100.8, 102.1, 100.9, 101.8, 101.0, 102.3];
    const markup = Array.from({ length: 14 }, (_, i) => 103 + i * 1.3);
    const distrib = [120.5, 119.2, 120.8, 119.4, 120.6, 119.1, 120.3, 119.0];
    const bars = buildSeries([...drop, ...accum, ...markup, ...distrib], 150);

    const res = analyzeWyckoffCycle({
      bars,
      livePrice: 119.1,
      session: null,
      volumeProfile: null,
      currentOBI: -0.2,
    });

    expect(res.ready).toBe(true);
    expect(res.phaseDurations).toHaveLength(4);
    expect(res.historySpanMs).toBe(bars.length * 300_000);
    expect(res.currentPhaseElapsedMs).toBeGreaterThan(0);
    expect(res.currentPhaseAvgMs).toBeGreaterThan(0);
    expect(res.currentPhaseMaturityPct).toBeGreaterThan(0);
    expect(res.cycleMaturityLabel).toMatch(/Temprana|En desarrollo|Avanzada|Madura/);

    const active = res.phaseDurations.find((p) => p.isCurrent);
    expect(active).toBeDefined();
    expect(active?.stage).toBe(res.macroStage);
    expect(active?.maturityPct).toBe(res.currentPhaseMaturityPct);

    const populated = res.phaseDurations.filter((p) => p.occurrences > 0);
    expect(populated.length).toBeGreaterThanOrEqual(2);
    for (const p of populated) {
      expect(p.avgDurationMs).toBeGreaterThan(0);
      expect(p.avgDurationHours).toBeCloseTo(p.avgDurationMs / 3_600_000, 6);
      expect(p.avgDurationDays).toBeCloseTo(p.avgDurationMs / 86_400_000, 6);
    }
  });

  it("extracts historicalCycles sorted with same-stage first and projects anchored overlays", () => {
    const drop1 = Array.from({ length: 10 }, (_, i) => 120 - i * 1.3);
    const accum1 = [107.0, 108.4, 107.2, 108.5, 107.3, 108.2, 107.4, 108.0];
    const markup1 = Array.from({ length: 10 }, (_, i) => 109 + i * 1.2);
    const distrib1 = [120.0, 118.6, 120.2, 118.8, 120.1, 118.5, 119.8, 118.4];
    const drop2 = Array.from({ length: 8 }, (_, i) => 117.5 - i * 1.1);
    const accum2 = [109.2, 110.4, 109.4, 110.2, 109.5, 110.3];
    const bars = buildSeries(
      [...drop1, ...accum1, ...markup1, ...distrib1, ...drop2, ...accum2],
      145
    );

    const res = analyzeWyckoffCycle({
      bars,
      livePrice: 110.3,
      session: null,
      volumeProfile: null,
      currentOBI: 0.12,
    });

    expect(res.ready).toBe(true);
    expect(res.historicalCycles.length).toBeGreaterThanOrEqual(2);

    const firstMatchIdx = res.historicalCycles.findIndex((c) => c.matchesCurrentStage);
    if (firstMatchIdx !== -1) {
      expect(firstMatchIdx).toBe(0);
    }

    for (const cycle of res.historicalCycles) {
      expect(cycle.barCount).toBeGreaterThanOrEqual(3);
      expect(cycle.normalizedCloses[0]).toBe(1);
      expect(cycle.curveMappedValues).toHaveLength(WYCKOFF_CANONICAL_CURVE.length);
      expect(cycle.curveMappedValues.some((v) => v !== null)).toBe(true);
    }

    const chosen = res.historicalCycles[0];
    const projection = projectHistoricalCycleOverlay(res, chosen);
    expect(projection).not.toBeNull();
    expect(projection!.anchorIndex).toBe(res.currentPhaseStartIndex);
    expect(projection!.structureOverlay).toHaveLength(res.series.length);
    expect(projection!.curveOverlay).toHaveLength(WYCKOFF_CANONICAL_CURVE.length);
    expect(projection!.structureOverlay[projection!.anchorIndex]).toBeCloseTo(
      res.series[projection!.anchorIndex].close,
      6
    );
    expect(projection!.maturityVsSelectedPct).toBeGreaterThan(0);
    expect(Number.isFinite(projection!.currentReturnPct)).toBe(true);
    expect(Number.isFinite(projection!.historicalReturnAtSameStepPct)).toBe(true);
  });

  it("calculates phase-specific Volume Profile (POC & 70% Value Area) for each identified Wyckoff phase", () => {
    const drop = Array.from({ length: 14 }, (_, i) => 120 - i * 1.4);
    const accum = [100.4, 102.0, 100.6, 102.2, 100.8, 102.1, 100.9, 101.8, 101.0, 102.3];
    const markup = Array.from({ length: 14 }, (_, i) => 103 + i * 1.3);
    const distrib = [120.5, 119.2, 120.8, 119.4, 120.6, 119.1, 120.3, 119.0];
    const bars = buildSeries([...drop, ...accum, ...markup, ...distrib], 150);

    // Concentrate volume in the middle of Accumulation range
    const accumMidIdx = drop.length + 4;
    bars[accumMidIdx].volume = 1200;

    const res = analyzeWyckoffCycle({
      bars,
      livePrice: 119.1,
      session: null,
      volumeProfile: null,
      currentOBI: -0.2,
    });

    expect(res.ready).toBe(true);
    expect(res.phaseVolumeProfiles.length).toBeGreaterThanOrEqual(2);
    expect(res.phaseVolumeProfiles.some((vp) => vp.isCurrent)).toBe(true);

    for (const vp of res.phaseVolumeProfiles) {
      expect(vp.bins).toHaveLength(20);
      expect(vp.totalVolume).toBeGreaterThan(0);
      expect(vp.poc).toBeGreaterThanOrEqual(vp.val);
      expect(vp.poc).toBeLessThanOrEqual(vp.vah);
      expect(vp.val).toBeGreaterThanOrEqual(vp.rangeLow - 1e-6);
      expect(vp.vah).toBeLessThanOrEqual(vp.rangeHigh + 1e-6);
      expect(vp.valueAreaPct).toBeGreaterThanOrEqual(70);
      expect(vp.bins.filter((b) => b.isPOC)).toHaveLength(1);
      expect(vp.bins[0].priceMid).toBeGreaterThan(vp.bins[vp.bins.length - 1].priceMid);
    }
  });

  it("computes Trend Strength (ADX) to distinguish strong trends vs range-bound Wyckoff phases", () => {
    // 1. Sustained monotonic trend -> high ADX (>= 25), bullish +DI > -DI
    const trendBars = buildSeries(
      Array.from({ length: 40 }, (_, i) => 100 + i * 1.4),
      150
    );
    const trendRes = analyzeWyckoffCycle({
      bars: trendBars,
      livePrice: 156,
      session: null,
      volumeProfile: null,
      currentOBI: 0.3,
    });
    expect(trendRes.ready).toBe(true);
    expect(trendRes.adxCurrent).toBeGreaterThanOrEqual(25);
    expect(["trending", "strong-trend"]).toContain(trendRes.adxRegime);
    expect(trendRes.plusDiCurrent).toBeGreaterThan(trendRes.minusDiCurrent);
    expect(trendRes.adxDirection).toBe("bullish");
    expect(trendRes.series.every((pt) => pt.adx >= 0 && pt.adx <= 100)).toBe(true);

    // 2. Oscillating lateral range (multi-bar swings up & down) -> lower ADX (< 25 / range-bound)
    const swingWave = [100.0, 100.9, 101.7, 102.2, 101.3, 100.4, 99.6, 100.5];
    const rangePrices = Array.from({ length: 40 }, (_, i) => swingWave[i % swingWave.length]);
    const rangeBars = buildSeries(rangePrices, 120);
    const rangeRes = analyzeWyckoffCycle({
      bars: rangeBars,
      livePrice: 100.5,
      session: null,
      volumeProfile: null,
      currentOBI: 0,
    });
    expect(rangeRes.ready).toBe(true);
    expect(rangeRes.adxCurrent).toBeLessThan(trendRes.adxCurrent);
    expect(rangeRes.adxCurrent).toBeLessThan(25);
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
    expect(res.phaseDurations).toEqual([]);
    expect(res.historicalCycles).toEqual([]);
    expect(res.phaseVolumeProfiles).toEqual([]);
    expect(res.climaxBarCount).toBe(0);
    expect(res.macdCrossCount).toBe(0);
    expect(res.adxCurrent).toBe(0);
    expect(res.curvePoints).toHaveLength(WYCKOFF_CANONICAL_CURVE.length);
    expect(projectHistoricalCycleOverlay(res, null)).toBeNull();
  });
});
