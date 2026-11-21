"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Flame,
  Minus,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { AssetLogo } from "@/components/AssetLogo";
import AdxSparkline from "@/components/AdxSparkline";
import { Segmented } from "@/components/ui/Primitives";
import type { AdxScannerEntry, AdxScannerTimeframe } from "@/hooks/useAdxWatchlist";
import type { AdxRegime } from "@/lib/engine/wyckoff";

export type AdxGridScope = "watchlist" | "all";
export type AdxRegimeFilter = "all" | "trending_plus" | "strong" | "emerging" | "range";
export type AdxGridSortKey = "adx" | "adxSlope" | "diSpread" | "change5m" | "score" | "symbol";

const REGIME_LABELS: Record<AdxRegime, string> = {
  "strong-trend": "Strong Trend",
  trending: "Trending",
  emerging: "Emerging",
  "range-bound": "Range-Bound",
};

const TIMEFRAME_OPTIONS: { value: AdxScannerTimeframe; label: string }[] = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
];

const SORT_OPTIONS: { value: AdxGridSortKey; label: string }[] = [
  { value: "adx", label: "ADX ↓" },
  { value: "adxSlope", label: "5t Slope" },
  { value: "diSpread", label: "|DI+ − DI−|" },
  { value: "change5m", label: "5m %" },
  { value: "score", label: "Score" },
  { value: "symbol", label: "A–Z" },
];

const REGIME_FILTERS: { value: AdxRegimeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trending_plus", label: "Trending ≥25" },
  { value: "strong", label: "Strong ≥40" },
  { value: "emerging", label: "20–25" },
  { value: "range", label: "Range <20" },
];

function formatPrice(p: number | null): string {
  if (p === null || !Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toPrecision(4);
}

function formatUsdCompact(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function formatPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const pct = v * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function terminalHref(symbol: string): string {
  return `/?symbol=${encodeURIComponent(symbol)}&market=perpetual&venue=okx-futures`;
}

function chartsHref(symbol: string, timeframe: AdxScannerTimeframe): string {
  return `/interactive-charts?symbol=${encodeURIComponent(symbol)}&market=perpetual&venue=okx-futures&tf=${timeframe}`;
}

function regimeAccentVar(regime: AdxRegime, direction: "bullish" | "bearish" | "neutral"): string {
  if (regime === "range-bound") return "var(--text-muted)";
  if (regime === "emerging") return "var(--warn)";
  if (direction === "bullish") return "var(--buy)";
  if (direction === "bearish") return "var(--sell)";
  return "var(--accent)";
}

export default function AdxScannerGrid({
  entries,
  scope,
  onScopeChange,
  timeframe,
  onTimeframeChange,
  watchlistCount,
  allCount,
  onToggleWatchlist,
  onResetWatchlist,
  isLoading,
  error,
  lastSyncedAt,
  onRefresh,
  searchQuery,
  onSearchQueryChange,
}: {
  entries: AdxScannerEntry[];
  scope: AdxGridScope;
  onScopeChange: (scope: AdxGridScope) => void;
  timeframe: AdxScannerTimeframe;
  onTimeframeChange: (tf: AdxScannerTimeframe) => void;
  watchlistCount: number;
  allCount: number;
  onToggleWatchlist: (symbol: string) => void;
  onResetWatchlist: () => void;
  isLoading: boolean;
  error: string | null;
  lastSyncedAt: number | null;
  onRefresh: () => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
}) {
  const [regimeFilter, setRegimeFilter] = useState<AdxRegimeFilter>("all");
  const [sortBy, setSortBy] = useState<AdxGridSortKey>("adx");

  const scopedEntries = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    return entries.filter((item) => {
      if (scope === "watchlist" && !item.inWatchlist) return false;
      if (q && !item.base.includes(q) && !item.symbol.includes(q)) return false;
      return true;
    });
  }, [entries, scope, searchQuery]);

  const summary = useMemo(() => {
    const ready = scopedEntries.filter((e) => e.snapshot !== null);
    let strongCount = 0;
    let trendingCount = 0;
    let emergingCount = 0;
    let rangeCount = 0;
    let bullTrends = 0;
    let bearTrends = 0;
    let risingAdxCount = 0;
    let fallingAdxCount = 0;
    let sumAdx = 0;
    let leader: AdxScannerEntry | null = null;

    for (const item of ready) {
      const snap = item.snapshot!;
      sumAdx += snap.adx;
      if (snap.regime === "strong-trend") {
        strongCount++;
        trendingCount++;
      } else if (snap.regime === "trending") {
        trendingCount++;
      } else if (snap.regime === "emerging") {
        emergingCount++;
      } else {
        rangeCount++;
      }

      if (snap.adx >= 25) {
        if (snap.direction === "bullish") bullTrends++;
        else if (snap.direction === "bearish") bearTrends++;
      }

      if (item.adxTrajectory?.trend === "increasing") risingAdxCount++;
      else if (item.adxTrajectory?.trend === "decreasing") fallingAdxCount++;

      if (!leader || snap.adx > (leader.snapshot?.adx ?? -1)) {
        leader = item;
      }
    }

    return {
      readyCount: ready.length,
      strongCount,
      trendingCount,
      emergingCount,
      rangeCount,
      bullTrends,
      bearTrends,
      risingAdxCount,
      fallingAdxCount,
      avgAdx: ready.length > 0 ? sumAdx / ready.length : null,
      leader,
    };
  }, [scopedEntries]);

  const visibleCards = useMemo(() => {
    const filtered = scopedEntries.filter((item) => {
      if (regimeFilter === "all") return true;
      const snap = item.snapshot;
      if (!snap) return false;
      if (regimeFilter === "strong") return snap.adx >= 40;
      if (regimeFilter === "trending_plus") return snap.adx >= 25;
      if (regimeFilter === "emerging") return snap.adx >= 20 && snap.adx < 25;
      return snap.adx < 20;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "symbol") return a.base.localeCompare(b.base);
      if (sortBy === "score") return b.score - a.score || (b.snapshot?.adx ?? -1) - (a.snapshot?.adx ?? -1);
      if (sortBy === "adxSlope") {
        const sa = a.adxTrajectory?.netChange ?? -Infinity;
        const sb = b.adxTrajectory?.netChange ?? -Infinity;
        return sb - sa || (b.snapshot?.adx ?? -1) - (a.snapshot?.adx ?? -1);
      }
      if (sortBy === "change5m") return Math.abs(b.change5m ?? -1) - Math.abs(a.change5m ?? -1);
      if (sortBy === "diSpread") {
        const sa = a.snapshot ? Math.abs(a.snapshot.plusDi - a.snapshot.minusDi) : -1;
        const sb = b.snapshot ? Math.abs(b.snapshot.plusDi - b.snapshot.minusDi) : -1;
        return sb - sa;
      }
      const adxA = a.snapshot?.adx ?? -1;
      const adxB = b.snapshot?.adx ?? -1;
      return adxB - adxA || a.base.localeCompare(b.base);
    });
  }, [scopedEntries, regimeFilter, sortBy]);

  const lastSyncLabel = useMemo(() => {
    if (!lastSyncedAt) return "Syncing OKX candles…";
    return `OKX OHLC synced ${new Date(lastSyncedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}`;
  }, [lastSyncedAt]);

  return (
    <section
      className="rounded-[var(--radius-card)] border border-border bg-bg-panel p-3.5 shadow-[0_10px_30px_-12px_var(--shadow)]"
      aria-label="Real-Time ADX Trend Strength Watchlist Scanner Grid"
    >
      {/* Top Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-muted pb-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-bg-surface text-accent">
            <Activity size={17} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-bold tracking-tight text-text-primary">
                Real-Time ADX Trend Strength Scanner Grid
              </h2>
              <span className="rounded-[var(--radius-sm)] border border-border bg-bg-surface px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-accent">
                Wilder ADX(14) · {timeframe.toUpperCase()}
              </span>
              <span className="font-mono text-[11px] text-text-muted">{lastSyncLabel}</span>
            </div>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              Quantifies directional force across active watchlist perpetuals in real time (OKX candles + live SSE ticks). Highlighted cards mark ADX ≥ 25 trending regimes.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="xs"
            value={scope}
            onChange={onScopeChange}
            ariaLabel="Scanner symbol scope"
            options={[
              { value: "watchlist", label: `Watchlist (${watchlistCount})` },
              { value: "all", label: `All Active (${allCount})` },
            ]}
          />
          <Segmented
            size="xs"
            value={timeframe}
            onChange={onTimeframeChange}
            ariaLabel="ADX calculation timeframe"
            options={TIMEFRAME_OPTIONS}
            accent
          />
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-2.5 text-[11.5px] font-medium text-text-secondary transition-colors hover:border-accent hover:text-text-primary disabled:opacity-50 cursor-pointer"
            title="Refresh OKX candle baseline"
          >
            <RefreshCw size={12} className={isLoading ? "animate-spin text-accent" : ""} />
            Sync
          </button>
        </div>
      </div>

      {/* Summary Telemetry Strip */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-[var(--radius-sm)] border border-border-muted bg-bg-surface px-3 py-2">
          <div className="text-[10.5px] uppercase tracking-wider text-text-muted">Trending (ADX ≥ 25)</div>
          <div className="mt-0.5 flex items-baseline gap-2 font-mono text-[14px] font-bold tabular-nums">
            <span className="text-buy">{summary.trendingCount}</span>
            <span className="text-[11px] font-normal text-text-muted">
              / {summary.readyCount || scopedEntries.length} ready
              {summary.strongCount > 0 ? ` · ${summary.strongCount} strong ≥40` : ""}
            </span>
          </div>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-border-muted bg-bg-surface px-3 py-2">
          <div className="text-[10.5px] uppercase tracking-wider text-text-muted">Strongest Trend Leader</div>
          <div className="mt-0.5 flex items-baseline gap-2 font-mono text-[14px] font-bold tabular-nums">
            {summary.leader && summary.leader.snapshot ? (
              <>
                <Link href={chartsHref(summary.leader.symbol, timeframe)} className="text-accent hover:underline">
                  {summary.leader.base} · {summary.leader.snapshot.adx.toFixed(1)}
                </Link>
                <span
                  className={`text-[11px] font-semibold ${
                    summary.leader.snapshot.direction === "bullish"
                      ? "text-buy"
                      : summary.leader.snapshot.direction === "bearish"
                        ? "text-sell"
                        : "text-text-muted"
                  }`}
                >
                  {summary.leader.snapshot.direction.toUpperCase()}
                </span>
              </>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-border-muted bg-bg-surface px-3 py-2">
          <div className="text-[10.5px] uppercase tracking-wider text-text-muted">Directional Split (≥25)</div>
          <div className="mt-0.5 flex items-baseline gap-2 font-mono text-[14px] font-bold tabular-nums">
            <span className="text-buy">{summary.bullTrends} Bull</span>
            <span className="text-text-muted">/</span>
            <span className="text-sell">{summary.bearTrends} Bear</span>
          </div>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-border-muted bg-bg-surface px-3 py-2">
          <div className="text-[10.5px] uppercase tracking-wider text-text-muted">Mean ADX · 5-Tick Slope</div>
          <div className="mt-0.5 flex items-baseline gap-2 font-mono text-[14px] font-bold tabular-nums">
            <span className="text-text-primary">
              {summary.avgAdx !== null ? summary.avgAdx.toFixed(1) : "—"}
            </span>
            <span className="text-[11px] font-normal text-buy">
              {summary.risingAdxCount} rising
            </span>
            <span className="text-[11px] font-normal text-sell">
              {summary.fallingAdxCount} fading
            </span>
          </div>
        </div>
      </div>

      {/* Filter & Sort Controls Row */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-7 w-48 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-2.5 text-text-muted focus-within:border-accent">
            <Search size={12} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search ticker…"
              aria-label="Filter ADX scanner grid"
              className="w-full border-0 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>
          <Segmented
            size="xs"
            value={regimeFilter}
            onChange={setRegimeFilter}
            ariaLabel="Filter by ADX trend regime"
            options={REGIME_FILTERS}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-text-muted">Sort</span>
          <Segmented
            size="xs"
            value={sortBy}
            onChange={setSortBy}
            ariaLabel="Sort ADX scanner cards"
            options={SORT_OPTIONS}
          />
          {scope === "watchlist" && (
            <button
              type="button"
              onClick={onResetWatchlist}
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-2 text-[11px] text-text-muted transition-colors hover:border-accent hover:text-text-primary cursor-pointer"
              title="Restore default 12 active watchlist symbols"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-[var(--radius-sm)] border border-sell/40 bg-sell/10 px-3 py-2 text-[12px] text-sell">
          OKX ADX sync issue ({error}). Waiting for next candle refresh…
        </div>
      )}

      {/* Scanner Cards Grid */}
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleCards.map((item) => {
          const snap = item.snapshot;
          const adx = snap?.adx ?? 0;
          const plusDi = snap?.plusDi ?? 0;
          const minusDi = snap?.minusDi ?? 0;
          const diTotal = plusDi + minusDi;
          const plusSharePct = diTotal > 0 ? (plusDi / diTotal) * 100 : 50;
          const barWidthPct = Math.min(100, Math.max(4, (adx / 65) * 100));
          const accentColor = snap ? regimeAccentVar(snap.regime, snap.direction) : "var(--text-muted)";
          const isTrending = snap !== null && snap.adx >= 25;
          const isStrong = snap !== null && snap.adx >= 40;

          return (
            <article
              key={item.symbol}
              className={`group relative flex flex-col justify-between gap-2.5 rounded-[var(--radius)] border p-3 transition-colors ${
                isTrending
                  ? "bg-bg-surface"
                  : "border-border-muted bg-bg-surface/70 hover:border-border"
              }`}
              style={
                isTrending
                  ? {
                      borderColor: `color-mix(in srgb, ${accentColor} ${isStrong ? "58%" : "36%"}, var(--border))`,
                      boxShadow: isStrong
                        ? `0 0 0 1px color-mix(in srgb, ${accentColor} 18%, transparent)`
                        : undefined,
                    }
                  : undefined
              }
            >
              {/* Card Header: Asset + Watchlist Star + Price */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AssetLogo symbol={item.symbol} size={24} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={terminalHref(item.symbol)}
                        className="font-mono text-[13px] font-bold text-text-primary hover:text-accent hover:underline"
                        title={`Open ${item.symbol} in Terminal`}
                      >
                        {item.base}
                      </Link>
                      <button
                        type="button"
                        onClick={() => onToggleWatchlist(item.symbol)}
                        aria-label={
                          item.inWatchlist
                            ? `Remove ${item.base} from watchlist`
                            : `Add ${item.base} to watchlist`
                        }
                        title={item.inWatchlist ? "Pinned in Watchlist (click to remove)" : "Pin to Watchlist"}
                        className="inline-flex items-center justify-center rounded p-0.5 text-text-muted transition-colors hover:text-warn cursor-pointer"
                      >
                        <Star
                          size={13}
                          className={item.inWatchlist ? "fill-warn text-warn" : "text-text-muted"}
                        />
                      </button>
                      {isStrong && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[9.5px] font-bold uppercase"
                          style={{
                            color: accentColor,
                            background: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
                          }}
                        >
                          <Flame size={10} />
                          Hot
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                      <span className="text-text-secondary">${formatPrice(item.price)}</span>
                      {item.change5m !== null && (
                        <span className={item.change5m >= 0 ? "text-buy" : "text-sell"}>
                          {formatPct(item.change5m)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* ADX Big Readout */}
                <div className="text-right font-mono tabular-nums">
                  {snap ? (
                    <>
                      <div className="flex items-center justify-end gap-1">
                        {snap.direction === "bullish" ? (
                          <TrendingUp size={13} className="text-buy" />
                        ) : snap.direction === "bearish" ? (
                          <TrendingDown size={13} className="text-sell" />
                        ) : (
                          <Minus size={13} className="text-text-muted" />
                        )}
                        <span className="text-[17px] font-extrabold leading-none" style={{ color: accentColor }}>
                          {adx.toFixed(1)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-end gap-1 text-[10px]">
                        <span
                          className="rounded px-1.5 py-0.5 font-semibold"
                          style={{
                            color: accentColor,
                            background: `color-mix(in srgb, ${accentColor} 14%, transparent)`,
                          }}
                        >
                          {REGIME_LABELS[snap.regime]}
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className="text-[11px] text-text-muted">{item.loading ? "Loading…" : "—"}</span>
                  )}
                </div>
              </div>

              {/* 5-Tick ADX Momentum Sparkline */}
              {snap && (
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-text-muted">
                    <span>5-Tick Strength</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        item.adxTrajectory?.trend === "increasing"
                          ? "font-semibold text-buy"
                          : item.adxTrajectory?.trend === "decreasing"
                            ? "font-semibold text-sell"
                            : "text-text-muted"
                      }
                    >
                      {item.adxTrajectory?.trend === "increasing"
                        ? "Increasing"
                        : item.adxTrajectory?.trend === "decreasing"
                          ? "Decreasing"
                          : "Steady"}
                    </span>
                  </div>
                  <AdxSparkline trajectory={item.adxTrajectory} width={78} height={20} showDelta />
                </div>
              )}

              {/* ADX Strength Progress Bar with 20 / 25 / 40 Markers */}
              <div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg-panel">
                  {/* Threshold tick lines at 20, 25, 40 over 0..65 scale */}
                  <span
                    className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-border"
                    style={{ left: `${(20 / 65) * 100}%` }}
                    title="ADX 20 · Emerging threshold"
                  />
                  <span
                    className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-text-muted/60"
                    style={{ left: `${(25 / 65) * 100}%` }}
                    title="ADX 25 · Active Trend threshold"
                  />
                  <span
                    className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-text-muted/40"
                    style={{ left: `${(40 / 65) * 100}%` }}
                    title="ADX 40 · Strong Trend threshold"
                  />
                  {snap && (
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${barWidthPct}%`, background: accentColor }}
                    />
                  )}
                </div>

                {/* +DI vs -DI Directional Pressure Bar */}
                {snap && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between font-mono text-[10.5px] tabular-nums">
                      <span className="text-buy">+DI {plusDi.toFixed(1)}</span>
                      <span className="text-text-muted">
                        Δ3b {snap.adxDelta >= 0 ? "+" : ""}
                        {snap.adxDelta.toFixed(1)}
                      </span>
                      <span className="text-sell">-DI {minusDi.toFixed(1)}</span>
                    </div>
                    <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-bg-panel">
                      <div
                        className="h-full bg-buy transition-all duration-300"
                        style={{ width: `${plusSharePct}%` }}
                      />
                      <div
                        className="h-full bg-sell transition-all duration-300"
                        style={{ width: `${100 - plusSharePct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer: Micro OrderFlow + Quick Links */}
              <div className="flex items-center justify-between gap-2 border-t border-border-muted pt-2 font-mono text-[10.5px] text-text-muted tabular-nums">
                <div className="flex items-center gap-2">
                  <span title="1m USD Volume">V1m {formatUsdCompact(item.volume1mUsd)}</span>
                  <span title="Volume Z-Score">
                    z {item.volumeZ !== null ? item.volumeZ.toFixed(1) : "—"}
                  </span>
                  {item.deltaShare !== null && (
                    <span className={item.deltaShare >= 0 ? "text-buy" : "text-sell"} title="Aggressive delta share">
                      Δ{item.deltaShare >= 0 ? "+" : ""}
                      {(item.deltaShare * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Link
                    href={chartsHref(item.symbol, timeframe)}
                    className="inline-flex items-center gap-0.5 text-text-secondary transition-colors hover:text-accent"
                    title={`Inspect ${item.base} Wyckoff ADX chart`}
                  >
                    Wyckoff
                    <ArrowUpRight size={10} />
                  </Link>
                  <Link
                    href={terminalHref(item.symbol)}
                    className="inline-flex items-center gap-0.5 text-text-secondary transition-colors hover:text-accent"
                    title={`Trade / Footprint ${item.base}`}
                  >
                    Footprint
                    <ArrowUpRight size={10} />
                  </Link>
                </div>
              </div>
            </article>
          );
        })}

        {visibleCards.length === 0 && (
          <div className="col-span-full rounded-[var(--radius)] border border-border-muted bg-bg-surface px-4 py-8 text-center text-[12.5px] text-text-muted">
            {scopedEntries.length === 0 && scope === "watchlist"
              ? "Your watchlist is empty. Switch to “All Active” or click Reset to pin symbols."
              : "No symbols match the selected ADX regime or search filter."}
          </div>
        )}
      </div>
    </section>
  );
}
