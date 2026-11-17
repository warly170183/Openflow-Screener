"use client";

import React, { useMemo, useState } from "react";
import type { ArchEdge, ArchNode, ArchPerspective, TraceStep } from "@/lib/architecture/model";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";

const COL_X = [135, 420, 725, 995] as const;
const NODE_W = 224;
const NODE_H = 84;

const ACCENT_VAR: Record<ArchNode["accent"], string> = {
  accent: "var(--accent)",
  buy: "var(--buy)",
  vwap: "var(--vwap)",
  poc: "var(--poc)",
  warn: "var(--warn)",
};

const COL_HEADERS = [
  { x: COL_X[0], title: "1. Fuente OKX", sub: "WebSocket v5 & REST" },
  { x: COL_X[1], title: "2. Transporte y Relay", sub: "Adaptación + Failover" },
  { x: COL_X[2], title: "3. Motores y Estado", sub: "Cálculo + Zustand" },
  { x: COL_X[3], title: "4. Interfaz UI", sub: "Canvas DPR + Tablas" },
] as const;

function bezierPath(fromNode: ArchNode, toNode: ArchNode): { d: string; mx: number; my: number } {
  const x1 = COL_X[fromNode.col] + NODE_W / 2;
  const y1 = fromNode.y;
  const x2 = COL_X[toNode.col] - NODE_W / 2;
  const y2 = toNode.y;
  const dx = Math.max(48, (x2 - x1) * 0.52);
  const cx1 = x1 + dx;
  const cx2 = x2 - dx;
  const d = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;
  // Midpoint of cubic bezier at t=0.5
  const mx = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
  const my = 0.125 * y1 + 0.375 * y1 + 0.375 * y2 + 0.125 * y2;
  return { d, mx, my };
}

export default function ArchitectureDiagram({
  nodes,
  edges,
  perspective,
  selectedNodeId,
  onSelectNode,
  traceSteps,
  activeTraceIndex,
  isPlaying,
  onTogglePlay,
  onStepTrace,
  onJumpTrace,
  onResetTrace,
}: {
  nodes: ArchNode[];
  edges: ArchEdge[];
  perspective: ArchPerspective;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  traceSteps: TraceStep[];
  activeTraceIndex: number | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepTrace: (delta: -1 | 1) => void;
  onJumpTrace: (index: number) => void;
  onResetTrace: () => void;
}) {
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const activeTrace = activeTraceIndex !== null ? traceSteps[activeTraceIndex] ?? null : null;

  const visibleNodeIds = useMemo(
    () => new Set(nodes.filter((n) => n.perspectives.includes(perspective)).map((n) => n.id)),
    [nodes, perspective]
  );

  const visibleEdges = useMemo(
    () => edges.filter((e) => e.perspectives.includes(perspective)),
    [edges, perspective]
  );

  const connectedEdges = useMemo(() => {
    const set = new Set<string>();
    for (const e of visibleEdges) {
      if (e.from === selectedNodeId || e.to === selectedNodeId) {
        set.add(e.id);
      }
    }
    return set;
  }, [visibleEdges, selectedNodeId]);

  const connectedNodes = useMemo(() => {
    const set = new Set<string>([selectedNodeId]);
    for (const e of visibleEdges) {
      if (e.from === selectedNodeId) set.add(e.to);
      if (e.to === selectedNodeId) set.add(e.from);
    }
    return set;
  }, [visibleEdges, selectedNodeId]);

  const selectedNode = nodeMap.get(selectedNodeId) ?? nodes[0];
  const hoveredEdge = visibleEdges.find((e) => e.id === hoveredEdgeId) ?? null;

  const upstreamNodes = useMemo(
    () =>
      visibleEdges
        .filter((e) => e.to === selectedNode.id)
        .map((e) => ({ edge: e, node: nodeMap.get(e.from) }))
        .filter((x): x is { edge: ArchEdge; node: ArchNode } => Boolean(x.node)),
    [visibleEdges, selectedNode.id, nodeMap]
  );

  const downstreamNodes = useMemo(
    () =>
      visibleEdges
        .filter((e) => e.from === selectedNode.id)
        .map((e) => ({ edge: e, node: nodeMap.get(e.to) }))
        .filter((x): x is { edge: ArchEdge; node: ArchNode } => Boolean(x.node)),
    [visibleEdges, selectedNode.id, nodeMap]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Trace controller bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-bg-panel px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-accent px-3 py-1.5 text-[12px] font-semibold text-on-accent transition-opacity hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            {isPlaying ? "Pausar simulación" : activeTrace ? "Continuar simulación" : "Simular flujo de tick OKX"}
          </button>

          <div className="inline-flex items-center rounded-[var(--radius-sm)] border border-border bg-bg-panel-alt">
            <button
              type="button"
              onClick={() => onStepTrace(-1)}
              aria-label="Paso anterior del flujo"
              className="px-2 py-1.5 text-text-secondary hover:text-text-primary disabled:opacity-35 cursor-pointer"
              disabled={activeTraceIndex === 0}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2.5 font-mono text-[11.5px] tabular-nums text-text-primary whitespace-nowrap">
              {activeTrace ? `Paso ${activeTrace.step} / ${traceSteps.length}` : "Modo exploración"}
            </span>
            <button
              type="button"
              onClick={() => onStepTrace(1)}
              aria-label="Siguiente paso del flujo"
              className="px-2 py-1.5 text-text-secondary hover:text-text-primary disabled:opacity-35 cursor-pointer"
              disabled={activeTraceIndex === traceSteps.length - 1}
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {activeTrace && (
            <button
              type="button"
              onClick={onResetTrace}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-2.5 py-1.5 text-[11.5px] text-text-secondary hover:text-text-primary whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw size={12} />
              Reiniciar
            </button>
          )}
        </div>

        <div className="text-[12px] text-text-secondary">
          {hoveredEdge ? (
            <span>
              <strong className="font-semibold text-text-primary">{hoveredEdge.label}</strong>
              {" — "}
              {hoveredEdge.detail}
            </span>
          ) : activeTrace ? (
            <span>
              <strong className="font-semibold text-accent">{activeTrace.title}</strong>
              {" · "}
              <span className="font-mono text-[11px] text-text-muted">{activeTrace.modulePath}</span>
            </span>
          ) : (
            <span>Haz clic en cualquier nodo del diagrama para inspeccionar conexiones, entradas y salidas.</span>
          )}
        </div>
      </div>

      {/* Main split: SVG Graph + Technical Inspector */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
        {/* Interactive SVG Canvas */}
        <div className="relative overflow-x-auto rounded-[var(--radius-card)] border border-border bg-bg-panel p-3">
          <svg
            viewBox="0 0 1130 500"
            className="h-auto w-full min-w-[760px] select-none"
            role="img"
            aria-label="Diagrama interactivo de arquitectura de la aplicación"
          >
            <defs>
              <marker id="arch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 1 2 L 9 5 L 1 8 z" fill="var(--text-muted)" />
              </marker>
              <marker id="arch-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M 1 2 L 9 5 L 1 8 z" fill="var(--accent)" />
              </marker>
              <pattern id="arch-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.8" fill="var(--border)" />
              </pattern>
            </defs>

            <rect x="0" y="0" width="1130" height="500" rx="12" fill="var(--bg-surface)" />
            <rect x="0" y="0" width="1130" height="500" rx="12" fill="url(#arch-grid)" opacity="0.55" />

            {/* Swimlane column dividers & headers */}
            {COL_HEADERS.map((col, idx) => (
              <g key={col.title}>
                {idx > 0 && (
                  <line
                    x1={col.x - 140}
                    y1={16}
                    x2={col.x - 140}
                    y2={484}
                    stroke="var(--border-muted)"
                    strokeDasharray="3 4"
                  />
                )}
                <text
                  x={col.x}
                  y={32}
                  textAnchor="middle"
                  fill="var(--text-primary)"
                  fontSize="12"
                  fontWeight="700"
                  letterSpacing="-0.01em"
                >
                  {col.title}
                </text>
                <text
                  x={col.x}
                  y={47}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="10.5"
                  fontFamily="var(--font-mono)"
                >
                  {col.sub}
                </text>
              </g>
            ))}

            {/* Edges */}
            {visibleEdges.map((edge) => {
              const fromNode = nodeMap.get(edge.from);
              const toNode = nodeMap.get(edge.to);
              if (!fromNode || !toNode) return null;

              const { d, mx, my } = bezierPath(fromNode, toNode);
              const isTraceEdge = activeTrace?.edgeId === edge.id;
              const isConnected = connectedEdges.has(edge.id);
              const isHovered = hoveredEdgeId === edge.id;
              const highlighted = isTraceEdge || isConnected || isHovered;
              const dimmed =
                (!highlighted && activeTrace !== null) ||
                (!highlighted && activeTrace === null && selectedNodeId !== "" && !connectedEdges.has(edge.id));

              return (
                <g
                  key={edge.id}
                  onMouseEnter={() => setHoveredEdgeId(edge.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)}
                  className="cursor-pointer"
                >
                  {/* Invisible wider hit target */}
                  <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
                  <path
                    d={d}
                    fill="none"
                    stroke={highlighted ? "var(--accent)" : "var(--text-muted)"}
                    strokeWidth={isTraceEdge ? 2.6 : highlighted ? 2 : 1.35}
                    strokeDasharray={edge.dashed ? "5 4" : undefined}
                    opacity={dimmed ? 0.28 : highlighted ? 0.95 : 0.65}
                    markerEnd={highlighted ? "url(#arch-arrow-active)" : "url(#arch-arrow)"}
                  />

                  {/* Animated packet indicator on active trace edge */}
                  {isTraceEdge && (
                    <circle r="4.5" fill="var(--accent)" className="motion-reduce:hidden">
                      <animateMotion dur="1.3s" repeatCount="indefinite" path={d} />
                    </circle>
                  )}

                  {/* Edge label */}
                  <g transform={`translate(${mx}, ${my})`} opacity={dimmed ? 0.4 : 1}>
                    <rect
                      x={-68}
                      y={-10}
                      width={136}
                      height={20}
                      rx={4}
                      fill="var(--bg-panel)"
                      stroke={highlighted ? "var(--accent)" : "var(--border)"}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fill={highlighted ? "var(--text-primary)" : "var(--text-secondary)"}
                      fontSize="9.5"
                      fontFamily="var(--font-mono)"
                      fontWeight={highlighted ? "600" : "500"}
                    >
                      {edge.label}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              if (!visibleNodeIds.has(node.id)) return null;
              const x = COL_X[node.col] - NODE_W / 2;
              const y = node.y - NODE_H / 2;
              const isSelected = node.id === selectedNodeId;
              const isTraceNode = activeTrace?.nodeId === node.id;
              const isNeighbor = connectedNodes.has(node.id);
              const dimmed = activeTrace ? !isTraceNode && !isNeighbor : !isNeighbor;
              const accentColor = ACCENT_VAR[node.accent];

              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.title}: ${node.layerLabel}`}
                  aria-pressed={isSelected}
                  onClick={() => onSelectNode(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectNode(node.id);
                    }
                  }}
                  className="cursor-pointer outline-none"
                  opacity={dimmed ? 0.42 : 1}
                >
                  {isSelected && (
                    <rect
                      x={x - 3}
                      y={y - 3}
                      width={NODE_W + 6}
                      height={NODE_H + 6}
                      rx={13}
                      fill="none"
                      stroke={accentColor}
                      strokeWidth={1.75}
                      opacity={0.45}
                    />
                  )}

                  <rect
                    x={x}
                    y={y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                    fill={isSelected ? "var(--bg-panel-alt)" : "var(--bg-panel)"}
                    stroke={isSelected || isTraceNode ? accentColor : "var(--border)"}
                    strokeWidth={isSelected || isTraceNode ? 2 : 1.1}
                  />

                  {/* Top accent bar */}
                  <rect x={x + 12} y={y + 10} width={28} height={3} rx={1.5} fill={accentColor} />

                  {/* Layer tag + Cadence metadata without pill box */}
                  <text
                    x={x + 48}
                    y={y + 14.5}
                    fill="var(--text-muted)"
                    fontSize="9.5"
                    fontFamily="var(--font-mono)"
                  >
                    {node.layerLabel.toUpperCase()}
                  </text>

                  {/* Node title */}
                  <text
                    x={x + 12}
                    y={y + 38}
                    fill="var(--text-primary)"
                    fontSize="12.5"
                    fontWeight="700"
                    letterSpacing="-0.015em"
                  >
                    {node.title}
                  </text>

                  {/* Subtitle */}
                  <text
                    x={x + 12}
                    y={y + 55}
                    fill="var(--text-secondary)"
                    fontSize="10.2"
                    fontFamily="var(--font-mono)"
                  >
                    {node.subtitle.length > 31 ? `${node.subtitle.slice(0, 30)}…` : node.subtitle}
                  </text>

                  {/* Protocol footer */}
                  <text
                    x={x + 12}
                    y={y + 73}
                    fill="var(--text-muted)"
                    fontSize="9.8"
                  >
                    {node.protocol}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Technical Inspector Side Panel */}
        <aside
          className="flex flex-col justify-between gap-4 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4"
          aria-live="polite"
        >
          <div className="flex flex-col gap-3.5">
            <div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-muted">
                <span style={{ color: ACCENT_VAR[selectedNode.accent] }}>{selectedNode.layerLabel}</span>
                <span>·</span>
                <span>{selectedNode.cadence}</span>
              </div>
              <h2 className="mt-1 text-[16px] font-bold tracking-tight text-text-primary">
                {selectedNode.title}
              </h2>
              <p className="font-mono text-[11.5px] text-text-secondary">{selectedNode.protocol}</p>
            </div>

            <p className="text-[13px] leading-relaxed text-text-secondary">
              {selectedNode.summary}
            </p>

            {/* Responsibilities */}
            <div className="border-t border-border-muted pt-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Funciones principales
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px] leading-snug text-text-secondary">
                {selectedNode.responsibilities.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ACCENT_VAR[selectedNode.accent] }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Inputs / Outputs */}
            <div className="grid grid-cols-1 gap-3 border-t border-border-muted pt-3 sm:grid-cols-2 xl:grid-cols-1">
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Entradas</h3>
                <div className="mt-1 text-[12px] text-text-secondary">
                  {selectedNode.inputs.join(" · ")}
                </div>
              </div>
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Salidas</h3>
                <div className="mt-1 text-[12px] text-text-secondary">
                  {selectedNode.outputs.join(" · ")}
                </div>
              </div>
            </div>

            {/* Upstream & Downstream quick navigation */}
            {(upstreamNodes.length > 0 || downstreamNodes.length > 0) && (
              <div className="border-t border-border-muted pt-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Conexiones en el grafo
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {upstreamNodes.map(({ node }) => (
                    <button
                      key={`in-${node.id}`}
                      type="button"
                      onClick={() => onSelectNode(node.id)}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-2 py-1 text-[11.5px] text-text-secondary hover:border-accent hover:text-text-primary cursor-pointer"
                    >
                      <span>←</span>
                      <span>{node.title}</span>
                    </button>
                  ))}
                  {downstreamNodes.map(({ node }) => (
                    <button
                      key={`out-${node.id}`}
                      type="button"
                      onClick={() => onSelectNode(node.id)}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-2 py-1 text-[11.5px] text-text-secondary hover:border-accent hover:text-text-primary cursor-pointer"
                    >
                      <span>{node.title}</span>
                      <ArrowRight size={11} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Code modules list */}
          <div className="border-t border-border-muted pt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Módulos fuente
            </h3>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-text-secondary">
              {selectedNode.files.map((file) => (
                <span key={file}>{file}</span>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Interactive Packet Payload Inspector (when trace step is active) */}
      {activeTrace && (
        <div className="rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-muted pb-2.5">
            <div>
              <span className="font-mono text-[11px] uppercase tracking-wider text-accent">
                Traza interactiva · {activeTrace.payloadLabel}
              </span>
              <h3 className="mt-0.5 text-[14px] font-semibold text-text-primary">
                {activeTrace.title}
              </h3>
            </div>
            <span className="font-mono text-[11px] text-text-muted">
              Simulación didáctica de paquete OKX · {activeTrace.modulePath}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="flex flex-col justify-between gap-3">
              <p className="text-[13px] leading-relaxed text-text-secondary">
                {activeTrace.summary}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {traceSteps.map((s, idx) => (
                  <button
                    key={s.step}
                    type="button"
                    onClick={() => onJumpTrace(idx)}
                    className={`rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-[11px] tabular-nums transition-colors cursor-pointer ${
                      idx === activeTraceIndex
                        ? "border-accent bg-accent text-on-accent font-semibold"
                        : "border-border bg-bg-surface text-text-muted hover:text-text-primary"
                    }`}
                  >
                    #{s.step}
                  </button>
                ))}
              </div>
            </div>
            <pre className="overflow-x-auto rounded-[var(--radius)] border border-border bg-bg-surface p-3 font-mono text-[11.5px] leading-relaxed text-text-primary">
              <code>{activeTrace.payload}</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
