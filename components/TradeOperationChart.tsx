"use client";

import React, { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Segmented } from "@/components/ui/Primitives";
import { extractLiquidityLevels } from "@/lib/engine/liquidityLevels";
import {
  type BollingerChartPoint,
  type TradeSetupOption,
} from "@/lib/engine/tradingOptions";
import type {
  AggregatedOrderBook,
  FlowBar,
  MarketType,
  NormalizedOrderBook,
  Timeframe,
} from "@/lib/types/market";
import { formatClock, formatCompact, formatPriceValue } from "@/lib/format";
import { Activity, CandlestickChart, Layers, Maximize2 } from "lucide-react";

type ProjectionChartMode = "candles" | "live1s";

interface LiveChartPoint {
  time: number;
  label: string;
  price: number;
  upper?: number;
  middle?: number;
  lower?: number;
  bandRange?: [number, number];
  atr?: number | null;
  volume?: number;
  delta?: number;
}

function OperationTooltip({
  active,
  payload,
  decimals,
  mode,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: LiveChartPoint }>;
  decimals: number;
  mode: ProjectionChartMode;
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div
      className="rounded-lg border border-border bg-bg-panel-alt px-2.5 py-2 text-[11px] shadow-lg"
      style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
    >
      <div className="mb-1 text-text-muted">{formatClock(pt.time, mode === "live1s")}</div>
      <div className="flex justify-between gap-4">
        <span className="text-text-secondary">Precio</span>
        <span className="font-semibold text-text-primary">{formatPriceValue(pt.price, decimals)}</span>
      </div>
      {mode === "candles" && pt.upper !== undefined && pt.middle !== undefined && pt.lower !== undefined && (
        <>
          <div className="flex justify-between gap-4">
            <span className="text-text-secondary">BB Superior (+2σ)</span>
            <span className="text-buy">{formatPriceValue(pt.upper, decimals)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-text-secondary">Media SMA(20)</span>
            <span className="text-vwap">{formatPriceValue(pt.middle, decimals)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-text-secondary">BB Inferior (-2σ)</span>
            <span className="text-sell">{formatPriceValue(pt.lower, decimals)}</span>
          </div>
          {pt.atr !== null && pt.atr !== undefined && (
            <div className="mt-1 flex justify-between gap-4 border-t border-border-muted pt-1">
              <span className="text-text-secondary">ATR local</span>
              <span className="text-warn">{formatPriceValue(pt.atr, decimals)}</span>
            </div>
          )}
        </>
      )}
      {mode === "live1s" && pt.delta !== undefined && pt.volume !== undefined && (
        <>
          <div className="flex justify-between gap-4">
            <span className="text-text-secondary">Volumen 1s</span>
            <span className="text-text-primary">{formatCompact(pt.volume, 3)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-text-secondary">Delta 1s</span>
            <span className={pt.delta >= 0 ? "text-buy" : "text-sell"}>
              {pt.delta >= 0 ? "+" : ""}
              {formatCompact(pt.delta, 3)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default function TradeOperationChart({
  symbol,
  baseSymbol,
  marketType,
  timeframe,
  decimals,
  tickSize,
  livePrice,
  vwap,
  bollingerSeries,
  flowBars,
  liveBar,
  orderBook,
  activeOption,
  height = 320,
  onExpand,
}: {
  symbol: string;
  baseSymbol: string;
  marketType: MarketType;
  timeframe: Timeframe;
  decimals: number;
  tickSize: number;
  livePrice: number;
  vwap?: number | null;
  bollingerSeries: BollingerChartPoint[];
  flowBars: FlowBar[];
  liveBar: FlowBar | null;
  orderBook: NormalizedOrderBook | AggregatedOrderBook | null;
  activeOption: TradeSetupOption | null;
  height?: number;
  onExpand?: () => void;
}) {
  const [mode, setMode] = useState<ProjectionChartMode>("candles");
  const [showLiquidity, setShowLiquidity] = useState(true);

  const candlePoints = useMemo<LiveChartPoint[]>(() => {
    const slice = bollingerSeries.slice(-60);
    if (!slice.length) return [];
    return slice.map((pt, idx) => {
      const isLast = idx === slice.length - 1;
      const price = isLast && livePrice > 0 ? livePrice : pt.close;
      return {
        time: pt.time,
        label: formatClock(pt.time).slice(0, 5),
        price,
        upper: pt.upper,
        middle: pt.middle,
        lower: pt.lower,
        bandRange: pt.bandRange,
        atr: pt.atr,
      };
    });
  }, [bollingerSeries, livePrice]);

  const liveTickPoints = useMemo<LiveChartPoint[]>(() => {
    const merged = liveBar ? [...flowBars, liveBar] : flowBars;
    const recent = merged.slice(-120);
    return recent.map((b, idx) => ({
      time: b.time,
      label: formatClock(b.time, false),
      price: idx === recent.length - 1 && livePrice > 0 ? livePrice : b.close,
      volume: b.volume,
      delta: b.buyVolume - b.sellVolume,
    }));
  }, [flowBars, liveBar, livePrice]);

  const activeData = mode === "candles" ? candlePoints : liveTickPoints;

  const chartDomain = useMemo<[number, number] | ["auto", "auto"]>(() => {
    if (!activeData.length) return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const pt of activeData) {
      min = Math.min(min, pt.lower ?? pt.price, pt.price);
      max = Math.max(max, pt.upper ?? pt.price, pt.price);
    }
    if (activeOption) {
      min = Math.min(min, activeOption.stopLoss, activeOption.tp2, activeOption.entry);
      max = Math.max(max, activeOption.stopLoss, activeOption.tp2, activeOption.entry);
    }
    if (livePrice > 0) {
      min = Math.min(min, livePrice);
      max = Math.max(max, livePrice);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return ["auto", "auto"];
    const pad = (max - min) * 0.08;
    return [min - pad, max + pad];
  }, [activeData, activeOption, livePrice]);

  // Extract L2 liquidity levels strictly inside / adjacent to the proposed trade window
  const nearbyLiquidity = useMemo(() => {
    const ref = activeOption?.entry ?? livePrice;
    if (!orderBook || !(ref > 0)) {
      return { bids: [], asks: [], all: [], medianSize: 0, wallThreshold: 0, maxSize: 0 };
    }
    const loBound = Array.isArray(chartDomain) && typeof chartDomain[0] === "number" ? chartDomain[0] * 0.996 : ref * 0.96;
    const hiBound = Array.isArray(chartDomain) && typeof chartDomain[1] === "number" ? chartDomain[1] * 1.004 : ref * 1.04;
    return extractLiquidityLevels({
      book: orderBook,
      referencePrice: ref,
      tickSize,
      maxPerSide: 3,
      minPrice: loBound,
      maxPrice: hiBound,
    });
  }, [orderBook, activeOption?.entry, livePrice, tickSize, chartDomain]);

  const profitZone = useMemo(() => {
    if (!activeOption) return null;
    const y1 = Math.min(activeOption.entry, activeOption.tp2);
    const y2 = Math.max(activeOption.entry, activeOption.tp2);
    return { y1, y2 };
  }, [activeOption]);

  const riskZone = useMemo(() => {
    if (!activeOption) return null;
    const y1 = Math.min(activeOption.entry, activeOption.stopLoss);
    const y2 = Math.max(activeOption.entry, activeOption.stopLoss);
    return { y1, y2 };
  }, [activeOption]);

  const pairLabel = marketType === "forex" ? symbol : `${baseSymbol}/USDT`;

  return (
    <div className="flex flex-col gap-3">
      {/* Header row with mode switcher + liquidity toggle + live level legend */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border-muted pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="xs"
            value={mode}
            onChange={setMode}
            options={[
              {
                value: "candles",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <CandlestickChart size={12} />
                    <span>Velas + BB ({timeframe})</span>
                  </span>
                ),
                title: `Evolución en vivo sobre velas ${timeframe} y Bandas de Bollinger`,
              },
              {
                value: "live1s",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Activity size={12} />
                    <span>Tick a Tick (1s Vivo)</span>
                  </span>
                ),
                title: "Flujo segundo a segundo de OKX contra Entrada, SL, TP1 y TP2",
              },
            ]}
            ariaLabel="Modo del gráfico de operación"
          />

          <button
            type="button"
            onClick={() => setShowLiquidity((prev) => !prev)}
            aria-pressed={showLiquidity}
            className={`ui-button chip ${showLiquidity ? "is-active" : ""}`}
            title="Mostrar u ocultar niveles de liquidez Bid/Ask del libro L2 cercanos a la operación"
          >
            <Layers size={12} />
            <span>Liquidez cercana</span>
          </button>

          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-buy">
            <span className="status-dot live" />
            <span>{pairLabel}</span>
            {livePrice > 0 && (
              <strong className="text-text-primary">{formatPriceValue(livePrice, decimals)}</strong>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums">
          {activeOption && (
            <>
              <span className="text-buy">TP2 {formatPriceValue(activeOption.tp2, decimals)}</span>
              <span className="text-buy">TP1 {formatPriceValue(activeOption.tp1, decimals)}</span>
              <span className="text-accent">E {formatPriceValue(activeOption.entry, decimals)}</span>
              <span className="text-sell">SL {formatPriceValue(activeOption.stopLoss, decimals)}</span>
            </>
          )}
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="ui-button chip"
              title="Abrir proyección en ventana ampliada"
            >
              <Maximize2 size={12} />
              <span>Ampliar</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Real-time Recharts Visualization */}
      <div style={{ height }} className="w-full">
        {activeData.length < 2 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[12.5px] text-text-muted">
            <p>
              {mode === "live1s"
                ? `Esperando al menos 2 segundos de flujo vivo para ${pairLabel}…`
                : `Esperando serie de velas de ${timeframe} para proyectar la operación…`}
            </p>
            {mode === "live1s" && candlePoints.length >= 2 && (
              <button
                type="button"
                onClick={() => setMode("candles")}
                className="ui-button chip is-primary"
              >
                Ver Velas + Bollinger ({timeframe})
              </button>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
            <ComposedChart data={activeData} margin={{ top: 12, right: 88, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                minTickGap={34}
                tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={{ stroke: "var(--border-muted)" }}
                tickLine={false}
              />
              <YAxis
                domain={chartDomain}
                width={72}
                tickFormatter={(v: number) => formatPriceValue(v, decimals)}
                tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<OperationTooltip decimals={decimals} mode={mode} />} />

              {/* Trade Risk & Profit Shaded Zones */}
              {profitZone && (
                <ReferenceArea
                  y1={profitZone.y1}
                  y2={profitZone.y2}
                  fill="var(--buy)"
                  fillOpacity={0.08}
                  ifOverflow="extendDomain"
                />
              )}
              {riskZone && (
                <ReferenceArea
                  y1={riskZone.y1}
                  y2={riskZone.y2}
                  fill="var(--sell)"
                  fillOpacity={0.09}
                  ifOverflow="extendDomain"
                />
              )}

              {/* Nearby L2 Liquidity Pools around Trade Setup */}
              {showLiquidity &&
                nearbyLiquidity.asks.map((lvl) => (
                  <ReferenceLine
                    key={lvl.id}
                    y={lvl.price}
                    stroke="var(--sell)"
                    strokeWidth={lvl.isWall ? 1.5 : 1}
                    strokeOpacity={lvl.isWall ? 0.78 : 0.45}
                    strokeDasharray="2 4"
                    label={{
                      value: `Liq Ask ${formatCompact(lvl.size, 2)}${lvl.isWall ? " ★" : ""}`,
                      position: "insideTopLeft",
                      fill: "var(--sell)",
                      fontSize: 9.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                ))}
              {showLiquidity &&
                nearbyLiquidity.bids.map((lvl) => (
                  <ReferenceLine
                    key={lvl.id}
                    y={lvl.price}
                    stroke="var(--buy)"
                    strokeWidth={lvl.isWall ? 1.5 : 1}
                    strokeOpacity={lvl.isWall ? 0.78 : 0.45}
                    strokeDasharray="2 4"
                    label={{
                      value: `Liq Bid ${formatCompact(lvl.size, 2)}${lvl.isWall ? " ★" : ""}`,
                      position: "insideBottomLeft",
                      fill: "var(--buy)",
                      fontSize: 9.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                ))}

              {/* Bollinger Envelope in Candle Mode */}
              {mode === "candles" && (
                <>
                  <Area
                    type="monotone"
                    dataKey="bandRange"
                    name="Bandas Bollinger"
                    stroke="none"
                    fill="var(--vwap)"
                    fillOpacity={0.1}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="upper"
                    stroke="var(--vwap)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="middle"
                    stroke="var(--vwap)"
                    strokeWidth={1.25}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="lower"
                    stroke="var(--vwap)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                </>
              )}

              {/* Session VWAP context line */}
              {vwap && vwap > 0 && (
                <ReferenceLine
                  y={vwap}
                  stroke="var(--vwap)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  label={{
                    value: "VWAP",
                    position: "insideTopLeft",
                    fill: "var(--vwap)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                />
              )}

              {/* Live Price Curve */}
              <Line
                type="monotone"
                dataKey="price"
                stroke="var(--text-primary)"
                strokeWidth={2.1}
                dot={false}
                isAnimationActive={false}
              />

              {/* Live Spot Horizontal Marker */}
              {livePrice > 0 && (
                <ReferenceLine
                  y={livePrice}
                  stroke="var(--text-secondary)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  label={{
                    value: `Vivo ${formatPriceValue(livePrice, decimals)}`,
                    position: "right",
                    fill: "var(--text-primary)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                />
              )}

              {/* Active Trade Operation Levels */}
              {activeOption && (
                <>
                  <ReferenceLine
                    y={activeOption.tp2}
                    stroke="var(--buy)"
                    strokeWidth={1.8}
                    label={{
                      value: `TP2 ${formatPriceValue(activeOption.tp2, decimals)}`,
                      position: "right",
                      fill: "var(--buy)",
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <ReferenceLine
                    y={activeOption.tp1}
                    stroke="var(--buy)"
                    strokeWidth={1.4}
                    strokeDasharray="4 2"
                    label={{
                      value: `TP1 ${formatPriceValue(activeOption.tp1, decimals)}`,
                      position: "right",
                      fill: "var(--buy)",
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <ReferenceLine
                    y={activeOption.entry}
                    stroke="var(--accent)"
                    strokeWidth={1.8}
                    strokeDasharray="5 2"
                    label={{
                      value: `E ${formatPriceValue(activeOption.entry, decimals)}`,
                      position: "right",
                      fill: "var(--accent)",
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <ReferenceLine
                    y={activeOption.stopLoss}
                    stroke="var(--sell)"
                    strokeWidth={1.8}
                    strokeDasharray="4 2"
                    label={{
                      value: `SL ${formatPriceValue(activeOption.stopLoss, decimals)}`,
                      position: "right",
                      fill: "var(--sell)",
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Nearby L2 Liquidity Pools Strip */}
      {showLiquidity && (
        <div className="rounded-[var(--radius)] border border-border-muted bg-bg-surface/70 px-3 py-2">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-text-primary">
              Niveles de Liquidez Cercanos a la Operación (Libro L2)
            </span>
            <span className="font-mono text-[10.5px] text-text-muted">
              ★ = Muro destacado (≥3.2× mediana)
            </span>
          </div>
          {nearbyLiquidity.all.length === 0 ? (
            <div className="text-[11px] text-text-muted">
              {marketType === "forex"
                ? "El feed FX no expone libro L2 profundo para niveles descansando."
                : "Esperando instantánea L2 de OKX dentro del rango de la operación…"}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 font-mono text-[11px] tabular-nums">
              {nearbyLiquidity.all.map((lvl) => (
                <div
                  key={lvl.id}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border-muted bg-bg-panel px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: lvl.side === "bid" ? "var(--buy)" : "var(--sell)" }}
                    />
                    <span className={lvl.side === "bid" ? "text-buy font-semibold" : "text-sell font-semibold"}>
                      {lvl.side === "bid" ? "Bid" : "Ask"} {formatPriceValue(lvl.price, decimals)}
                    </span>
                    {lvl.isWall && <span className="text-warn">★</span>}
                  </div>
                  <div className="text-right text-text-secondary shrink-0">
                    <strong className="text-text-primary">{formatCompact(lvl.size, 2)}</strong>{" "}
                    <span className="text-[10px] text-text-muted">
                      ({lvl.distancePct >= 0 ? "+" : ""}
                      {lvl.distancePct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
