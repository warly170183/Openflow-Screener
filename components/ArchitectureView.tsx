"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Wordmark } from "@/components/Logo";
import RouteNav from "@/components/RouteNav";
import ThemeMenu from "@/components/ThemeMenu";
import CommandPalette from "@/components/CommandPalette";
import { Segmented } from "@/components/ui/Primitives";
import ArchitectureDiagram from "@/components/architecture/ArchitectureDiagram";
import CadenceChart from "@/components/architecture/CadenceChart";
import {
  ARCH_CHANGELOG,
  ARCH_EDGES,
  ARCH_NODES,
  CADENCE_METRICS,
  LAYER_META,
  TRACE_STEPS,
  type ArchLayer,
  type ArchPerspective,
  type ArchitectureChangeEntry,
} from "@/lib/architecture/model";
import { CRYPTO_ASSETS } from "@/lib/config/instruments";
import { ArrowUpRight, History, Layers, ShieldCheck, Workflow } from "lucide-react";

const PERSPECTIVES: { value: ArchPerspective; label: string; title: string }[] = [
  { value: "full", label: "Vista completa", title: "Topología integral del sistema sobre OKX" },
  { value: "terminal", label: "Terminal y HVN", title: "Flujo hacia el Footprint Canvas, VAP HVN y estudios" },
  { value: "trading", label: "Opciones y Gráficos", title: "Motor ATR + Bollinger, Riesgo 2–3%, Footprint en vivo y Gráficos Recharts" },
  { value: "screener", label: "Screener OKX", title: "Pipeline en servidor sobre ~40 swaps perpetuos OKX" },
  { value: "resilience", label: "Resiliencia y Relay", title: "Failover WebSocket → SSE/Snapshot, sembrado y klines" },
];

const LAYER_ORDER: ArchLayer[] = ["source", "transport", "engine", "state", "ui"];

const CATEGORY_FILTER: { value: "all" | ArchitectureChangeEntry["category"]; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "Trading y Análisis", label: "Trading y Análisis" },
  { value: "Visualización y UX", label: "Visualización y UX" },
  { value: "Indicadores", label: "Indicadores" },
  { value: "Datos y Relay", label: "Datos y Relay" },
];

const OKX_ENDPOINTS = [
  {
    surface: "WebSocket Público v5",
    endpoint: "wss://ws.okx.com:8443/ws/v5/public",
    channels: "trades, books, open-interest, funding-rate, mark-price, index-tickers, liquidation-orders",
    purpose: "Alimenta en tiempo real el Terminal, Opciones de Trading, Gráficos Interactivos y el Screener multi-activo.",
  },
  {
    surface: "REST Instrumentos y Trades",
    endpoint: "GET /api/v5/public/instruments & /market/trades",
    channels: "ctVal, instType=SWAP/SPOT, limit=40",
    purpose: "Resuelve multiplicadores ctVal, descubre los 40 pares más líquidos y siembra trades iniciales al conectar en frío.",
  },
  {
    surface: "REST Klines Multi-Temporalidad",
    endpoint: "GET /api/v5/market/candles & history-candles",
    channels: "bar=1m|5m|15m|30m|1H|4H, limit",
    purpose: "Hidrata velas por temporalidad vía /api/terminal/klines para ATR(14), Bandas de Bollinger y pPOC/VAH/VAL.",
  },
] as const;

export default function ArchitectureView() {
  const [perspective, setPerspective] = useState<ArchPerspective>("full");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("terminal-adapters");
  const [activeTraceIndex, setActiveTraceIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [changeCategory, setChangeCategory] = useState<"all" | ArchitectureChangeEntry["category"]>("all");

  const handlePerspectiveChange = (next: ArchPerspective) => {
    setPerspective(next);
    const current = ARCH_NODES.find((n) => n.id === selectedNodeId);
    if (!current || !current.perspectives.includes(next)) {
      const firstMatch = ARCH_NODES.find((n) => n.perspectives.includes(next));
      if (firstMatch) setSelectedNodeId(firstMatch.id);
    }
  };

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setActiveTraceIndex((prev) => {
        const next = prev === null ? 0 : (prev + 1) % TRACE_STEPS.length;
        setSelectedNodeId(TRACE_STEPS[next].nodeId);
        return next;
      });
    }, 2400);
    return () => clearInterval(id);
  }, [isPlaying]);

  const handleTogglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const startIdx = activeTraceIndex ?? 0;
    setActiveTraceIndex(startIdx);
    setSelectedNodeId(TRACE_STEPS[startIdx].nodeId);
    setIsPlaying(true);
  };

  const handleStepTrace = (delta: -1 | 1) => {
    setIsPlaying(false);
    setActiveTraceIndex((prev) => {
      const current = prev === null ? 0 : prev;
      const next = Math.max(0, Math.min(TRACE_STEPS.length - 1, current + delta));
      setSelectedNodeId(TRACE_STEPS[next].nodeId);
      return next;
    });
  };

  const handleResetTrace = () => {
    setIsPlaying(false);
    setActiveTraceIndex(null);
  };

  const handleJumpTrace = (index: number) => {
    setIsPlaying(false);
    const clamped = Math.max(0, Math.min(TRACE_STEPS.length - 1, index));
    setActiveTraceIndex(clamped);
    setSelectedNodeId(TRACE_STEPS[clamped].nodeId);
  };

  const filteredChangelog = useMemo(
    () =>
      changeCategory === "all"
        ? ARCH_CHANGELOG
        : ARCH_CHANGELOG.filter((c) => c.category === changeCategory),
    [changeCategory]
  );

  // Interactive bar chart summarizing modules & changes across architecture layers
  const layerStatsData = useMemo(
    () =>
      LAYER_ORDER.map((layerKey) => {
        const layerNodes = ARCH_NODES.filter((n) => n.layer === layerKey);
        const fileCount = new Set(layerNodes.flatMap((n) => n.files)).size;
        const respCount = layerNodes.reduce((s, n) => s + n.responsibilities.length, 0);
        const shortName: Record<ArchLayer, string> = {
          source: "1. Fuente OKX",
          transport: "2. Transporte",
          engine: "3. Motores",
          state: "4. Sesión/Temas",
          ui: "5. Vistas UI",
        };
        return {
          layerKey,
          name: shortName[layerKey],
          modulos: fileCount,
          capacidades: respCount,
          firstNodeId: layerNodes[0]?.id ?? "okx-ws",
        };
      }),
    []
  );

  return (
    <div className="min-h-screen bg-bg-base text-text-primary flex flex-col">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-bg-base/95 px-4 py-2.5 backdrop-blur">
        <Link className="brand" href="/" aria-label="orderflow home">
          <Wordmark size={26} />
        </Link>
        <RouteNav />

        <div className="ml-2 hidden items-center gap-2 text-[12px] text-text-muted xl:flex">
          <span>Fuente única: OKX v5</span>
          <span>·</span>
          <span>{CRYPTO_ASSETS.length} activos OKX</span>
          <span>·</span>
          <span>VAP HVN · ATR+Bollinger · Tema Sepia</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ThemeMenu />
          <CommandPalette />
          <Link
            href="/"
            className="ui-button chip is-primary whitespace-nowrap shrink-0"
          >
            Abrir Terminal
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-4 py-5 md:px-6">
        {/* Page Header + Perspective Filter */}
        <section className="flex flex-col gap-4 border-b border-border-muted pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-muted">
              <Workflow size={13} className="text-accent" />
              <span>Arquitectura viva del sistema</span>
              <span>·</span>
              <span>Next.js 16 + Zustand + Canvas DPR + Recharts</span>
              <span>·</span>
              <span>{ARCH_CHANGELOG.length} hitos registrados</span>
            </div>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-tight text-text-primary sm:text-[26px]">
              Flujo Order Flow, Opciones de Trading y Gráficos sobre OKX
            </h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-secondary">
              Mapa técnico actualizado automáticamente con cada módulo que añadimos: desde el WebSocket OKX y el relay multi-temporalidad hasta VAP HVN, tema Sepia, Opciones de Trading con proyección en vivo y liquidez L2 cercana, y Gráficos Interactivos con Footprint, velas con niveles de liquidez y Ciclo de Wyckoff con fechas, tooltips, histograma Clímax/Churn, MACD (12,26,9), Trend Strength (ADX), duración por fase, superposición de ciclos históricos y barra lateral de Volume Profile (POC y Value Area) por fase.
            </p>
          </div>

          <div className="flex flex-col items-start gap-1.5 lg:items-end">
            <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
              Filtrar perspectiva
            </span>
            <Segmented
              value={perspective}
              onChange={handlePerspectiveChange}
              options={PERSPECTIVES}
              ariaLabel="Perspectiva de arquitectura"
            />
          </div>
        </section>

        {/* Interactive Node-Edge System Architecture Graph */}
        <ArchitectureDiagram
          nodes={ARCH_NODES}
          edges={ARCH_EDGES}
          perspective={perspective}
          selectedNodeId={selectedNodeId}
          onSelectNode={(id) => {
            setSelectedNodeId(id);
            const traceIdx = TRACE_STEPS.findIndex((t) => t.nodeId === id);
            if (activeTraceIndex !== null && traceIdx !== -1) {
              setActiveTraceIndex(traceIdx);
            }
          }}
          traceSteps={TRACE_STEPS}
          activeTraceIndex={activeTraceIndex}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          onStepTrace={handleStepTrace}
          onJumpTrace={handleJumpTrace}
          onResetTrace={handleResetTrace}
        />

        {/* Interactive System Evolution & Layer Distribution Chart */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
          {/* Interactive Chronological Changelog */}
          <div className="flex flex-col gap-3.5 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-muted pb-3">
              <div className="flex items-center gap-2">
                <History size={16} className="text-accent" />
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">
                    Registro de Cambios y Funcionalidades Añadidas
                  </h2>
                  <p className="text-[12px] text-text-secondary">
                    Bitácora actualizada de cada mejora integrada para recordar qué hace y dónde vive
                  </p>
                </div>
              </div>
              <Segmented
                size="xs"
                value={changeCategory}
                onChange={setChangeCategory}
                options={CATEGORY_FILTER}
                ariaLabel="Filtrar cambios por categoría"
              />
            </div>

            <div className="flex flex-col divide-y divide-border-muted">
              {filteredChangelog.map((entry) => {
                const isNodeSelected = entry.nodeId === selectedNodeId;
                return (
                  <article key={entry.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-bold text-accent">{entry.version}</span>
                        <span className="text-[11px] text-text-muted">·</span>
                        <span className="font-mono text-[11px] text-text-muted">{entry.category}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedNodeId(entry.nodeId);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className={`text-[11.5px] font-medium cursor-pointer hover:underline ${
                          isNodeSelected ? "text-accent" : "text-text-secondary"
                        }`}
                      >
                        Ver nodo en diagrama ↑
                      </button>
                    </div>
                    <h3 className="mt-1 text-[14px] font-bold text-text-primary">{entry.title}</h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">{entry.summary}</p>
                    <ul className="mt-2 flex flex-col gap-1 text-[12px] text-text-secondary">
                      {entry.details.map((d) => (
                        <li key={d} className="flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 font-mono text-[11px] text-text-muted">
                      {entry.files.join(" · ")}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          {/* Interactive Recharts Subsystem Distribution Chart */}
          <div className="flex flex-col justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="border-b border-border-muted pb-3">
              <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">
                Gráfico Interactivo: Módulos y Capacidades por Capa
              </h2>
              <p className="mt-0.5 text-[12px] text-text-secondary">
                Haz clic sobre cualquier barra para resaltar la capa correspondiente en el diagrama superior.
              </p>
            </div>

            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
                <BarChart
                  data={layerStatsData}
                  margin={{ top: 10, right: 10, left: -12, bottom: 0 }}
                  onClick={(state) => {
                    const activeLabel = state?.activeLabel;
                    const hit = layerStatsData.find((d) => d.name === activeLabel);
                    if (hit) setSelectedNodeId(hit.firstNodeId);
                  }}
                >
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                    axisLine={{ stroke: "var(--border-muted)" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--bg-panel-alt)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                    }}
                  />
                  <Bar dataKey="modulos" name="Archivos / Módulos" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {layerStatsData.map((entry) => (
                      <Cell key={entry.layerKey} fill="var(--accent)" fillOpacity={0.85} />
                    ))}
                  </Bar>
                  <Bar dataKey="capacidades" name="Responsabilidades" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {layerStatsData.map((entry) => (
                      <Cell key={entry.layerKey} fill="var(--buy)" fillOpacity={0.75} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-[var(--radius)] border border-border-muted bg-bg-surface p-3 text-[12px] text-text-secondary">
              <strong className="text-text-primary">Resumen actual:</strong>{" "}
              {ARCH_NODES.length} nodos arquitectónicos · {ARCH_EDGES.length} flujos de datos · 5 vistas principales (Terminal, Opciones de Trading, Gráficos Interactivos con Footprint + Recharts, Screener, Arquitectura) · 7 temas visuales (incl. Sepia).
            </div>
          </div>
        </section>

        {/* Interactive Cadence / Throttling SVG Bar Chart */}
        <CadenceChart
          metrics={CADENCE_METRICS}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
        />

        {/* OKX-Only Data Acquisition Specification */}
        <section className="rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-muted pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-buy" />
              <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">
                Adquisición de datos unificada en OKX (Perpetuos SWAP y Spot)
              </h2>
            </div>
            <span className="font-mono text-[11.5px] text-text-muted">
              Binance y Bybit removidos · 100% tráfico verificado contra okx.com
            </span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="py-2 pr-4 font-medium">Interfaz OKX</th>
                  <th className="py-2 pr-4 font-medium">Endpoint</th>
                  <th className="py-2 pr-4 font-medium">Canales / Parámetros</th>
                  <th className="py-2 font-medium">Función en la aplicación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-muted">
                {OKX_ENDPOINTS.map((row) => (
                  <tr key={row.surface} className="align-top">
                    <td className="py-3 pr-4 font-semibold text-text-primary whitespace-nowrap">
                      {row.surface}
                    </td>
                    <td className="py-3 pr-4 font-mono text-[11.5px] text-accent whitespace-nowrap">
                      {row.endpoint}
                    </td>
                    <td className="py-3 pr-4 font-mono text-[11.5px] text-text-secondary">
                      {row.channels}
                    </td>
                    <td className="py-3 text-text-secondary leading-relaxed">
                      {row.purpose}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Detailed Explanatory Guide of Every Subsystem */}
        <section className="flex flex-col gap-4 pb-6">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-accent" />
            <h2 className="text-[16px] font-semibold tracking-tight text-text-primary">
              Función detallada de cada capa y componente
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {LAYER_ORDER.map((layerKey) => {
              const meta = LAYER_META[layerKey];
              const layerNodes = ARCH_NODES.filter((n) => n.layer === layerKey);
              return (
                <div
                  key={layerKey}
                  className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4"
                >
                  <div className="border-b border-border-muted pb-2.5">
                    <h3 className="text-[14px] font-bold text-text-primary">{meta.title}</h3>
                    <p className="mt-0.5 text-[12.5px] text-text-secondary">{meta.description}</p>
                  </div>

                  <div className="flex flex-col divide-y divide-border-muted">
                    {layerNodes.map((node) => {
                      const isSelected = node.id === selectedNodeId;
                      return (
                        <div key={node.id} className="py-2.5 first:pt-0 last:pb-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedNodeId(node.id);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                              className={`text-left text-[13px] font-semibold transition-colors cursor-pointer ${
                                isSelected ? "text-accent" : "text-text-primary hover:text-accent"
                              }`}
                            >
                              {node.title}
                            </button>
                            <span className="font-mono text-[11px] text-text-muted">
                              {node.cadence}
                            </span>
                          </div>
                          <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
                            {node.summary}
                          </p>
                          <div className="mt-1.5 font-mono text-[11px] text-text-muted">
                            {node.files.slice(0, 4).join(" · ")}
                            {node.files.length > 4 ? ` (+${node.files.length - 4})` : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
