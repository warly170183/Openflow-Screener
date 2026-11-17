"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useScreenerFeed } from "@/hooks/useScreenerFeed";
import { useSessionStore } from "@/lib/session/SessionContext";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented, Stat } from "@/components/ui/Primitives";
import type { ScreenerRow } from "@/lib/screener/screenerCore";

type SortMode = "score" | "signals" | "delta" | "imb" | "volz";

const SORT_MODES: ReadonlyArray<{ value: SortMode; label: string }> = [
  { value: "score", label: "Score" },
  { value: "signals", label: "Signals" },
  { value: "delta", label: "Flow" },
  { value: "imb", label: "Imb" },
  { value: "volz", label: "Vol z" },
];

const baseAsset = (sym: string) => sym.replace(/-USDT-SWAP$|USDT$/, "");
const formatPx = (p: number) => (p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toPrecision(4));
const formatPct = (v: number | null) =>
  v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;

export default function ScreenerReferencePanel() {
  const { scan, signals, link } = useScreenerFeed({
    includeSignals: true,
    includeStats: false,
    includeHealth: false,
  });
  const activeSymbol = useSessionStore((s) => s.symbol);
  const marketType = useSessionStore((s) => s.marketType);
  const setMarketType = useSessionStore((s) => s.setMarketType);
  const setVenue = useSessionStore((s) => s.setVenue);
  const setSymbol = useSessionStore((s) => s.setSymbol);
  const [sortMode, setSortMode] = useState<SortMode>("score");

  const activeBase = marketType === "forex" ? "" : baseAsset(activeSymbol.toUpperCase());
  const allRows = useMemo(() => scan?.rows ?? [], [scan]);

  const rankedByScore = useMemo(
    () =>
      [...allRows].sort(
        (a, b) => (b.candidate?.score ?? 0) - (a.candidate?.score ?? 0) || b.volume1mUsd - a.volume1mUsd
      ),
    [allRows]
  );

  const activeRankIndex = useMemo(
    () => (activeBase ? rankedByScore.findIndex((r) => baseAsset(r.symbol) === activeBase) : -1),
    [activeBase, rankedByScore]
  );
  const activeRow: ScreenerRow | null =
    activeRankIndex >= 0 ? rankedByScore[activeRankIndex] : null;

  const visibleRows = useMemo(() => {
    const filtered = sortMode === "signals" ? allRows.filter((r) => r.signal !== null) : allRows;
    return [...filtered]
      .sort((a, b) => {
        if (sortMode === "delta") {
          return Math.abs(b.deltaShare ?? 0) - Math.abs(a.deltaShare ?? 0);
        }
        if (sortMode === "imb") {
          const aTotal = a.askImbalances + a.bidImbalances;
          const bTotal = b.askImbalances + b.bidImbalances;
          return Math.abs(b.imbalanceNet) - Math.abs(a.imbalanceNet) || bTotal - aTotal;
        }
        if (sortMode === "volz") {
          return (b.volumeZ ?? -Infinity) - (a.volumeZ ?? -Infinity);
        }
        return (b.candidate?.score ?? 0) - (a.candidate?.score ?? 0) || b.volume1mUsd - a.volume1mUsd;
      })
      .slice(0, 10);
  }, [allRows, sortMode]);

  const selectSymbol = (rowSymbol: string) => {
    const terminalSymbol = `${baseAsset(rowSymbol)}USDT`;
    if (marketType !== "perpetual") setMarketType("perpetual");
    setVenue("okx-futures");
    setSymbol(terminalSymbol);
  };

  const activeSignalsCount = allRows.filter((r) => r.signal !== null).length;
  const activeScore = activeRow?.candidate?.score ?? null;
  const activeDir = activeRow?.candidate?.direction;

  return (
    <Panel
      title="OrderFlow Screener"
      icon={<Icon.Pulse />}
      subtitle={
        allRows.length > 0
          ? `OKX ref · ${allRows.length} pairs · ${activeSignalsCount} signals`
          : "Internal OKX screener engine"
      }
      value={
        activeRow && activeScore !== null ? (
          <span
            className={activeDir === "long" ? "tone-buy" : activeDir === "short" ? "tone-sell" : "tone-accent"}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            #{activeRankIndex + 1} · {activeScore}
          </span>
        ) : (
          <span className="tone-muted">{link === "live" ? `${allRows.length} OKX` : "—"}</span>
        )
      }
      actions={
        <>
          <Segmented
            size="xs"
            value={sortMode}
            onChange={setSortMode}
            options={SORT_MODES}
            ariaLabel="Screener reference ranking"
          />
          <Link href="/screener" className="ui-button chip" title="Open full built-in OrderFlow Screener">
            Full
          </Link>
        </>
      }
      footer={
        <div className="study-stats">
          <Stat
            label={activeBase || "Active"}
            value={
              activeRow?.candidate
                ? `${activeRow.candidate.direction === "long" ? "LONG" : "SHORT"} ${activeRow.candidate.setup === "momentum" ? "MOM" : "REV"}`
                : activeRow
                  ? "Watching"
                  : "No perp match"
            }
            tone={activeDir === "long" ? "buy" : activeDir === "short" ? "sell" : "muted"}
          />
          <Stat
            label="POC (15m)"
            value={activeRow?.pocPrice != null ? formatPx(activeRow.pocPrice) : "—"}
            sub={
              activeRow?.valPrice != null && activeRow?.vahPrice != null
                ? `VA ${formatPx(activeRow.valPrice)}–${formatPx(activeRow.vahPrice)}`
                : undefined
            }
            tone="poc"
          />
          <Stat
            label="Imb A/B"
            value={activeRow ? `${activeRow.askImbalances} / ${activeRow.bidImbalances}` : "—"}
            sub={
              activeRow?.stackedImbalance
                ? `${activeRow.stackedImbalance.direction.toUpperCase()} ${activeRow.stackedImbalance.count}× stacked`
                : activeRow?.volumeZ != null
                  ? `Vol z ${activeRow.volumeZ.toFixed(1)}σ`
                  : undefined
            }
            tone={
              activeRow && activeRow.imbalanceNet > 0
                ? "buy"
                : activeRow && activeRow.imbalanceNet < 0
                  ? "sell"
                  : "muted"
            }
          />
          <Stat
            label="Δ Flow"
            value={
              activeRow?.deltaShare != null
                ? `${activeRow.deltaShare >= 0 ? "+" : ""}${(activeRow.deltaShare * 100).toFixed(0)}%`
                : "—"
            }
            sub={`${signals.filter((s) => s.status === "open").length || activeSignalsCount} open setups`}
            tone={activeRow?.deltaShare != null ? (activeRow.deltaShare >= 0 ? "buy" : "sell") : "muted"}
          />
        </div>
      }
    >
      <div className="flex flex-1 flex-col min-h-0 overflow-y-auto px-2 pb-1">
        {activeRow?.signal && (
          <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-border-muted bg-bg-panel-alt px-2 py-1 font-mono text-[10.5px] tabular-nums">
            <span className={activeRow.signal.direction === "long" ? "text-buy font-semibold" : "text-sell font-semibold"}>
              {activeRow.signal.direction.toUpperCase()} PLAN
            </span>
            <span className="text-text-secondary truncate">
              E {formatPx(activeRow.signal.plan.entry)} · SL {formatPx(activeRow.signal.plan.stop)} · TP1{" "}
              {formatPx(activeRow.signal.plan.tp1)}
            </span>
          </div>
        )}

        {allRows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-text-muted">
            {link === "down" ? "Screener stream reconnecting…" : "Scanning OKX perpetuals…"}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-text-muted">
            No active threshold signals yet (warming up)…
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border-muted font-mono text-[11px] tabular-nums">
            <div className="grid grid-cols-[1fr_68px_50px_54px_54px] items-center gap-1 px-1.5 py-1 text-[10px] font-sans text-text-muted">
              <span>OKX Pair</span>
              <span className="text-right">Price</span>
              <span className="text-right">5m</span>
              <span className="text-right">Imb A/B</span>
              <span className="text-right">Score</span>
            </div>
            {visibleRows.map((r) => {
              const name = baseAsset(r.symbol);
              const isSelected = name === activeBase;
              const score = r.candidate?.score ?? 0;
              const dir = r.candidate?.direction;
              return (
                <button
                  key={r.symbol}
                  type="button"
                  onClick={() => selectSymbol(r.symbol)}
                  className={`grid grid-cols-[1fr_68px_50px_54px_54px] items-center gap-1 rounded px-1.5 py-1 text-left transition-colors hover:bg-bg-hover ${
                    isSelected ? "bg-[var(--highlight-dim)]" : ""
                  }`}
                  title={`Load ${name}USDT OKX Perpetual into Terminal · POC ${r.pocPrice != null ? formatPx(r.pocPrice) : "—"}`}
                >
                  <span className="flex items-center gap-1.5 truncate font-sans text-[11.5px] font-semibold text-text-primary">
                    {name}
                    {r.signal && (
                      <span className={`text-[9.5px] font-mono ${r.signal.direction === "long" ? "text-buy" : "text-sell"}`}>
                        ●
                      </span>
                    )}
                  </span>
                  <span className="text-right text-text-secondary">{formatPx(r.price)}</span>
                  <span className={`text-right ${(r.change5m ?? 0) >= 0 ? "text-buy" : "text-sell"}`}>
                    {formatPct(r.change5m)}
                  </span>
                  <span
                    className={`text-right ${
                      r.imbalanceNet > 0 ? "text-buy" : r.imbalanceNet < 0 ? "text-sell" : "text-text-muted"
                    }`}
                  >
                    {r.askImbalances}/{r.bidImbalances}
                  </span>
                  <span
                    className={`text-right font-semibold ${
                      dir === "long" ? "text-buy" : dir === "short" ? "text-sell" : "text-text-muted"
                    }`}
                  >
                    {score > 0 ? `${dir === "long" ? "▲" : "▼"} ${score}` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}
