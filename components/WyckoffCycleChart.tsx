"use client";

import React, { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  WYCKOFF_STAGES,
  analyzeWyckoffCycle,
  type WyckoffEnrichedCurvePoint,
  type WyckoffMacroStage,
  type WyckoffPricePoint,
} from "@/lib/engine/wyckoff";
import type { OhlcBar } from "@/lib/engine/tradingOptions";
import type { SessionStats, Timeframe, VolumeProfile } from "@/lib/types/market";
import { formatClock, formatCompact, formatPriceValue } from "@/lib/format";
import { Compass } from "lucide-react";

const STAGE_COLOR: Record<WyckoffMacroStage, string> = {
  accumulation: "var(--buy)",
  markup: "var(--accent)",
  distribution: "var(--sell)",
  markdown: "var(--warn)",
};

function formatDateTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts);
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${dd}/${mm} ${formatClock(ts)}`;
}

function CurveTooltip({
  active,
  payload,
  decimals,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: WyckoffEnrichedCurvePoint }>;
  decimals: number;
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  const stageMeta = WYCKOFF_STAGES.find((s) => s.id === pt.stage);
  const color = STAGE_COLOR[pt.stage];

  return (
    <div
      className="max-w-[270px] rounded-lg border border-border bg-bg-panel-alt px-3 py-2.5 text-[11px] shadow-lg"
      style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-text-primary">{pt.phaseName}</span>
        <span className="text-[10px] font-semibold" style={{ color }}>
          {stageMeta?.shortLabel}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-1.5 font-sans text-[10.5px]">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: pt.detected ? color : "var(--text-muted)" }}
        />
        <span className={pt.detected ? "font-semibold text-text-primary" : "text-text-muted"}>
          {pt.detected ? "Marcador detectado en velas OKX" : "Nivel estructural del ciclo"}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-1 border-t border-border-muted pt-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Precio</span>
          <strong className="text-text-primary">{formatPriceValue(pt.price, decimals)}</strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Volumen</span>
          <strong className="text-text-primary">
            {pt.volume > 0
              ? `${formatCompact(pt.volume, 2)} (${pt.volumeRatio.toFixed(1)}×)`
              : "—"}
          </strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Hora</span>
          <span className="text-text-secondary">{formatDateTime(pt.time)}</span>
        </div>
      </div>

      {stageMeta?.description && (
        <div className="mt-2 border-t border-border-muted pt-1.5 font-sans text-[10.5px] leading-snug text-text-secondary">
          {stageMeta.description}
        </div>
      )}
    </div>
  );
}

interface StructureChartPoint extends WyckoffPricePoint {
  clock: string;
}

function StructureTooltip({
  active,
  payload,
  decimals,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: StructureChartPoint }>;
  decimals: number;
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  const marker = pt.marker;
  const markerColor = marker ? STAGE_COLOR[marker.stage] : undefined;

  return (
    <div
      className="min-w-[235px] max-w-[280px] rounded-lg border border-border bg-bg-panel-alt px-3 py-2.5 text-[11px] shadow-lg"
      style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
    >
      {marker ? (
        <div className="mb-2 border-b border-border-muted pb-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold" style={{ color: markerColor }}>
              ● Fase {marker.code}
            </span>
            <span className="text-[10px] text-text-muted">Marcador Wyckoff</span>
          </div>
          <div className="mt-0.5 font-sans text-[11px] font-semibold text-text-primary">
            {marker.name}
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-[10.5px]">
            <span className="text-text-muted">Precio fase</span>
            <strong style={{ color: markerColor }}>
              {formatPriceValue(marker.price, decimals)}
            </strong>
          </div>
        </div>
      ) : (
        <div className="mb-1.5 flex items-center justify-between gap-3 border-b border-border-muted pb-1 text-text-muted">
          <span>Vela OKX</span>
          <span>{formatDateTime(pt.time)}</span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Hora</span>
          <span className="text-text-secondary">{formatDateTime(pt.time)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Precio cierre</span>
          <strong className="text-text-primary">{formatPriceValue(pt.close, decimals)}</strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Rango Máx / Mín</span>
          <span className="text-text-secondary">
            {formatPriceValue(pt.high, decimals)} / {formatPriceValue(pt.low, decimals)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Volumen</span>
          <strong className="text-text-primary">
            {formatCompact(pt.volume, 2)} ({pt.volumeRatio.toFixed(1)}× media)
          </strong>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border-muted pt-1 text-[10.5px]">
          <span className="text-accent">EMA (12)</span>
          <span className="text-text-secondary">{formatPriceValue(pt.emaFast, decimals)}</span>
        </div>
      </div>
    </div>
  );
}

interface CustomDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: WyckoffEnrichedCurvePoint;
  activeStep: number;
}

function CurvePhaseDot({ cx, cy, index, payload, activeStep }: CustomDotProps) {
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) {
    return <g key={`empty-curve-dot-${index ?? 0}`} />;
  }
  const color = STAGE_COLOR[payload.stage];
  const isNow = payload.step === activeStep;
  const isHighlighted = payload.detected || Boolean(payload.eventTag);

  if (!isHighlighted || isNow) {
    return (
      <circle
        key={`curve-dot-${payload.step}`}
        cx={cx}
        cy={cy}
        r={2.5}
        fill="var(--text-muted)"
        fillOpacity={0.75}
      />
    );
  }

  return (
    <g key={`curve-dot-${payload.step}`}>
      <circle
        cx={cx}
        cy={cy}
        r={payload.detected ? 5 : 3.5}
        fill={payload.detected ? color : "var(--bg-base)"}
        stroke={color}
        strokeWidth={payload.detected ? 1.8 : 1.4}
      />
    </g>
  );
}

interface StructureDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: StructureChartPoint;
}

function StructurePhaseDot({ cx, cy, index, payload }: StructureDotProps) {
  if (typeof cx !== "number" || typeof cy !== "number" || !payload?.marker) {
    return <g key={`empty-struct-dot-${index ?? 0}`} />;
  }
  const marker = payload.marker;
  const color = STAGE_COLOR[marker.stage];
  const placeBelow = payload.close < payload.equilibrium;
  const dy = placeBelow ? 15 : -10;

  return (
    <g key={`struct-marker-${marker.code}-${index ?? 0}`}>
      <circle
        cx={cx}
        cy={cy}
        r={5.5}
        fill={color}
        stroke="var(--bg-base)"
        strokeWidth={1.8}
      />
      <text
        x={cx}
        y={cy + dy}
        textAnchor="middle"
        fill={color}
        fontSize={9.5}
        fontWeight={700}
        fontFamily="var(--font-mono)"
      >
        {marker.code}
      </text>
    </g>
  );
}

export default function WyckoffCycleChart({
  symbol,
  timeframe,
  decimals,
  bars,
  livePrice,
  session,
  volumeProfile,
  currentOBI,
}: {
  symbol: string;
  timeframe: Timeframe;
  decimals: number;
  bars: OhlcBar[];
  livePrice: number;
  session: SessionStats | null;
  volumeProfile: VolumeProfile | null;
  currentOBI: number;
}) {
  const analysis = useMemo(
    () =>
      analyzeWyckoffCycle({
        bars,
        livePrice,
        session,
        volumeProfile,
        currentOBI,
      }),
    [bars, livePrice, session, volumeProfile, currentOBI]
  );

  const activePoint =
    analysis.curvePoints[analysis.cycleStep] ?? analysis.curvePoints[0];
  const stageColor = STAGE_COLOR[analysis.macroStage];

  const priceSeries = useMemo<StructureChartPoint[]>(
    () =>
      analysis.series.map((pt) => ({
        ...pt,
        clock: formatClock(pt.time).slice(0, 5),
      })),
    [analysis.series]
  );

  const priceDomain = useMemo<[number, number] | ["auto", "auto"]>(() => {
    if (!priceSeries.length) return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const pt of priceSeries) {
      min = Math.min(min, pt.low, pt.ice);
      max = Math.max(max, pt.high, pt.creek);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return ["auto", "auto"];
    const pad = (max - min) * 0.1;
    return [min - pad, max + pad];
  }, [priceSeries]);

  return (
    <section className="flex flex-col gap-3.5 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
      {/* Header + Current Stage Summary */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-muted pb-3">
        <div className="flex items-start gap-2">
          <Compass size={16} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-text-primary">
                Ciclo de Mercado de Wyckoff ({symbol} · {timeframe})
              </h2>
              {analysis.ready && (
                <span
                  className="font-mono text-[11px] font-bold"
                  style={{ color: stageColor }}
                >
                  [{analysis.stageLabel} · {analysis.subPhase}]
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              {analysis.summary}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border-muted bg-bg-surface px-3 py-1.5 font-mono text-[11px] tabular-nums">
          <div>
            <span className="text-text-muted">Evento: </span>
            <strong style={{ color: stageColor }}>{analysis.eventBadge}</strong>
          </div>
          <span className="text-border">|</span>
          <div>
            <span className="text-text-muted">Progreso ciclo: </span>
            <strong className="text-text-primary">{analysis.cycleProgressPct}%</strong>
          </div>
          <span className="text-border">|</span>
          <div>
            <span className="text-text-muted">Confianza: </span>
            <strong className="text-text-primary">{analysis.confidencePct}%</strong>
          </div>
        </div>
      </div>

      {/* 4-Stage Wyckoff Cycle Stepper */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {WYCKOFF_STAGES.map((stage) => {
          const isActive = analysis.ready && analysis.macroStage === stage.id;
          const color = STAGE_COLOR[stage.id];
          return (
            <div
              key={stage.id}
              className={`rounded-[var(--radius)] border px-3 py-2 transition-colors ${
                isActive ? "bg-bg-panel-alt border-accent" : "border-border-muted bg-bg-surface/60 opacity-75"
              }`}
              style={isActive ? { borderColor: color } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[12px] font-bold"
                  style={{ color: isActive ? color : "var(--text-primary)" }}
                >
                  {stage.label}
                </span>
                <span className="font-mono text-[10px] text-text-muted">{stage.phaseRange}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-text-secondary">
                {stage.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Dual Charts: Left = Canonical Wyckoff Cycle Position, Right = Asset Price Structure & Ice/Creek Range */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Chart A: Canonical Wyckoff Cycle Curve with Live Asset Position & Interactive Phase Tooltips */}
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border-muted bg-bg-surface/50 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-semibold text-text-primary">
                Posición Actual dentro del Ciclo Ideal de Wyckoff
              </h3>
              <p className="text-[11px] text-text-secondary">
                Pasa el cursor sobre cada fase para ver precio, volumen y hora detectados
              </p>
            </div>
            {analysis.ready && (
              <span className="font-mono text-[11px] font-bold" style={{ color: stageColor }}>
                ● AHORA: {activePoint.label}
              </span>
            )}
          </div>

          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
              <ComposedChart
                data={analysis.curvePoints}
                margin={{ top: 18, right: 16, left: -12, bottom: 4 }}
              >
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  interval={1}
                  tick={{ fill: "var(--text-muted)", fontSize: 9.5, fontFamily: "var(--font-mono)" }}
                  axisLine={{ stroke: "var(--border-muted)" }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  width={34}
                  tick={false}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CurveTooltip decimals={decimals} />} />

                {/* 4 Macro Stage Background Bands */}
                <ReferenceArea x1="PS" x2="SOS" fill="var(--buy)" fillOpacity={0.08} />
                <ReferenceArea x1="SOS" x2="Rally" fill="var(--accent)" fillOpacity={0.07} />
                <ReferenceArea x1="Rally" x2="SOW" fill="var(--sell)" fillOpacity={0.08} />
                <ReferenceArea x1="SOW" x2="Fin Ciclo" fill="var(--warn)" fillOpacity={0.07} />

                <Area
                  type="monotone"
                  dataKey="idealPrice"
                  name="Ciclo Wyckoff"
                  stroke="var(--text-secondary)"
                  strokeWidth={2}
                  fill="var(--accent)"
                  fillOpacity={0.08}
                  dot={(dotProps) => (
                    <CurvePhaseDot
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      index={dotProps.index}
                      payload={dotProps.payload as WyckoffEnrichedCurvePoint | undefined}
                      activeStep={analysis.cycleStep}
                    />
                  )}
                  activeDot={{
                    r: 7,
                    fill: "var(--accent)",
                    stroke: "var(--bg-base)",
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />

                {analysis.ready && (
                  <>
                    <ReferenceLine
                      x={activePoint.label}
                      stroke={stageColor}
                      strokeDasharray="3 3"
                      strokeWidth={1.5}
                    />
                    <ReferenceDot
                      x={activePoint.label}
                      y={activePoint.idealPrice}
                      r={7}
                      fill={stageColor}
                      stroke="var(--bg-base)"
                      strokeWidth={2}
                      label={{
                        value: `AHORA (${activePoint.label})`,
                        position: "top",
                        fill: stageColor,
                        fontSize: 10.5,
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart B: Real Asset Price Structure with Trading Range (Creek / Ice), Phase Markers & Tooltip */}
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border-muted bg-bg-surface/50 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-semibold text-text-primary">
                Estructura de Precio Real: Rango Ice / Creek ({timeframe})
              </h3>
              <p className="text-[11px] text-text-secondary">
                {analysis.springDetected
                  ? "Alerta Spring detectada: pasa el cursor sobre los marcadores para ver precio, volumen y hora"
                  : analysis.utadDetected
                    ? "Alerta UTAD detectada: pasa el cursor sobre los marcadores para ver precio, volumen y hora"
                    : "Marcadores de fase sobre velas reales OKX, soporte Ice, resistencia Creek y EMA(12)"}
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10.5px] text-text-muted">
              <span className="text-sell">┄ Creek</span>
              <span className="text-buy">┄ Ice</span>
              <span className="text-accent">● EMA</span>
            </div>
          </div>

          <div className="h-[250px] w-full">
            {!analysis.ready || priceSeries.length < 2 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                Sincronizando velas OKX para detectar el rango estructural de Wyckoff…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
                <ComposedChart data={priceSeries} margin={{ top: 18, right: 64, left: 2, bottom: 8 }}>
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="clock"
                    minTickGap={28}
                    tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                    axisLine={{ stroke: "var(--border-muted)" }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={priceDomain}
                    width={66}
                    tickFormatter={(v: number) => formatPriceValue(v, decimals)}
                    tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<StructureTooltip decimals={decimals} />} />

                  <ReferenceArea
                    y1={analysis.iceSupport}
                    y2={analysis.creekResistance}
                    fill={stageColor}
                    fillOpacity={0.06}
                  />

                  <ReferenceLine
                    y={analysis.creekResistance}
                    stroke="var(--sell)"
                    strokeDasharray="4 3"
                    label={{
                      value: `Creek ${formatPriceValue(analysis.creekResistance, decimals)}`,
                      position: "right",
                      fill: "var(--sell)",
                      fontSize: 9.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <ReferenceLine
                    y={analysis.equilibriumPrice}
                    stroke="var(--text-muted)"
                    strokeDasharray="2 3"
                    label={{
                      value: "Eq 50%",
                      position: "right",
                      fill: "var(--text-muted)",
                      fontSize: 9.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <ReferenceLine
                    y={analysis.iceSupport}
                    stroke="var(--buy)"
                    strokeDasharray="4 3"
                    label={{
                      value: `Ice ${formatPriceValue(analysis.iceSupport, decimals)}`,
                      position: "right",
                      fill: "var(--buy)",
                      fontSize: 9.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  />

                  <Line
                    type="monotone"
                    dataKey="emaFast"
                    name="EMA (12)"
                    stroke="var(--accent)"
                    strokeWidth={1.3}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="close"
                    name="Precio"
                    stroke="var(--text-primary)"
                    strokeWidth={2}
                    dot={(dotProps) => (
                      <StructurePhaseDot
                        cx={dotProps.cx}
                        cy={dotProps.cy}
                        index={dotProps.index}
                        payload={dotProps.payload as StructureChartPoint | undefined}
                      />
                    )}
                    activeDot={{
                      r: 7,
                      fill: stageColor,
                      stroke: "var(--bg-base)",
                      strokeWidth: 2,
                    }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Detected Phase Markers Chronological Summary */}
      {analysis.ready && analysis.markers.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border-muted bg-bg-surface/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Marcadores de fase detectados ({analysis.markers.length})
            </span>
            <span className="font-mono text-[10.5px] text-text-muted">
              Precio · Volumen · Hora OKX
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 font-mono text-[11px] tabular-nums">
            {analysis.markers.map((marker) => {
              const color = STAGE_COLOR[marker.stage];
              return (
                <div
                  key={`${marker.code}-${marker.time}`}
                  title={`${marker.name} · Precio ${formatPriceValue(marker.price, decimals)} · Vol ${formatCompact(marker.volume, 2)} · ${formatDateTime(marker.time)}`}
                  className="flex flex-col gap-0.5 rounded-[var(--radius)] border border-border-muted bg-bg-panel px-2.5 py-1.5"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="font-bold" style={{ color }}>
                      ● {marker.code}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {formatClock(marker.time).slice(0, 5)}
                    </span>
                  </div>
                  <div className="font-semibold text-text-primary">
                    {formatPriceValue(marker.price, decimals)}
                  </div>
                  <div className="text-[10px] text-text-secondary">
                    Vol {formatCompact(marker.volume, 1)} ({marker.volumeRatio.toFixed(1)}×)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Quantitative Metrics & Actionable Wyckoff Guidance */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 font-mono text-[11px] tabular-nums">
        <div className="rounded-[var(--radius)] border border-border-muted bg-bg-surface px-3 py-2">
          <div className="font-sans text-[10.5px] text-text-muted">Rango Estructural (Ice ↔ Creek)</div>
          <div className="mt-0.5 font-semibold text-text-primary">
            {analysis.ready
              ? `${formatPriceValue(analysis.iceSupport, decimals)} – ${formatPriceValue(analysis.creekResistance, decimals)}`
              : "—"}
          </div>
        </div>
        <div className="rounded-[var(--radius)] border border-border-muted bg-bg-surface px-3 py-2">
          <div className="font-sans text-[10.5px] text-text-muted">Esfuerzo vs Resultado</div>
          <div className="mt-0.5 font-semibold text-accent">{analysis.effortResultLabel}</div>
        </div>
        <div className="rounded-[var(--radius)] border border-border-muted bg-bg-surface px-3 py-2">
          <div className="font-sans text-[10.5px] text-text-muted">Movimiento Previo / Pendiente</div>
          <div className="mt-0.5 font-semibold text-text-primary">
            {analysis.priorMovePct >= 0 ? "+" : ""}
            {analysis.priorMovePct.toFixed(2)}% · EMA {analysis.trendSlopePct >= 0 ? "+" : ""}
            {analysis.trendSlopePct.toFixed(2)}%
          </div>
        </div>
        <div className="rounded-[var(--radius)] border border-border-muted bg-bg-surface px-3 py-2 font-sans">
          <div className="text-[10.5px] text-text-muted">Lectura Operativa Wyckoff</div>
          <div className="mt-0.5 text-[11.5px] text-text-secondary leading-snug">
            {analysis.actionGuidance}
          </div>
        </div>
      </div>
    </section>
  );
}
