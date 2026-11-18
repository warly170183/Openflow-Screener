"use client";

import React, { useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  projectHistoricalCycleOverlay,
  type WyckoffEnrichedCurvePoint,
  type WyckoffHistoricalCycle,
  type WyckoffMacroStage,
  type WyckoffPhaseVolumeProfile,
  type WyckoffPricePoint,
} from "@/lib/engine/wyckoff";
import type { OhlcBar } from "@/lib/engine/tradingOptions";
import type { SessionStats, Timeframe, VolumeProfile } from "@/lib/types/market";
import { formatClock, formatCompact, formatPriceValue } from "@/lib/format";
import { Activity, BarChart2, Calendar, Clock, Compass, Gauge, History } from "lucide-react";

const STAGE_COLOR: Record<WyckoffMacroStage, string> = {
  accumulation: "var(--buy)",
  markup: "var(--accent)",
  distribution: "var(--sell)",
  markdown: "var(--warn)",
};

const SPANISH_MONTHS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
] as const;

function formatDateTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts);
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy} ${formatClock(ts)}`;
}

function formatAxisDateTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts);
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${dd}/${mm} ${formatClock(ts).slice(0, 5)}`;
}

function formatShortDateLabel(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts);
  const dd = d.getDate().toString().padStart(2, "0");
  const mon = SPANISH_MONTHS[d.getMonth()] ?? "";
  return `${dd} ${mon} ${d.getFullYear()} · ${formatClock(ts).slice(0, 5)}`;
}

function formatMacdNumber(val: number, priceDecimals: number): string {
  if (!Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  const dec = abs >= 100 ? 1 : abs >= 1 ? 2 : Math.min(6, Math.max(3, priceDecimals));
  return `${val > 0 ? "+" : ""}${val.toFixed(dec)}`;
}

function formatPhaseDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const hours = ms / 3_600_000;
  if (hours >= 24) {
    const days = hours / 24;
    return `${days.toFixed(days >= 10 ? 1 : 2)} d (${hours.toFixed(1)} h)`;
  }
  if (hours >= 1) {
    const days = hours / 24;
    return `${hours.toFixed(hours >= 10 ? 1 : 2)} h (${days.toFixed(2)} d)`;
  }
  const mins = Math.max(1, Math.round(ms / 60_000));
  return `${mins} min (${hours.toFixed(2)} h)`;
}

interface CurveChartPoint extends WyckoffEnrichedCurvePoint {
  overlayIdealPrice: number | null;
}

function CurveTooltip({
  active,
  payload,
  decimals,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CurveChartPoint }>;
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
          <span className="text-text-muted">Fecha y hora</span>
          <span className="text-text-secondary">{formatDateTime(pt.time)}</span>
        </div>
        {pt.overlayIdealPrice != null && Number.isFinite(pt.overlayIdealPrice) && (
          <div className="flex items-center justify-between gap-4 border-t border-border-muted pt-1">
            <span style={{ color: "var(--poc)" }}>Ciclo histórico</span>
            <strong style={{ color: "var(--poc)" }}>
              {pt.overlayIdealPrice.toFixed(1)} / 100
            </strong>
          </div>
        )}
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
  timeKey: string;
  overlayPrice: number | null;
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
      className="min-w-[235px] max-w-[285px] rounded-lg border border-border bg-bg-panel-alt px-3 py-2.5 text-[11px] shadow-lg"
      style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
    >
      {marker ? (
        <div className="mb-2 border-b border-border-muted pb-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold" style={{ color: markerColor }}>
              ● Fase {marker.code}
            </span>
            <span className="text-[10px] text-text-muted">
              {pt.isClimax ? "Marcador + Clímax" : "Marcador Wyckoff"}
            </span>
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
          <span>{pt.isClimax ? "Evento de Volumen" : "Vela OKX"}</span>
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
          <strong style={{ color: pt.isClimax ? "var(--warn)" : "var(--text-primary)" }}>
            {formatCompact(pt.volume, 2)} ({pt.volumeRatio.toFixed(1)}× media)
          </strong>
        </div>
        <div className="flex items-center justify-between gap-4 text-[10.5px]">
          <span className="text-text-muted">Esfuerzo</span>
          <span style={{ color: pt.isClimax ? "var(--warn)" : "var(--text-secondary)" }}>
            {pt.effortLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border-muted pt-1 text-[10.5px]">
          <span className="text-accent">EMA (12)</span>
          <span className="text-text-secondary">{formatPriceValue(pt.emaFast, decimals)}</span>
        </div>
        {pt.overlayPrice != null && Number.isFinite(pt.overlayPrice) && pt.overlayPrice > 0 && (
          <div className="flex items-center justify-between gap-4 text-[10.5px]">
            <span style={{ color: "var(--poc)" }}>Ciclo histórico</span>
            <strong style={{ color: "var(--poc)" }}>
              {formatPriceValue(pt.overlayPrice, decimals)} (
              {((pt.close - pt.overlayPrice) / pt.overlayPrice) * 100 >= 0 ? "+" : ""}
              {(((pt.close - pt.overlayPrice) / pt.overlayPrice) * 100).toFixed(2)}%)
            </strong>
          </div>
        )}
      </div>
    </div>
  );
}

function MacdTooltip({
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
  const isBullMom = pt.macdHistogram >= 0;

  return (
    <div
      className="min-w-[235px] max-w-[290px] rounded-lg border border-border bg-bg-panel-alt px-3 py-2.5 text-[11px] shadow-lg"
      style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-border-muted pb-1">
        <span className="font-bold text-accent">MACD (12, 26, 9)</span>
        <span className="text-[10px] text-text-muted">{formatDateTime(pt.time)}</span>
      </div>

      {marker && (
        <div className="mb-2 rounded border border-border-muted bg-bg-surface px-2 py-1">
          <div className="text-[10px] text-text-muted">Fase Wyckoff en esta vela</div>
          <div className="font-sans text-[11px] font-semibold" style={{ color: STAGE_COLOR[marker.stage] }}>
            ● {marker.name}
          </div>
        </div>
      )}

      {pt.macdCross && (
        <div
          className="mb-1.5 rounded border px-2 py-0.5 font-sans text-[10.5px] font-semibold"
          style={{
            borderColor: pt.macdCross === "bullish" ? "var(--buy)" : "var(--sell)",
            color: pt.macdCross === "bullish" ? "var(--buy)" : "var(--sell)",
          }}
        >
          {pt.macdCross === "bullish"
            ? "▲ Cruce Alcista (MACD cruza sobre Señal)"
            : "▼ Cruce Bajista (MACD cruza bajo Señal)"}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-accent">MACD (12,26)</span>
          <strong className="text-text-primary">{formatMacdNumber(pt.macdLine, decimals)}</strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-warn">Señal (9)</span>
          <strong className="text-text-primary">{formatMacdNumber(pt.macdSignal, decimals)}</strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Histograma</span>
          <strong style={{ color: isBullMom ? "var(--buy)" : "var(--sell)" }}>
            {formatMacdNumber(pt.macdHistogram, decimals)}
          </strong>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border-muted pt-1">
          <span className="text-text-muted">Precio cierre</span>
          <span className="text-text-secondary">{formatPriceValue(pt.close, decimals)}</span>
        </div>
      </div>
    </div>
  );
}

function TrendStrengthTooltip({
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
  const regime =
    pt.adx >= 40
      ? "Tendencia Muy Fuerte"
      : pt.adx >= 25
        ? "Tendencia Activa"
        : pt.adx >= 20
          ? "Transición / Ruptura"
          : "Rango Lateral";
  const adxColor =
    pt.adx >= 40
      ? "var(--warn)"
      : pt.adx >= 25
        ? "var(--accent)"
        : pt.adx >= 20
          ? "var(--poc)"
          : "var(--text-secondary)";

  return (
    <div
      className="min-w-[235px] max-w-[295px] rounded-lg border border-border bg-bg-panel-alt px-3 py-2.5 text-[11px] shadow-lg"
      style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-border-muted pb-1">
        <span className="font-bold" style={{ color: adxColor }}>
          Trend Strength (ADX)
        </span>
        <span className="text-[10px] text-text-muted">{formatDateTime(pt.time)}</span>
      </div>

      {marker && (
        <div className="mb-2 rounded border border-border-muted bg-bg-surface px-2 py-1">
          <div className="text-[10px] text-text-muted">Fase Wyckoff en esta vela</div>
          <div className="font-sans text-[11px] font-semibold" style={{ color: STAGE_COLOR[marker.stage] }}>
            ● {marker.name}
          </div>
        </div>
      )}

      <div className="mb-1.5 font-sans text-[11px] font-semibold" style={{ color: adxColor }}>
        {regime} ({pt.adx.toFixed(1)})
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: "var(--poc)" }}>ADX (Fuerza)</span>
          <strong style={{ color: adxColor }}>{pt.adx.toFixed(1)}</strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-buy">+DI (Impulso Alcista)</span>
          <strong className="text-buy">{pt.plusDi.toFixed(1)}</strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sell">-DI (Impulso Bajista)</span>
          <strong className="text-sell">{pt.minusDi.toFixed(1)}</strong>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border-muted pt-1">
          <span className="text-text-muted">Precio cierre</span>
          <span className="text-text-secondary">{formatPriceValue(pt.close, decimals)}</span>
        </div>
      </div>
    </div>
  );
}

interface MacdDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: StructureChartPoint;
}

function MacdCrossDot({ cx, cy, index, payload }: MacdDotProps) {
  if (typeof cx !== "number" || typeof cy !== "number" || !payload?.macdCross) {
    return <g key={`empty-macd-dot-${index ?? 0}`} />;
  }
  const color = payload.macdCross === "bullish" ? "var(--buy)" : "var(--sell)";
  return (
    <circle
      key={`macd-cross-${payload.timeKey}-${index ?? 0}`}
      cx={cx}
      cy={cy}
      r={4.5}
      fill={color}
      stroke="var(--bg-base)"
      strokeWidth={1.6}
    />
  );
}

function VolumeClimaxTooltip({
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
  const accentColor = marker
    ? STAGE_COLOR[marker.stage]
    : pt.isClimax
      ? "var(--warn)"
      : "var(--text-primary)";

  return (
    <div
      className="min-w-[235px] max-w-[290px] rounded-lg border border-border bg-bg-panel-alt px-3 py-2.5 text-[11px] shadow-lg"
      style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-border-muted pb-1">
        <span className="font-bold" style={{ color: accentColor }}>
          {pt.effortLabel}
        </span>
        <span className="text-[10px] text-text-muted">{formatClock(pt.time)}</span>
      </div>

      {marker && (
        <div className="mb-2 rounded border border-border-muted bg-bg-surface px-2 py-1">
          <div className="text-[10px] text-text-muted">Correlación con fase Wyckoff</div>
          <div className="font-sans text-[11px] font-semibold" style={{ color: STAGE_COLOR[marker.stage] }}>
            ● {marker.name}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Volumen</span>
          <strong style={{ color: pt.isClimax ? "var(--warn)" : "var(--text-primary)" }}>
            {formatCompact(pt.volume, 2)} ({pt.volumeRatio.toFixed(1)}× media)
          </strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Precio cierre</span>
          <strong className="text-text-primary">{formatPriceValue(pt.close, decimals)}</strong>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Cuerpo / Rango</span>
          <span className="text-text-secondary">
            {(pt.bodyRatio * 100).toFixed(0)}% cuerpo · {pt.spreadPct.toFixed(2)}% amplitud
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted">Hora OKX</span>
          <span className="text-text-secondary">{formatDateTime(pt.time)}</span>
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
  const [showMacd, setShowMacd] = useState(true);
  const [showTrendStrength, setShowTrendStrength] = useState(true);
  const [showVolumeProfile, setShowVolumeProfile] = useState(true);
  const [selectedProfileStage, setSelectedProfileStage] = useState<WyckoffMacroStage | "">("");
  const [hoveredVpBinIndex, setHoveredVpBinIndex] = useState<number | null>(null);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [selectedCycleId, setSelectedCycleId] = useState<string>("");

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

  const selectedCycle = useMemo<WyckoffHistoricalCycle | null>(() => {
    if (!analysis.historicalCycles.length) return null;
    return (
      analysis.historicalCycles.find((c) => c.id === selectedCycleId) ??
      analysis.historicalCycles[0]
    );
  }, [analysis.historicalCycles, selectedCycleId]);

  const activePhaseProfile = useMemo<WyckoffPhaseVolumeProfile | null>(() => {
    if (!analysis.phaseVolumeProfiles.length) return null;
    if (selectedProfileStage) {
      const explicit = analysis.phaseVolumeProfiles.find((p) => p.stage === selectedProfileStage);
      if (explicit) return explicit;
    }
    return (
      analysis.phaseVolumeProfiles.find((p) => p.isCurrent) ??
      analysis.phaseVolumeProfiles[0]
    );
  }, [analysis.phaseVolumeProfiles, selectedProfileStage]);

  const overlayProjection = useMemo(
    () => (overlayEnabled ? projectHistoricalCycleOverlay(analysis, selectedCycle) : null),
    [overlayEnabled, analysis, selectedCycle]
  );

  const activePoint =
    analysis.curvePoints[analysis.cycleStep] ?? analysis.curvePoints[0];
  const stageColor = STAGE_COLOR[analysis.macroStage];

  const curveChartData = useMemo<CurveChartPoint[]>(
    () =>
      analysis.curvePoints.map((pt, idx) => ({
        ...pt,
        overlayIdealPrice: overlayProjection ? overlayProjection.curveOverlay[idx] : null,
      })),
    [analysis.curvePoints, overlayProjection]
  );

  const priceSeries = useMemo<StructureChartPoint[]>(
    () =>
      analysis.series.map((pt, idx) => ({
        ...pt,
        clock: formatClock(pt.time).slice(0, 5),
        timeKey: String(pt.time),
        overlayPrice: overlayProjection ? overlayProjection.structureOverlay[idx] : null,
      })),
    [analysis.series, overlayProjection]
  );

  const priceDomain = useMemo<[number, number] | ["auto", "auto"]>(() => {
    if (!priceSeries.length) return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const pt of priceSeries) {
      min = Math.min(min, pt.low, pt.ice);
      max = Math.max(max, pt.high, pt.creek);
      if (pt.overlayPrice != null && Number.isFinite(pt.overlayPrice)) {
        min = Math.min(min, pt.overlayPrice);
        max = Math.max(max, pt.overlayPrice);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return ["auto", "auto"];
    const pad = (max - min) * 0.1;
    return [min - pad, max + pad];
  }, [priceSeries]);

  const showProfileLevelsOnChart = useMemo(() => {
    if (!showVolumeProfile || !activePhaseProfile) return false;
    if (typeof priceDomain[0] !== "number" || typeof priceDomain[1] !== "number") return false;
    const [dMin, dMax] = priceDomain;
    return activePhaseProfile.poc >= dMin && activePhaseProfile.poc <= dMax;
  }, [showVolumeProfile, activePhaseProfile, priceDomain]);

  return (
    <section className="flex flex-col gap-3.5 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
      {/* Header + Current Stage Summary + Dates */}
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
            {analysis.ready && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-muted">
                <Calendar size={12} className="text-accent" />
                <span>
                  Momento actual:{" "}
                  <strong className="text-text-primary">
                    {formatShortDateLabel(analysis.windowEndTime)}
                  </strong>
                </span>
                <span>·</span>
                <span>
                  Ventana: {formatAxisDateTime(analysis.windowStartTime)} →{" "}
                  {formatAxisDateTime(analysis.windowEndTime)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setOverlayEnabled((v) => !v)}
            disabled={!analysis.ready || analysis.historicalCycles.length === 0}
            aria-pressed={overlayEnabled}
            className={`ui-button chip whitespace-nowrap ${overlayEnabled ? "is-primary" : ""}`}
            title="Superponer un ciclo Wyckoff histórico para comparar progresión y madurez"
          >
            <History size={13} />
            Overlay Historical Cycles
          </button>

          <button
            type="button"
            onClick={() => setShowVolumeProfile((v) => !v)}
            disabled={!analysis.ready || analysis.phaseVolumeProfiles.length === 0}
            aria-pressed={showVolumeProfile}
            className={`ui-button chip whitespace-nowrap ${showVolumeProfile ? "is-primary" : ""}`}
            title="Mostrar u ocultar la barra lateral de Volume Profile (POC y Value Area) por fase Wyckoff"
          >
            <BarChart2 size={13} />
            Volume Profile
          </button>

          <button
            type="button"
            onClick={() => setShowMacd((v) => !v)}
            className={`ui-button chip whitespace-nowrap ${showMacd ? "is-primary" : ""}`}
            title="Mostrar u ocultar el indicador MACD (12, 26, 9)"
          >
            <Activity size={13} />
            MACD (12,26,9)
          </button>

          <button
            type="button"
            onClick={() => setShowTrendStrength((v) => !v)}
            aria-pressed={showTrendStrength}
            className={`ui-button chip whitespace-nowrap ${showTrendStrength ? "is-primary" : ""}`}
            title="Mostrar u ocultar el indicador Trend Strength (ADX) que mide fuerza de tendencia vs rango"
          >
            <Gauge size={13} />
            Trend Strength (ADX)
          </button>

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
      </div>

      {/* Historical Cycle Overlay Picker & Comparison Summary */}
      {analysis.ready && analysis.historicalCycles.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[var(--radius)] border border-border-muted bg-bg-surface/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <History
              size={13}
              style={{ color: overlayEnabled ? "var(--poc)" : "var(--text-muted)" }}
            />
            <label
              htmlFor="wyckoff-historical-cycle-select"
              className="text-[11px] font-semibold uppercase tracking-wider text-text-muted"
            >
              Ciclo Histórico de Referencia
            </label>
            <select
              id="wyckoff-historical-cycle-select"
              value={selectedCycle?.id ?? ""}
              onChange={(e) => {
                setSelectedCycleId(e.target.value);
                if (!overlayEnabled) setOverlayEnabled(true);
              }}
              className="rounded-[var(--radius-sm)] border border-border bg-bg-panel px-2.5 py-1 font-mono text-[11px] text-text-primary outline-none focus:border-accent"
            >
              {analysis.historicalCycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.matchesCurrentStage ? "★ " : ""}
                  {c.label} · {formatAxisDateTime(c.startTime)} ({formatPhaseDuration(c.durationMs)} ·{" "}
                  {c.barCount}v · {c.returnPct >= 0 ? "+" : ""}
                  {c.returnPct.toFixed(2)}%)
                </option>
              ))}
            </select>
          </div>

          {overlayProjection ? (
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums">
              <span style={{ color: "var(--poc)" }}>
                ┄ Superpuesto: <strong>{overlayProjection.cycle.label}</strong>
              </span>
              <span className="text-border">|</span>
              <span className="text-text-muted">
                Madurez vs elegido:{" "}
                <strong className="text-text-primary">
                  {overlayProjection.maturityVsSelectedPct}%
                </strong>{" "}
                ({overlayProjection.activeBarsElapsed}/{overlayProjection.cycle.barCount} velas ·{" "}
                {overlayProjection.remainingBarsEstimate > 0
                  ? `~${overlayProjection.remainingBarsEstimate} velas rest.`
                  : "supera duración"}
                )
              </span>
              <span className="text-border">|</span>
              <span className="text-text-muted">
                Progresión:{" "}
                <strong
                  style={{
                    color:
                      overlayProjection.currentReturnPct >= 0 ? "var(--buy)" : "var(--sell)",
                  }}
                >
                  Actual {overlayProjection.currentReturnPct >= 0 ? "+" : ""}
                  {overlayProjection.currentReturnPct.toFixed(2)}%
                </strong>{" "}
                vs{" "}
                <strong style={{ color: "var(--poc)" }}>
                  Hist {overlayProjection.historicalReturnAtSameStepPct >= 0 ? "+" : ""}
                  {overlayProjection.historicalReturnAtSameStepPct.toFixed(2)}%
                </strong>
              </span>
            </div>
          ) : (
            <span className="font-mono text-[10.5px] text-text-muted">
              Activa <strong className="text-text-primary">Overlay Historical Cycles</strong> o elige un episodio para superponerlo en ambos gráficos
            </span>
          )}
        </div>
      )}

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

      {/* Dual Charts: Left = Canonical Wyckoff Cycle Position, Right = Asset Price Structure + Phase Volume Profile Side-Bar */}
      <div
        className={`grid grid-cols-1 gap-4 ${
          showVolumeProfile && activePhaseProfile
            ? "xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.42fr)]"
            : "xl:grid-cols-2"
        }`}
      >
        {/* Chart A: Canonical Wyckoff Cycle Curve with Live Asset Position & Interactive Phase Tooltips */}
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border-muted bg-bg-surface/50 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-semibold text-text-primary">
                Posición Actual dentro del Ciclo Ideal de Wyckoff
              </h3>
              <p className="text-[11px] text-text-secondary">
                Pasa el cursor sobre cada fase para ver precio, volumen, fecha y hora detectados
              </p>
            </div>
            {analysis.ready && (
              <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px]">
                {overlayProjection && (
                  <span style={{ color: "var(--poc)" }}>
                    ┄ Hist: {overlayProjection.cycle.shortLabel}
                  </span>
                )}
                <span className="font-bold" style={{ color: stageColor }}>
                  ● AHORA: {activePoint.label} ({formatAxisDateTime(analysis.windowEndTime)})
                </span>
              </div>
            )}
          </div>

          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
              <ComposedChart
                data={curveChartData}
                margin={{ top: 20, right: 20, left: -12, bottom: 4 }}
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

                {overlayProjection && (
                  <Line
                    type="monotone"
                    dataKey="overlayIdealPrice"
                    name="Ciclo histórico"
                    stroke="var(--poc)"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    dot={{ r: 3.5, fill: "var(--poc)", stroke: "var(--bg-base)", strokeWidth: 1 }}
                    activeDot={{ r: 5.5, fill: "var(--poc)", stroke: "var(--bg-base)", strokeWidth: 1.5 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}

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
                        value: `AHORA · ${formatAxisDateTime(analysis.windowEndTime)}`,
                        position: "top",
                        fill: stageColor,
                        fontSize: 10,
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
              {showProfileLevelsOnChart && activePhaseProfile && (
                <span style={{ color: "var(--poc)" }}>
                  ━ POC ({activePhaseProfile.shortLabel})
                </span>
              )}
              {overlayProjection && (
                <span style={{ color: "var(--poc)" }}>┄ Hist</span>
              )}
            </div>
          </div>

          <div
            className={`grid grid-cols-1 gap-3 ${
              showVolumeProfile && activePhaseProfile
                ? "lg:grid-cols-[minmax(0,1fr)_272px]"
                : ""
            }`}
          >
            <div className="h-[250px] lg:h-[310px] w-full">
              {!analysis.ready || priceSeries.length < 2 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  Sincronizando velas OKX para detectar el rango estructural de Wyckoff…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
                  <ComposedChart
                    data={priceSeries}
                    syncId="wyckoff-structure"
                    margin={{ top: 18, right: 64, left: 2, bottom: 8 }}
                  >
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="timeKey"
                      minTickGap={44}
                      tickFormatter={(v: string) => formatAxisDateTime(Number(v))}
                      tick={{ fill: "var(--text-muted)", fontSize: 9.5, fontFamily: "var(--font-mono)" }}
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

                    {showProfileLevelsOnChart && activePhaseProfile && (
                      <>
                        <ReferenceArea
                          y1={activePhaseProfile.val}
                          y2={activePhaseProfile.vah}
                          fill="var(--poc)"
                          fillOpacity={0.08}
                        />
                        <ReferenceLine
                          y={activePhaseProfile.poc}
                          stroke="var(--poc)"
                          strokeWidth={1.5}
                          strokeDasharray="6 3"
                          label={{
                            value: `POC ${formatPriceValue(activePhaseProfile.poc, decimals)}`,
                            position: "insideTopLeft",
                            fill: "var(--poc)",
                            fontSize: 9.5,
                            fontWeight: 700,
                            fontFamily: "var(--font-mono)",
                          }}
                        />
                      </>
                    )}

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
                    {overlayProjection && priceSeries[overlayProjection.anchorIndex] && (
                      <ReferenceLine
                        x={priceSeries[overlayProjection.anchorIndex].timeKey}
                        stroke="var(--poc)"
                        strokeDasharray="2 3"
                        label={{
                          value: "Ancla hist.",
                          position: "top",
                          fill: "var(--poc)",
                          fontSize: 9.5,
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    )}
                    {overlayProjection && (
                      <Line
                        type="monotone"
                        dataKey="overlayPrice"
                        name="Ciclo histórico"
                        stroke="var(--poc)"
                        strokeWidth={2}
                        strokeDasharray="5 3"
                        dot={false}
                        activeDot={{
                          r: 5,
                          fill: "var(--poc)",
                          stroke: "var(--bg-base)",
                          strokeWidth: 1.5,
                        }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    )}
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

            {/* Phase-Specific Volume Profile Side-Bar */}
            {showVolumeProfile && activePhaseProfile && (
              <aside
                aria-label="Volume Profile por Fase Wyckoff"
                className="flex flex-col justify-between gap-2 rounded-[var(--radius-sm)] border border-border-muted bg-bg-panel px-2.5 py-2"
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-1.5 border-b border-border-muted pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <BarChart2 size={12} style={{ color: "var(--poc)" }} />
                      <span className="text-[11px] font-semibold text-text-primary">
                        Perfil de Volumen (POC · VA)
                      </span>
                    </div>
                    <span className="font-mono text-[9.5px] text-text-muted">
                      VA {activePhaseProfile.valueAreaPct}%
                    </span>
                  </div>

                  {/* Selectable tabs for each identified Wyckoff phase */}
                  <div className="flex flex-wrap gap-1">
                    {analysis.phaseVolumeProfiles.map((vp) => {
                      const active = vp.stage === activePhaseProfile.stage;
                      const vpColor = STAGE_COLOR[vp.stage];
                      return (
                        <button
                          key={`vp-tab-${vp.stage}`}
                          type="button"
                          onClick={() => {
                            setSelectedProfileStage(vp.stage);
                            setHoveredVpBinIndex(null);
                          }}
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                            active
                              ? "border-accent bg-bg-panel-alt font-bold text-text-primary"
                              : "border-border-muted bg-bg-surface text-text-muted hover:text-text-primary"
                          }`}
                          style={active ? { borderColor: vpColor, color: vpColor } : undefined}
                          title={`Ver POC y Value Area de ${vp.label} (${vp.barCount} velas)`}
                        >
                          {vp.isCurrent ? "● " : ""}
                          {vp.shortLabel}
                        </button>
                      );
                    })}
                  </div>

                  {/* Key levels summary: VAH / POC / VAL for the selected phase */}
                  <div className="grid grid-cols-3 gap-1 rounded border border-border-muted bg-bg-surface px-1.5 py-1 font-mono text-[9.5px] tabular-nums">
                    <div>
                      <div className="text-text-muted">VAL</div>
                      <div className="font-semibold text-text-secondary">
                        {formatPriceValue(activePhaseProfile.val, decimals)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "var(--poc)" }}>POC</div>
                      <div className="font-bold" style={{ color: "var(--poc)" }}>
                        {formatPriceValue(activePhaseProfile.poc, decimals)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-text-muted">VAH</div>
                      <div className="font-semibold text-text-secondary">
                        {formatPriceValue(activePhaseProfile.vah, decimals)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Horizontal Volume-at-Price Bars (Top = High Price, Bottom = Low Price) */}
                <div className="flex flex-col gap-[2px] py-0.5 font-mono text-[9px] tabular-nums">
                  {activePhaseProfile.bins.map((bin) => {
                    const isHovered = hoveredVpBinIndex === bin.index;
                    const barColor = bin.isPOC
                      ? "var(--poc)"
                      : bin.inValueArea
                        ? STAGE_COLOR[activePhaseProfile.stage]
                        : "var(--text-muted)";
                    const barOpacity = bin.isPOC ? 0.95 : bin.inValueArea ? 0.62 : 0.26;
                    return (
                      <div
                        key={`vp-bin-${activePhaseProfile.stage}-${bin.index}`}
                        onMouseEnter={() => setHoveredVpBinIndex(bin.index)}
                        onMouseLeave={() => setHoveredVpBinIndex(null)}
                        title={`${formatPriceValue(bin.priceLow, decimals)} – ${formatPriceValue(bin.priceHigh, decimals)} · Vol ${formatCompact(bin.volume, 2)} (${bin.pctOfTotal.toFixed(1)}%)${bin.isPOC ? " · POC" : bin.inValueArea ? " · Value Area 70%" : ""}`}
                        className={`relative flex h-[9px] items-center justify-between overflow-hidden rounded-[2px] px-1 transition-colors ${
                          isHovered ? "bg-bg-hover" : "bg-bg-surface/40"
                        }`}
                        style={
                          bin.isPOC
                            ? { outline: "1px solid var(--poc)", outlineOffset: "-1px" }
                            : undefined
                        }
                      >
                        <div
                          className="absolute inset-y-0 right-0 rounded-l-[2px] transition-all"
                          style={{
                            width: `${Math.max(3, bin.pctOfMax)}%`,
                            backgroundColor: barColor,
                            opacity: barOpacity,
                          }}
                        />
                        <span
                          className={`relative z-10 leading-none ${
                            bin.isPOC
                              ? "font-bold text-text-primary"
                              : bin.inValueArea
                                ? "text-text-secondary"
                                : "text-text-muted"
                          }`}
                        >
                          {formatPriceValue(bin.priceMid, decimals)}
                        </span>
                        {bin.isPOC ? (
                          <span
                            className="relative z-10 font-bold leading-none"
                            style={{ color: "var(--poc)" }}
                          >
                            POC {bin.pctOfTotal.toFixed(0)}%
                          </span>
                        ) : isHovered ? (
                          <span className="relative z-10 leading-none text-text-primary">
                            {formatCompact(bin.volume, 1)} ({bin.pctOfTotal.toFixed(1)}%)
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Footer: Active Phase Vol & Identified Phases POC/VA Summary */}
                <div className="flex flex-col gap-1 border-t border-border-muted pt-1.5 font-mono text-[9.5px] tabular-nums text-text-muted">
                  <div className="flex items-center justify-between gap-1">
                    <span>
                      Vol: <strong className="text-text-primary">{formatCompact(activePhaseProfile.totalVolume, 2)}</strong>
                    </span>
                    <span>
                      {activePhaseProfile.barCount}v · {formatAxisDateTime(activePhaseProfile.startTime)}
                    </span>
                  </div>
                  {analysis.phaseVolumeProfiles.length > 1 && (
                    <div className="flex flex-col gap-0.5 pt-0.5">
                      {analysis.phaseVolumeProfiles.map((vp) => (
                        <button
                          key={`vp-row-${vp.stage}`}
                          type="button"
                          onClick={() => setSelectedProfileStage(vp.stage)}
                          className={`flex items-center justify-between gap-1 rounded px-1 py-0.5 text-left transition-colors ${
                            vp.stage === activePhaseProfile.stage
                              ? "bg-bg-panel-alt text-text-primary"
                              : "hover:bg-bg-surface"
                          }`}
                        >
                          <span style={{ color: STAGE_COLOR[vp.stage] }}>
                            {vp.shortLabel}
                          </span>
                          <span>
                            POC <strong style={{ color: "var(--poc)" }}>{formatPriceValue(vp.poc, decimals)}</strong> · VA{" "}
                            {formatPriceValue(vp.val, decimals)}–{formatPriceValue(vp.vah, decimals)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>

      {/* Secondary Volume Churn & Climax Histogram synced with Phase Markers */}
      <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border-muted bg-bg-surface/50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold text-text-primary">
              Histograma de Volumen, Churn y Eventos Clímax ({timeframe})
            </h3>
            <p className="text-[11px] text-text-secondary">
              Resalta picos de volumen (≥1.5×) y barras de absorción/churn sincronizadas con los marcadores de fase Wyckoff
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-text-muted">
            <span style={{ color: stageColor }}>■ Fase + Clímax</span>
            <span className="text-warn">■ Churn / Clímax</span>
            <span className="text-text-secondary">┄ 1.5× Umbral</span>
            {analysis.ready && (
              <span className="text-text-primary">
                Clímax: <strong>{analysis.climaxBarCount}</strong> · En fase:{" "}
                <strong style={{ color: stageColor }}>{analysis.correlatedClimaxCount}</strong>
              </span>
            )}
          </div>
        </div>

        <div className="h-[160px] w-full">
          {!analysis.ready || priceSeries.length < 2 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
              Esperando barras de volumen OKX para calcular churn y eventos clímax…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={140}>
              <BarChart
                data={priceSeries}
                syncId="wyckoff-structure"
                margin={{ top: 20, right: 64, left: 2, bottom: 2 }}
              >
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="timeKey"
                  minTickGap={44}
                  tickFormatter={(v: string) => formatAxisDateTime(Number(v))}
                  tick={{ fill: "var(--text-muted)", fontSize: 9.5, fontFamily: "var(--font-mono)" }}
                  axisLine={{ stroke: "var(--border-muted)" }}
                  tickLine={false}
                />
                <YAxis
                  width={66}
                  tickFormatter={(v: number) => formatCompact(v, 1)}
                  tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<VolumeClimaxTooltip decimals={decimals} />} />

                <ReferenceLine
                  y={analysis.avgVolume}
                  stroke="var(--text-muted)"
                  strokeDasharray="2 3"
                  label={{
                    value: "Media 1×",
                    position: "right",
                    fill: "var(--text-muted)",
                    fontSize: 9.5,
                    fontFamily: "var(--font-mono)",
                  }}
                />
                <ReferenceLine
                  y={analysis.climaxThresholdVolume}
                  stroke="var(--warn)"
                  strokeDasharray="4 3"
                  label={{
                    value: "Clímax 1.5×",
                    position: "right",
                    fill: "var(--warn)",
                    fontSize: 9.5,
                    fontFamily: "var(--font-mono)",
                  }}
                />

                {analysis.markers.map((marker) => (
                  <ReferenceLine
                    key={`vol-marker-ref-${marker.code}-${marker.time}`}
                    x={String(marker.time)}
                    stroke={STAGE_COLOR[marker.stage]}
                    strokeDasharray="3 3"
                    strokeOpacity={0.75}
                    label={{
                      value: marker.code,
                      position: "top",
                      fill: STAGE_COLOR[marker.stage],
                      fontSize: 9.5,
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                ))}

                <Bar dataKey="volume" name="Volumen" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {priceSeries.map((pt) => {
                    const fill =
                      pt.marker && pt.isClimax
                        ? STAGE_COLOR[pt.marker.stage]
                        : pt.isClimax
                          ? "var(--warn)"
                          : pt.marker
                            ? STAGE_COLOR[pt.marker.stage]
                            : pt.isBull
                              ? "var(--buy)"
                              : "var(--sell)";
                    const fillOpacity =
                      pt.marker && pt.isClimax
                        ? 0.95
                        : pt.isClimax
                          ? 0.85
                          : pt.marker
                            ? 0.65
                            : 0.28;
                    const stroke =
                      pt.marker && pt.isClimax
                        ? "var(--text-primary)"
                        : pt.isClimax
                          ? "var(--warn)"
                          : undefined;

                    return (
                      <Cell
                        key={`wyckoff-vol-${pt.timeKey}`}
                        fill={fill}
                        fillOpacity={fillOpacity}
                        stroke={stroke}
                        strokeWidth={stroke ? 1 : 0}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* MACD (12, 26, 9) Momentum Confirmation Panel synced with Wyckoff Phases */}
      {showMacd && (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border-muted bg-bg-surface/50 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-text-primary">
                  Indicador MACD (12, 26, 9) — Confirmación de Momentum Wyckoff ({timeframe})
                </h3>
                {analysis.ready && (
                  <span
                    className="font-mono text-[11px] font-bold"
                    style={{
                      color:
                        analysis.macdBias === "bullish"
                          ? "var(--buy)"
                          : analysis.macdBias === "bearish"
                            ? "var(--sell)"
                            : "var(--text-secondary)",
                    }}
                  >
                    [{analysis.macdMomentumLabel}]
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-secondary">
                Línea MACD vs Señal e histograma con cruces alcistas/bajistas alineados con las fases y fechas del ciclo
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-text-muted tabular-nums">
              <span className="text-accent">
                ━ MACD {analysis.ready ? formatMacdNumber(analysis.macdCurrent, decimals) : "—"}
              </span>
              <span className="text-warn">
                ┄ Señal {analysis.ready ? formatMacdNumber(analysis.macdSignalCurrent, decimals) : "—"}
              </span>
              <span>
                Hist{" "}
                <strong
                  style={{
                    color: analysis.macdHistogramCurrent >= 0 ? "var(--buy)" : "var(--sell)",
                  }}
                >
                  {analysis.ready ? formatMacdNumber(analysis.macdHistogramCurrent, decimals) : "—"}
                </strong>
              </span>
              {analysis.ready && (
                <span className="text-text-primary">
                  Cruces: <strong>{analysis.macdCrossCount}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="h-[165px] w-full">
            {!analysis.ready || priceSeries.length < 2 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                Calculando MACD (12, 26, 9) sobre las velas OKX…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={145}>
                <ComposedChart
                  data={priceSeries}
                  syncId="wyckoff-structure"
                  margin={{ top: 18, right: 64, left: 2, bottom: 2 }}
                >
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="timeKey"
                    minTickGap={44}
                    tickFormatter={(v: string) => formatAxisDateTime(Number(v))}
                    tick={{ fill: "var(--text-muted)", fontSize: 9.5, fontFamily: "var(--font-mono)" }}
                    axisLine={{ stroke: "var(--border-muted)" }}
                    tickLine={false}
                  />
                  <YAxis
                    width={66}
                    tickFormatter={(v: number) => formatMacdNumber(v, decimals)}
                    tick={{ fill: "var(--text-muted)", fontSize: 9.5, fontFamily: "var(--font-mono)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<MacdTooltip decimals={decimals} />} />

                  <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />

                  {analysis.markers.map((marker) => (
                    <ReferenceLine
                      key={`macd-marker-ref-${marker.code}-${marker.time}`}
                      x={String(marker.time)}
                      stroke={STAGE_COLOR[marker.stage]}
                      strokeDasharray="3 3"
                      strokeOpacity={0.65}
                      label={{
                        value: marker.code,
                        position: "top",
                        fill: STAGE_COLOR[marker.stage],
                        fontSize: 9.5,
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                  ))}

                  <Bar dataKey="macdHistogram" name="Histograma MACD" radius={[1.5, 1.5, 0, 0]} isAnimationActive={false}>
                    {priceSeries.map((pt, idx) => {
                      const prev = idx > 0 ? priceSeries[idx - 1].macdHistogram : pt.macdHistogram;
                      const isPos = pt.macdHistogram >= 0;
                      const expanding = isPos ? pt.macdHistogram >= prev : pt.macdHistogram <= prev;
                      return (
                        <Cell
                          key={`wyckoff-macd-hist-${pt.timeKey}`}
                          fill={isPos ? "var(--buy)" : "var(--sell)"}
                          fillOpacity={expanding ? 0.78 : 0.36}
                        />
                      );
                    })}
                  </Bar>

                  <Line
                    type="monotone"
                    dataKey="macdSignal"
                    name="Señal (9)"
                    stroke="var(--warn)"
                    strokeWidth={1.4}
                    strokeDasharray="3 2"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="macdLine"
                    name="MACD (12,26)"
                    stroke="var(--accent)"
                    strokeWidth={1.8}
                    dot={(dotProps) => (
                      <MacdCrossDot
                        cx={dotProps.cx}
                        cy={dotProps.cy}
                        index={dotProps.index}
                        payload={dotProps.payload as StructureChartPoint | undefined}
                      />
                    )}
                    activeDot={{
                      r: 6,
                      fill: "var(--accent)",
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
      )}

      {/* Trend Strength (ADX) Panel synced with Wyckoff Phases */}
      {showTrendStrength && (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border-muted bg-bg-surface/50 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-text-primary">
                  Trend Strength (ADX {analysis.adxPeriodUsed}) — Fuerza de Tendencia vs. Rango Wyckoff ({timeframe})
                </h3>
                {analysis.ready && (
                  <span
                    className="font-mono text-[11px] font-bold"
                    style={{
                      color:
                        analysis.adxRegime === "strong-trend"
                          ? "var(--warn)"
                          : analysis.adxRegime === "trending"
                            ? "var(--accent)"
                            : analysis.adxRegime === "emerging"
                              ? "var(--poc)"
                              : "var(--text-secondary)",
                    }}
                  >
                    [ADX {analysis.adxCurrent.toFixed(1)} · {analysis.trendStrengthLabel}]
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-secondary">
                ADX &lt; 20 confirma fases laterales (Acumulación/Distribución); ADX ≥ 25 cuantifica tendencia activa (Markup/Markdown) junto a +DI / -DI
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-text-muted tabular-nums">
              <span style={{ color: "var(--poc)" }}>
                ━ ADX {analysis.ready ? analysis.adxCurrent.toFixed(1) : "—"}
              </span>
              <span className="text-buy">
                ┄ +DI {analysis.ready ? analysis.plusDiCurrent.toFixed(1) : "—"}
              </span>
              <span className="text-sell">
                ┄ -DI {analysis.ready ? analysis.minusDiCurrent.toFixed(1) : "—"}
              </span>
              {analysis.ready && (
                <span className="text-text-primary">
                  Δ3v:{" "}
                  <strong
                    style={{
                      color: analysis.adxDelta >= 0 ? "var(--buy)" : "var(--text-secondary)",
                    }}
                  >
                    {analysis.adxDelta >= 0 ? "+" : ""}
                    {analysis.adxDelta.toFixed(1)}
                  </strong>
                </span>
              )}
            </div>
          </div>

          <div className="h-[160px] w-full">
            {!analysis.ready || priceSeries.length < 2 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                Calculando ADX ({analysis.adxPeriodUsed}) sobre velas OKX para medir la fuerza tendencial…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={140}>
                <ComposedChart
                  data={priceSeries}
                  syncId="wyckoff-structure"
                  margin={{ top: 18, right: 64, left: 2, bottom: 2 }}
                >
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="timeKey"
                    minTickGap={44}
                    tickFormatter={(v: string) => formatAxisDateTime(Number(v))}
                    tick={{ fill: "var(--text-muted)", fontSize: 9.5, fontFamily: "var(--font-mono)" }}
                    axisLine={{ stroke: "var(--border-muted)" }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    width={66}
                    ticks={[0, 20, 25, 40, 60, 80, 100]}
                    tick={{ fill: "var(--text-muted)", fontSize: 9.5, fontFamily: "var(--font-mono)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<TrendStrengthTooltip decimals={decimals} />} />

                  {/* Range-bound (<20) and Trending (>=25) regime shading */}
                  <ReferenceArea y1={0} y2={20} fill="var(--text-muted)" fillOpacity={0.07} />
                  <ReferenceArea y1={25} y2={100} fill="var(--accent)" fillOpacity={0.05} />

                  <ReferenceLine
                    y={20}
                    stroke="var(--text-muted)"
                    strokeDasharray="2 3"
                    label={{
                      value: "Rango 20",
                      position: "right",
                      fill: "var(--text-muted)",
                      fontSize: 9.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <ReferenceLine
                    y={25}
                    stroke="var(--accent)"
                    strokeDasharray="4 3"
                    label={{
                      value: "Tend. 25",
                      position: "right",
                      fill: "var(--accent)",
                      fontSize: 9.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <ReferenceLine
                    y={40}
                    stroke="var(--warn)"
                    strokeDasharray="4 3"
                    label={{
                      value: "Fuerte 40",
                      position: "right",
                      fill: "var(--warn)",
                      fontSize: 9.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  />

                  {analysis.markers.map((marker) => (
                    <ReferenceLine
                      key={`adx-marker-ref-${marker.code}-${marker.time}`}
                      x={String(marker.time)}
                      stroke={STAGE_COLOR[marker.stage]}
                      strokeDasharray="3 3"
                      strokeOpacity={0.6}
                      label={{
                        value: marker.code,
                        position: "top",
                        fill: STAGE_COLOR[marker.stage],
                        fontSize: 9.5,
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                  ))}

                  <Area
                    type="monotone"
                    dataKey="adx"
                    name="ADX"
                    stroke="var(--poc)"
                    strokeWidth={2}
                    fill="var(--poc)"
                    fillOpacity={0.14}
                    dot={false}
                    activeDot={{
                      r: 6,
                      fill: "var(--poc)",
                      stroke: "var(--bg-base)",
                      strokeWidth: 2,
                    }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="plusDi"
                    name="+DI"
                    stroke="var(--buy)"
                    strokeWidth={1.3}
                    strokeDasharray="3 2"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="minusDi"
                    name="-DI"
                    stroke="var(--sell)"
                    strokeWidth={1.3}
                    strokeDasharray="3 2"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Statistical Panel: Average Historical Duration per Wyckoff Phase & Cycle Maturity */}
      {analysis.ready && analysis.phaseDurations.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-border-muted bg-bg-surface/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-accent" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Duración Media Histórica por Fase y Madurez del Ciclo
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-text-muted tabular-nums">
              <span>
                Horizonte:{" "}
                <strong className="text-text-primary">
                  {formatPhaseDuration(analysis.historySpanMs)}
                </strong>
              </span>
              <span className="text-border">|</span>
              <span>
                Fase actual:{" "}
                <strong style={{ color: stageColor }}>
                  {formatPhaseDuration(analysis.currentPhaseElapsedMs)}
                </strong>{" "}
                / Media {formatPhaseDuration(analysis.currentPhaseAvgMs)}
              </span>
              <span className="text-border">|</span>
              <span style={{ color: stageColor }}>
                <strong>{analysis.cycleMaturityLabel}</strong>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 font-mono text-[11px] tabular-nums">
            {analysis.phaseDurations.map((stat) => {
              const color = STAGE_COLOR[stat.stage];
              const barPct = stat.isCurrent
                ? Math.min(100, Math.max(4, stat.maturityPct ?? 0))
                : Math.min(100, stat.sharePct);

              return (
                <div
                  key={stat.stage}
                  className={`flex flex-col gap-1.5 rounded-[var(--radius)] border px-2.5 py-2 ${
                    stat.isCurrent
                      ? "bg-bg-panel-alt border-accent"
                      : "border-border-muted bg-bg-panel"
                  }`}
                  style={stat.isCurrent ? { borderColor: color } : undefined}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="font-sans text-[11.5px] font-bold" style={{ color }}>
                      {stat.label}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {stat.isCurrent
                        ? `● ACTIVA (${stat.maturityPct ?? 100}%)`
                        : `${stat.occurrences} ep.`}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-sans text-[10px] text-text-muted">Duración media</span>
                    <strong className="text-[12px] text-text-primary">
                      {stat.occurrences > 0 ? formatPhaseDuration(stat.avgDurationMs) : "Sin datos"}
                    </strong>
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded bg-bg-surface">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${stat.occurrences > 0 ? barPct : 0}%`,
                        backgroundColor: color,
                        opacity: stat.isCurrent ? 0.95 : 0.65,
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[10px] text-text-secondary">
                    {stat.isCurrent ? (
                      <>
                        <span>En curso: {formatPhaseDuration(stat.currentElapsedMs)}</span>
                        <span>{stat.occurrences} ep. · {stat.sharePct}% hist.</span>
                      </>
                    ) : stat.occurrences > 0 ? (
                      <>
                        <span>~{stat.avgBars.toFixed(0)} velas/ep.</span>
                        <span>{stat.sharePct}% del historial</span>
                      </>
                    ) : (
                      <span>Sin episodios en ventana</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detected Phase Markers Chronological Summary */}
      {analysis.ready && analysis.markers.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border-muted bg-bg-surface/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Marcadores de fase detectados ({analysis.markers.length})
            </span>
            <span className="font-mono text-[10.5px] text-text-muted">
              Precio · Volumen · Churn/Clímax · Fecha y Hora OKX
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 font-mono text-[11px] tabular-nums">
            {analysis.markers.map((marker) => {
              const color = STAGE_COLOR[marker.stage];
              const matchedBar = analysis.series.find((s) => s.time === marker.time);
              const isClimaxBar = Boolean(matchedBar?.isClimax);
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
                    <span className="text-[9.5px] text-text-muted">
                      {formatAxisDateTime(marker.time)}
                    </span>
                  </div>
                  <div className="font-semibold text-text-primary">
                    {formatPriceValue(marker.price, decimals)}
                  </div>
                  <div className="flex items-center justify-between gap-1 text-[10px] text-text-secondary">
                    <span>
                      Vol {formatCompact(marker.volume, 1)} ({marker.volumeRatio.toFixed(1)}×)
                    </span>
                    {isClimaxBar && (
                      <span className="font-bold text-warn">
                        {matchedBar?.isChurn ? "CHURN" : "CLÍMAX"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Quantitative Metrics & Actionable Wyckoff Guidance */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 font-mono text-[11px] tabular-nums">
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
          <div className="font-sans text-[10.5px] text-text-muted">Confirmación MACD (12,26,9)</div>
          <div
            className="mt-0.5 font-semibold"
            style={{
              color:
                analysis.macdBias === "bullish"
                  ? "var(--buy)"
                  : analysis.macdBias === "bearish"
                    ? "var(--sell)"
                    : "var(--text-primary)",
            }}
          >
            {analysis.macdMomentumLabel}
          </div>
        </div>
        <div className="rounded-[var(--radius)] border border-border-muted bg-bg-surface px-3 py-2">
          <div className="font-sans text-[10.5px] text-text-muted">Trend Strength (ADX)</div>
          <div
            className="mt-0.5 font-semibold"
            style={{
              color:
                analysis.adxRegime === "strong-trend"
                  ? "var(--warn)"
                  : analysis.adxRegime === "trending"
                    ? "var(--accent)"
                    : analysis.adxRegime === "emerging"
                      ? "var(--poc)"
                      : "var(--text-primary)",
            }}
          >
            {analysis.ready
              ? `${analysis.adxCurrent.toFixed(1)} · ${analysis.trendStrengthLabel}`
              : "—"}
          </div>
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
