"use client";

import React, { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Segmented } from "@/components/ui/Primitives";
import { extractLiquidityLevels, type LiquidityLevel } from "@/lib/engine/liquidityLevels";
import { analyzeHighVolumeNodes } from "@/lib/engine/orderFlowEngine";
import type { OhlcBar } from "@/lib/engine/tradingOptions";
import type {
  AggregatedOrderBook,
  MarketType,
  NormalizedOrderBook,
  Timeframe,
  VolumeProfile,
} from "@/lib/types/market";
import { formatClock, formatCompact, formatPriceValue } from "@/lib/format";
import { CandlestickChart, Layers } from "lucide-react";

type LiquidityFilterMode = "top" | "walls";

interface CandlePoint {
  time: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  wickRange: [number, number];
  isBull: boolean;
}

interface CandleShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: CandlePoint;
}

function CandlestickShape({ x = 0, y = 0, width = 8, height = 0, payload }: CandleShapeProps) {
  if (!payload) return null;
  const color = payload.isBull ? "var(--buy)" : "var(--sell)";
  const centerX = x + width / 2;
  const candleWidth = Math.max(3, Math.min(12, width * 0.68));
  const bodyX = centerX - candleWidth / 2;

  const span = payload.high - payload.low;
  if (!(span > 0) || !(height > 0)) {
    return (
      <g>
        <line x1={bodyX} y1={y} x2={bodyX + candleWidth} y2={y} stroke={color} strokeWidth={1.8} />
      </g>
    );
  }

  const priceToY = (p: number) => y + ((payload.high - p) / span) * height;
  const openY = priceToY(payload.open);
  const closeY = priceToY(payload.close);
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(1.8, Math.abs(closeY - openY));

  return (
    <g>
      <line x1={centerX} y1={y} x2={centerX} y2={y + height} stroke={color} strokeWidth={1.35} strokeOpacity={0.9} />
      <rect
        x={bodyX}
        y={bodyTop}
        width={candleWidth}
        height={bodyHeight}
        rx={1}
        fill={color}
        fillOpacity={payload.isBull ? 0.9 : 0.88}
      />
    </g>
  );
}

function CandleLiquidityTooltip({
  active,
  payload,
  decimals,
  levels,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CandlePoint }>;
  decimals: number;
  levels: LiquidityLevel[];
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  const changePct = pt.open > 0 ? ((pt.close - pt.open) / pt.open) * 100 : 0;
  const touchingLevels = levels.filter((lvl) => lvl.price >= pt.low * 0.999 && lvl.price <= pt.high * 1.001);

  return (
    <div
      className="rounded-lg border border-border bg-bg-panel-alt px-2.5 py-2 text-[11px] shadow-lg"
      style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
    >
      <div className="mb-1 flex items-center justify-between gap-4 text-text-muted">
        <span>{formatClock(pt.time)}</span>
        <span className={pt.isBull ? "text-buy" : "text-sell"}>
          {changePct >= 0 ? "+" : ""}
          {changePct.toFixed(2)}%
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-text-secondary">Apertura</span>
        <span className="text-text-primary">{formatPriceValue(pt.open, decimals)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-text-secondary">Máximo</span>
        <span className="text-text-primary">{formatPriceValue(pt.high, decimals)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-text-secondary">Mínimo</span>
        <span className="text-text-primary">{formatPriceValue(pt.low, decimals)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-text-secondary">Cierre</span>
        <span className={`font-semibold ${pt.isBull ? "text-buy" : "text-sell"}`}>
          {formatPriceValue(pt.close, decimals)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-text-secondary">Volumen</span>
        <span className="text-text-primary">{formatCompact(pt.volume, 2)}</span>
      </div>
      {touchingLevels.length > 0 && (
        <div className="mt-1.5 border-t border-border-muted pt-1">
          <div className="text-[10px] uppercase text-text-muted">Liquidez en rango de vela</div>
          {touchingLevels.slice(0, 3).map((lvl) => (
            <div key={lvl.id} className="flex justify-between gap-3">
              <span className={lvl.side === "bid" ? "text-buy" : "text-sell"}>
                {lvl.side === "bid" ? "Bid" : "Ask"} {formatPriceValue(lvl.price, decimals)}
              </span>
              <span className="text-text-primary">{formatCompact(lvl.size, 2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LiquidityCandlesChart({
  symbol,
  marketType,
  timeframe,
  tickSize,
  decimals,
  bars,
  livePrice,
  orderBook,
  volumeProfile,
  hvnThreshold,
}: {
  symbol: string;
  marketType: MarketType;
  timeframe: Timeframe;
  tickSize: number;
  decimals: number;
  bars: OhlcBar[];
  livePrice: number;
  orderBook: NormalizedOrderBook | AggregatedOrderBook | null;
  volumeProfile: VolumeProfile | null;
  hvnThreshold: number;
}) {
  const [filterMode, setFilterMode] = useState<LiquidityFilterMode>("top");
  const [showHvn, setShowHvn] = useState(true);

  const candleData = useMemo<CandlePoint[]>(() => {
    const slice = bars.slice(-64);
    if (!slice.length) return [];
    return slice.map((b, idx) => {
      const isLast = idx === slice.length - 1;
      const close = isLast && livePrice > 0 ? livePrice : b.close;
      const high = isLast && livePrice > 0 ? Math.max(b.high, livePrice) : b.high;
      const low = isLast && livePrice > 0 ? Math.min(b.low, livePrice) : b.low;
      return {
        time: b.openTime,
        label: formatClock(b.openTime).slice(0, 5),
        open: b.open,
        high,
        low,
        close,
        volume: b.volume,
        wickRange: [low, high],
        isBull: close >= b.open,
      };
    });
  }, [bars, livePrice]);

  const candleSpan = useMemo(() => {
    if (!candleData.length) return { min: 0, max: 0 };
    let min = Infinity;
    let max = -Infinity;
    for (const c of candleData) {
      min = Math.min(min, c.low);
      max = Math.max(max, c.high);
    }
    return { min, max };
  }, [candleData]);

  const extractedLiquidity = useMemo(() => {
    if (!orderBook || !(livePrice > 0)) {
      return { bids: [], asks: [], all: [], medianSize: 0, wallThreshold: 0, maxSize: 0 };
    }
    const spanPad =
      candleSpan.max > candleSpan.min
        ? (candleSpan.max - candleSpan.min) * 0.25
        : livePrice * 0.025;
    const minPrice = candleSpan.min > 0 ? candleSpan.min - spanPad : livePrice * 0.96;
    const maxPrice = candleSpan.max > 0 ? candleSpan.max + spanPad : livePrice * 1.04;

    return extractLiquidityLevels({
      book: orderBook,
      referencePrice: livePrice,
      tickSize,
      maxPerSide: filterMode === "walls" ? 6 : 5,
      minPrice,
      maxPrice,
      wallsOnly: filterMode === "walls",
    });
  }, [orderBook, livePrice, tickSize, candleSpan, filterMode]);

  const hvnNodes = useMemo(() => {
    if (!showHvn || !volumeProfile?.levels.length) return [];
    const analysis = analyzeHighVolumeNodes(volumeProfile, hvnThreshold, tickSize);
    return analysis.nodes.slice(0, 4);
  }, [showHvn, volumeProfile, hvnThreshold, tickSize]);

  const yDomain = useMemo<[number, number] | ["auto", "auto"]>(() => {
    if (!candleData.length) return ["auto", "auto"];
    let min = candleSpan.min;
    let max = candleSpan.max;
    for (const lvl of extractedLiquidity.all) {
      min = Math.min(min, lvl.price);
      max = Math.max(max, lvl.price);
    }
    if (livePrice > 0) {
      min = Math.min(min, livePrice);
      max = Math.max(max, livePrice);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return ["auto", "auto"];
    const pad = (max - min) * 0.06;
    return [min - pad, max + pad];
  }, [candleData.length, candleSpan, extractedLiquidity.all, livePrice]);

  const baseBandHalf = useMemo(() => {
    if (!(yDomain[0] !== "auto" && typeof yDomain[0] === "number" && typeof yDomain[1] === "number")) {
      return tickSize > 0 ? tickSize * 0.5 : 0;
    }
    return Math.max(tickSize * 0.5, (yDomain[1] - yDomain[0]) * 0.004);
  }, [yDomain, tickSize]);

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
      {/* Header + Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-muted pb-2.5">
        <div className="flex items-center gap-2">
          <CandlestickChart size={16} className="text-accent" />
          <div>
            <h2 className="text-[15px] font-semibold text-text-primary">
              Gráfico de Velas y Niveles de Liquidez en Vivo ({timeframe})
            </h2>
            <p className="text-[11.5px] text-text-secondary">
              Velas OHLC de {symbol} con muros y piscinas de liquidez Bid/Ask del libro L2 superpuestas
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="xs"
            value={filterMode}
            onChange={setFilterMode}
            options={[
              { value: "top", label: "Top Liquidez" },
              { value: "walls", label: "Solo Muros (≥3.2×)" },
            ]}
            ariaLabel="Filtro de niveles de liquidez"
          />

          <button
            type="button"
            onClick={() => setShowHvn((v) => !v)}
            aria-pressed={showHvn}
            className={`ui-button chip ${showHvn ? "is-active" : ""}`}
            title="Mostrar nodos de alto volumen (VAP HVN / POC) sobre las velas"
          >
            <Layers size={12} />
            <span>POC / HVN</span>
          </button>
        </div>
      </div>

      {/* Candlestick Chart + Right Liquidity Ladder */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.8fr)_300px]">
        <div className="h-[340px] w-full">
          {candleData.length < 2 ? (
            <div className="flex h-full items-center justify-center text-[12.5px] text-text-muted">
              Sincronizando velas OHLC de OKX para {symbol} ({timeframe})…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
              <ComposedChart data={candleData} margin={{ top: 10, right: 86, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  minTickGap={30}
                  tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={{ stroke: "var(--border-muted)" }}
                  tickLine={false}
                />
                <YAxis
                  domain={yDomain}
                  width={70}
                  tickFormatter={(v: number) => formatPriceValue(v, decimals)}
                  tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={<CandleLiquidityTooltip decimals={decimals} levels={extractedLiquidity.all} />}
                />

                {/* Translucent Liquidity Zone Bands for strongest walls */}
                {baseBandHalf > 0 &&
                  extractedLiquidity.all
                    .filter((l) => l.isWall)
                    .map((lvl) => (
                      <ReferenceArea
                        key={`band-${lvl.id}`}
                        y1={lvl.price - baseBandHalf}
                        y2={lvl.price + baseBandHalf}
                        fill={lvl.side === "bid" ? "var(--buy)" : "var(--sell)"}
                        fillOpacity={0.14}
                        ifOverflow="extendDomain"
                      />
                    ))}

                {/* VAP POC & HVN Context */}
                {showHvn && volumeProfile?.poc && volumeProfile.poc > 0 && (
                  <ReferenceLine
                    y={volumeProfile.poc}
                    stroke="var(--poc)"
                    strokeWidth={1.3}
                    strokeDasharray="4 4"
                    label={{
                      value: `POC ${formatPriceValue(volumeProfile.poc, decimals)}`,
                      position: "insideTopLeft",
                      fill: "var(--poc)",
                      fontSize: 9.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                )}
                {showHvn &&
                  hvnNodes.map((node) => (
                    <ReferenceLine
                      key={`hvn-${node.price}`}
                      y={node.price}
                      stroke="var(--accent)"
                      strokeWidth={1}
                      strokeOpacity={0.45}
                      strokeDasharray="2 3"
                    />
                  ))}

                {/* L2 Liquidity Pool Lines */}
                {extractedLiquidity.asks.map((lvl) => (
                  <ReferenceLine
                    key={lvl.id}
                    y={lvl.price}
                    stroke="var(--sell)"
                    strokeWidth={lvl.isWall ? 1.8 : 1.1}
                    strokeOpacity={0.4 + lvl.shareOfMax * 0.55}
                    strokeDasharray={lvl.isWall ? undefined : "3 3"}
                    label={{
                      value: `Ask ${formatPriceValue(lvl.price, decimals)} · ${formatCompact(lvl.size, 2)}`,
                      position: "right",
                      fill: "var(--sell)",
                      fontSize: 9.5,
                      fontWeight: lvl.isWall ? 700 : 500,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                ))}
                {extractedLiquidity.bids.map((lvl) => (
                  <ReferenceLine
                    key={lvl.id}
                    y={lvl.price}
                    stroke="var(--buy)"
                    strokeWidth={lvl.isWall ? 1.8 : 1.1}
                    strokeOpacity={0.4 + lvl.shareOfMax * 0.55}
                    strokeDasharray={lvl.isWall ? undefined : "3 3"}
                    label={{
                      value: `Bid ${formatPriceValue(lvl.price, decimals)} · ${formatCompact(lvl.size, 2)}`,
                      position: "right",
                      fill: "var(--buy)",
                      fontSize: 9.5,
                      fontWeight: lvl.isWall ? 700 : 500,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                ))}

                {/* Live Spot Price */}
                {livePrice > 0 && (
                  <ReferenceLine
                    y={livePrice}
                    stroke="var(--text-primary)"
                    strokeWidth={1.3}
                    strokeDasharray="2 2"
                    label={{
                      value: `Vivo ${formatPriceValue(livePrice, decimals)}`,
                      position: "insideBottomLeft",
                      fill: "var(--text-primary)",
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                )}

                {/* Real Japanese Candlesticks */}
                <Bar
                  dataKey="wickRange"
                  name="Velas OHLC"
                  shape={<CandlestickShape />}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Synchronized Liquidity Depth Levels Ladder */}
        <aside className="flex flex-col justify-between gap-2 rounded-[var(--radius)] border border-border-muted bg-bg-surface/70 p-3">
          <div>
            <div className="flex items-center justify-between border-b border-border-muted pb-2">
              <span className="text-[12px] font-semibold text-text-primary">
                Niveles de Liquidez Activos
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">
                {extractedLiquidity.all.length} niveles
              </span>
            </div>

            {extractedLiquidity.all.length === 0 ? (
              <p className="py-6 text-center text-[11.5px] text-text-muted">
                {marketType === "forex"
                  ? "Libro L2 no disponible en pares Spot FX."
                  : filterMode === "walls"
                    ? "No hay muros ≥3.2× dentro del rango visible actual. Cambia a Top Liquidez."
                    : "Esperando niveles del libro L2 de OKX…"}
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-1.5 font-mono text-[11px] tabular-nums">
                {extractedLiquidity.all.map((lvl) => {
                  const pctWidth = Math.max(8, Math.round(lvl.shareOfMax * 100));
                  const barBg = lvl.side === "bid" ? "var(--buy)" : "var(--sell)";
                  return (
                    <div
                      key={lvl.id}
                      className="relative overflow-hidden rounded-[var(--radius-sm)] border border-border-muted bg-bg-panel px-2.5 py-1.5"
                    >
                      <div
                        className="pointer-events-none absolute inset-y-0 left-0 opacity-15"
                        style={{ width: `${pctWidth}%`, background: barBg }}
                      />
                      <div className="relative flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className={lvl.side === "bid" ? "text-buy font-semibold" : "text-sell font-semibold"}>
                            {lvl.side === "bid" ? "BID" : "ASK"} {formatPriceValue(lvl.price, decimals)}
                          </span>
                          {lvl.isWall && (
                            <span className="text-[10px] font-bold text-warn" title={`Muro ${lvl.strengthRatio.toFixed(1)}× sobre mediana`}>
                              MURO {lvl.strengthRatio.toFixed(1)}×
                            </span>
                          )}
                        </div>
                        <div className="text-right text-text-primary">
                          <strong>{formatCompact(lvl.size, 2)}</strong>
                          <span className="ml-1.5 text-[10px] text-text-muted">
                            ({lvl.distancePct >= 0 ? "+" : ""}
                            {lvl.distancePct.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-border-muted pt-2 text-[10.5px] text-text-muted">
            <div className="flex justify-between font-mono">
              <span>Mediana L2:</span>
              <span className="text-text-secondary">
                {extractedLiquidity.medianSize > 0 ? formatCompact(extractedLiquidity.medianSize, 2) : "—"}
              </span>
            </div>
            <div className="flex justify-between font-mono">
              <span>Umbral Muro:</span>
              <span className="text-warn">
                {extractedLiquidity.wallThreshold > 0 ? formatCompact(extractedLiquidity.wallThreshold, 2) : "—"}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
