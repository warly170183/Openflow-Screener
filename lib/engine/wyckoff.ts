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
  emaFast: number;
  creek: number;
  ice: number;
  equilibrium: number;
  marker?: WyckoffPhaseMarker;
}

export interface WyckoffAnalysis {
  ready: boolean;
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

  const windowBars = bars.slice(-72).map((b, idx, arr) => {
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

  const closes = windowBars.map((b) => b.close);
  const ema12 = emaSeries(closes, 12);
  const ema34 = emaSeries(closes, 34);

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

  const series: WyckoffPricePoint[] = windowBars.map((b, idx) => ({
    time: b.openTime,
    close: b.close,
    high: b.high,
    low: b.low,
    volume: b.volume,
    volumeRatio: overallAvgVol > 0 ? b.volume / overallAvgVol : 1,
    emaFast: ema12[idx],
    creek: creekResistance,
    ice: iceSupport,
    equilibrium: equilibriumPrice,
    marker: markerByBarIndex.get(idx),
  }));

  return {
    ready: true,
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
