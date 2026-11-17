// ============================================================
// TRADING OPTIONS & VOLATILITY ANALYSIS ENGINE
// Computes ATR(14), Bollinger Bands (20, 2σ), and Order-Flow
// confluence from live terminal parameters + timeframe klines
// to generate actionable Long / Short setups with Entry, TP1,
// TP2, volatility-calibrated Stop Loss, and 2–3% risk sizing.
// ============================================================

import {
  averageTrueRange,
  resampleBars,
  rollingVolumeZScores,
} from "@/lib/engine/analytics";
import { analyzeHighVolumeNodes, type HighVolumeNodeAnalysis } from "@/lib/engine/orderFlowEngine";
import type {
  DerivativesAggregate,
  FlowBar,
  FootprintCandle,
  MarketType,
  SessionStats,
  Timeframe,
  VolumeProfile,
} from "@/lib/types/market";

export const DEFAULT_RISK_PCT = 2.5;
export const MIN_RISK_PCT = 0.5;
export const MAX_RISK_PCT = 10;
export const DEFAULT_ACCOUNT_EQUITY_USD = 10_000;

export interface OhlcBar {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BollingerBandValues {
  period: number;
  multiplier: number;
  samples: number;
  ready: boolean;
  middle: number;
  upper: number;
  lower: number;
  stdDev: number;
  bandwidthPct: number;
  percentB: number; // 0 = lower band, 0.5 = middle, 1 = upper band
  regime: "squeeze" | "normal" | "expansion";
}

export interface BollingerChartPoint {
  time: number;
  close: number;
  middle: number;
  upper: number;
  lower: number;
  bandRange: [number, number];
  atr: number | null;
}

export interface VolatilityStopMetrics {
  atr: number;
  atrPct: number;
  atrMultiplier: number;
  bbStdDev: number;
  bbSigmaMultiplier: number;
  atrComponent: number;
  bbComponent: number;
  stopDistance: number;
  stopDistancePct: number;
  bollinger: BollingerBandValues;
}

export interface ParameterSignal {
  id: string;
  label: string;
  value: string;
  bias: "bullish" | "bearish" | "neutral";
  detail: string;
}

export interface TradeSetupOption {
  id: "primary-bias" | "structural-counter";
  title: string;
  subtitle: string;
  setupType: "trend-continuation" | "mean-reversion";
  direction: "long" | "short";
  confidence: "Alta" | "Media" | "Moderada";
  score: number;
  entry: number;
  entryLabel: string;
  stopLoss: number;
  tp1: number;
  tp2: number;
  stopDistance: number;
  stopDistancePct: number;
  rr1: number;
  rr2: number;
  riskPct: number;
  riskUsd: number;
  positionNotionalUsd: number;
  positionUnits: number;
  rewardTp1Usd: number;
  rewardTp2Usd: number;
  rationale: string[];
}

export interface TradingAnalysisInput {
  symbol: string;
  marketType: MarketType;
  timeframe: Timeframe;
  currentPrice: number;
  tickSize: number;
  bars: OhlcBar[];
  session: SessionStats | null;
  volumeProfile: VolumeProfile | null;
  hvnAnalysis?: HighVolumeNodeAnalysis | null;
  currentOBI: number;
  flowBars: FlowBar[];
  derivatives: DerivativesAggregate | null;
  riskPct?: number;
  accountBalanceUsd?: number;
}

export interface TradingAnalysisResult {
  ready: boolean;
  candleCount: number;
  timeframe: Timeframe;
  currentPrice: number;
  overallBias: "long" | "short" | "neutral";
  confluenceScore: number; // -100..+100
  volatility: VolatilityStopMetrics | null;
  bollingerSeries: BollingerChartPoint[];
  signals: ParameterSignal[];
  options: TradeSetupOption[];
}

const TF_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
};

/** Parse OKX REST candle arrays [ts, o, h, l, c, volBase, ...]. */
export function parseOkxOhlcRows(rows: unknown[][]): OhlcBar[] {
  return rows
    .map((r) => ({
      openTime: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5] ?? 0),
    }))
    .filter(
      (b) =>
        Number.isFinite(b.openTime) &&
        Number.isFinite(b.open) &&
        Number.isFinite(b.high) &&
        Number.isFinite(b.low) &&
        Number.isFinite(b.close) &&
        b.open > 0 &&
        b.high >= b.low &&
        b.close > 0
    )
    .sort((a, b) => a.openTime - b.openTime);
}

/** Merge historical OKX klines with live FootprintCandles for the selected timeframe. */
export function mergeOhlcSeries(
  historical: OhlcBar[],
  footprintCandles: FootprintCandle[],
  currentCandle: FootprintCandle | null,
  timeframe: Timeframe
): OhlcBar[] {
  const map = new Map<number, OhlcBar>();
  for (const k of historical) {
    map.set(k.openTime, k);
  }
  const allLive = currentCandle ? [...footprintCandles, currentCandle] : footprintCandles;
  const bucketMs = TF_MS[timeframe];
  for (const c of allLive) {
    if (!(c.open > 0) || !(c.close > 0) || !Number.isFinite(c.high) || !Number.isFinite(c.low)) continue;
    const alignedOpen = Math.floor(c.openTime / bucketMs) * bucketMs;
    const prev = map.get(alignedOpen);
    if (!prev) {
      map.set(alignedOpen, {
        openTime: alignedOpen,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      });
    } else {
      map.set(alignedOpen, {
        openTime: alignedOpen,
        open: prev.open,
        high: Math.max(prev.high, c.high),
        low: Math.min(prev.low, c.low),
        close: c.close,
        volume: Math.max(prev.volume, c.volume),
      });
    }
  }
  return [...map.values()].sort((a, b) => a.openTime - b.openTime);
}

/** Compute Bollinger Bands (SMA 20 ± 2σ) and full chart series. */
export function computeBollingerSeries(
  bars: OhlcBar[],
  period = 20,
  multiplier = 2
): { current: BollingerBandValues | null; series: BollingerChartPoint[] } {
  if (!bars.length) return { current: null, series: [] };

  const series: BollingerChartPoint[] = [];
  const bandwidths: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    const start = Math.max(0, i - period + 1);
    const windowBars = bars.slice(start, i + 1);
    const n = windowBars.length;
    const closes = windowBars.map((b) => b.close);
    const mean = closes.reduce((s, v) => s + v, 0) / n;
    const variance = closes.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const upper = mean + multiplier * stdDev;
    const lower = mean - multiplier * stdDev;
    const bw = mean > 0 ? ((upper - lower) / mean) * 100 : 0;
    bandwidths.push(bw);

    // Local 14-bar ATR approximation for chart series
    const atrSlice = bars.slice(Math.max(0, i - 13), i + 1);
    const trs = atrSlice.map((b, idx) => {
      const globalIdx = Math.max(0, i - 13) + idx;
      if (globalIdx === 0) return b.high - b.low;
      const prevClose = bars[globalIdx - 1].close;
      return Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
    });
    const atr = trs.length ? trs.reduce((s, v) => s + v, 0) / trs.length : null;

    series.push({
      time: bars[i].openTime,
      close: bars[i].close,
      middle: mean,
      upper,
      lower,
      bandRange: [lower, upper],
      atr,
    });
  }

  const last = series[series.length - 1];
  const lastBar = bars[bars.length - 1];
  const stdDev = (last.upper - last.middle) / multiplier;
  const currentBw = last.middle > 0 ? ((last.upper - last.lower) / last.middle) * 100 : 0;
  const percentB = last.upper > last.lower ? (lastBar.close - last.lower) / (last.upper - last.lower) : 0.5;

  const recentBws = bandwidths.slice(-Math.min(50, bandwidths.length));
  const avgBw = recentBws.reduce((s, v) => s + v, 0) / Math.max(1, recentBws.length);
  const regime: BollingerBandValues["regime"] =
    recentBws.length >= 10 && currentBw < avgBw * 0.72
      ? "squeeze"
      : recentBws.length >= 10 && currentBw > avgBw * 1.28
        ? "expansion"
        : "normal";

  return {
    current: {
      period,
      multiplier,
      samples: Math.min(bars.length, period),
      ready: bars.length >= period,
      middle: last.middle,
      upper: last.upper,
      lower: last.lower,
      stdDev,
      bandwidthPct: currentBw,
      percentB,
      regime,
    },
    series,
  };
}

/**
 * Calibrate Stop Loss distance combining Wilder ATR(14) and Bollinger Band σ dispersion.
 * Uses 1.5× ATR(14) weighted 60% + 1.5× BB σ (0.75× half-band) weighted 40%,
 * floored at 1.15× the larger volatility metric and minimum tick cushion.
 */
export function computeVolatilityStop(params: {
  price: number;
  bars: OhlcBar[];
  bollinger: BollingerBandValues;
  tickSize: number;
  atrMultiplier?: number;
  bbSigmaMultiplier?: number;
}): VolatilityStopMetrics {
  const { price, bars, bollinger, tickSize, atrMultiplier = 1.5, bbSigmaMultiplier = 1.5 } = params;
  const pseudoCandles = bars.map((b) => ({
    openTime: b.openTime,
    closeTime: b.openTime,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    delta: 0,
    cumulativeDelta: 0,
    levels: new Map(),
    sortedPrices: [],
    tradeCount: 0,
    maxVolumeAtLevel: 0,
    complete: true,
    venueVolumes: {},
  }));

  const rawAtr = averageTrueRange(pseudoCandles, 14);
  const atr = rawAtr && rawAtr > 0 ? rawAtr : Math.max(price * 0.0025, tickSize * 4);
  const atrPct = price > 0 ? (atr / price) * 100 : 0;

  const atrComponent = atr * atrMultiplier;
  const effectiveStd = bollinger.stdDev > 0 ? bollinger.stdDev : atr * 0.85;
  const bbComponent = effectiveStd * bbSigmaMultiplier;

  const blended = atrComponent * 0.6 + bbComponent * 0.4;
  const floorStop = Math.max(atr * 1.15, effectiveStd * 1.15, tickSize * 3, price * 0.0012);
  const stopDistance = Math.max(blended, floorStop);
  const stopDistancePct = price > 0 ? (stopDistance / price) * 100 : 0;

  return {
    atr,
    atrPct,
    atrMultiplier,
    bbStdDev: effectiveStd,
    bbSigmaMultiplier,
    atrComponent,
    bbComponent,
    stopDistance,
    stopDistancePct,
    bollinger,
  };
}

function snapPrice(price: number, reference: number, tickSize: number): number {
  if (!Number.isFinite(price) || price <= 0) return reference;
  if (tickSize > 0 && tickSize < reference * 0.01) {
    const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(tickSize)) + 1));
    return Number(price.toFixed(decimals));
  }
  const decimals = reference >= 1000 ? 2 : reference >= 1 ? 4 : 6;
  return Number(price.toFixed(decimals));
}

function buildOptionSizing(params: {
  id: TradeSetupOption["id"];
  title: string;
  subtitle: string;
  setupType: TradeSetupOption["setupType"];
  direction: "long" | "short";
  confidence: TradeSetupOption["confidence"];
  score: number;
  entry: number;
  entryLabel: string;
  stopLoss: number;
  tp1: number;
  tp2: number;
  riskPct: number;
  accountBalanceUsd: number;
  rationale: string[];
}): TradeSetupOption {
  const {
    id,
    title,
    subtitle,
    setupType,
    direction,
    confidence,
    score,
    entry,
    entryLabel,
    stopLoss,
    tp1,
    tp2,
    riskPct,
    accountBalanceUsd,
    rationale,
  } = params;

  const stopDistance = Math.abs(entry - stopLoss);
  const stopDistancePct = entry > 0 ? (stopDistance / entry) * 100 : 0;
  const rr1 = stopDistance > 0 ? Math.abs(tp1 - entry) / stopDistance : 1.5;
  const rr2 = stopDistance > 0 ? Math.abs(tp2 - entry) / stopDistance : 2.6;

  const clampedRiskPct = Math.max(MIN_RISK_PCT, Math.min(MAX_RISK_PCT, riskPct));
  const riskUsd = accountBalanceUsd * (clampedRiskPct / 100);
  const stopFraction = entry > 0 ? stopDistance / entry : 0;
  const positionNotionalUsd = stopFraction > 0 ? riskUsd / stopFraction : 0;
  const positionUnits = entry > 0 ? positionNotionalUsd / entry : 0;

  return {
    id,
    title,
    subtitle,
    setupType,
    direction,
    confidence,
    score,
    entry,
    entryLabel,
    stopLoss,
    tp1,
    tp2,
    stopDistance,
    stopDistancePct,
    rr1,
    rr2,
    riskPct: clampedRiskPct,
    riskUsd,
    positionNotionalUsd,
    positionUnits,
    rewardTp1Usd: riskUsd * rr1,
    rewardTp2Usd: riskUsd * rr2,
    rationale,
  };
}

export function evaluateTradingOptions(input: TradingAnalysisInput): TradingAnalysisResult {
  const {
    timeframe,
    currentPrice,
    tickSize,
    bars,
    session,
    volumeProfile,
    currentOBI,
    flowBars,
    derivatives,
    riskPct = DEFAULT_RISK_PCT,
    accountBalanceUsd = DEFAULT_ACCOUNT_EQUITY_USD,
  } = input;

  const lastBarClose = bars[bars.length - 1]?.close ?? 0;
  const price = currentPrice > 0 ? currentPrice : session?.last ?? lastBarClose;

  if (!(price > 0) || bars.length < 2) {
    return {
      ready: false,
      candleCount: bars.length,
      timeframe,
      currentPrice: price,
      overallBias: "neutral",
      confluenceScore: 0,
      volatility: null,
      bollingerSeries: [],
      signals: [],
      options: [],
    };
  }

  const { current: bb, series: bollingerSeries } = computeBollingerSeries(bars, 20, 2);
  if (!bb) {
    return {
      ready: false,
      candleCount: bars.length,
      timeframe,
      currentPrice: price,
      overallBias: "neutral",
      confluenceScore: 0,
      volatility: null,
      bollingerSeries: [],
      signals: [],
      options: [],
    };
  }

  const vol = computeVolatilityStop({
    price,
    bars,
    bollinger: bb,
    tickSize,
    atrMultiplier: 1.5,
    bbSigmaMultiplier: 1.5,
  });

  const hvn = input.hvnAnalysis ?? (volumeProfile ? analyzeHighVolumeNodes(volumeProfile, 0.7, tickSize) : null);

  // Compute order flow studies from 1s flowBars
  const bars5s = resampleBars(flowBars.slice(-900), 5);
  const latestZ = rollingVolumeZScores(bars5s, 20).at(-1)?.z ?? null;
  const buyShare = session && session.volume > 0 ? (session.buyVolume / session.volume) * 100 : 50;
  const netDelta = session ? session.buyVolume - session.sellVolume : 0;
  const vwap = session?.vwap && session.vwap > 0 ? session.vwap : bb.middle;
  const vwapSigma = session && session.vwapStd > 0 ? (price - vwap) / session.vwapStd : 0;
  const poc = volumeProfile?.poc && volumeProfile.poc > 0 ? volumeProfile.poc : bb.middle;
  const vah = volumeProfile?.vah && volumeProfile.vah > 0 ? volumeProfile.vah : bb.upper;
  const val = volumeProfile?.val && volumeProfile.val > 0 ? volumeProfile.val : bb.lower;

  // Score technical & order-flow alignment (-100 to +100)
  let score = 0;
  const signals: ParameterSignal[] = [];

  // 1. Bollinger %B & Mean Position
  const bbBias: ParameterSignal["bias"] =
    bb.percentB >= 0.56 ? "bullish" : bb.percentB <= 0.44 ? "bearish" : "neutral";
  score += bb.percentB >= 0.56 && bb.percentB <= 0.85 ? 18 : bb.percentB > 0.85 ? 8 : bb.percentB <= 0.44 && bb.percentB >= 0.15 ? -18 : bb.percentB < 0.15 ? -8 : 0;
  signals.push({
    id: "bollinger",
    label: "Bandas de Bollinger (20, 2σ)",
    value: `%B ${(bb.percentB * 100).toFixed(0)}% · Ancho ${bb.bandwidthPct.toFixed(2)}%`,
    bias: bbBias,
    detail:
      bb.regime === "squeeze"
        ? "Compresión activa (squeeze): ruptura inminente de volatilidad."
        : bb.regime === "expansion"
          ? "Expansión de bandas: tendencia con alta dispersión."
          : "Volatilidad en rango equilibrado.",
  });

  // 2. ATR(14) Volatility Stop Calibration
  signals.push({
    id: "atr",
    label: `ATR(14) en ${timeframe}`,
    value: `${vol.atrPct.toFixed(2)}% · SL ±${vol.stopDistancePct.toFixed(2)}%`,
    bias: "neutral",
    detail: `Stop Loss calibrado con 1.5×ATR (${vol.atrComponent.toFixed(price >= 100 ? 2 : 4)}) + 1.5σ BB (${vol.bbComponent.toFixed(price >= 100 ? 2 : 4)}).`,
  });

  // 3. VWAP & σ Deviation
  const vwapBias: ParameterSignal["bias"] =
    price > vwap * 1.0005 ? "bullish" : price < vwap * 0.9995 ? "bearish" : "neutral";
  score += vwapBias === "bullish" ? 20 : vwapBias === "bearish" ? -20 : 0;
  signals.push({
    id: "vwap",
    label: "VWAP de Sesión",
    value: `${vwapSigma >= 0 ? "+" : ""}${vwapSigma.toFixed(2)}σ`,
    bias: vwapBias,
    detail: price >= vwap ? "Precio cotizando sobre el VWAP institucional (control comprador)." : "Precio por debajo del VWAP (presión vendedora).",
  });

  // 4. Order Book Imbalance (OBI)
  const obiBias: ParameterSignal["bias"] =
    currentOBI >= 0.08 ? "bullish" : currentOBI <= -0.08 ? "bearish" : "neutral";
  score += Math.round(Math.max(-25, Math.min(25, currentOBI * 45)));
  signals.push({
    id: "obi",
    label: "Desequilibrio del Libro (OBI)",
    value: `${currentOBI >= 0 ? "+" : ""}${(currentOBI * 100).toFixed(1)}%`,
    bias: obiBias,
    detail: obiBias === "bullish" ? "Profundidad Bid dominante absorbiendo oferta." : obiBias === "bearish" ? "Muro Ask dominante presionando el libro." : "Libro de órdenes equilibrado.",
  });

  // 5. Aggressive Delta & Volume Z-Score
  const deltaBias: ParameterSignal["bias"] =
    buyShare >= 52.5 ? "bullish" : buyShare <= 47.5 ? "bearish" : "neutral";
  score += deltaBias === "bullish" ? 20 : deltaBias === "bearish" ? -20 : 0;
  signals.push({
    id: "delta",
    label: "Flujo Agresivo (Delta / Vol z)",
    value: `${buyShare.toFixed(1)}% Buy${latestZ !== null ? ` · z ${latestZ >= 0 ? "+" : ""}${latestZ.toFixed(1)}σ` : ""}`,
    bias: deltaBias,
    detail: `Delta acumulado neto ${netDelta >= 0 ? "+" : ""}${netDelta.toFixed(2)} unidades ejecutadas en mercado.`,
  });

  // 6. Value Area & HVN Nodes
  const vaBias: ParameterSignal["bias"] =
    price > poc ? "bullish" : price < poc ? "bearish" : "neutral";
  score += vaBias === "bullish" ? 12 : vaBias === "bearish" ? -12 : 0;
  signals.push({
    id: "vap",
    label: "Perfil VAP (POC / HVN)",
    value: `${hvn?.nodes.length ?? 0} nodos HVN`,
    bias: vaBias,
    detail:
      price >= poc
        ? `Soporte estructural en POC y Value Area (${snapPrice(val, price, tickSize)} – ${snapPrice(vah, price, tickSize)}).`
        : `Resistencia en POC superior; buscando liquidez en VAL.`,
  });

  // 7. Derivatives basis / funding (perpetuals)
  if (input.marketType === "perpetual" && derivatives) {
    const basis = derivatives.basisBps ?? 0;
    const funding = derivatives.fundingRate8h ?? derivatives.primaryFundingRate ?? 0;
    const derivBias: ParameterSignal["bias"] = basis > 1.5 ? "bullish" : basis < -1.5 ? "bearish" : "neutral";
    score += derivBias === "bullish" ? 5 : derivBias === "bearish" ? -5 : 0;
    signals.push({
      id: "derivatives",
      label: "Derivados (Basis / Funding)",
      value: `${basis >= 0 ? "+" : ""}${basis.toFixed(1)} bp · ${(funding * 100).toFixed(4)}%`,
      bias: derivBias,
      detail: basis >= 0 ? "Futuro cotizando con prima respecto al índice spot." : "Futuro con descuento respecto al índice.",
    });
  }

  const clampedScore = Math.max(-100, Math.min(100, score));
  const overallBias: TradingAnalysisResult["overallBias"] =
    clampedScore >= 14 ? "long" : clampedScore <= -14 ? "short" : "neutral";

  const primaryDir: "long" | "short" =
    overallBias !== "neutral" ? overallBias : price >= bb.middle ? "long" : "short";
  const absScore = Math.abs(clampedScore);
  const primaryConf: TradeSetupOption["confidence"] =
    absScore >= 50 ? "Alta" : absScore >= 24 ? "Media" : "Moderada";

  const stopDist = vol.stopDistance;

  // Locate nearest structural HVN levels above/below entry for smarter TP anchoring
  const hvnAbove = hvn?.nodes
    .map((n) => n.price)
    .filter((p) => p > price + stopDist * 0.75)
    .sort((a, b) => a - b)[0];
  const hvnBelow = hvn?.nodes
    .map((n) => n.price)
    .filter((p) => p < price - stopDist * 0.75)
    .sort((a, b) => b - a)[0];

  // ── Option 1: Primary directional setup aligned to live parameters ──
  const primaryEntryRaw =
    primaryDir === "long"
      ? bb.percentB > 0.88
        ? Math.max(price - stopDist * 0.25, bb.middle)
        : price
      : bb.percentB < 0.12
        ? Math.min(price + stopDist * 0.25, bb.middle)
        : price;

  const primaryEntry = snapPrice(primaryEntryRaw, price, tickSize);
  const primaryStopRaw = primaryDir === "long" ? primaryEntry - stopDist : primaryEntry + stopDist;
  const primaryStop = snapPrice(primaryStopRaw, price, tickSize);

  const primaryTp1Raw =
    primaryDir === "long"
      ? Math.max(primaryEntry + stopDist * 1.5, Math.min(primaryEntry + stopDist * 2.1, Math.max(bb.upper, vah, hvnAbove ?? 0)))
      : Math.min(primaryEntry - stopDist * 1.5, Math.max(primaryEntry - stopDist * 2.1, Math.min(bb.lower, val, hvnBelow ?? Infinity)));
  const primaryTp2Raw =
    primaryDir === "long"
      ? Math.max(primaryTp1Raw + stopDist * 0.9, primaryEntry + stopDist * 2.65)
      : Math.min(primaryTp1Raw - stopDist * 0.9, primaryEntry - stopDist * 2.65);

  const primaryRationale = [
    `Sesgo técnico ${primaryDir === "long" ? "alcista" : "bajista"} con puntuación de confluencia ${clampedScore >= 0 ? "+" : ""}${clampedScore}/100 en ${timeframe}.`,
    `Stop Loss fijado a ${vol.stopDistancePct.toFixed(2)}% combinando 1.5× ATR(14) y 1.5σ de Bandas de Bollinger (${bb.regime === "squeeze" ? "squeeze" : bb.regime === "expansion" ? "expansión" : "rango normal"}).`,
    `Flujo Order Flow: OBI ${(currentOBI * 100).toFixed(1)}%, compras agresivas ${buyShare.toFixed(1)}% y VWAP en ${snapPrice(vwap, price, tickSize)}.`,
  ];

  const primaryOption = buildOptionSizing({
    id: "primary-bias",
    title: primaryDir === "long" ? "Opción Principal · Compra (Long)" : "Opción Principal · Venta (Short)",
    subtitle:
      primaryDir === "long"
        ? bb.percentB > 0.88
          ? "Retroceso controlado a zona de valor"
          : "Continuación alineada con flujo y VWAP"
        : bb.percentB < 0.12
          ? "Rebote técnico a zona media para corto"
          : "Continuación bajista alineada con OBI y VWAP",
    setupType: "trend-continuation",
    direction: primaryDir,
    confidence: primaryConf,
    score: Math.min(98, Math.max(42, 50 + Math.round(absScore * 0.5))),
    entry: primaryEntry,
    entryLabel:
      Math.abs(primaryEntry - price) / price < 0.001 ? "Entrada de mercado / inmediata" : "Entrada límite (pullback)",
    stopLoss: primaryStop,
    tp1: snapPrice(primaryTp1Raw, price, tickSize),
    tp2: snapPrice(primaryTp2Raw, price, tickSize),
    riskPct,
    accountBalanceUsd,
    rationale: primaryRationale,
  });

  // ── Option 2: Structural Bollinger Band + Value Area reversal / edge trigger ──
  const counterDir: "long" | "short" = primaryDir === "long" ? "short" : "long";
  const counterAnchorRaw =
    counterDir === "long"
      ? Math.min(bb.lower, val > 0 ? val : bb.lower)
      : Math.max(bb.upper, vah > 0 ? vah : bb.upper);
  // Keep structural anchor reasonable relative to current price
  const counterEntryRaw =
    counterDir === "long"
      ? Math.min(price - stopDist * 0.45, Math.max(counterAnchorRaw, price - stopDist * 2.2))
      : Math.max(price + stopDist * 0.45, Math.min(counterAnchorRaw, price + stopDist * 2.2));
  const counterEntry = snapPrice(counterEntryRaw, price, tickSize);
  const counterStop = snapPrice(
    counterDir === "long" ? counterEntry - stopDist * 1.1 : counterEntry + stopDist * 1.1,
    price,
    tickSize
  );
  const counterTp1Raw =
    counterDir === "long"
      ? Math.max(counterEntry + stopDist * 1.6, Math.min(bb.middle, poc))
      : Math.min(counterEntry - stopDist * 1.6, Math.max(bb.middle, poc));
  const counterTp2Raw =
    counterDir === "long"
      ? Math.max(counterTp1Raw + stopDist, bb.upper)
      : Math.min(counterTp1Raw - stopDist, bb.lower);

  const counterOption = buildOptionSizing({
    id: "structural-counter",
    title:
      counterDir === "long"
        ? "Opción Estructural · Rebote en Banda Inferior / VAL"
        : "Opción Estructural · Rechazo en Banda Superior / VAH",
    subtitle: "Operación límite en extremo de volatilidad Bollinger + Value Area",
    setupType: "mean-reversion",
    direction: counterDir,
    confidence: bb.regime === "expansion" ? "Moderada" : "Media",
    score: Math.max(38, 72 - Math.round(absScore * 0.25)),
    entry: counterEntry,
    entryLabel: "Orden límite en extremo Bollinger + VA",
    stopLoss: counterStop,
    tp1: snapPrice(counterTp1Raw, price, tickSize),
    tp2: snapPrice(counterTp2Raw, price, tickSize),
    riskPct,
    accountBalanceUsd,
    rationale: [
      `Nivel reactivo anclado en ${counterDir === "long" ? "Banda Inferior Bollinger / VAL" : "Banda Superior Bollinger / VAH"} buscando reversión hacia la media (${snapPrice(bb.middle, price, tickSize)}) y POC (${snapPrice(poc, price, tickSize)}).`,
      `Stop Loss ampliado 1.1× sobre la base ATR + Bollinger (±${((Math.abs(counterEntry - counterStop) / counterEntry) * 100).toFixed(2)}%) para absorber barridos de liquidez en extremos.`,
      `TP1 apunta al retorno al equilibrio (Media 20 / POC) y TP2 proyecta cruce hacia la banda contraria.`,
    ],
  });

  return {
    ready: bb.ready,
    candleCount: bars.length,
    timeframe,
    currentPrice: price,
    overallBias,
    confluenceScore: clampedScore,
    volatility: vol,
    bollingerSeries,
    signals,
    options: [primaryOption, counterOption],
  };
}
