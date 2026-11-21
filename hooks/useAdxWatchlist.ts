"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdxApiItem } from "@/app/api/screener/adx/route";
import type { OhlcBar } from "@/lib/engine/tradingOptions";
import {
  computeAdxSnapshot,
  computeAdxTickTrajectory,
  type AdxSnapshot,
  type AdxTickTrajectory,
} from "@/lib/engine/wyckoff";
import type { ScreenerRow } from "@/lib/screener/screenerCore";
import { normalizeWatchlistSymbol } from "@/lib/store/uiStore";

export type AdxScannerTimeframe = "5m" | "15m" | "1h" | "4h";

export interface AdxScannerEntry {
  symbol: string;
  base: string;
  instId: string;
  inWatchlist: boolean;
  liveRow: ScreenerRow | null;
  price: number | null;
  change5m: number | null;
  change1h: number | null;
  volume1mUsd: number | null;
  volumeZ: number | null;
  deltaShare: number | null;
  score: number;
  candidateDirection: "long" | "short" | null;
  snapshot: AdxSnapshot | null;
  adxTrajectory: AdxTickTrajectory | null;
  loading: boolean;
}

interface AdxCacheEntry {
  bars: OhlcBar[];
  instId: string;
}

interface AdxTickSample {
  adx: number;
  price: number;
}

export function useAdxWatchlist({
  symbols,
  watchlistSymbols,
  timeframe,
  liveRows,
  enabled = true,
}: {
  symbols: string[];
  watchlistSymbols: string[];
  timeframe: AdxScannerTimeframe;
  liveRows: ScreenerRow[];
  enabled?: boolean;
}) {
  const [cacheByKey, setCacheByKey] = useState<Record<string, Record<string, AdxCacheEntry>>>({});
  const [tickHistoryByKey, setTickHistoryByKey] = useState<
    Record<string, Record<string, AdxTickSample[]>>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const inFlightRef = useRef<string | null>(null);

  const normalizedSymbols = useMemo(
    () =>
      Array.from(new Set(symbols.map(normalizeWatchlistSymbol).filter(Boolean))).slice(0, 45),
    [symbols]
  );

  const symbolsParam = useMemo(() => normalizedSymbols.join(","), [normalizedSymbols]);

  const applyBatchPayload = useCallback(
    (tf: AdxScannerTimeframe, payload: { time: number; items: AdxApiItem[] }) => {
      setCacheByKey((prev) => {
        const existingForTf = prev[tf] ?? {};
        const updatedForTf: Record<string, AdxCacheEntry> = { ...existingForTf };
        for (const item of payload.items ?? []) {
          updatedForTf[item.symbol] = {
            bars: item.bars,
            instId: item.instId,
          };
        }
        return { ...prev, [tf]: updatedForTf };
      });
      setLastSyncedAt(payload.time || Date.now());
      setError(null);
    },
    []
  );

  const runFetch = useCallback(
    async (tf: AdxScannerTimeframe, listCsv: string, signal?: AbortSignal) => {
      if (!listCsv) return;
      const reqKey = `${tf}:${listCsv}`;
      inFlightRef.current = reqKey;
      try {
        const qs = new URLSearchParams({ bar: tf, symbols: listCsv });
        const res = await fetch(`/api/screener/adx?${qs.toString()}`, {
          cache: "no-store",
          signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = (await res.json()) as { time: number; items: AdxApiItem[] };
        if (signal?.aborted) return;
        applyBatchPayload(tf, payload);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load ADX market data");
      } finally {
        if (inFlightRef.current === reqKey) {
          inFlightRef.current = null;
        }
        setIsLoading(false);
      }
    },
    [applyBatchPayload]
  );

  useEffect(() => {
    if (!enabled || !symbolsParam) return;
    const controller = new AbortController();
    const kickTimer = setTimeout(() => {
      setIsLoading(true);
      void runFetch(timeframe, symbolsParam, controller.signal);
    }, 0);

    const intervalMs = timeframe === "5m" ? 20_000 : 30_000;
    const timer = setInterval(() => {
      void runFetch(timeframe, symbolsParam, controller.signal);
    }, intervalMs);

    return () => {
      controller.abort();
      clearTimeout(kickTimer);
      clearInterval(timer);
    };
  }, [enabled, runFetch, symbolsParam, timeframe]);

  const liveBySymbol = useMemo(() => {
    const map = new Map<string, ScreenerRow>();
    for (const row of liveRows) {
      const sym = normalizeWatchlistSymbol(row.symbol);
      if (sym) map.set(sym, row);
    }
    return map;
  }, [liveRows]);

  const watchlistSet = useMemo(
    () => new Set(watchlistSymbols.map(normalizeWatchlistSymbol).filter(Boolean)),
    [watchlistSymbols]
  );

  const barsMapForTf = useMemo(() => cacheByKey[timeframe] ?? {}, [cacheByKey, timeframe]);

  const snapshotBySymbol = useMemo(() => {
    const map = new Map<string, AdxSnapshot>();
    for (const [sym, entry] of Object.entries(barsMapForTf)) {
      if (!entry.bars.length) continue;
      const liveRow = liveBySymbol.get(sym);
      map.set(sym, computeAdxSnapshot(entry.bars, liveRow?.price, 14));
    }
    return map;
  }, [barsMapForTf, liveBySymbol]);

  // Append each live price tick's resulting ADX reading into a rolling 5-tick ring buffer.
  useEffect(() => {
    if (!enabled || snapshotBySymbol.size === 0 || liveBySymbol.size === 0) return;
    const timer = setTimeout(() => {
      setTickHistoryByKey((prev) => {
        const existingForTf = prev[timeframe] ?? {};
        let changed = false;
        const nextForTf: Record<string, AdxTickSample[]> = { ...existingForTf };

        for (const [sym, snap] of snapshotBySymbol.entries()) {
          const liveRow = liveBySymbol.get(sym);
          if (!liveRow || !Number.isFinite(liveRow.price) || liveRow.price <= 0) continue;

          const prevList = existingForTf[sym] ?? [];
          const lastSample = prevList[prevList.length - 1];
          if (
            lastSample &&
            lastSample.price === liveRow.price &&
            Math.abs(lastSample.adx - snap.adx) < 0.005
          ) {
            continue;
          }
          nextForTf[sym] = [...prevList, { adx: snap.adx, price: liveRow.price }].slice(-5);
          changed = true;
        }

        if (!changed) return prev;
        return { ...prev, [timeframe]: nextForTf };
      });
    }, 0);

    return () => clearTimeout(timer);
  }, [enabled, liveBySymbol, snapshotBySymbol, timeframe]);

  const trajectoryBySymbol = useMemo(() => {
    const map = new Map<string, AdxTickTrajectory>();
    const historyForTf = tickHistoryByKey[timeframe] ?? {};

    for (const [sym, snap] of snapshotBySymbol.entries()) {
      const liveSamples = historyForTf[sym] ?? [];
      const priorClosedBars = snap.recentAdx.slice(0, -1);
      const mergedPoints =
        liveSamples.length >= 5
          ? liveSamples.slice(-5).map((s) => s.adx)
          : [
              ...priorClosedBars,
              ...(liveSamples.length > 0 ? liveSamples.map((s) => s.adx) : [snap.adx]),
            ].slice(-5);
      map.set(sym, computeAdxTickTrajectory(mergedPoints));
    }
    return map;
  }, [snapshotBySymbol, tickHistoryByKey, timeframe]);

  const entries: AdxScannerEntry[] = useMemo(() => {
    return normalizedSymbols.map((sym) => {
      const base = sym.replace(/USDT$/, "");
      const liveRow = liveBySymbol.get(sym) ?? null;
      const cached = barsMapForTf[sym];
      const snapshot = snapshotBySymbol.get(sym) ?? null;
      const adxTrajectory = trajectoryBySymbol.get(sym) ?? null;
      const lastClose = cached?.bars.at(-1)?.close ?? null;
      return {
        symbol: sym,
        base,
        instId: cached?.instId ?? `${base}-USDT-SWAP`,
        inWatchlist: watchlistSet.has(sym),
        liveRow,
        price: liveRow?.price ?? lastClose,
        change5m: liveRow?.change5m ?? null,
        change1h: liveRow?.change1h ?? null,
        volume1mUsd: liveRow?.volume1mUsd ?? null,
        volumeZ: liveRow?.volumeZ ?? null,
        deltaShare: liveRow?.deltaShare ?? null,
        score: liveRow?.candidate?.score ?? 0,
        candidateDirection: liveRow?.candidate?.direction ?? null,
        snapshot,
        adxTrajectory,
        loading: snapshot === null && isLoading,
      };
    });
  }, [
    barsMapForTf,
    isLoading,
    liveBySymbol,
    normalizedSymbols,
    snapshotBySymbol,
    trajectoryBySymbol,
    watchlistSet,
  ]);

  const refreshNow = useCallback(() => {
    if (symbolsParam) {
      setIsLoading(true);
      void runFetch(timeframe, symbolsParam);
    }
  }, [runFetch, symbolsParam, timeframe]);

  return {
    entries,
    snapshotBySymbol,
    trajectoryBySymbol,
    isLoading,
    error,
    lastSyncedAt,
    refreshNow,
  };
}
