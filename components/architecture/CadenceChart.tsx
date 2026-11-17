"use client";

import React, { useState } from "react";
import type { CadenceMetric } from "@/lib/architecture/model";

const CATEGORY_COLOR: Record<CadenceMetric["category"], string> = {
  "Tiempo real": "var(--buy)",
  Throttling: "var(--accent)",
  Agregación: "var(--vwap)",
  Resiliencia: "var(--warn)",
};

export default function CadenceChart({
  metrics,
  selectedNodeId,
  onSelectNode,
}: {
  metrics: CadenceMetric[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}) {
  const [activeMetricId, setActiveMetricId] = useState<string>(metrics[1]?.id ?? metrics[0].id);
  const activeMetric = metrics.find((m) => m.id === activeMetricId) ?? metrics[0];

  // Log10 scale from 10ms (log=1) to 100_000ms (log=5) so 10ms and 60s compare cleanly.
  const minLog = Math.log10(5);
  const maxLog = Math.log10(100_000);
  const barWidthPct = (ms: number) => {
    const clamped = Math.max(5, Math.min(100_000, ms));
    return ((Math.log10(clamped) - minLog) / (maxLog - minLog)) * 100;
  };

  return (
    <section
      className="rounded-[var(--radius-card)] border border-border bg-bg-panel p-4"
      aria-label="Cadencias y ventanas de procesamiento"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-muted pb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">
            Gráfico interactivo de cadencias y amortiguación (escala logarítmica)
          </h2>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">
            Cómo el sistema comprime ráfagas de ticks de OKX en ventanas estables para sostener 60 FPS sin congelar React ni el servidor.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11.5px] text-text-secondary">
          {(["Tiempo real", "Throttling", "Agregación", "Resiliencia"] as const).map((cat) => (
            <span key={cat} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLOR[cat] }} />
              {cat}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
        {/* Interactive SVG / HTML log-bar chart */}
        <div className="flex flex-col gap-2">
          {metrics.map((metric) => {
            const pct = barWidthPct(metric.ms);
            const isSelected = metric.id === activeMetric.id;
            const isNodeMatch = metric.nodeId === selectedNodeId;
            const color = CATEGORY_COLOR[metric.category];

            return (
              <button
                key={metric.id}
                type="button"
                onClick={() => {
                  setActiveMetricId(metric.id);
                  onSelectNode(metric.nodeId);
                }}
                onMouseEnter={() => setActiveMetricId(metric.id)}
                className={`group flex flex-col gap-1.5 rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? "border-accent bg-bg-panel-alt"
                    : isNodeMatch
                      ? "border-border bg-bg-surface"
                      : "border-border-muted bg-bg-surface hover:border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-text-primary">
                    {metric.label}
                  </span>
                  <span className="font-mono text-[11.5px] tabular-nums text-text-secondary">
                    {metric.displayValue}
                  </span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg-base">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(8, pct)}%`,
                      background: color,
                      opacity: isSelected ? 1 : 0.72,
                    }}
                  />
                </div>
              </button>
            );
          })}
          <div className="mt-1 flex justify-between font-mono text-[10.5px] text-text-muted">
            <span>10 ms (Push)</span>
            <span>100 ms</span>
            <span>1 s</span>
            <span>10 s</span>
            <span>60 s</span>
          </div>
        </div>

        {/* Selected metric rationale */}
        <div className="flex flex-col justify-between gap-4 rounded-[var(--radius)] border border-border bg-bg-surface p-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-muted">
              <span style={{ color: CATEGORY_COLOR[activeMetric.category] }}>{activeMetric.category}</span>
              <span>·</span>
              <span className="tabular-nums">{activeMetric.displayValue}</span>
            </div>
            <h3 className="mt-1.5 text-[15px] font-semibold text-text-primary">
              {activeMetric.label}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
              {activeMetric.rationale}
            </p>
          </div>

          <div className="border-t border-border-muted pt-3 text-[12px] text-text-muted">
            Al hacer clic en una barra, el diagrama superior resalta automáticamente el módulo responsable de esta cadencia.
          </div>
        </div>
      </div>
    </section>
  );
}
