// ============================================================
// WYCKOFF MARKET CYCLE DETECTOR & ANALYZER
// Evaluates live OHLCV bars + Order Flow (OBI, Delta, POC)
// to determine the asset's current position in the 4-stage
// Wyckoff Cycle: Accumulation -> Markup -> Distribution -> Markdown,
// extracts real OHLCV phase markers (SC, AR, ST, Spring, SOS,
// BC, UTAD, SOW) with exact price, volume, and timestamp data,
// and maps them onto both the asset structure and canonical curve.
// ============================================================

import type { OhlcBar } from "@/lib/engine/tradingOptions";
import type { SessionStats, VolumeProfile } from "@/lib/types/market";

export type WyckoffMacroStage = "accumulation" | "markup" | "distribution" | "markdown";

export interface WyckoffStageInfo {
  id: WyckoffMacroStage;
  label: string;
  shortLabel: string;
  phaseRange: string;
  description: string;
  actionHint: string;
}

export const WYCKOFF_STAGES: readonly WyckoffStageInfo[] = [
  {
    id: "accumulation",
    label: "1. Acumulación",
    shortLabel: "Acumulación",
    phaseRange: "Fases A–D",
    description: "Absorción institucional tras caída previa; soporte defendido (Ice) y posibles barridos Spring.",
    actionHint: "Vigilar Spring confirmado, LPS y ruptura alcista (SOS) sobre Creek.",
  },
  {
    id: "markup",
    label: "2. Tendencia Alcista (Markup)",
    shortLabel: "Markup",
    phaseRange: "Fase E",
    description: "Expansión alcista con máximos y mínimos crecientes fuera del rango de acumulación.",
    actionHint: "Continuación de tendencia: buscar retrocesos ordenados hacia VWAP / EMA.",
  },
  {
    id: "distribution",
    label: "3. Distribución",
    shortLabel: "Distribución",
    phaseRange: "Fases A–D",
    description: "Transferencia de posiciones en zona alta tras subida previa; rechazos en techo (UTAD) y alto esfuerzo sin avance.",
    actionHint: "Precaución ante UTAD en resistencia y rupturas bajistas (SOW) bajo Ice.",
  },
  {
    id: "markdown",
    label: "4. Tendencia Bajista (Markdown)",
    shortLabel: "Markdown",
    phaseRange: "Fase E",
    description: "Desplazamiento bajista tras perder el soporte estructural (Ice) con predominio vendedor.",
    actionHint: "Tendencia bajista activa hasta detectar Clímax de Venta (SC) y nuevo rango base.",
  },
] as const;

export interface WyckoffCurvePoint {
  step: number;
  label: string;
  stage: WyckoffMacroStage;
  idealPrice: number;
  eventTag?: string;
}

export interface WyckoffPhaseMarker {
  code: string;
  name: string;
  stage: WyckoffMacroStage;
  time: number;
  price: number;
  volume: number;
  volumeRatio: number;
  detected: boolean;
}

export interface WyckoffEnrichedCurvePoint extends WyckoffCurvePoint {
  price: number;
  volume: number;
  volumeRatio: number;
  time: number;
  detected: boolean;
  phaseName: string;
}

const PHASE_NAMES: Record<string, string> = {
  PS: "PS · Soporte Preliminar",
  SC: "SC · Clímax de Venta",
  AR: "AR · Reacción Automática",
  ST: "ST · Test Secundario",
  Spring: "Spring · Barrido de Soporte",
  SOS: "SOS · Señal de Fortaleza",
  LPS: "LPS · Último Punto de Soporte",
  JAC: "JAC · Salto sobre el Creek",
  BU: "BU · Back-Up al Creek",
  Impulso: "Fase E · Impulso Alcista",
  "Re-Acum.": "Re-Acumulación en Tendencia",
  Rally: "Clímax de Tendencia Alcista",
  PSY: "PSY · Oferta Preliminar",
  BC: "BC · Clímax Comprador",
  UTAD: "UTAD · Trampa Alcista en Techo",
  SOW: "SOW · Señal de Debilidad",
  LPSY: "LPSY · Último Punto de Oferta",
  Ruptura: "Ruptura Estructural del Ice",
  Caída: "Fase E · Desplazamiento Bajista",
  "Re-Dist.": "Re-Distribución Bajista",
  Desplome: "Aceleración Bajista (Markdown)",
  "Fin Ciclo": "Agotamiento de Markdown",
};

/**
 * Canonical 24-step normalized Wyckoff Cycle curve (0..100 scale)
 * used to visualize where the asset currently sits along the cycle.
 */
export const WYCKOFF_CANONICAL_CURVE: readonly WyckoffCurvePoint[] = [
  // 0..5: Accumulation (steps 0..5)
  { step: 0, label: "PS", stage: "accumulation", idealPrice: 30, eventTag: "PS" },
  { step: 1, label: "SC", stage: "accumulation", idealPrice: 18, eventTag: "SC" },
  { step: 2, label: "AR", stage: "accumulation", idealPrice: 34, eventTag: "AR" },
  { step: 3, label: "ST", stage: "accumulation", idealPrice: 21, eventTag: "ST" },
  { step: 4, label: "Spring", stage: "accumulation", idealPrice: 14, eventTag: "Spring" },
  { step: 5, label: "SOS", stage: "accumulation", idealPrice: 38, eventTag: "SOS" },
  // 6..11: Markup (steps 6..11)
  { step: 6, label: "LPS", stage: "markup", idealPrice: 35, eventTag: "LPS" },
  { step: 7, label: "JAC", stage: "markup", idealPrice: 48, eventTag: "JAC" },
  { step: 8, label: "BU", stage: "markup", idealPrice: 44 },
  { step: 9, label: "Impulso", stage: "markup", idealPrice: 64 },
  { step: 10, label: "Re-Acum.", stage: "markup", idealPrice: 61 },
  { step: 11, label: "Rally", stage: "markup", idealPrice: 78 },
  // 12..17: Distribution (steps 12..17)
  { step: 12, label: "PSY", stage: "distribution", idealPrice: 76, eventTag: "PSY" },
  { step: 13, label: "BC", stage: "distribution", idealPrice: 88, eventTag: "BC" },
  { step: 14, label: "AR", stage: "distribution", idealPrice: 72, eventTag: "AR" },
  { step: 15, label: "ST", stage: "distribution", idealPrice: 85, eventTag: "ST" },
  { step: 16, label: "UTAD", stage: "distribution", idealPrice: 92, eventTag: "UTAD" },
  { step: 17, label: "SOW", stage: "distribution", idealPrice: 68, eventTag: "SOW" },
  // 18..23: Markdown (steps 18..23)
  { step: 18, label: "LPSY", stage: "markdown", idealPrice: 73, eventTag: "LPSY" },
  { step: 19, label: "Ruptura", stage: "markdown", idealPrice: 58 },
  { step: 20, label: "Caída", stage: "markdown", idealPrice: 46 },
  { step: 21, label: "Re-Dist.", stage: "markdown", idealPrice: 49 },
  { step: 22, label: "Desplome", stage: "markdown", idealPrice: 32 },
  { step: 23, label: "Fin Ciclo", stage: "markdown", idealPrice: 24 },
];

export interface WyckoffPricePoint {
  time: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  volumeRatio: number;
  isBull: boolean;
  spreadPct: number;
  bodyRatio: number;
  isChurn: boolean;
  isClimax: boolean;
  effortLabel: string;
  emaFast: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  macdCross: "bullish" | "bearish" | null;
  adx: number;
  plusDi: number;
  minusDi: number;
  creek: number;
  ice: number;
  equilibrium: number;
  marker?: WyckoffPhaseMarker;
}

export interface WyckoffPhaseDurationStat {
  stage: WyckoffMacroStage;
  label: string;
  shortLabel: string;
  occurrences: number;
  avgDurationMs: number;
  avgDurationHours: number;
  avgDurationDays: number;
  avgBars: number;
  minDurationMs: number;
  maxDurationMs: number;
  totalDurationMs: number;
  sharePct: number;
  isCurrent: boolean;
  currentElapsedMs: number;
  maturityPct: number | null;
}

export interface WyckoffHistoricalCycle {
  id: string;
  label: string;
  stage: WyckoffMacroStage;
  stageLabel: string;
  shortLabel: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  barCount: number;
  returnPct: number;
  normalizedCloses: number[];
  curveMappedValues: (number | null)[];
  matchesCurrentStage: boolean;
}

export interface WyckoffOverlayProjection {
  cycle: WyckoffHistoricalCycle;
  anchorIndex: number;
  anchorPrice: number;
  structureOverlay: (number | null)[];
  curveOverlay: (number | null)[];
  maturityVsSelectedPct: number;
  activeBarsElapsed: number;
  remainingBarsEstimate: number;
  currentReturnPct: number;
  historicalReturnAtSameStepPct: number;
}

export interface WyckoffPhaseVolumeBin {
  index: number;
  priceLow: number;
  priceHigh: number;
  priceMid: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  pctOfMax: number;
  pctOfTotal: number;
  isPOC: boolean;
  inValueArea: boolean;
}

export interface WyckoffPhaseVolumeProfile {
  stage: WyckoffMacroStage;
  label: string;
  shortLabel: string;
  isCurrent: boolean;
  episodeCount: number;
  barCount: number;
  startTime: number;
  endTime: number;
  rangeLow: number;
  rangeHigh: number;
  totalVolume: number;
  poc: number;
  vah: number;
  val: number;
  valueAreaPct: number;
  bins: WyckoffPhaseVolumeBin[];
}

export interface WyckoffAnalysis {
  ready: boolean;
  windowStartTime: number;
  windowEndTime: number;
  historySpanMs: number;
  macroStage: WyckoffMacroStage;
  stageLabel: string;
  subPhase: string;
  eventBadge: string;
  confidencePct: number;
  cycleStep: number; // 0..23 index on WYCKOFF_CANONICAL_CURVE
  cycleProgressPct: number; // 0..100%
  creekResistance: number;
  iceSupport: number;
  equilibriumPrice: number;
  positionInRange: number; // 0 = Ice, 1 = Creek (<0 breakdown, >1 breakout)
  trendSlopePct: number;
  priorMovePct: number;
  volumeRatio: number; // recent vol vs 20-bar avg
  avgVolume: number;
  climaxThresholdVolume: number;
  climaxBarCount: number;
  correlatedClimaxCount: number;
  macdCurrent: number;
  macdSignalCurrent: number;
  macdHistogramCurrent: number;
  macdBias: "bullish" | "bearish" | "neutral";
  macdMomentumLabel: string;
  macdCrossCount: number;
  adxCurrent: number;
  plusDiCurrent: number;
  minusDiCurrent: number;
  adxPeriodUsed: number;
  adxRegime: "strong-trend" | "trending" | "emerging" | "range-bound";
  adxDirection: "bullish" | "bearish" | "neutral";
  trendStrengthLabel: string;
  adxDelta: number;
  currentPhaseElapsedMs: number;
  currentPhaseAvgMs: number;
  currentPhaseMaturityPct: number;
  cycleMaturityLabel: string;
  currentPhaseStartIndex: number;
  phaseDurations: WyckoffPhaseDurationStat[];
  historicalCycles: WyckoffHistoricalCycle[];
  phaseVolumeProfiles: WyckoffPhaseVolumeProfile[];
  springDetected: boolean;
  utadDetected: boolean;
  effortResultLabel: string;
  summary: string;
  actionGuidance: string;
  markers: WyckoffPhaseMarker[];
  curvePoints: WyckoffEnrichedCurvePoint[];
  series: WyckoffPricePoint[];
}

export interface WyckoffInput {
  bars: OhlcBar[];
  livePrice: number;
  session: SessionStats | null;
  volumeProfile: VolumeProfile | null;
  currentOBI: number;
}

function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = new Array<number>(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export type AdxRegime = "strong-trend" | "trending" | "emerging" | "range-bound";
export type AdxDirection = "bullish" | "bearish" | "neutral";
export type AdxSlopeTrend = "increasing" | "decreasing" | "flat";

export interface AdxTickTrajectory {
  points: number[];
  trend: AdxSlopeTrend;
  netChange: number;
  lastStepChange: number;
}

export interface AdxSnapshot {
  adx: number;
  plusDi: number;
  minusDi: number;
  adxDelta: number;
  recentAdx: number[];
  regime: AdxRegime;
  direction: AdxDirection;
  periodUsed: number;
  barsCount: number;
  lastTime: number | null;
}

export function wilderAdxSeries(
  bars: OhlcBar[],
  requestedPeriod = 14
): { adx: number[]; plusDi: number[]; minusDi: number[]; period: number } {
  const n = bars.length;
  if (n < 2) {
    return {
      adx: new Array<number>(n).fill(0),
      plusDi: new Array<number>(n).fill(0),
      minusDi: new Array<number>(n).fill(0),
      period: requestedPeriod,
    };
  }

  const p =
    n >= requestedPeriod * 2 + 1
      ? requestedPeriod
      : Math.max(3, Math.min(requestedPeriod, Math.floor((n - 1) / 2)));

  const tr = new Array<number>(n).fill(0);
  const plusDm = new Array<number>(n).fill(0);
  const minusDm = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const curr = bars[i];
    const prev = bars[i - 1];
    tr[i] = Math.max(
      Math.max(0, curr.high - curr.low),
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const plusDi = new Array<number>(n).fill(0);
  const minusDi = new Array<number>(n).fill(0);
  const dx = new Array<number>(n).fill(0);
  const adx = new Array<number>(n).fill(0);

  let smTr = 0;
  let smPlusDm = 0;
  let smMinusDm = 0;

  for (let i = 1; i < n; i++) {
    if (i <= p) {
      smTr += tr[i];
      smPlusDm += plusDm[i];
      smMinusDm += minusDm[i];
    } else {
      smTr = smTr - smTr / p + tr[i];
      smPlusDm = smPlusDm - smPlusDm / p + plusDm[i];
      smMinusDm = smMinusDm - smMinusDm / p + minusDm[i];
    }

    const pdi = smTr > 0 ? clamp((smPlusDm / smTr) * 100, 0, 100) : 0;
    const mdi = smTr > 0 ? clamp((smMinusDm / smTr) * 100, 0, 100) : 0;
    plusDi[i] = pdi;
    minusDi[i] = mdi;

    const diSum = pdi + mdi;
    dx[i] = diSum > 0.5 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0;
  }

  plusDi[0] = plusDi[1];
  minusDi[0] = minusDi[1];
  dx[0] = dx[1];

  let runningAdx = dx[1];
  adx[0] = runningAdx;
  for (let i = 1; i < n; i++) {
    if (i <= p) {
      let sum = 0;
      for (let j = 1; j <= i; j++) sum += dx[j];
      runningAdx = sum / i;
    } else {
      runningAdx = (runningAdx * (p - 1) + dx[i]) / p;
    }
    adx[i] = clamp(Number.isFinite(runningAdx) ? runningAdx : 0, 0, 100);
  }

  return { adx, plusDi, minusDi, period: p };
}

export function updateBarsWithLivePrice(bars: OhlcBar[], livePrice?: number): OhlcBar[] {
  if (!bars.length || livePrice === undefined || !Number.isFinite(livePrice) || livePrice <= 0) {
    return bars;
  }
  const lastIdx = bars.length - 1;
  const last = bars[lastIdx];
  const nextHigh = Math.max(last.high, livePrice);
  const nextLow = Math.min(last.low, livePrice);
  if (last.close === livePrice && last.high === nextHigh && last.low === nextLow) {
    return bars;
  }
  const next = bars.slice();
  next[lastIdx] = {
    ...last,
    close: livePrice,
    high: nextHigh,
    low: nextLow,
  };
  return next;
}

export function computeAdxTickTrajectory(rawPoints: number[]): AdxTickTrajectory {
  const points = rawPoints.filter((v) => Number.isFinite(v)).slice(-5);
  if (points.length < 2) {
    return {
      points,
      trend: "flat",
      netChange: 0,
      lastStepChange: 0,
    };
  }
  const first = points[0];
  const prev = points[points.length - 2];
  const last = points[points.length - 1];
  const netChange = last - first;
  const lastStepChange = last - prev;

  let trend: AdxSlopeTrend = "flat";
  if (netChange >= 0.08 || (netChange > 0.02 && lastStepChange > 0.01)) {
    trend = "increasing";
  } else if (netChange <= -0.08 || (netChange < -0.02 && lastStepChange < -0.01)) {
    trend = "decreasing";
  }

  return {
    points,
    trend,
    netChange,
    lastStepChange,
  };
}

export function computeAdxSnapshot(
  bars: OhlcBar[],
  livePrice?: number,
  requestedPeriod = 14
): AdxSnapshot {
  const effectiveBars = updateBarsWithLivePrice(bars, livePrice);
  const lastTime = effectiveBars.at(-1)?.openTime ?? null;
  if (effectiveBars.length < 4) {
    return {
      adx: 0,
      plusDi: 0,
      minusDi: 0,
      adxDelta: 0,
      recentAdx: [],
      regime: "range-bound",
      direction: "neutral",
      periodUsed: requestedPeriod,
      barsCount: effectiveBars.length,
      lastTime,
    };
  }

  const series = wilderAdxSeries(effectiveBars, requestedPeriod);
  const lastIdx = effectiveBars.length - 1;
  const prevIdx = Math.max(0, lastIdx - 3);
  const adx = series.adx[lastIdx] ?? 0;
  const plusDi = series.plusDi[lastIdx] ?? 0;
  const minusDi = series.minusDi[lastIdx] ?? 0;
  const adxDelta = adx - (series.adx[prevIdx] ?? adx);
  const recentAdx = series.adx.slice(-5);

  const regime: AdxRegime =
    adx >= 40
      ? "strong-trend"
      : adx >= 25
        ? "trending"
        : adx >= 20
          ? "emerging"
          : "range-bound";

  const direction: AdxDirection =
    plusDi - minusDi >= 2.5 ? "bullish" : minusDi - plusDi >= 2.5 ? "bearish" : "neutral";

  return {
    adx,
    plusDi,
    minusDi,
    adxDelta,
    recentAdx,
    regime,
    direction,
    periodUsed: series.period,
    barsCount: effectiveBars.length,
    lastTime,
  };
}

function phaseNameFor(code: string, stage: WyckoffMacroStage): string {
  if (code === "AR") {
    return stage === "distribution" || stage === "markdown"
      ? "AR · Reacción Automática Bajista"
      : "AR · Reacción Automática Alcista";
  }
  if (code === "ST") {
    return stage === "distribution" || stage === "markdown"
      ? "ST · Test Secundario en Techo"
      : "ST · Test Secundario en Soporte";
  }
  return PHASE_NAMES[code] ?? code;
}

export function analyzeWyckoffCycle(input: WyckoffInput): WyckoffAnalysis {
  const { bars, livePrice, session, volumeProfile, currentOBI } = input;

  if (bars.length < 6) {
    const px = livePrice > 0 ? livePrice : bars.at(-1)?.close ?? 0;
    const nowTime = bars.at(-1)?.openTime ?? 0;
    return {
      ready: false,
      windowStartTime: bars[0]?.openTime ?? 0,
      windowEndTime: nowTime,
      historySpanMs: 0,
      macroStage: "accumulation",
      stageLabel: "1. Acumulación",
      subPhase: "Sincronizando histórico",
      eventBadge: "TR",
      confidencePct: 0,
      cycleStep: 2,
      cycleProgressPct: 10,
      creekResistance: px,
      iceSupport: px,
      equilibriumPrice: px,
      positionInRange: 0.5,
      trendSlopePct: 0,
      priorMovePct: 0,
      volumeRatio: 1,
      avgVolume: 0,
      climaxThresholdVolume: 0,
      climaxBarCount: 0,
      correlatedClimaxCount: 0,
      macdCurrent: 0,
      macdSignalCurrent: 0,
      macdHistogramCurrent: 0,
      macdBias: "neutral",
      macdMomentumLabel: "Esperando velas",
      macdCrossCount: 0,
      adxCurrent: 0,
      plusDiCurrent: 0,
      minusDiCurrent: 0,
      adxPeriodUsed: 14,
      adxRegime: "range-bound",
      adxDirection: "neutral",
      trendStrengthLabel: "Esperando velas",
      adxDelta: 0,
      currentPhaseElapsedMs: 0,
      currentPhaseAvgMs: 0,
      currentPhaseMaturityPct: 0,
      cycleMaturityLabel: "Esperando velas",
      currentPhaseStartIndex: 0,
      phaseDurations: [],
      historicalCycles: [],
      phaseVolumeProfiles: [],
      springDetected: false,
      utadDetected: false,
      effortResultLabel: "Esperando velas",
      summary: "Recopilando al menos 6 velas OHLCV de OKX para identificar la estructura de Wyckoff.",
      actionGuidance: "Esperando datos de mercado en vivo.",
      markers: [],
      curvePoints: WYCKOFF_CANONICAL_CURVE.map((pt) => ({
        ...pt,
        price: px,
        volume: 0,
        volumeRatio: 1,
        time: nowTime,
        detected: false,
        phaseName: phaseNameFor(pt.label, pt.stage),
      })),
      series: [],
    };
  }

  // Use extra lookback (up to 110 bars) to warm up MACD(12, 26, 9) before slicing trailing 72 bars
  const warmupBars = bars.slice(-110).map((b, idx, arr) => {
    if (idx === arr.length - 1 && livePrice > 0) {
      return {
        ...b,
        close: livePrice,
        high: Math.max(b.high, livePrice),
        low: Math.min(b.low, livePrice),
      };
    }
    return b;
  });

  const windowCount = Math.min(72, warmupBars.length);
  const warmupOffset = warmupBars.length - windowCount;
  const windowBars = warmupBars.slice(warmupOffset);

  const warmupCloses = warmupBars.map((b) => b.close);
  const ema12Warm = emaSeries(warmupCloses, 12);
  const ema26Warm = emaSeries(warmupCloses, 26);
  const macdLineWarm = ema12Warm.map((e12, i) => e12 - ema26Warm[i]);
  const macdSignalWarm = emaSeries(macdLineWarm, 9);
  const macdHistWarm = macdLineWarm.map((m, i) => m - macdSignalWarm[i]);

  const closes = windowBars.map((b) => b.close);
  const ema12 = ema12Warm.slice(warmupOffset);
  const ema34 = emaSeries(warmupCloses, 34).slice(warmupOffset);
  const macdLine = macdLineWarm.slice(warmupOffset);
  const macdSignal = macdSignalWarm.slice(warmupOffset);
  const macdHistogram = macdHistWarm.slice(warmupOffset);

  const adxWarm = wilderAdxSeries(warmupBars, 14);
  const adxSeries = adxWarm.adx.slice(warmupOffset);
  const plusDiSeries = adxWarm.plusDi.slice(warmupOffset);
  const minusDiSeries = adxWarm.minusDi.slice(warmupOffset);
  const adxPeriodUsed = adxWarm.period;

  const lastIdx = windowBars.length - 1;
  const currentClose = closes[lastIdx];
  const lastEma12 = ema12[lastIdx];
  const lastEma34 = ema34[lastIdx];

  const slopeLookback = Math.min(8, lastIdx);
  const prevEma12 = ema12[lastIdx - slopeLookback] || lastEma12;
  const trendSlopePct = prevEma12 > 0 ? ((lastEma12 - prevEma12) / prevEma12) * 100 : 0;

  // Prior directional move (first ~half of window up to trading range start)
  const rangeCount = Math.min(36, Math.max(12, Math.floor(windowBars.length * 0.6)));
  const rangeStart = Math.max(0, windowBars.length - rangeCount);
  const priorSlice = windowBars.slice(0, Math.max(2, rangeStart + 2));
  const priorStartClose = priorSlice[0].close;
  const priorEndClose = priorSlice[priorSlice.length - 1].close;
  const priorMovePct = priorStartClose > 0 ? ((priorEndClose - priorStartClose) / priorStartClose) * 100 : 0;

  // Define Trading Range Creek (resistance) and Ice (support) using structural anchor bars
  const rangeSlice = windowBars.slice(rangeStart);
  const anchorCount = Math.max(6, rangeSlice.length - 4);
  const anchorSlice = rangeSlice.slice(0, anchorCount);

  let creekResistance = -Infinity;
  let iceSupport = Infinity;
  for (const b of anchorSlice) {
    creekResistance = Math.max(creekResistance, b.high);
    iceSupport = Math.min(iceSupport, b.low);
  }
  if (!Number.isFinite(creekResistance) || !Number.isFinite(iceSupport) || creekResistance <= iceSupport) {
    creekResistance = Math.max(...closes);
    iceSupport = Math.min(...closes);
  }

  const equilibriumPrice = (creekResistance + iceSupport) / 2;
  const span = Math.max(1e-9, creekResistance - iceSupport);
  const positionInRange = (currentClose - iceSupport) / span;

  // Detect Spring (dip below Ice followed by reclaim inside) and UTAD (spike above Creek followed by rejection inside)
  const tailBars = rangeSlice.slice(-6);
  const tailMinLow = Math.min(...tailBars.map((b) => b.low));
  const tailMaxHigh = Math.max(...tailBars.map((b) => b.high));
  const springDetected = tailMinLow < iceSupport * 0.9995 && currentClose > iceSupport;
  const utadDetected = tailMaxHigh > creekResistance * 1.0005 && currentClose < creekResistance;

  // Volume effort vs average
  const volBars = rangeSlice.slice(-20);
  const avgVol = volBars.reduce((s, b) => s + b.volume, 0) / Math.max(1, volBars.length);
  const overallAvgVol =
    windowBars.reduce((s, b) => s + b.volume, 0) / Math.max(1, windowBars.length) || 1;
  const recentVol =
    tailBars.slice(-3).reduce((s, b) => s + b.volume, 0) / Math.max(1, Math.min(3, tailBars.length));
  const volumeRatio = avgVol > 0 ? recentVol / avgVol : 1;

  // Order flow confirmation
  const buyShare = session && session.volume > 0 ? session.buyVolume / session.volume : 0.5;
  const flowBull = buyShare > 0.52 || currentOBI > 0.08;
  const flowBear = buyShare < 0.48 || currentOBI < -0.08;
  const abovePoc = volumeProfile?.poc ? currentClose >= volumeProfile.poc : currentClose >= equilibriumPrice;

  // Determine Wyckoff Macro Stage & Sub-Phase
  let macroStage: WyckoffMacroStage;
  let subPhase: string;
  let eventBadge: string;
  let cycleStep: number;
  let confidencePct: number;

  const isBreakingUp = positionInRange > 0.98 && trendSlopePct > 0.12 && lastEma12 >= lastEma34 * 0.999;
  const isBreakingDown = positionInRange < 0.02 && trendSlopePct < -0.12 && lastEma12 <= lastEma34 * 1.001;
  const isUptrend =
    lastEma12 > lastEma34 * 1.002 &&
    trendSlopePct > 0.25 &&
    positionInRange >= 0.72;
  const isDowntrend =
    lastEma12 < lastEma34 * 0.998 &&
    trendSlopePct < -0.25 &&
    positionInRange <= 0.28;

  if (isBreakingUp || isUptrend) {
    macroStage = "markup";
    const strongBreakout = positionInRange > 1.05;
    if (strongBreakout) {
      subPhase = "Fase E · Expansión Alcista";
      eventBadge = trendSlopePct > 0.8 ? "Rally" : "Impulso";
      cycleStep = trendSlopePct > 0.9 ? 11 : 9;
      confidencePct = clamp(Math.round(68 + Math.abs(trendSlopePct) * 10 + (flowBull ? 10 : 0)), 55, 95);
    } else {
      subPhase = "Fase D/E · JAC / Salida del Rango";
      eventBadge = "JAC";
      cycleStep = 7;
      confidencePct = clamp(Math.round(62 + (flowBull ? 12 : 0) + (abovePoc ? 6 : 0)), 52, 90);
    }
  } else if (isBreakingDown || isDowntrend) {
    macroStage = "markdown";
    const deepDrop = positionInRange < -0.05;
    if (deepDrop) {
      subPhase = "Fase E · Caída / Markdown";
      eventBadge = trendSlopePct < -0.8 ? "Desplome" : "Caída";
      cycleStep = trendSlopePct < -0.9 ? 22 : 20;
      confidencePct = clamp(Math.round(68 + Math.abs(trendSlopePct) * 10 + (flowBear ? 10 : 0)), 55, 95);
    } else {
      subPhase = "Fase D/E · Ruptura de Soporte (Ice)";
      eventBadge = "SOW";
      cycleStep = 19;
      confidencePct = clamp(Math.round(62 + (flowBear ? 12 : 0) + (!abovePoc ? 6 : 0)), 52, 90);
    }
  } else {
    // Inside Trading Range -> Distinguish Accumulation vs Distribution
    const accumScore =
      (priorMovePct < -0.15 ? 2 : 0) +
      (springDetected ? 3 : 0) +
      (flowBull ? 2 : 0) +
      (trendSlopePct >= -0.05 && positionInRange <= 0.65 ? 1 : 0);
    const distribScore =
      (priorMovePct > 0.15 ? 2 : 0) +
      (utadDetected ? 3 : 0) +
      (flowBear ? 2 : 0) +
      (trendSlopePct <= 0.05 && positionInRange >= 0.45 ? 1 : 0);

    if (accumScore >= distribScore) {
      macroStage = "accumulation";
      if (springDetected) {
        subPhase = "Fase C · Spring (Barrido y Reentrada)";
        eventBadge = "Spring";
        cycleStep = 4;
        confidencePct = clamp(Math.round(74 + (flowBull ? 12 : 0)), 62, 94);
      } else if (positionInRange >= 0.68 && trendSlopePct > 0.05) {
        subPhase = "Fase D · Señal de Fortaleza (SOS)";
        eventBadge = "SOS";
        cycleStep = 5;
        confidencePct = clamp(Math.round(66 + (flowBull ? 10 : 0)), 55, 90);
      } else if (Math.abs(priorMovePct) > 1.2 && rangeSlice.length < 18) {
        subPhase = "Fase A · Parada de Caída (SC / AR)";
        eventBadge = "AR";
        cycleStep = 2;
        confidencePct = 60;
      } else {
        subPhase = "Fase B · Construcción de Causa / Absorción";
        eventBadge = "ST";
        cycleStep = 3;
        confidencePct = clamp(Math.round(58 + (flowBull ? 8 : 0)), 50, 86);
      }
    } else {
      macroStage = "distribution";
      if (utadDetected) {
        subPhase = "Fase C · UTAD (Falsa Ruptura en Techo)";
        eventBadge = "UTAD";
        cycleStep = 16;
        confidencePct = clamp(Math.round(74 + (flowBear ? 12 : 0)), 62, 94);
      } else if (positionInRange <= 0.32 && trendSlopePct < -0.05) {
        subPhase = "Fase D · Señal de Debilidad (SOW)";
        eventBadge = "SOW";
        cycleStep = 17;
        confidencePct = clamp(Math.round(66 + (flowBear ? 10 : 0)), 55, 90);
      } else if (Math.abs(priorMovePct) > 1.2 && rangeSlice.length < 18) {
        subPhase = "Fase A · Clímax Comprador (BC / AR)";
        eventBadge = "AR";
        cycleStep = 14;
        confidencePct = 60;
      } else {
        subPhase = "Fase B · Distribución en Rango Superior";
        eventBadge = "ST";
        cycleStep = 15;
        confidencePct = clamp(Math.round(58 + (flowBear ? 8 : 0)), 50, 86);
      }
    }
  }

  // Anchor concrete Wyckoff phase markers onto real windowBars indices
  const usedIndices = new Set<number>();
  const markerByBarIndex = new Map<number, WyckoffPhaseMarker>();
  const markerByStageCode = new Map<string, WyckoffPhaseMarker>();

  const claimBarIndex = (targetIdx: number): number => {
    const bounded = clamp(targetIdx, 0, windowBars.length - 1);
    if (!usedIndices.has(bounded)) {
      usedIndices.add(bounded);
      return bounded;
    }
    for (let offset = 1; offset <= 4; offset++) {
      if (bounded - offset >= 0 && !usedIndices.has(bounded - offset)) {
        usedIndices.add(bounded - offset);
        return bounded - offset;
      }
      if (bounded + offset < windowBars.length && !usedIndices.has(bounded + offset)) {
        usedIndices.add(bounded + offset);
        return bounded + offset;
      }
    }
    return bounded;
  };

  const assignMarker = (
    rawIdx: number,
    code: string,
    stage: WyckoffMacroStage,
    priceOverride?: number
  ) => {
    const idx = claimBarIndex(rawIdx);
    const bar = windowBars[idx];
    const ratio = overallAvgVol > 0 ? bar.volume / overallAvgVol : 1;
    const marker: WyckoffPhaseMarker = {
      code,
      name: phaseNameFor(code, stage),
      stage,
      time: bar.openTime,
      price: priceOverride ?? bar.close,
      volume: bar.volume,
      volumeRatio: ratio,
      detected: true,
    };
    markerByBarIndex.set(idx, marker);
    markerByStageCode.set(`${stage}:${code}`, marker);
    if (!markerByStageCode.has(code)) {
      markerByStageCode.set(code, marker);
    }
  };

  const midRangeIdx = Math.min(windowBars.length - 2, rangeStart + Math.floor(rangeSlice.length * 0.45));
  const lateRangeStart = Math.min(windowBars.length - 1, rangeStart + Math.floor(rangeSlice.length * 0.55));

  if (macroStage === "accumulation" || macroStage === "markup") {
    // 1) PS before range or early high-vol drop bar
    if (rangeStart > 1) {
      assignMarker(Math.max(0, rangeStart - 2), "PS", "accumulation");
    }
    // 2) SC: lowest low in first half of trading range
    let scIdx = rangeStart;
    for (let i = rangeStart; i <= midRangeIdx; i++) {
      if (windowBars[i].low <= windowBars[scIdx].low) scIdx = i;
    }
    assignMarker(scIdx, "SC", "accumulation", windowBars[scIdx].low);

    // 3) AR: highest high between SC and lateRangeStart
    let arIdx = Math.min(windowBars.length - 1, scIdx + 1);
    for (let i = scIdx + 1; i <= Math.min(windowBars.length - 2, Math.max(arIdx, lateRangeStart)); i++) {
      if (windowBars[i].high >= windowBars[arIdx].high) arIdx = i;
    }
    assignMarker(arIdx, "AR", "accumulation", windowBars[arIdx].high);

    // 4) ST or Spring in second half of range
    let stIdx = lateRangeStart;
    for (let i = lateRangeStart; i < windowBars.length - 1; i++) {
      if (windowBars[i].low <= windowBars[stIdx].low) stIdx = i;
    }
    if (springDetected) {
      let springIdx = Math.max(0, windowBars.length - 6);
      for (let i = springIdx; i < windowBars.length; i++) {
        if (windowBars[i].low <= windowBars[springIdx].low) springIdx = i;
      }
      assignMarker(springIdx, "Spring", "accumulation", windowBars[springIdx].low);
    } else {
      assignMarker(stIdx, "ST", "accumulation", windowBars[stIdx].low);
    }

    // 5) SOS / JAC / current markup bar
    if (macroStage === "markup") {
      let jacIdx = Math.max(rangeStart, windowBars.length - 5);
      for (let i = jacIdx; i < windowBars.length; i++) {
        if (windowBars[i].close > creekResistance) {
          jacIdx = i;
          break;
        }
      }
      assignMarker(jacIdx, "JAC", "markup", windowBars[jacIdx].close);
      assignMarker(windowBars.length - 1, eventBadge, "markup", currentClose);
    } else if (positionInRange >= 0.68 || eventBadge === "SOS") {
      assignMarker(windowBars.length - 1, "SOS", "accumulation", currentClose);
    }
  } else {
    // Distribution or Markdown
    if (rangeStart > 1) {
      assignMarker(Math.max(0, rangeStart - 2), "PSY", "distribution");
    }
    // BC: highest high in first half of range
    let bcIdx = rangeStart;
    for (let i = rangeStart; i <= midRangeIdx; i++) {
      if (windowBars[i].high >= windowBars[bcIdx].high) bcIdx = i;
    }
    assignMarker(bcIdx, "BC", "distribution", windowBars[bcIdx].high);

    // AR: lowest low after BC
    let arIdx = Math.min(windowBars.length - 1, bcIdx + 1);
    for (let i = bcIdx + 1; i <= Math.min(windowBars.length - 2, Math.max(arIdx, lateRangeStart)); i++) {
      if (windowBars[i].low <= windowBars[arIdx].low) arIdx = i;
    }
    assignMarker(arIdx, "AR", "distribution", windowBars[arIdx].low);

    // ST or UTAD in upper second half
    let stIdx = lateRangeStart;
    for (let i = lateRangeStart; i < windowBars.length - 1; i++) {
      if (windowBars[i].high >= windowBars[stIdx].high) stIdx = i;
    }
    if (utadDetected) {
      let utadIdx = Math.max(0, windowBars.length - 6);
      for (let i = utadIdx; i < windowBars.length; i++) {
        if (windowBars[i].high >= windowBars[utadIdx].high) utadIdx = i;
      }
      assignMarker(utadIdx, "UTAD", "distribution", windowBars[utadIdx].high);
    } else {
      assignMarker(stIdx, "ST", "distribution", windowBars[stIdx].high);
    }

    if (macroStage === "markdown") {
      let sowIdx = Math.max(rangeStart, windowBars.length - 5);
      for (let i = sowIdx; i < windowBars.length; i++) {
        if (windowBars[i].close < iceSupport) {
          sowIdx = i;
          break;
        }
      }
      assignMarker(sowIdx, "SOW", "distribution", windowBars[sowIdx].close);
      assignMarker(windowBars.length - 1, eventBadge, "markdown", currentClose);
    } else if (positionInRange <= 0.32 || eventBadge === "SOW") {
      assignMarker(windowBars.length - 1, "SOW", "distribution", currentClose);
    }
  }

  const markers = [...markerByBarIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, m]) => m);

  // Enrich every step on the canonical Wyckoff curve with real price, volume, and timestamp
  const curvePoints: WyckoffEnrichedCurvePoint[] = WYCKOFF_CANONICAL_CURVE.map((pt, idx) => {
    const specific =
      markerByStageCode.get(`${pt.stage}:${pt.label}`) ??
      (idx === cycleStep ? markerByBarIndex.get(lastIdx) : undefined);

    if (specific) {
      return {
        ...pt,
        price: specific.price,
        volume: specific.volume,
        volumeRatio: specific.volumeRatio,
        time: specific.time,
        detected: true,
        phaseName: specific.name,
      };
    }

    const mappedBarIdx = clamp(
      Math.round((idx / Math.max(1, WYCKOFF_CANONICAL_CURVE.length - 1)) * (windowBars.length - 1)),
      0,
      windowBars.length - 1
    );
    const fallbackBar = windowBars[mappedBarIdx];
    const normalizedRatio = (pt.idealPrice - 14) / (92 - 14); // 0..1 across cycle curve
    const structuralPrice = iceSupport + clamp(normalizedRatio, 0, 1) * span;
    const ratio = overallAvgVol > 0 ? fallbackBar.volume / overallAvgVol : 1;

    return {
      ...pt,
      price: structuralPrice,
      volume: fallbackBar.volume,
      volumeRatio: ratio,
      time: fallbackBar.openTime,
      detected: false,
      phaseName: phaseNameFor(pt.label, pt.stage),
    };
  });

  const stageMeta = WYCKOFF_STAGES.find((s) => s.id === macroStage)!;
  const cycleProgressPct = Math.round((cycleStep / (WYCKOFF_CANONICAL_CURVE.length - 1)) * 100);

  const effortResultLabel =
    volumeRatio >= 1.45 && Math.abs(trendSlopePct) < 0.25
      ? `Alto esfuerzo (${volumeRatio.toFixed(1)}× vol) / Poco avance (Absorción)`
      : volumeRatio >= 1.35
        ? `Expansión con volumen (${volumeRatio.toFixed(1)}×)`
        : volumeRatio <= 0.72
          ? `Secado de oferta/demanda (${volumeRatio.toFixed(1)}× vol)`
          : `Volumen equilibrado (${volumeRatio.toFixed(1)}×)`;

  const summary = `${stageMeta.label} (${subPhase}): Precio al ${Math.round(clamp(positionInRange * 100, 0, 100))}% del rango estructural (Soporte Ice ${iceSupport.toFixed(currentClose >= 100 ? 2 : 4)} ↔ Techo Creek ${creekResistance.toFixed(currentClose >= 100 ? 2 : 4)}).`;

  const avgSpread =
    windowBars.reduce((s, b) => s + Math.max(0, b.high - b.low), 0) /
    Math.max(1, windowBars.length);

  const CLIMAX_PHASE_CODES = new Set(["PS", "SC", "BC", "Spring", "UTAD", "SOS", "SOW", "JAC"]);
  let climaxBarCount = 0;
  let correlatedClimaxCount = 0;
  let macdCrossCount = 0;

  const series: WyckoffPricePoint[] = windowBars.map((b, idx) => {
    const volRatio = overallAvgVol > 0 ? b.volume / overallAvgVol : 1;
    const barSpread = Math.max(0, b.high - b.low);
    const spreadRatio = avgSpread > 0 ? barSpread / avgSpread : 1;
    const bodyRatio = barSpread > 0 ? Math.abs(b.close - b.open) / barSpread : 1;
    const spreadPct = b.close > 0 ? (barSpread / b.close) * 100 : 0;
    const isBull = b.close >= b.open;
    const marker = markerByBarIndex.get(idx);

    const isChurn = volRatio >= 1.25 && (bodyRatio <= 0.45 || spreadRatio <= 1.05);
    const isPhaseBoosted = Boolean(marker && CLIMAX_PHASE_CODES.has(marker.code) && volRatio >= 1.2);
    const isClimax = volRatio >= 1.5 || isChurn || isPhaseBoosted;

    if (isClimax) {
      climaxBarCount += 1;
      if (marker) correlatedClimaxCount += 1;
    }

    const prevHist = idx > 0 ? macdHistogram[idx - 1] : macdHistogram[idx];
    const currHist = macdHistogram[idx];
    let macdCross: "bullish" | "bearish" | null = null;
    if (idx > 0) {
      if (prevHist <= 0 && currHist > 0) {
        macdCross = "bullish";
        macdCrossCount += 1;
      } else if (prevHist >= 0 && currHist < 0) {
        macdCross = "bearish";
        macdCrossCount += 1;
      }
    }

    const effortLabel =
      volRatio >= 1.5 && isChurn
        ? "Clímax + Churn (Absorción)"
        : volRatio >= 1.5
          ? "Pico Climático (≥1.5× Vol)"
          : isChurn
            ? "Churn de Volumen (Esfuerzo/Pausa)"
            : isPhaseBoosted
              ? `Esfuerzo en Fase ${marker!.code}`
              : "Volumen Normal";

    return {
      time: b.openTime,
      close: b.close,
      high: b.high,
      low: b.low,
      volume: b.volume,
      volumeRatio: volRatio,
      isBull,
      spreadPct,
      bodyRatio,
      isChurn,
      isClimax,
      effortLabel,
      emaFast: ema12[idx],
      macdLine: macdLine[idx],
      macdSignal: macdSignal[idx],
      macdHistogram: currHist,
      macdCross,
      adx: Number((adxSeries[idx] ?? 0).toFixed(2)),
      plusDi: Number((plusDiSeries[idx] ?? 0).toFixed(2)),
      minusDi: Number((minusDiSeries[idx] ?? 0).toFixed(2)),
      creek: creekResistance,
      ice: iceSupport,
      equilibrium: equilibriumPrice,
      marker,
    };
  });

  const macdCurrent = macdLine[lastIdx] ?? 0;
  const macdSignalCurrent = macdSignal[lastIdx] ?? 0;
  const macdHistogramCurrent = macdHistogram[lastIdx] ?? 0;

  const adxCurrent = Number((adxSeries[lastIdx] ?? 0).toFixed(1));
  const plusDiCurrent = Number((plusDiSeries[lastIdx] ?? 0).toFixed(1));
  const minusDiCurrent = Number((minusDiSeries[lastIdx] ?? 0).toFixed(1));
  const adxPrev = adxSeries[Math.max(0, lastIdx - 3)] ?? adxCurrent;
  const adxDelta = Number((adxCurrent - adxPrev).toFixed(1));
  const adxRegime: "strong-trend" | "trending" | "emerging" | "range-bound" =
    adxCurrent >= 40
      ? "strong-trend"
      : adxCurrent >= 25
        ? "trending"
        : adxCurrent >= 20
          ? "emerging"
          : "range-bound";
  const adxDirection: "bullish" | "bearish" | "neutral" =
    plusDiCurrent > minusDiCurrent + 2
      ? "bullish"
      : minusDiCurrent > plusDiCurrent + 2
        ? "bearish"
        : "neutral";
  const trendStrengthLabel =
    adxRegime === "strong-trend"
      ? "Tendencia Muy Fuerte (≥40)"
      : adxRegime === "trending"
        ? "Tendencia Activa (25–40)"
        : adxRegime === "emerging"
          ? "Transición / Ruptura (20–25)"
          : "Rango Lateral (<20)";
  const recentCross = [...series].slice(-4).reverse().find((s) => s.macdCross !== null)?.macdCross ?? null;
  const macdBias: "bullish" | "bearish" | "neutral" =
    macdHistogramCurrent > 0 && macdCurrent >= macdSignalCurrent
      ? "bullish"
      : macdHistogramCurrent < 0 && macdCurrent <= macdSignalCurrent
        ? "bearish"
        : "neutral";

  const macdMomentumLabel =
    recentCross === "bullish"
      ? macroStage === "accumulation" || macroStage === "markup"
        ? `Cruce Alcista MACD (Confirma ${eventBadge})`
        : "Cruce Alcista MACD (Rebote de momentum)"
      : recentCross === "bearish"
        ? macroStage === "distribution" || macroStage === "markdown"
          ? `Cruce Bajista MACD (Confirma ${eventBadge})`
          : "Cruce Bajista MACD (Pérdida de impulso)"
        : macdBias === "bullish"
          ? "Momentum Alcista (MACD > Señal)"
          : macdBias === "bearish"
            ? "Momentum Bajista (MACD < Señal)"
            : "Equilibrio MACD / Compresión";

  // Historical Phase Duration & Cycle Maturity across all supplied OHLCV bars (up to 300)
  const historyBars = bars.slice(-300).map((b, idx, arr) => {
    if (idx === arr.length - 1 && livePrice > 0) {
      return {
        ...b,
        close: livePrice,
        high: Math.max(b.high, livePrice),
        low: Math.min(b.low, livePrice),
      };
    }
    return b;
  });

  const deltas: number[] = [];
  for (let i = 1; i < historyBars.length; i++) {
    const d = historyBars[i].openTime - historyBars[i - 1].openTime;
    if (d > 0) deltas.push(d);
  }
  deltas.sort((a, b) => a - b);
  const barIntervalMs = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : 300_000;

  const histCloses = historyBars.map((b) => b.close);
  const histEma12 = emaSeries(histCloses, 12);
  const histEma34 = emaSeries(histCloses, 34);

  const rawStages: WyckoffMacroStage[] = historyBars.map((b, i) => {
    const lookStart = Math.max(0, i - 19);
    let rHigh = -Infinity;
    let rLow = Infinity;
    for (let j = lookStart; j <= i; j++) {
      if (historyBars[j].high > rHigh) rHigh = historyBars[j].high;
      if (historyBars[j].low < rLow) rLow = historyBars[j].low;
    }
    const rSpan = Math.max(1e-9, rHigh - rLow);
    const pos = (b.close - rLow) / rSpan;
    const slopeRefIdx = Math.max(0, i - 5);
    const prevEma = histEma12[slopeRefIdx] || histEma12[i];
    const slope = prevEma > 0 ? ((histEma12[i] - prevEma) / prevEma) * 100 : 0;

    if (histEma12[i] > histEma34[i] * 1.0015 && slope > 0.14 && pos >= 0.6) {
      return "markup";
    }
    if (histEma12[i] < histEma34[i] * 0.9985 && slope < -0.14 && pos <= 0.4) {
      return "markdown";
    }

    const priorRefIdx = Math.max(0, i - 14);
    const priorClose = historyBars[priorRefIdx].close;
    const priorChg = priorClose > 0 ? ((b.close - priorClose) / priorClose) * 100 : 0;
    const accVotes = (priorChg < -0.15 ? 1 : 0) + (pos <= 0.55 ? 1 : 0) + (slope >= -0.05 ? 1 : 0);
    const distVotes = (priorChg > 0.15 ? 1 : 0) + (pos >= 0.45 ? 1 : 0) + (slope <= 0.05 ? 1 : 0);
    return accVotes >= distVotes ? "accumulation" : "distribution";
  });

  // Smooth isolated 1-bar blips and align active trailing stage with `macroStage`
  const smoothedStages = [...rawStages];
  for (let i = 1; i < smoothedStages.length - 1; i++) {
    if (smoothedStages[i - 1] === smoothedStages[i + 1] && smoothedStages[i] !== smoothedStages[i - 1]) {
      smoothedStages[i] = smoothedStages[i - 1];
    }
  }
  const activeTailTarget = macroStage;
  smoothedStages[smoothedStages.length - 1] = activeTailTarget;
  // Walk backward slightly if only the very last bar flipped, keeping contiguous live phase consistent
  for (let i = smoothedStages.length - 2; i >= Math.max(0, smoothedStages.length - 2); i--) {
    if (smoothedStages[i] === rawStages[smoothedStages.length - 1]) {
      smoothedStages[i] = activeTailTarget;
    } else {
      break;
    }
  }

  interface PhaseEpisode {
    stage: WyckoffMacroStage;
    startIdx: number;
    endIdx: number;
    durationMs: number;
    bars: number;
  }

  const episodes: PhaseEpisode[] = [];
  let epStart = 0;
  for (let i = 1; i <= smoothedStages.length; i++) {
    if (i === smoothedStages.length || smoothedStages[i] !== smoothedStages[epStart]) {
      const endIdx = i - 1;
      const durationMs = Math.max(
        barIntervalMs,
        historyBars[endIdx].openTime - historyBars[epStart].openTime + barIntervalMs
      );
      episodes.push({
        stage: smoothedStages[epStart],
        startIdx: epStart,
        endIdx,
        durationMs,
        bars: endIdx - epStart + 1,
      });
      epStart = i;
    }
  }

  const currentEpisode = episodes[episodes.length - 1];
  const currentPhaseElapsedMs = currentEpisode ? currentEpisode.durationMs : barIntervalMs;
  const historySpanMs = Math.max(
    barIntervalMs,
    (historyBars[historyBars.length - 1]?.openTime ?? 0) - (historyBars[0]?.openTime ?? 0) + barIntervalMs
  );

  const phaseDurations: WyckoffPhaseDurationStat[] = WYCKOFF_STAGES.map((st) => {
    const matching = episodes.filter((e) => e.stage === st.id);
    const occurrences = matching.length;
    const totalDurationMs = matching.reduce((s, e) => s + e.durationMs, 0);
    const avgDurationMs = occurrences > 0 ? totalDurationMs / occurrences : 0;
    const avgBars = occurrences > 0 ? matching.reduce((s, e) => s + e.bars, 0) / occurrences : 0;
    const minDurationMs = occurrences > 0 ? Math.min(...matching.map((e) => e.durationMs)) : 0;
    const maxDurationMs = occurrences > 0 ? Math.max(...matching.map((e) => e.durationMs)) : 0;
    const isCurrent = st.id === macroStage;
    const maturityPct =
      isCurrent && avgDurationMs > 0
        ? Math.round((currentPhaseElapsedMs / avgDurationMs) * 100)
        : null;

    return {
      stage: st.id,
      label: st.label,
      shortLabel: st.shortLabel,
      occurrences,
      avgDurationMs,
      avgDurationHours: avgDurationMs / 3_600_000,
      avgDurationDays: avgDurationMs / 86_400_000,
      avgBars,
      minDurationMs,
      maxDurationMs,
      totalDurationMs,
      sharePct: historySpanMs > 0 ? Math.round((totalDurationMs / historySpanMs) * 100) : 0,
      isCurrent,
      currentElapsedMs: isCurrent ? currentPhaseElapsedMs : 0,
      maturityPct,
    };
  });

  const activeStat = phaseDurations.find((p) => p.stage === macroStage);
  const currentPhaseAvgMs = activeStat?.avgDurationMs ?? currentPhaseElapsedMs;
  const currentPhaseMaturityPct =
    currentPhaseAvgMs > 0 ? Math.round((currentPhaseElapsedMs / currentPhaseAvgMs) * 100) : 100;

  const cycleMaturityLabel =
    currentPhaseMaturityPct >= 110
      ? `Madura (${currentPhaseMaturityPct}% · Probable transición)`
      : currentPhaseMaturityPct >= 75
        ? `Avanzada (${currentPhaseMaturityPct}% de media)`
        : currentPhaseMaturityPct >= 35
          ? `En desarrollo (${currentPhaseMaturityPct}% de media)`
          : `Temprana (${currentPhaseMaturityPct}% de media)`;

  const currentPhaseStartIndex = clamp(
    windowBars.length - (currentEpisode?.bars ?? 1),
    0,
    Math.max(0, windowBars.length - 2)
  );

  const STAGE_STEP_RANGE: Record<WyckoffMacroStage, [number, number]> = {
    accumulation: [0, 5],
    markup: [6, 11],
    distribution: [12, 17],
    markdown: [18, 23],
  };

  const buildHistoricalCycle = (
    ep: PhaseEpisode,
    indexSuffix: number,
    customLabelPrefix?: string
  ): WyckoffHistoricalCycle => {
    const epBars = historyBars.slice(ep.startIdx, ep.endIdx + 1);
    const firstBar = epBars[0];
    const lastBar = epBars[epBars.length - 1];
    const baseClose = firstBar?.close > 0 ? firstBar.close : 1;
    const endClose = lastBar?.close ?? baseClose;
    const returnPct = ((endClose - baseClose) / baseClose) * 100;
    const normalizedCloses = epBars.map((b) => (baseClose > 0 ? b.close / baseClose : 1));

    const stageInfo = WYCKOFF_STAGES.find((s) => s.id === ep.stage)!;
    const [stepStart, stepEnd] = STAGE_STEP_RANGE[ep.stage];
    const stageIdealSlice = WYCKOFF_CANONICAL_CURVE.slice(stepStart, stepEnd + 1);
    const idealMin = Math.min(...stageIdealSlice.map((p) => p.idealPrice));
    const idealMax = Math.max(...stageIdealSlice.map((p) => p.idealPrice));
    const idealSpan = Math.max(8, idealMax - idealMin);

    const epMin = Math.min(...epBars.map((b) => b.close));
    const epMax = Math.max(...epBars.map((b) => b.close));
    const epSpan = Math.max(1e-9, epMax - epMin);

    const curveMappedValues: (number | null)[] = new Array(WYCKOFF_CANONICAL_CURVE.length).fill(null);
    const stageLen = stepEnd - stepStart + 1;
    for (let s = 0; s < stageLen; s++) {
      const samplePos = stageLen > 1 ? (s / (stageLen - 1)) * (epBars.length - 1) : 0;
      const sampleIdx = clamp(Math.round(samplePos), 0, epBars.length - 1);
      const norm = (epBars[sampleIdx].close - epMin) / epSpan;
      curveMappedValues[stepStart + s] = Number((idealMin + norm * idealSpan).toFixed(2));
    }

    return {
      id: `${ep.stage}-${firstBar.openTime}-${indexSuffix}`,
      label: customLabelPrefix ? `${customLabelPrefix} · ${stageInfo.shortLabel}` : stageInfo.shortLabel,
      stage: ep.stage,
      stageLabel: stageInfo.label,
      shortLabel: stageInfo.shortLabel,
      startTime: firstBar.openTime,
      endTime: lastBar.openTime,
      durationMs: ep.durationMs,
      barCount: ep.bars,
      returnPct,
      normalizedCloses,
      curveMappedValues,
      matchesCurrentStage: ep.stage === macroStage,
    };
  };

  let candidateEpisodes = episodes
    .slice(0, -1)
    .filter((ep) => ep.bars >= 3)
    .reverse()
    .slice(0, 12);

  // If the entire historical buffer stayed in a single long episode, offer an earlier historical segment for comparison
  if (candidateEpisodes.length === 0 && historyBars.length >= 14) {
    const splitEnd = Math.max(4, Math.floor(historyBars.length * 0.5) - 1);
    const refDuration = Math.max(
      barIntervalMs,
      historyBars[splitEnd].openTime - historyBars[0].openTime + barIntervalMs
    );
    candidateEpisodes = [
      {
        stage: smoothedStages[0] ?? macroStage,
        startIdx: 0,
        endIdx: splitEnd,
        durationMs: refDuration,
        bars: splitEnd + 1,
      },
    ];
  }

  // Sort so same-stage cycles appear first (most recent first), followed by other historical phases
  const historicalCycles: WyckoffHistoricalCycle[] = candidateEpisodes
    .map((ep, idx) =>
      buildHistoricalCycle(
        ep,
        idx,
        episodes.length <= 1 ? "Ciclo previo" : undefined
      )
    )
    .sort((a, b) => {
      if (a.matchesCurrentStage !== b.matchesCurrentStage) {
        return a.matchesCurrentStage ? -1 : 1;
      }
      return b.startTime - a.startTime;
    });

  const phaseVolumeProfiles: WyckoffPhaseVolumeProfile[] = WYCKOFF_STAGES.flatMap((st) => {
    const matching = episodes.filter((e) => e.stage === st.id);
    if (!matching.length) return [];

    // Use the most recent identified episode for this Wyckoff phase so POC & Value Area match its price range
    const ep = matching[matching.length - 1];
    const epBars = historyBars.slice(ep.startIdx, ep.endIdx + 1);
    if (!epBars.length) return [];

    let rangeLow = Math.min(...epBars.map((b) => b.low));
    let rangeHigh = Math.max(...epBars.map((b) => b.high));
    if (!Number.isFinite(rangeLow) || !Number.isFinite(rangeHigh)) return [];
    if (rangeHigh <= rangeLow) {
      const pad = Math.max(1e-6, Math.abs(rangeLow) * 0.001);
      rangeLow -= pad;
      rangeHigh += pad;
    }

    const numBins = 20;
    const step = (rangeHigh - rangeLow) / numBins;
    const rawBins = Array.from({ length: numBins }, (_, i) => ({
      index: i,
      priceLow: rangeLow + i * step,
      priceHigh: rangeLow + (i + 1) * step,
      priceMid: rangeLow + (i + 0.5) * step,
      volume: 0,
      buyVolume: 0,
      sellVolume: 0,
    }));

    for (const b of epBars) {
      const barVol = Math.max(0, b.volume);
      if (barVol <= 0) continue;
      const buyShare =
        b.high > b.low
          ? clamp((b.close - b.low) / (b.high - b.low), 0.15, 0.85)
          : b.close >= b.open
            ? 0.65
            : 0.35;
      const startBin = clamp(Math.floor((b.low - rangeLow) / step), 0, numBins - 1);
      const endBin = clamp(Math.floor((b.high - rangeLow - 1e-12) / step), startBin, numBins - 1);
      const typicalPrice = (b.high + b.low + b.close) / 3;
      const typicalBin = clamp(Math.floor((typicalPrice - rangeLow) / step), startBin, endBin);

      let weightSum = 0;
      for (let bi = startBin; bi <= endBin; bi++) {
        weightSum += bi === typicalBin ? 1.35 : 1;
      }
      for (let bi = startBin; bi <= endBin; bi++) {
        const w = (bi === typicalBin ? 1.35 : 1) / Math.max(1e-9, weightSum);
        const addVol = barVol * w;
        rawBins[bi].volume += addVol;
        rawBins[bi].buyVolume += addVol * buyShare;
        rawBins[bi].sellVolume += addVol * (1 - buyShare);
      }
    }

    const totalVolume = rawBins.reduce((s, b) => s + b.volume, 0);
    let pocIdx = Math.floor(numBins / 2);
    let maxBinVol = -1;
    for (let i = 0; i < numBins; i++) {
      if (rawBins[i].volume > maxBinVol) {
        maxBinVol = rawBins[i].volume;
        pocIdx = i;
      }
    }
    const poc = rawBins[pocIdx].priceMid;

    // 70% Value Area expansion outward from Point of Control
    let lo = pocIdx;
    let hi = pocIdx;
    let accVol = rawBins[pocIdx].volume;
    const vaTarget = totalVolume * 0.7;
    while (accVol < vaTarget && (lo > 0 || hi < numBins - 1)) {
      const lowCand = lo > 0 ? rawBins[lo - 1].volume : -1;
      const highCand = hi < numBins - 1 ? rawBins[hi + 1].volume : -1;
      if (highCand >= lowCand && hi < numBins - 1) {
        hi += 1;
        accVol += rawBins[hi].volume;
      } else if (lo > 0) {
        lo -= 1;
        accVol += rawBins[lo].volume;
      } else {
        break;
      }
    }

    const val = rawBins[lo].priceLow;
    const vah = rawBins[hi].priceHigh;
    const valueAreaPct = totalVolume > 0 ? Math.round((accVol / totalVolume) * 100) : 70;

    // Descending price order (top-down for vertical side-bar)
    const bins: WyckoffPhaseVolumeBin[] = [];
    for (let i = numBins - 1; i >= 0; i--) {
      const rb = rawBins[i];
      bins.push({
        ...rb,
        pctOfMax: maxBinVol > 0 ? (rb.volume / maxBinVol) * 100 : 0,
        pctOfTotal: totalVolume > 0 ? (rb.volume / totalVolume) * 100 : 0,
        isPOC: i === pocIdx,
        inValueArea: i >= lo && i <= hi,
      });
    }

    return [
      {
        stage: st.id,
        label: st.label,
        shortLabel: st.shortLabel,
        isCurrent: st.id === macroStage,
        episodeCount: matching.length,
        barCount: epBars.length,
        startTime: epBars[0].openTime,
        endTime: epBars[epBars.length - 1].openTime,
        rangeLow,
        rangeHigh,
        totalVolume,
        poc,
        vah,
        val,
        valueAreaPct,
        bins,
      },
    ];
  });

  return {
    ready: true,
    windowStartTime: windowBars[0]?.openTime ?? 0,
    windowEndTime: windowBars[lastIdx]?.openTime ?? 0,
    historySpanMs,
    macroStage,
    stageLabel: stageMeta.label,
    subPhase,
    eventBadge,
    confidencePct,
    cycleStep,
    cycleProgressPct,
    creekResistance,
    iceSupport,
    equilibriumPrice,
    positionInRange,
    trendSlopePct,
    priorMovePct,
    volumeRatio,
    avgVolume: overallAvgVol,
    climaxThresholdVolume: overallAvgVol * 1.5,
    climaxBarCount,
    correlatedClimaxCount,
    macdCurrent,
    macdSignalCurrent,
    macdHistogramCurrent,
    macdBias,
    macdMomentumLabel,
    macdCrossCount,
    adxCurrent,
    plusDiCurrent,
    minusDiCurrent,
    adxPeriodUsed,
    adxRegime,
    adxDirection,
    trendStrengthLabel,
    adxDelta,
    currentPhaseElapsedMs,
    currentPhaseAvgMs,
    currentPhaseMaturityPct,
    cycleMaturityLabel,
    currentPhaseStartIndex,
    phaseDurations,
    historicalCycles,
    phaseVolumeProfiles,
    springDetected,
    utadDetected,
    effortResultLabel,
    summary,
    actionGuidance: stageMeta.actionHint,
    markers,
    curvePoints,
    series,
  };
}

export function projectHistoricalCycleOverlay(
  analysis: WyckoffAnalysis,
  selectedCycle: WyckoffHistoricalCycle | null
): WyckoffOverlayProjection | null {
  if (!analysis.ready || !selectedCycle || analysis.series.length < 2) {
    return null;
  }

  const anchorIndex = clamp(analysis.currentPhaseStartIndex, 0, analysis.series.length - 1);
  const anchorPrice = analysis.series[anchorIndex]?.close || analysis.series[0].close || 1;
  const structureOverlay: (number | null)[] = new Array(analysis.series.length).fill(null);

  for (let k = 0; k < selectedCycle.normalizedCloses.length; k++) {
    const targetIdx = anchorIndex + k;
    if (targetIdx >= analysis.series.length) break;
    structureOverlay[targetIdx] = anchorPrice * selectedCycle.normalizedCloses[k];
  }

  const activeBarsElapsed = Math.max(1, analysis.series.length - anchorIndex);
  const maturityVsSelectedPct =
    selectedCycle.durationMs > 0
      ? Math.round((analysis.currentPhaseElapsedMs / selectedCycle.durationMs) * 100)
      : 100;
  const remainingBarsEstimate = selectedCycle.barCount - activeBarsElapsed;

  const lastClose = analysis.series[analysis.series.length - 1]?.close ?? anchorPrice;
  const currentReturnPct = anchorPrice > 0 ? ((lastClose - anchorPrice) / anchorPrice) * 100 : 0;

  const sameStepIdx = clamp(activeBarsElapsed - 1, 0, selectedCycle.normalizedCloses.length - 1);
  const histRatioAtStep = selectedCycle.normalizedCloses[sameStepIdx] ?? 1;
  const historicalReturnAtSameStepPct = (histRatioAtStep - 1) * 100;

  return {
    cycle: selectedCycle,
    anchorIndex,
    anchorPrice,
    structureOverlay,
    curveOverlay: selectedCycle.curveMappedValues,
    maturityVsSelectedPct,
    activeBarsElapsed,
    remainingBarsEstimate,
    currentReturnPct,
    historicalReturnAtSameStepPct,
  };
}
