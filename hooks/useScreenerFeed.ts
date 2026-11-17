"use client";

import { useEffect, useState } from "react";
import type { ScanResult } from "@/lib/screener/screenerCore";
import type { TrackedSignal, TrackerStats } from "@/lib/signals/tracker";

export type ScreenerLinkStatus = "connecting" | "live" | "down";

export interface ScreenerHealth {
  ok?: boolean;
  uptimeSec: number;
  mode: "okx" | "demo" | "starting";
  feed: {
    connected: boolean;
    lastMessageAt: number | null;
    reconnects: number;
    symbols: number;
  };
  notifications?: boolean;
  lastScanAt: number | null;
}

export interface ScreenerFeedOptions {
  includeSignals?: boolean;
  includeStats?: boolean;
  includeHealth?: boolean;
}

/**
 * Connects strictly to the application's built-in internal OrderFlow Screener
 * endpoints (`/api/screener`, `/api/stream`, `/api/signals`, `/api/stats`, `/api/health`)
 * with SSE streaming and automatic HTTP JSON polling fallback.
 */
export function useScreenerFeed(options: ScreenerFeedOptions = {}) {
  const { includeSignals = true, includeStats = true, includeHealth = true } = options;
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [signals, setSignals] = useState<TrackedSignal[]>([]);
  const [stats, setStats] = useState<TrackerStats | null>(null);
  const [health, setHealth] = useState<ScreenerHealth | null>(null);
  const [link, setLink] = useState<ScreenerLinkStatus>("connecting");

  useEffect(() => {
    let alive = true;
    let lastSseAt = 0;
    let hasRows = false;

    const loadScan = async () => {
      try {
        const res = await fetch("/api/screener", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ScanResult;
        if (!alive) return;
        if (data && Array.isArray(data.rows)) {
          if (data.rows.length > 0) hasRows = true;
          setScan((prev) => (!prev || data.time >= prev.time ? data : prev));
          if (data.rows.length > 0) setLink("live");
        }
      } catch {
        // Keep current link status; next tick retries.
      }
    };

    void loadScan();

    const source = new EventSource("/api/stream");
    source.addEventListener("scan", (event) => {
      if (!alive) return;
      lastSseAt = Date.now();
      const parsed = JSON.parse((event as MessageEvent).data) as ScanResult;
      if (parsed.rows?.length) hasRows = true;
      setScan(parsed);
      setLink("live");
    });
    source.onerror = () => {
      void loadScan();
      if (Date.now() - lastSseAt > 6_000 && !hasRows) setLink("down");
    };

    const pollId = setInterval(() => {
      if (!hasRows || Date.now() - lastSseAt > 2_500) {
        void loadScan();
      }
    }, 800);

    return () => {
      alive = false;
      clearInterval(pollId);
      source.close();
    };
  }, []);

  useEffect(() => {
    if (!includeSignals && !includeStats && !includeHealth) return;
    let alive = true;
    const load = async () => {
      try {
        const [s, t, h] = await Promise.all([
          includeSignals ? fetch("/api/signals?limit=30", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])) : null,
          includeStats ? fetch("/api/stats", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)) : null,
          includeHealth ? fetch("/api/health", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)) : null,
        ]);
        if (!alive) return;
        if (includeSignals && Array.isArray(s)) setSignals(s as TrackedSignal[]);
        if (includeStats && t) setStats(t as TrackerStats);
        if (includeHealth && h) setHealth(h as ScreenerHealth);
      } catch {
        // Connectivity status already tracks stream health.
      }
    };
    void load();
    const id = setInterval(load, 8_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [includeHealth, includeSignals, includeStats]);

  return { scan, signals, stats, health, link };
}
