"use client";

import React, { useId } from "react";
import type { AdxTickTrajectory } from "@/lib/engine/wyckoff";

const TREND_COLOR: Record<AdxTickTrajectory["trend"], string> = {
  increasing: "var(--buy)",
  decreasing: "var(--sell)",
  flat: "var(--text-muted)",
};

const TREND_LABEL: Record<AdxTickTrajectory["trend"], string> = {
  increasing: "Increasing",
  decreasing: "Decreasing",
  flat: "Steady",
};

export default function AdxSparkline({
  trajectory,
  width = 72,
  height = 20,
  showDelta = true,
  className = "",
}: {
  trajectory: AdxTickTrajectory | null | undefined;
  width?: number;
  height?: number;
  showDelta?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");

  if (!trajectory || trajectory.points.length < 2) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] text-text-muted ${className}`}
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <line
            x1={2}
            x2={width - 2}
            y1={height / 2}
            y2={height / 2}
            stroke="var(--border)"
            strokeDasharray="2 2"
            strokeWidth={1}
          />
        </svg>
        {showDelta && <span>—</span>}
      </span>
    );
  }

  const { points, trend, netChange } = trajectory;
  const stroke = TREND_COLOR[trend];
  const padX = 3;
  const padY = 3;
  const innerW = Math.max(4, width - padX * 2);
  const innerH = Math.max(4, height - padY * 2);

  const minVal = Math.min(...points);
  const maxVal = Math.max(...points);
  const rawSpan = maxVal - minVal;
  // Minimum display span keeps tiny live-tick shifts legible while avoiding amplified noise
  const span = Math.max(rawSpan, 0.35);
  const mid = (minVal + maxVal) / 2;
  const domainMin = mid - span / 2;

  const coords = points.map((val, idx) => {
    const x = points.length === 1 ? padX + innerW / 2 : padX + (idx / (points.length - 1)) * innerW;
    const normY = (val - domainMin) / span;
    const y = padY + (1 - Math.max(0, Math.min(1, normY))) * innerH;
    return { x, y, val };
  });

  const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPoints = `${coords[0].x.toFixed(1)},${(height - 1).toFixed(1)} ${linePoints} ${coords[coords.length - 1].x.toFixed(1)},${(height - 1).toFixed(1)}`;
  const startY = coords[0].y;
  const lastCoord = coords[coords.length - 1];
  const gradId = `adx-spark-${uid}`;

  const deltaText = `${netChange >= 0 ? "+" : ""}${netChange.toFixed(2)}`;
  const tooltipText = `ADX 5-tick strength ${TREND_LABEL[trend].toLowerCase()} (${deltaText}): ${points
    .map((v) => v.toFixed(1))
    .join(" → ")}`;

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono tabular-nums ${className}`}
      title={tooltipText}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={tooltipText}
        className="shrink-0 overflow-visible"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <line
          x1={padX}
          x2={width - padX}
          y1={startY}
          y2={startY}
          stroke={stroke}
          strokeOpacity={0.24}
          strokeDasharray="2 2"
          strokeWidth={1}
        />
        <polygon points={areaPoints} fill={`url(#${gradId})`} />
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePoints}
        />
        {coords.slice(0, -1).map((c, idx) => (
          <circle
            key={idx}
            cx={c.x}
            cy={c.y}
            r={1.15}
            fill={stroke}
            fillOpacity={0.65}
          />
        ))}
        <circle
          cx={lastCoord.x}
          cy={lastCoord.y}
          r={2.2}
          fill={stroke}
          stroke="var(--bg-panel)"
          strokeWidth={0.8}
        />
      </svg>
      {showDelta && (
        <span className="text-[10.5px] font-semibold leading-none" style={{ color: stroke }}>
          {netChange > 0 ? `+${netChange.toFixed(2)}` : netChange.toFixed(2)}
        </span>
      )}
    </span>
  );
}
