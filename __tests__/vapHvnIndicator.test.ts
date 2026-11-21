import {
  analyzeHighVolumeNodes,
  analyzeVolumeProfileSR,
  applyTradeToCandle,
  computeVolumeProfile,
  createEmptyCandle,
} from "@/lib/engine/orderFlowEngine";
import { DEFAULT_INDICATORS, useUIStore } from "@/lib/store/uiStore";
import type { FootprintCandle, NormalizedTrade } from "@/lib/types/market";

function makeTrade(price: number, quantity: number, side: "buy" | "sell", ts = 1_700_000_000_000): NormalizedTrade {
  return {
    id: `hvn-${price}-${quantity}-${side}-${Math.random()}`,
    venue: "okx-futures",
    symbol: "BTC-USDT-SWAP",
    timestamp: ts,
    localTimestamp: ts,
    price,
    quantity,
    quoteVolume: price * quantity,
    side,
    marketType: "perpetual",
  };
}

function buildCandle(levels: Array<{ price: number; buy: number; sell: number }>): FootprintCandle {
  let candle = createEmptyCandle(1_700_000_000_000, "5m");
  for (const { price, buy, sell } of levels) {
    if (buy > 0) candle = applyTradeToCandle(candle, makeTrade(price, buy, "buy"), 10, 3);
    if (sell > 0) candle = applyTradeToCandle(candle, makeTrade(price, sell, "sell"), 10, 3);
  }
  return candle;
}

describe("Volume-at-Price HVN indicator", () => {
  test("identifies POC and secondary HVN clusters with contiguous zones", () => {
    const candle = buildCandle([
      { price: 65000, buy: 1, sell: 1 },   // 2
      { price: 65010, buy: 35, sell: 35 }, // 70 (secondary HVN)
      { price: 65020, buy: 40, sell: 40 }, // 80 (secondary HVN local peak)
      { price: 65030, buy: 3, sell: 2 },   // 5 (LVN gap)
      { price: 65040, buy: 4, sell: 4 },   // 8
      { price: 65050, buy: 50, sell: 50 }, // 100 (POC & local peak)
      { price: 65060, buy: 38, sell: 32 }, // 70 (POC cluster)
      { price: 65070, buy: 2, sell: 3 },   // 5
    ]);
    const profile = computeVolumeProfile([candle], 0.7);
    const analysis = analyzeHighVolumeNodes(profile, 0.65, 10);

    expect(analysis.pocVolume).toBeCloseTo(100);
    expect(analysis.thresholdVolume).toBeCloseTo(65);
    expect(analysis.nodes.map((n) => n.price)).toEqual([65010, 65020, 65050, 65060]);

    const secondaryPeak = analysis.nodeByPrice.get(65020)!;
    expect(secondaryPeak.isPoc).toBe(false);
    expect(secondaryPeak.isLocalPeak).toBe(true);
    expect(secondaryPeak.pocRatio).toBeCloseTo(0.8);

    const pocNode = analysis.nodeByPrice.get(65050)!;
    expect(pocNode.isPoc).toBe(true);
    expect(pocNode.isLocalPeak).toBe(true);

    // Two distinct clusters separated by the 65030-65040 LVN gap
    expect(analysis.zones).toHaveLength(2);
    expect(analysis.zones[0]).toMatchObject({
      startPrice: 65010,
      endPrice: 65020,
      peakPrice: 65020,
      levelCount: 2,
      containsPoc: false,
    });
    expect(analysis.zones[1]).toMatchObject({
      startPrice: 65050,
      endPrice: 65060,
      peakPrice: 65050,
      levelCount: 2,
      containsPoc: true,
    });
  });

  test("respects HVN threshold ratio sensitivity", () => {
    const candle = buildCandle([
      { price: 80, buy: 5, sell: 5 },    // 10
      { price: 90, buy: 5, sell: 5 },    // 10
      { price: 100, buy: 5, sell: 5 },   // 10
      { price: 110, buy: 28, sell: 27 }, // 55 (55% of POC)
      { price: 120, buy: 50, sell: 50 }, // 100 (POC)
      { price: 130, buy: 40, sell: 40 }, // 80 (80% of POC)
    ]);
    const profile = computeVolumeProfile([candle]);

    expect(analyzeHighVolumeNodes(profile, 0.5, 10).nodes.map((n) => n.price)).toEqual([110, 120, 130]);
    expect(analyzeHighVolumeNodes(profile, 0.75, 10).nodes.map((n) => n.price)).toEqual([120, 130]);
    expect(analyzeHighVolumeNodes(profile, 0.85, 10).nodes.map((n) => n.price)).toEqual([120]);
  });

  test("suppresses uniform flat profiles and handles empty inputs safely", () => {
    expect(analyzeHighVolumeNodes(null).nodes).toEqual([]);
    expect(analyzeHighVolumeNodes(undefined).zones).toEqual([]);

    const flat = computeVolumeProfile([
      buildCandle([
        { price: 100, buy: 5, sell: 5 },
        { price: 110, buy: 5, sell: 5 },
        { price: 120, buy: 5, sell: 5 },
        { price: 130, buy: 5, sell: 5 },
      ]),
    ]);
    expect(analyzeHighVolumeNodes(flat, 0.65, 10).nodes).toEqual([]);
  });

  test("classifies horizontal Volume Profile HVN zones into Support, Resistance, Pivot, and LVN", () => {
    const candle = buildCandle([
      { price: 64980, buy: 30, sell: 55 }, // 85 (deeper support)
      { price: 65000, buy: 1, sell: 2 },   // 3 (LVN)
      { price: 65020, buy: 25, sell: 60 }, // 85 (S1 nearest support)
      { price: 65040, buy: 2, sell: 2 },   // 4 (LVN)
      { price: 65060, buy: 55, sell: 45 }, // 100 (POC / pivot when price=65060)
      { price: 65080, buy: 3, sell: 2 },   // 5 (LVN)
      { price: 65100, buy: 62, sell: 28 }, // 90 (R1 nearest resistance)
      { price: 65120, buy: 2, sell: 1 },   // 3 (LVN)
      { price: 65140, buy: 50, sell: 25 }, // 75 (higher resistance)
    ]);
    const profile = computeVolumeProfile([candle], 0.7);
    const sr = analyzeVolumeProfileSR(profile, 65060, 0.65, 20);

    expect(sr.pivotZones).toHaveLength(1);
    expect(sr.pivotZones[0].peakPrice).toBe(65060);

    expect(sr.supportZones.map((z) => z.peakPrice)).toEqual([65020, 64980]);
    expect(sr.nearestSupport?.peakPrice).toBe(65020);
    expect(sr.nearestSupport?.role).toBe("support");
    expect(sr.nearestSupport!.distancePct).toBeLessThan(0);

    expect(sr.resistanceZones.map((z) => z.peakPrice)).toEqual([65100, 65140]);
    expect(sr.nearestResistance?.peakPrice).toBe(65100);
    expect(sr.nearestResistance?.role).toBe("resistance");
    expect(sr.nearestResistance!.distancePct).toBeGreaterThan(0);

    expect(sr.lvnLevels.map((l) => l.price)).toEqual([65000, 65040, 65080, 65120]);
    expect(sr.zoneByPrice.get(65020)?.role).toBe("support");
    expect(sr.zoneByPrice.get(65100)?.role).toBe("resistance");
    expect(sr.nearestSupport!.strength).toBeGreaterThan(50);
  });

  test("uiStore toggles HVN highlight, VP S/R, and threshold cleanly", () => {
    useUIStore.getState().resetIndicators();
    expect(useUIStore.getState().indicators.hvnHighlight).toBe(DEFAULT_INDICATORS.hvnHighlight);
    expect(useUIStore.getState().indicators.vpSupportResistance).toBe(true);
    expect(useUIStore.getState().indicators.hvnThreshold).toBe(0.65);

    useUIStore.getState().setIndicator("hvnHighlight", false);
    useUIStore.getState().setIndicator("vpSupportResistance", false);
    expect(useUIStore.getState().indicators.hvnHighlight).toBe(false);
    expect(useUIStore.getState().indicators.vpSupportResistance).toBe(false);

    useUIStore.getState().setIndicator("hvnHighlight", true);
    useUIStore.getState().setIndicator("vpSupportResistance", true);
    useUIStore.getState().setIndicator("hvnThreshold", 0.75);
    useUIStore.getState().setIndicator("hvnColor", "#ff9f43");

    expect(useUIStore.getState().indicators.hvnHighlight).toBe(true);
    expect(useUIStore.getState().indicators.vpSupportResistance).toBe(true);
    expect(useUIStore.getState().indicators.hvnThreshold).toBe(0.75);
    expect(useUIStore.getState().indicators.hvnColor).toBe("#ff9f43");

    useUIStore.getState().resetIndicators();
    expect(useUIStore.getState().indicators.hvnThreshold).toBe(0.65);
    expect(useUIStore.getState().indicators.vpSupportResistance).toBe(true);
    expect(useUIStore.getState().indicators.hvnColor).toBeNull();
  });
});
