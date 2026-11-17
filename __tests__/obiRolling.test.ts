import { buildRollingObiSeries, OBI_ROLLING_WINDOW_MS } from "@/lib/engine/obiRolling";
import type { OBIPricePoint } from "@/lib/types/market";

describe("buildRollingObiSeries", () => {
  it("returns empty series and balanced defaults when no samples exist", () => {
    const { points, summary } = buildRollingObiSeries([]);
    expect(points).toEqual([]);
    expect(summary.currentRollingObi).toBeNull();
    expect(summary.currentSpotObi).toBeNull();
    expect(summary.bias).toBe("balanced");
    expect(summary.coverageRatio).toBe(0);
  });

  it("computes true 30-minute sliding rolling average of OBI alongside price", () => {
    const start = Math.floor(1_700_000_000_000 / 60_000) * 60_000;
    const samples: OBIPricePoint[] = [];

    // First 20 minutes: negative OBI (-0.4), price 90000
    for (let s = 0; s < 20 * 60; s++) {
      samples.push({ time: start + s * 1000, obi: -0.4, price: 90_000 + s * 0.1 });
    }
    // Next 20 minutes: positive OBI (+0.6), price 91000+
    for (let s = 20 * 60; s < 40 * 60; s++) {
      samples.push({ time: start + s * 1000, obi: 0.6, price: 91_000 + (s - 1200) * 0.2 });
    }

    const { points, summary } = buildRollingObiSeries(samples, 60, OBI_ROLLING_WINDOW_MS);
    expect(points.length).toBe(40);
    // Early buckets in first 20m have rollingObi = -0.4
    expect(points[5].rollingObi).toBeCloseTo(-0.4, 5);
    // Final bucket at minute 40 looks back 30m (minutes 10..40): 10m of -0.4 + 20m of +0.6 => ~0.2667
    expect(summary.currentRollingObi).not.toBeNull();
    expect(summary.currentRollingObi!).toBeGreaterThan(0.24);
    expect(summary.currentRollingObi!).toBeLessThan(0.29);
    expect(summary.coverageRatio).toBe(1);
    expect(summary.bias).toBe("bid-support");
    expect(summary.delta5m).toBeGreaterThan(0);
    expect(summary.priceChangePct).toBeGreaterThan(0);
  });
});
