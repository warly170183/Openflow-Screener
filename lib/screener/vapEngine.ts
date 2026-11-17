// ============================================================
// VOLUME-AT-PRICE (VAP) & IMBALANCE ENGINE
// Maintains a rolling, memory-bounded minute-slotted price ladder
// for each tracked instrument in the internal Screener service.
// Computes:
//   1. Volume-at-Price (POC, VAH, VAL, level distribution)
//   2. Horizontal Bid/Ask Imbalances (>= imbalanceThreshold, default 3x)
//   3. Stacked Imbalances (>= minStackedLevels consecutive levels)
// ============================================================

import { resolveTickSize } from "@/lib/engine/analytics";
import { roundToTick } from "@/lib/engine/orderFlowEngine";
import type { NormalizedTrade } from "@/lib/types/market";

export interface VapLevelSnapshot {
  price: number;
  bidVolume: number;
  askVolume: number;
  totalVolume: number;
  delta: number;
  imbalance: "ask" | "bid" | "neutral";
  isPoc: boolean;
}

export interface StackedImbalanceSummary {
  direction: "buy" | "sell";
  count: number;
  startPrice: number;
  endPrice: number;
}

export interface VapSummary {
  pocPrice: number | null;
  vahPrice: number | null;
  valPrice: number | null;
  pocDistancePct: number | null;
  pocVolume: number;
  askImbalances: number;
  bidImbalances: number;
  imbalanceNet: number;
  stackedImbalance: StackedImbalanceSummary | null;
  vapLevelsCount: number;
  vapLevels: VapLevelSnapshot[];
}

export interface VapOptions {
  /** Rolling window for POC / Value Area profile (ms). */
  vapWindowMs: number;
  /** Rolling window for aggressive Bid/Ask footprint imbalances (ms). */
  imbalanceWindowMs: number;
  /** Ratio required for a directional level imbalance (default 3x). */
  imbalanceThreshold: number;
  /** Minimum consecutive imbalanced price levels to form a stacked imbalance. */
  minStackedLevels: number;
  /** 70% Value Area fraction around POC. */
  valueAreaPct: number;
  /** Duration of each time slot in the rolling ladder (ms). */
  slotMs: number;
  /** Max VAP levels serialized per scan snapshot to keep SSE frames compact. */
  maxSnapshotLevels: number;
}

export const DEFAULT_VAP_OPTIONS: VapOptions = {
  vapWindowMs: 15 * 60_000,
  imbalanceWindowMs: 5 * 60_000,
  imbalanceThreshold: 3,
  minStackedLevels: 3,
  valueAreaPct: 0.7,
  slotMs: 60_000,
  maxSnapshotLevels: 12,
};

interface LevelAccumulator {
  bid: number;
  ask: number;
}

interface SlotBucket {
  time: number;
  levels: Map<number, LevelAccumulator>;
}

export class RollingVapTracker {
  private slots: SlotBucket[] = [];
  private tickSize = 0;
  private readonly opts: VapOptions;

  constructor(options: Partial<VapOptions> = {}) {
    this.opts = { ...DEFAULT_VAP_OPTIONS, ...options };
  }

  get resolvedTickSize(): number {
    return this.tickSize;
  }

  onTrade(trade: NormalizedTrade): void {
    if (!(trade.price > 0) || !(trade.quantity > 0)) return;
    if (this.tickSize <= 0) {
      this.tickSize = resolveTickSize(trade.price, "perpetual");
    }

    const slotTime = Math.floor(trade.timestamp / this.opts.slotMs) * this.opts.slotMs;
    let slot = this.slots[this.slots.length - 1];
    if (!slot || slot.time < slotTime) {
      slot = { time: slotTime, levels: new Map() };
      this.slots.push(slot);
    } else if (slotTime < slot.time) {
      // Late print: locate existing slot or fold into oldest/matching slot.
      const found = this.slots.find((s) => s.time === slotTime);
      if (found) {
        slot = found;
      } else {
        const cutoff = Math.max(this.opts.vapWindowMs, this.opts.imbalanceWindowMs);
        if (slotTime < slot.time - cutoff) return;
        slot = { time: slotTime, levels: new Map() };
        this.slots.push(slot);
        this.slots.sort((a, b) => a.time - b.time);
      }
    }

    const levelPrice = roundToTick(trade.price, this.tickSize);
    let acc = slot.levels.get(levelPrice);
    if (!acc) {
      acc = { bid: 0, ask: 0 };
      slot.levels.set(levelPrice, acc);
    }

    if (trade.side === "buy") {
      acc.ask += trade.quantity;
    } else {
      acc.bid += trade.quantity;
    }

    this.prune(trade.timestamp);
  }

  prune(now: number): void {
    const retention = Math.max(this.opts.vapWindowMs, this.opts.imbalanceWindowMs);
    const cutoff = Math.floor((now - retention) / this.opts.slotMs) * this.opts.slotMs;
    while (this.slots.length > 0 && this.slots[0].time < cutoff) {
      this.slots.shift();
    }
  }

  summary(now: number, currentPrice: number): VapSummary {
    this.prune(now);

    const vapCutoff = Math.floor((now - this.opts.vapWindowMs) / this.opts.slotMs) * this.opts.slotMs;
    const imbCutoff = Math.floor((now - this.opts.imbalanceWindowMs) / this.opts.slotMs) * this.opts.slotMs;

    const vapMap = new Map<number, LevelAccumulator>();
    const imbMap = new Map<number, LevelAccumulator>();

    for (const slot of this.slots) {
      const inVap = slot.time >= vapCutoff;
      const inImb = slot.time >= imbCutoff;
      if (!inVap && !inImb) continue;

      for (const [price, vol] of slot.levels) {
        if (inVap) {
          const existing = vapMap.get(price);
          if (existing) {
            existing.bid += vol.bid;
            existing.ask += vol.ask;
          } else {
            vapMap.set(price, { bid: vol.bid, ask: vol.ask });
          }
        }
        if (inImb) {
          const existing = imbMap.get(price);
          if (existing) {
            existing.bid += vol.bid;
            existing.ask += vol.ask;
          } else {
            imbMap.set(price, { bid: vol.bid, ask: vol.ask });
          }
        }
      }
    }

    if (vapMap.size === 0) {
      return {
        pocPrice: null,
        vahPrice: null,
        valPrice: null,
        pocDistancePct: null,
        pocVolume: 0,
        askImbalances: 0,
        bidImbalances: 0,
        imbalanceNet: 0,
        stackedImbalance: null,
        vapLevelsCount: 0,
        vapLevels: [],
      };
    }

    const vapPrices = [...vapMap.keys()].sort((a, b) => a - b);
    let totalVol = 0;
    let pocPrice = vapPrices[0];
    let pocVol = -1;

    for (const p of vapPrices) {
      const d = vapMap.get(p)!;
      const v = d.bid + d.ask;
      totalVol += v;
      if (v > pocVol) {
        pocVol = v;
        pocPrice = p;
      }
    }

    // 70% Value Area expansion around POC (matches orderFlowEngine.computeVolumeProfile).
    const target = totalVol * this.opts.valueAreaPct;
    let vahPrice = pocPrice;
    let valPrice = pocPrice;
    let accumulated = pocVol;
    let hi = vapPrices.indexOf(pocPrice);
    let lo = hi;

    while (accumulated < target && (hi < vapPrices.length - 1 || lo > 0)) {
      const nextHiVol = hi < vapPrices.length - 1
        ? (() => {
            const d = vapMap.get(vapPrices[hi + 1])!;
            return d.bid + d.ask;
          })()
        : 0;
      const nextLoVol = lo > 0
        ? (() => {
            const d = vapMap.get(vapPrices[lo - 1])!;
            return d.bid + d.ask;
          })()
        : 0;

      if (nextHiVol >= nextLoVol && hi < vapPrices.length - 1) {
        hi++;
        vahPrice = vapPrices[hi];
        accumulated += nextHiVol;
      } else if (lo > 0) {
        lo--;
        valPrice = vapPrices[lo];
        accumulated += nextLoVol;
      } else {
        break;
      }
    }

    // Imbalances & Stacked Imbalance detection over imbalanceWindowMs.
    const imbPrices = [...imbMap.keys()].sort((a, b) => a - b);
    const imbFlags = new Map<number, "ask" | "bid" | "neutral">();
    let askImbalances = 0;
    let bidImbalances = 0;

    for (const p of imbPrices) {
      const d = imbMap.get(p)!;
      const flag = classifyImbalance(d.bid, d.ask, this.opts.imbalanceThreshold);
      imbFlags.set(p, flag);
      if (flag === "ask") askImbalances++;
      else if (flag === "bid") bidImbalances++;
    }

    let stackedImbalance: StackedImbalanceSummary | null = null;
    let runDir: "buy" | "sell" | null = null;
    let runStartIdx = 0;
    let runCount = 0;

    const finalizeRun = (endIdx: number) => {
      if (runDir && runCount >= this.opts.minStackedLevels) {
        if (!stackedImbalance || runCount > stackedImbalance.count) {
          stackedImbalance = {
            direction: runDir,
            count: runCount,
            startPrice: imbPrices[runStartIdx],
            endPrice: imbPrices[endIdx],
          };
        }
      }
    };

    for (let i = 0; i < imbPrices.length; i++) {
      const flag = imbFlags.get(imbPrices[i]) ?? "neutral";
      if (flag === "neutral") {
        finalizeRun(i - 1);
        runDir = null;
        runCount = 0;
        continue;
      }
      const dir: "buy" | "sell" = flag === "ask" ? "buy" : "sell";
      if (dir === runDir) {
        runCount++;
      } else {
        finalizeRun(i - 1);
        runDir = dir;
        runStartIdx = i;
        runCount = 1;
      }
    }
    finalizeRun(imbPrices.length - 1);

    // Compact VAP snapshot centered around POC for transport/inspection.
    const pocIdx = vapPrices.indexOf(pocPrice);
    const maxLevels = Math.max(1, this.opts.maxSnapshotLevels);
    const half = Math.floor(maxLevels / 2);
    let sliceStart = Math.max(0, pocIdx - half);
    const sliceEnd = Math.min(vapPrices.length, sliceStart + maxLevels);
    sliceStart = Math.max(0, sliceEnd - maxLevels);

    const vapLevels: VapLevelSnapshot[] = vapPrices.slice(sliceStart, sliceEnd).map((price) => {
      const d = vapMap.get(price)!;
      const imbAcc = imbMap.get(price);
      return {
        price,
        bidVolume: d.bid,
        askVolume: d.ask,
        totalVolume: d.bid + d.ask,
        delta: d.ask - d.bid,
        imbalance: imbAcc
          ? classifyImbalance(imbAcc.bid, imbAcc.ask, this.opts.imbalanceThreshold)
          : classifyImbalance(d.bid, d.ask, this.opts.imbalanceThreshold),
        isPoc: price === pocPrice,
      };
    });

    const pocDistancePct =
      currentPrice > 0 && pocPrice > 0 ? (currentPrice - pocPrice) / pocPrice : null;

    return {
      pocPrice,
      vahPrice,
      valPrice,
      pocDistancePct,
      pocVolume: pocVol,
      askImbalances,
      bidImbalances,
      imbalanceNet: askImbalances - bidImbalances,
      stackedImbalance,
      vapLevelsCount: vapPrices.length,
      vapLevels,
    };
  }
}

function classifyImbalance(
  bidVolume: number,
  askVolume: number,
  threshold: number
): "ask" | "bid" | "neutral" {
  if (bidVolume > 0 && askVolume / bidVolume >= threshold) return "ask";
  if (askVolume > 0 && bidVolume / askVolume >= threshold) return "bid";
  return "neutral";
}
