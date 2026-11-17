"use client";

import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useUIStore } from "@/lib/store/uiStore";
import { useNow } from "./useNow";
import { DAY_MS, dayLevels, nakedPocs, parseOkxKlines, utcDay, type DayLevels, type Kline } from "@/lib/engine/priorSessions";

const DAYS_BACK = 7;

/**
 * Fetch 5m OKX klines through the server route so prior-day POC, VAH/VAL,
 * VWAP, and naked POCs come exclusively from OKX.
 */
async function fetchKlines(symbol: string, marketType: "perpetual" | "spot", from: number, to: number, signal: AbortSignal): Promise<Kline[]> {
  const qs = new URLSearchParams({
    symbol,
    marketType,
    from: String(from),
    to: String(to),
  }).toString();
  const response = await fetch(`/api/terminal/klines?${qs}`, { signal });
  if (!response.ok) throw new Error(`OKX kline request failed (${response.status})`);
  return parseOkxKlines((await response.json()) as unknown[][]);
}

export interface PriorSessions {
  previous: DayLevels | null;
  naked: DayLevels[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
}

/** Previous UTC day's levels and naked POCs for the current OKX instrument. */
export function usePriorSessions(): PriorSessions {
  const symbol = useSessionStore((s) => s.symbol);
  const marketType = useSessionStore((s) => s.marketType);
  const tickSize = useSessionStore((s) => s.tickSize);
  const sessionHigh = useSessionStore((s) => s.session?.high ?? -Infinity);
  const sessionLow = useSessionStore((s) => s.session?.low ?? Infinity);
  const replayStart = useSessionStore((s) => s.replay?.meta.startedAt ?? null);
  const valueAreaPct = useUIStore((s) => s.indicators.valueAreaPct);
  const enabled = useUIStore((s) => s.indicators.priorDay || s.indicators.nakedPocs);
  const now = useNow(60_000);
  // During a replay, "today" is the recording's day. 0 until mounted (no clock reads in render).
  const today = now ? utcDay(replayStart ?? now) : 0;
  const [state, setState] = useState<{ key: string; klines: Kline[]; status: PriorSessions["status"]; error?: string }>({ key: "", klines: [], status: "idle" });

  const key = `${marketType}:${symbol}:${today}`;
  useEffect(() => {
    if (!enabled || marketType === "forex" || !today) return;
    if (state.key === key && state.status !== "error") return;
    const controller = new AbortController();
    const kind = marketType === "perpetual" ? "perpetual" : "spot";
    const timer = setTimeout(() => {
      setState({ key, klines: [], status: "loading" });
      // Include today's bars so a POC revisited earlier today is not shown as naked.
      fetchKlines(symbol, kind, today - DAYS_BACK * DAY_MS, Math.min(today + DAY_MS, Date.now()), controller.signal)
        .then((klines) => setState({ key, klines, status: "ready" }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({ key, klines: [], status: "error", error: error instanceof Error ? error.message : String(error) });
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // state is read only to skip refetching the same key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, marketType, symbol, today, now]);

  return useMemo(() => {
    if (state.key !== key || state.status !== "ready" || !(tickSize > 0)) {
      return { previous: null, naked: [], status: state.key === key ? state.status : "idle", error: state.error };
    }
    const days = dayLevels(state.klines, tickSize, valueAreaPct, today);
    let todayHigh = -Infinity;
    let todayLow = Infinity;
    for (const k of state.klines) {
      if (k.openTime < today) continue;
      todayHigh = Math.max(todayHigh, k.high);
      todayLow = Math.min(todayLow, k.low);
    }
    todayHigh = Math.max(todayHigh, sessionHigh);
    todayLow = Math.min(todayLow, sessionLow);
    const previous = days.find((d) => d.day === today - DAY_MS) ?? null;
    // Yesterday's POC is already drawn as pPOC; list only older untested ones.
    const naked = nakedPocs(days, todayHigh, todayLow).filter((d) => d.day !== previous?.day);
    return { previous, naked, status: "ready" as const };
  }, [state, key, tickSize, valueAreaPct, today, sessionHigh, sessionLow]);
}
