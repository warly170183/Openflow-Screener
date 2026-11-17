"use client";

import React, { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSessionStore } from "@/lib/session/SessionContext";
import {
  OBI_ROLLING_RESOLUTIONS,
  OBI_ROLLING_WINDOW_MS,
  buildRollingObiSeries,
  type OBIRollingResolution,
  type RollingOBIPoint,
} from "@/lib/engine/obiRolling";
import { formatClock, formatPercent, formatPriceValue, formatSigned, priceDecimals } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented, Stat } from "@/components/ui/Primitives";

function formatWindowSpan(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const mins = sec / 60;
  return mins >= 10 ? `${Math.round(mins)}m` : `${mins.toFixed(1)}m`;
}

function rollingTone(value: number | null): "buy" | "sell" | "muted" {
  if (value === null) return "muted";
  if (value > 0.08) return "buy";
  if (value < -0.08) return "sell";
  return "muted";
}

function RollingObiTooltip({
  active,
  payload,
  decimals,
  showPrice,
  showRaw,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: RollingOBIPoint }>;
  decimals: number;
  showPrice: boolean;
  showRaw: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div
      className="rounded-lg border border-border bg-bg-panel-alt px-2.5 py-2 text-[11px] shadow-lg"
      style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
    >
      <div className="mb-1 flex items-center justify-between gap-4 text-text-muted">
        <span>{formatClock(point.time)}</span>
        <span>{point.windowSamples}s in 30m window</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-text-secondary">30m Rolling OBI</span>
        <span className={point.rollingObi >= 0 ? "text-buy font-semibold" : "text-sell font-semibold"}>
          {formatSigned(point.rollingObi, 3)}
        </span>
      </div>
      {showRaw && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-secondary">Spot OBI</span>
          <span className="text-text-primary">{formatSigned(point.obi, 3)}</span>
        </div>
      )}
      {showPrice && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-secondary">Price</span>
          <span className="text-vwap font-semibold">{formatPriceValue(point.price, decimals)}</span>
        </div>
      )}
    </div>
  );
}

export default function RollingOBIChartPanel() {
  const obiPriceHistory = useSessionStore((s) => s.obiPriceHistory);
  const tickSize = useSessionStore((s) => s.tickSize);
  const marketType = useSessionStore((s) => s.marketType);
  const [resolution, setResolution] = useState<OBIRollingResolution>(5);
  const [showPrice, setShowPrice] = useState(true);
  const [showRaw, setShowRaw] = useState(true);

  const { points, summary } = useMemo(
    () => buildRollingObiSeries(obiPriceHistory, resolution, OBI_ROLLING_WINDOW_MS),
    [obiPriceHistory, resolution]
  );

  const latestPrice = points[points.length - 1]?.price;
  const decimals = priceDecimals(tickSize, latestPrice);
  const tone = rollingTone(summary.currentRollingObi);

  const obiDomain = useMemo<[number, number]>(() => {
    if (!points.length) return [-0.5, 0.5];
    let maxAbs = 0.15;
    for (const pt of points) {
      maxAbs = Math.max(maxAbs, Math.abs(pt.rollingObi));
      if (showRaw) maxAbs = Math.max(maxAbs, Math.abs(pt.obi));
    }
    const bound = Math.min(1, Math.ceil((maxAbs * 1.15) * 10) / 10);
    return [-bound, bound];
  }, [points, showRaw]);

  const subtitle =
    summary.sampleCount > 0
      ? `30m avg · ${formatWindowSpan(summary.coverageMs)} / 30m${marketType === "forex" ? " · quote proxy" : ""}`
      : "30m rolling OBI + price (Recharts)";

  return (
    <Panel
      title="OBI 30m Rolling"
      icon={<Icon.Gauge />}
      subtitle={subtitle}
      value={
        <span className={`tone-${tone}`} style={{ fontVariantNumeric: "tabular-nums" }}>
          {summary.currentRollingObi === null ? "—" : formatSigned(summary.currentRollingObi, 3)}
        </span>
      }
      actions={
        <>
          <button
            type="button"
            className={`ui-button chip ${showRaw ? "is-active" : ""}`}
            onClick={() => setShowRaw((v) => !v)}
            title="Toggle instantaneous OBI trace alongside the 30-minute rolling mean"
          >
            Spot
          </button>
          <button
            type="button"
            className={`ui-button chip ${showPrice ? "is-active" : ""}`}
            onClick={() => setShowPrice((v) => !v)}
            title="Toggle price overlay on secondary axis"
          >
            Price
          </button>
          <Segmented
            size="xs"
            value={resolution}
            onChange={setResolution}
            options={OBI_ROLLING_RESOLUTIONS}
            ariaLabel="Rolling OBI bucket resolution"
          />
        </>
      }
      footer={
        <div className="study-stats">
          <Stat
            label="30m Avg"
            value={summary.currentRollingObi === null ? "—" : formatSigned(summary.currentRollingObi, 3)}
            tone={tone}
          />
          <Stat
            label="Spot OBI"
            value={summary.currentSpotObi === null ? "—" : formatSigned(summary.currentSpotObi, 3)}
            tone={rollingTone(summary.currentSpotObi)}
          />
          <Stat
            label="5m Slope"
            value={summary.delta5m === null ? "—" : formatSigned(summary.delta5m, 3)}
            tone={summary.delta5m === null ? "muted" : summary.delta5m >= 0 ? "buy" : "sell"}
          />
          <Stat
            label="Price Δ"
            value={summary.priceChangePct === null ? "—" : formatPercent(summary.priceChangePct, 2)}
            sub={summary.coverageRatio >= 1 ? "30m full" : `${Math.round(summary.coverageRatio * 100)}% win`}
            tone={summary.priceChangePct === null ? "muted" : summary.priceChangePct >= 0 ? "buy" : "sell"}
          />
        </div>
      }
    >
      <div className="relative flex-1 min-h-[120px] w-full px-1 pt-1">
        {points.length < 2 ? (
          <div className="flex h-full w-full items-center justify-center text-center text-[12px] text-text-muted">
            Collecting 1s order book imbalance & price samples…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={110}>
            <ComposedChart data={points} margin={{ top: 6, right: showPrice ? 4 : 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="obiRollingFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                minTickGap={28}
                tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={{ stroke: "var(--border-muted)" }}
                tickLine={false}
              />
              <YAxis
                yAxisId="obi"
                domain={obiDomain}
                width={42}
                tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`}
                tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={false}
                tickLine={false}
              />
              {showPrice && (
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  domain={["auto", "auto"]}
                  width={58}
                  tickFormatter={(v: number) => formatPriceValue(v, decimals)}
                  tick={{ fill: "var(--vwap)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={false}
                  tickLine={false}
                />
              )}
              <ReferenceLine yAxisId="obi" y={0} stroke="var(--border)" strokeDasharray="3 3" />
              <Tooltip
                content={
                  <RollingObiTooltip decimals={decimals} showPrice={showPrice} showRaw={showRaw} />
                }
              />
              <Area
                yAxisId="obi"
                type="monotone"
                dataKey="rollingObi"
                name="30m Rolling OBI"
                stroke="var(--accent)"
                strokeWidth={2}
                fill="url(#obiRollingFill)"
                dot={false}
                isAnimationActive={false}
              />
              {showRaw && (
                <Line
                  yAxisId="obi"
                  type="monotone"
                  dataKey="obi"
                  name="Spot OBI"
                  stroke="var(--text-muted)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {showPrice && (
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="price"
                  name="Price"
                  stroke="var(--vwap)"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}
