"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Wordmark } from "@/components/Logo";
import RouteNav from "@/components/RouteNav";
import ThemeMenu from "@/components/ThemeMenu";
import CommandPalette from "@/components/CommandPalette";
import { Icon } from "@/components/ui/Icons";
import { Segmented } from "@/components/ui/Primitives";
import { useScreenerFeed } from "@/hooks/useScreenerFeed";
import type { ScreenerRow } from "@/lib/screener/screenerCore";
import type { BucketStats, TrackedSignal, TrackerStats } from "@/lib/signals/tracker";

type FilterMode = "all" | "signals" | "long" | "short";
type SortKey =
  | "score"
  | "symbol"
  | "price"
  | "change5m"
  | "change1h"
  | "volume1mUsd"
  | "volumeZ"
  | "deltaShare"
  | "pocDistancePct"
  | "imbalanceNet"
  | "oiChange5m"
  | "fundingRate8h";

// ─── Formatting ─────────────────────────────────────────────
const base = (symbol: string) => symbol.replace(/-USDT-SWAP$|USDT$/, "");
const terminalHref = (symbol: string) =>
  `/?symbol=${encodeURIComponent(`${base(symbol)}USDT`)}&market=perpetual&venue=okx-futures`;
const pct = (v: number | null, digits = 2) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`);
const usd = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(0));
const price = (p: number) => (p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toPrecision(4));
const tone = (v: number | null) => (v === null || v === 0 ? "text-text-muted" : v > 0 ? "text-buy" : "text-sell");

const card = "rounded-[var(--radius-card)] border border-border bg-bg-panel shadow-[0_10px_30px_-12px_var(--shadow)]";
const th = "sticky top-0 z-10 bg-bg-panel px-2.5 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-text-muted first:text-left border-b border-border";
const td = "px-2.5 py-2 text-right font-mono text-[12px] first:text-left";

function ScoreBadge({ row }: { row: ScreenerRow }) {
  const c = row.candidate;
  if (!c || c.score === 0) return <span className="text-text-muted">—</span>;
  const live = row.signal !== null;
  const color = c.direction === "long" ? "var(--buy)" : "var(--sell)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[11px]"
      style={{ color: live ? color : "var(--text-secondary)", background: live ? `color-mix(in srgb, ${color} 14%, transparent)` : "transparent", border: `1px solid ${live ? color : "var(--border)"}` }}
      title={`${c.setup} ${c.direction}${live ? " — signal" : " — below threshold"}`}
    >
      {c.direction === "long" ? "▲" : "▼"} {c.score}
      <span className="text-[10px] opacity-70">{c.setup === "momentum" ? "MOM" : "REV"}</span>
    </span>
  );
}

const COLUMNS: ReadonlyArray<{ key?: SortKey; label: string }> = [
  { key: "symbol", label: "Symbol" },
  { key: "price", label: "Price" },
  { key: "change5m", label: "5m" },
  { key: "change1h", label: "1h" },
  { key: "volume1mUsd", label: "Vol 1m" },
  { key: "volumeZ", label: "Vol z" },
  { key: "deltaShare", label: "Δ flow" },
  { key: "pocDistancePct", label: "POC (15m)" },
  { key: "imbalanceNet", label: "Imb A/B" },
  { key: "oiChange5m", label: "OI 5m" },
  { label: "Regime" },
  { key: "fundingRate8h", label: "Funding/8h" },
  { label: "Liq L / S" },
  { key: "score", label: "Score" },
];

function Table({
  rows,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: ScreenerRow[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className="max-h-[calc(100vh-195px)] overflow-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {COLUMNS.map((col) => {
              const sortable = col.key !== undefined;
              const active = col.key === sortKey;
              return (
                <th key={col.label} className={th}>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key!)}
                      className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-text-primary ${active ? "text-accent" : "text-text-muted"}`}
                    >
                      {col.label}
                      {active ? (sortDir === "desc" ? "↓" : "↑") : ""}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className={`group border-b border-border-muted transition-colors hover:bg-bg-hover ${r.signal ? "bg-[var(--highlight-dim)]" : ""}`}>
              <td className={`${td} font-semibold text-text-primary`}>
                <Link
                  href={terminalHref(r.symbol)}
                  className="inline-flex items-center gap-1.5 text-text-primary no-underline hover:text-accent"
                  title={`Open ${base(r.symbol)}USDT in Terminal`}
                >
                  <span>{base(r.symbol)}</span>
                  <span className="opacity-0 transition-opacity group-hover:opacity-70">
                    <Icon.External />
                  </span>
                </Link>
                {!r.warmedUp && <span className="ml-1.5 text-[10px] font-normal text-warn" title="Warming up">warm-up</span>}
                {r.cascade && <span className="ml-1.5 text-[10px] font-normal text-sell">cascade</span>}
              </td>
              <td className={td}>{price(r.price)}</td>
              <td className={`${td} ${tone(r.change5m)}`}>{pct(r.change5m)}</td>
              <td className={`${td} ${tone(r.change1h)}`}>{pct(r.change1h)}</td>
              <td className={td}>${usd(r.volume1mUsd)}</td>
              <td className={`${td} ${r.volumeZ !== null && r.volumeZ >= 3 ? "text-[var(--highlight)]" : ""}`}>{r.volumeZ === null ? "—" : r.volumeZ.toFixed(1)}</td>
              <td className={`${td} ${tone(r.deltaShare)}`}>{r.deltaShare === null ? "—" : `${r.deltaShare >= 0 ? "+" : ""}${(r.deltaShare * 100).toFixed(0)}%`}</td>
              <td
                className={td}
                title={
                  r.pocPrice !== null && r.valPrice !== null && r.vahPrice !== null
                    ? `15m Volume-at-Price · POC ${price(r.pocPrice)} · VA ${price(r.valPrice)} – ${price(r.vahPrice)} (${r.vapLevelsCount} levels)`
                    : "Accumulating 15m Volume-at-Price"
                }
              >
                {r.pocPrice !== null ? (
                  <span className="inline-flex items-baseline justify-end gap-1.5 tabular-nums">
                    <span className="text-text-primary">{price(r.pocPrice)}</span>
                    {r.pocDistancePct !== null && (
                      <span className={`text-[10.5px] ${r.pocDistancePct >= 0 ? "text-buy" : "text-sell"}`}>
                        {r.pocDistancePct >= 0 ? "+" : ""}
                        {(r.pocDistancePct * 100).toFixed(2)}%
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </td>
              <td
                className={`${td} tabular-nums`}
                title={
                  r.stackedImbalance
                    ? `5m Price Imbalances (≥3×): ${r.askImbalances} Ask / ${r.bidImbalances} Bid · Stacked ${r.stackedImbalance.direction.toUpperCase()} (${r.stackedImbalance.count} levels)`
                    : `5m Price Imbalances (≥3×): ${r.askImbalances} Ask / ${r.bidImbalances} Bid`
                }
              >
                {r.askImbalances > 0 || r.bidImbalances > 0 ? (
                  <span className="inline-flex items-center justify-end gap-1">
                    <span className="text-buy">{r.askImbalances}</span>
                    <span className="text-text-muted">/</span>
                    <span className="text-sell">{r.bidImbalances}</span>
                    {r.stackedImbalance && (
                      <span
                        className={`ml-0.5 text-[10.5px] font-semibold ${
                          r.stackedImbalance.direction === "buy" ? "text-buy" : "text-sell"
                        }`}
                      >
                        {r.stackedImbalance.direction === "buy" ? "▲" : "▼"}
                        {r.stackedImbalance.count}×
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-text-muted">0 / 0</span>
                )}
              </td>
              <td className={`${td} ${tone(r.oiChange5m)}`}>{pct(r.oiChange5m)}</td>
              <td className={`${td} text-text-secondary`}>{r.oiRegime && r.oiRegime !== "neutral" ? r.oiRegime.replace("-", " ") : "—"}</td>
              <td className={`${td} ${r.fundingRate8h !== null && Math.abs(r.fundingRate8h) >= 0.0005 ? "text-warn" : ""}`}>{r.fundingRate8h === null ? "—" : `${(r.fundingRate8h * 100).toFixed(3)}%`}</td>
              <td className={td}>
                <span className="text-sell">{usd(r.liqLong5mUsd)}</span> / <span className="text-buy">{usd(r.liqShort5mUsd)}</span>
              </td>
              <td className={td}><ScoreBadge row={r} /></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={14} className="px-3 py-10 text-center text-text-muted">No matching symbols in current scan…</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SignalList({ items }: { items: TrackedSignal[] }) {
  if (!items.length) return <p className="p-4 text-[12px] text-text-muted">No signals yet. Symbols need a few minutes of warm-up before they can fire.</p>;
  return (
    <ul className="divide-y divide-border-muted">
      {items.map((t) => {
        const s = t.signal;
        const color = s.direction === "long" ? "var(--buy)" : "var(--sell)";
        return (
          <li key={t.id} className="px-3 py-2.5 text-[12px] transition-colors hover:bg-bg-hover">
            <Link href={terminalHref(s.symbol)} className="block no-underline">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold" style={{ color }}>{s.direction === "long" ? "▲ LONG" : "▼ SHORT"} {base(s.symbol)}</span>
                <span className="font-mono text-text-secondary">score {s.score} · {s.setup}</span>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-text-secondary">
                E {price(s.plan.entry)} · SL {price(s.plan.stop)} · TP1 {price(s.plan.tp1)} · TP2 {price(s.plan.tp2)} · TP3 {price(s.plan.tp3)}
              </div>
              <div className="mt-0.5 flex justify-between text-[11px] text-text-muted">
                <span>{new Date(s.time).toLocaleTimeString()}</span>
                <span className={t.status === "open" ? "text-warn" : (t.resultR ?? 0) > 0 ? "text-buy" : "text-sell"}>
                  {t.status === "open" ? `open · ${t.mfeR.toFixed(1)}R max` : `${t.outcome} ${(t.resultR ?? 0) >= 0 ? "+" : ""}${(t.resultR ?? 0).toFixed(2)}R`}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function StatsTable({ stats }: { stats: TrackerStats }) {
  const rows: Array<[string, BucketStats]> = [["All", stats.overall], ...Object.entries(stats.byScore).sort(([a], [b]) => a.localeCompare(b)), ...Object.entries(stats.bySetup)];
  const thin = stats.closedCount < stats.minReliableSample;
  return (
    <div>
      {thin && (
        <p className="border-b border-border-muted px-3 py-2 text-[11px] text-warn">
          Only {stats.closedCount} closed signal{stats.closedCount === 1 ? "" : "s"}; below {stats.minReliableSample} these numbers are noise, not evidence.
        </p>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Bucket", "n", "Win", "Avg R", "PF", "MFE", "MAE"].map((h) => <th key={h} className={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, b]) => (
            <tr key={name} className="border-b border-border-muted">
              <td className={`${td} text-text-primary`}>{name}</td>
              <td className={td}>{b.n}</td>
              <td className={td}>{(b.winRate * 100).toFixed(0)}%</td>
              <td className={`${td} ${tone(b.avgR)}`}>{b.avgR.toFixed(2)}</td>
              <td className={td}>{b.profitFactor === null ? "—" : b.profitFactor.toFixed(2)}</td>
              <td className={td}>{b.avgMfeR.toFixed(2)}</td>
              <td className={td}>{b.avgMaeR.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-text-muted">{stats.openCount} open · {stats.closedCount} closed. R = distance from entry to stop; trades close at stop (−1R), TP2 (+2R) or after 4 h.</p>
    </div>
  );
}

function sortValue(row: ScreenerRow, key: SortKey): number | string {
  switch (key) {
    case "symbol": return base(row.symbol);
    case "price": return row.price;
    case "change5m": return row.change5m ?? -Infinity;
    case "change1h": return row.change1h ?? -Infinity;
    case "volume1mUsd": return row.volume1mUsd;
    case "volumeZ": return row.volumeZ ?? -Infinity;
    case "deltaShare": return row.deltaShare ?? -Infinity;
    case "pocDistancePct": return row.pocDistancePct ?? -Infinity;
    case "imbalanceNet": return row.imbalanceNet;
    case "oiChange5m": return row.oiChange5m ?? -Infinity;
    case "fundingRate8h": return row.fundingRate8h ?? -Infinity;
    case "score": return row.candidate?.score ?? 0;
  }
}

export default function ScreenerView() {
  const { scan, signals, stats, health, link } = useScreenerFeed();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [hideWarmup, setHideWarmup] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => scan?.rows ?? [], [scan]);

  const visibleRows = useMemo(() => {
    const qNorm = query.trim().toUpperCase();
    const filtered = rows.filter((r) => {
      if (hideWarmup && !r.warmedUp) return false;
      if (qNorm && !base(r.symbol).includes(qNorm) && !r.symbol.includes(qNorm)) return false;
      if (filter === "signals" && !r.signal) return false;
      if (filter === "long" && r.candidate?.direction !== "long") return false;
      if (filter === "short" && r.candidate?.direction !== "short") return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const diff = (av as number) - (bv as number);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [rows, query, filter, hideWarmup, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  };

  const status = {
    connecting: ["Connecting…", "var(--warn)"],
    live: ["Live · Internal Engine", "var(--buy)"],
    down: ["Reconnecting…", "var(--sell)"],
  }[link];

  const activeSignalsCount = rows.filter((r) => r.signal !== null).length;
  const stackedImbalanceCount = rows.filter((r) => r.stackedImbalance !== null).length;
  const topLeader = useMemo(
    () => [...rows].sort((a, b) => (b.candidate?.score ?? 0) - (a.candidate?.score ?? 0))[0] ?? null,
    [rows]
  );
  const topFlow = useMemo(
    () =>
      [...rows]
        .filter((r) => r.deltaShare !== null)
        .sort((a, b) => Math.abs(b.deltaShare ?? 0) - Math.abs(a.deltaShare ?? 0))[0] ?? null,
    [rows]
  );

  return (
    <div className="min-h-screen bg-bg-base p-3 text-text-primary" style={{ fontFamily: "var(--font-ui)" }}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/" className="brand" aria-label="OrderFlow Screener Terminal">
            <Wordmark size={26} />
          </Link>
          <RouteNav />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-text-muted">{visibleRows.length}/{rows.length} symbols</span>
          {activeSignalsCount > 0 && (
            <span className="font-mono text-[11px] font-semibold text-accent">
              · {activeSignalsCount} active
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 px-1" style={{ color: status[1] }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: status[1] }} />
            {status[0]}
          </span>
          <ThemeMenu />
          <CommandPalette />
        </div>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className={`${card} px-3 py-2`}>
          <div className="text-[11px] text-text-muted">Engine Reference</div>
          <div className="mt-0.5 font-mono text-[13px] font-semibold text-text-primary tabular-nums">
            {health?.mode === "demo" ? "Built-in Demo Feed" : "OKX Perps (Built-in)"}
          </div>
          <div className="text-[11px] text-text-muted tabular-nums">
            {health?.feed.symbols ?? rows.length} tracked · VAP · Imb · Vol z
          </div>
        </div>
        <div className={`${card} px-3 py-2`}>
          <div className="text-[11px] text-text-muted">Score Leader</div>
          <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums">
            {topLeader ? (
              <Link href={terminalHref(topLeader.symbol)} className="text-accent hover:underline">
                {base(topLeader.symbol)} · {topLeader.candidate?.score ?? 0}
              </Link>
            ) : (
              "—"
            )}
          </div>
          <div className="text-[11px] text-text-muted">
            {topLeader?.candidate ? `${topLeader.candidate.direction.toUpperCase()} ${topLeader.candidate.setup}` : "Scanning"}
          </div>
        </div>
        <div className={`${card} px-3 py-2`}>
          <div className="text-[11px] text-text-muted">Strongest Δ Flow</div>
          <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums">
            {topFlow && topFlow.deltaShare !== null ? (
              <Link
                href={terminalHref(topFlow.symbol)}
                className={`${topFlow.deltaShare >= 0 ? "text-buy" : "text-sell"} hover:underline`}
              >
                {base(topFlow.symbol)} {topFlow.deltaShare >= 0 ? "+" : ""}
                {(topFlow.deltaShare * 100).toFixed(0)}%
              </Link>
            ) : (
              "—"
            )}
          </div>
          <div className="text-[11px] text-text-muted">Aggressive imbalance share</div>
        </div>
        <div className={`${card} px-3 py-2`}>
          <div className="text-[11px] text-text-muted">Setups & Stacked Imb</div>
          <div className="mt-0.5 font-mono text-[13px] font-semibold text-text-primary tabular-nums">
            {activeSignalsCount} live · {stackedImbalanceCount} stacked
          </div>
          <div className="text-[11px] text-text-muted">{signals.filter((s) => s.status === "open").length} open signals · click pair to load</div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-8 w-56 items-center gap-2 rounded-full border border-border bg-bg-panel px-3 text-text-muted focus-within:border-accent">
            <Icon.Search />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter symbol (BTC, SOL…)"
              aria-label="Filter screener symbols"
              className="w-full border-0 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>
          <Segmented
            value={filter}
            onChange={setFilter}
            ariaLabel="Filter rows"
            options={[
              { value: "all", label: "All" },
              { value: "signals", label: `Signals (${activeSignalsCount})` },
              { value: "long", label: "Long bias" },
              { value: "short", label: "Short bias" },
            ]}
          />
          <button
            type="button"
            onClick={() => setHideWarmup((v) => !v)}
            className={`ui-button chip ${hideWarmup ? "is-active" : ""}`}
          >
            Hide warm-up
          </button>
        </div>
        <span className="text-[11.5px] text-text-muted">Authoritative in-app reference · click any symbol to open in the Terminal</span>
      </div>

      {link === "down" && (
        <div className={`${card} mb-3 p-3 text-[12px] text-text-secondary`}>
          Reconnecting to internal screener stream (/api/stream). Polling JSON fallback (/api/screener)…
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
        <section className={`${card} overflow-hidden`}>
          <Table rows={visibleRows} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
        </section>
        <div className="flex flex-col gap-3">
          <section className={`${card} overflow-hidden`}>
            <h2 className="border-b border-border px-3 py-2 text-[12px] font-semibold">Signals</h2>
            <div className="max-h-[420px] overflow-y-auto"><SignalList items={signals} /></div>
          </section>
          <section className={`${card} overflow-hidden`}>
            <h2 className="border-b border-border px-3 py-2 text-[12px] font-semibold">Forward test</h2>
            {stats ? <StatsTable stats={stats} /> : <p className="p-4 text-[12px] text-text-muted">No data yet.</p>}
          </section>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-text-muted">Scores are heuristics, not validated predictions or advice. Judge them by the forward test above.</p>
    </div>
  );
}
