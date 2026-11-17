import type { OBIPricePoint } from "@/lib/types/market";

export const OBI_ROLLING_WINDOW_MS = 30 * 60_000;

export const OBI_ROLLING_RESOLUTIONS = [
  { value: 5, label: "5s" },
  { value: 15, label: "15s" },
  { value: 60, label: "1m" },
] as const;

export type OBIRollingResolution = (typeof OBI_ROLLING_RESOLUTIONS)[number]["value"];

export interface RollingOBIPoint {
  time: number;
  label: string;
  obi: number;
  rollingObi: number;
  price: number;
  windowSamples: number;
}

export interface RollingOBISummary {
  currentRollingObi: number | null;
  currentSpotObi: number | null;
  delta5m: number | null;
  priceChangePct: number | null;
  coverageMs: number;
  coverageRatio: number;
  sampleCount: number;
  bias: "bid-support" | "ask-pressure" | "balanced";
}

function formatAxisTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/**
 * Bucket raw 1-second OBI+Price samples into `bucketSec` display points,
 * while computing the exact time-weighted 30-minute rolling mean OBI from
 * the full trailing window `[t - windowMs, t]` at each point.
 */
export function buildRollingObiSeries(
  samples: readonly OBIPricePoint[],
  bucketSec: number = 5,
  windowMs: number = OBI_ROLLING_WINDOW_MS
): { points: RollingOBIPoint[]; summary: RollingOBISummary } {
  if (!samples.length) {
    return {
      points: [],
      summary: {
        currentRollingObi: null,
        currentSpotObi: null,
        delta5m: null,
        priceChangePct: null,
        coverageMs: 0,
        coverageRatio: 0,
        sampleCount: 0,
        bias: "balanced",
      },
    };
  }

  const ordered = [...samples].sort((a, b) => a.time - b.time);
  const bucketMs = Math.max(1, bucketSec) * 1000;

  // Group into display buckets so Recharts stays responsive over 30-60 min windows.
  const buckets: Array<{
    time: number;
    obiSum: number;
    obiCount: number;
    price: number;
  }> = [];

  for (const sample of ordered) {
    const bucketTime = Math.floor(sample.time / bucketMs) * bucketMs;
    const prev = buckets[buckets.length - 1];
    if (!prev || prev.time !== bucketTime) {
      buckets.push({
        time: bucketTime,
        obiSum: sample.obi,
        obiCount: 1,
        price: sample.price,
      });
    } else {
      prev.obiSum += sample.obi;
      prev.obiCount += 1;
      prev.price = sample.price;
    }
  }

  // Two-pointer sliding window over full ordered 1s samples for true 30m mean OBI.
  const points: RollingOBIPoint[] = [];
  let left = 0;
  let right = 0;
  let sum = 0;

  for (const bucket of buckets) {
    const endTime = bucket.time + bucketMs - 1;
    const startTime = endTime - windowMs;
    while (right < ordered.length && ordered[right].time <= endTime) {
      sum += ordered[right].obi;
      right++;
    }
    while (left < right && ordered[left].time < startTime) {
      sum -= ordered[left].obi;
      left++;
    }
    const windowSamples = Math.max(1, right - left);
    const rollingObi = sum / windowSamples;
    points.push({
      time: bucket.time,
      label: formatAxisTime(bucket.time),
      obi: bucket.obiSum / bucket.obiCount,
      rollingObi,
      price: bucket.price,
      windowSamples,
    });
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const lastPoint = points[points.length - 1];
  const coverageMs = Math.max(0, last.time - first.time);
  const coverageRatio = Math.min(1, coverageMs / windowMs);
  const priceChangePct = first.price > 0 ? ((last.price - first.price) / first.price) * 100 : null;

  const target5m = lastPoint.time - 5 * 60_000;
  let ref5m: RollingOBIPoint | null = null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].time <= target5m) {
      ref5m = points[i];
      break;
    }
  }
  const delta5m = ref5m ? lastPoint.rollingObi - ref5m.rollingObi : null;

  const bias: RollingOBISummary["bias"] =
    lastPoint.rollingObi > 0.08
      ? "bid-support"
      : lastPoint.rollingObi < -0.08
        ? "ask-pressure"
        : "balanced";

  return {
    points,
    summary: {
      currentRollingObi: lastPoint.rollingObi,
      currentSpotObi: last.obi,
      delta5m,
      priceChangePct,
      coverageMs,
      coverageRatio,
      sampleCount: ordered.length,
      bias,
    },
  };
}
