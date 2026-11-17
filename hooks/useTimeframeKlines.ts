"use client";

import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { mergeOhlcSeries, parseOkxOhlcRows, type OhlcBar } from "@/lib/engine/tradingOptions";
import type { Timeframe } from "@/lib/types/market";

interface KlineState {
  key: string;
  bars: OhlcBar[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
}

/**
 * Fetches real OKX historical OHLCV bars for the active symbol & timeframe
 * and merges them seamlessly with the live FootprintCandle series so
 * ATR(14) and Bollinger Bands(20, 2σ) remain calibrated across all timeframes.
 */
export function useTimeframeKlines(limit = 120): {
  bars: OhlcBar[];
  status: KlineState["status"];
  error?: string;
} {
  const symbol = useSessionStore((s) => s.symbol);
  const marketType = useSessionStore((s) => s.marketType);
  const timeframe = useSessionStore((s) => s.timeframe);
  const candles = useSessionStore((s) => s.candles);
  const currentCandle = useSessionStore((s) => s.currentCandle);

  const [state, setState] = useState<KlineState>({
    key: "",
    bars: [],
    status: "idle",
  });

  const requestKey = `${marketType}:${symbol}:${timeframe}:${limit}`;

  useEffect(() => {
    if (marketType === "forex") {
      return;
    }

    const controller = new AbortController();
    const kind = marketType === "spot" ? "spot" : "perpetual";
    const qs = new URLSearchParams({
      symbol,
      marketType: kind,
      bar: timeframe as Timeframe,
      limit: String(limit),
    }).toString();

    const timer = setTimeout(() => {
      setState((prev) =>
        prev.key === requestKey ? prev : { key: requestKey, bars: [], status: "loading" }
      );
      fetch(`/api/terminal/klines?${qs}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`OKX klines HTTP ${res.status}`);
          return parseOkxOhlcRows((await res.json()) as unknown[][]);
        })
        .then((bars) => {
          if (controller.signal.aborted) return;
          setState({ key: requestKey, bars, status: "ready" });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            key: requestKey,
            bars: [],
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }, 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, symbol, marketType, timeframe, limit]);

  const bars = useMemo(() => {
    const historical = state.key === requestKey && marketType !== "forex" ? state.bars : [];
    return mergeOhlcSeries(historical, candles, currentCandle, timeframe);
  }, [state.key, state.bars, requestKey, marketType, candles, currentCandle, timeframe]);

  const status: KlineState["status"] =
    marketType === "forex" ? (bars.length >= 20 ? "ready" : "idle") : state.key === requestKey ? state.status : "loading";

  return { bars, status, error: state.key === requestKey ? state.error : undefined };
}
