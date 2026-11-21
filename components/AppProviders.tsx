"use client";

import React, { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { MarketSessionProvider, useSessionStore } from "@/lib/session/SessionContext";
import { useMarketData } from "@/hooks/useMarketData";
import { useAlerts } from "@/hooks/useAlerts";
import { useUIStore } from "@/lib/store/uiStore";
import { useAlertStore } from "@/lib/store/alertStore";
import { useLayoutStore } from "@/lib/store/layoutStore";
import GlobalTooltip from "@/components/GlobalTooltip";
import HoverHint from "@/components/HoverHint";
import AlertToasts from "@/components/AlertToasts";

function UrlMarketSync() {
  const searchParams = useSearchParams();
  const setMarketType = useSessionStore((s) => s.setMarketType);
  const setSymbol = useSessionStore((s) => s.setSymbol);
  const setVenue = useSessionStore((s) => s.setVenue);
  const setTimeframe = useSessionStore((s) => s.setTimeframe);
  const appliedRef = useRef<string>("");

  useEffect(() => {
    const key = searchParams.toString();
    if (!key || appliedRef.current === key) return;
    appliedRef.current = key;
    const market = searchParams.get("market");
    const sym = searchParams.get("symbol");
    const venue = searchParams.get("venue");
    const tf = searchParams.get("tf");
    if (market === "perpetual" || market === "spot" || market === "forex") {
      setMarketType(market);
    }
    if (sym) setSymbol(sym);
    if (venue) setVenue(venue as never);
    if (tf === "1m" || tf === "5m" || tf === "15m" || tf === "30m" || tf === "1h" || tf === "4h") {
      setTimeframe(tf);
    }
  }, [searchParams, setMarketType, setSymbol, setTimeframe, setVenue]);

  return null;
}

function MarketRuntimeBridge() {
  useMarketData();
  useAlerts();

  useEffect(() => {
    void useUIStore.persist.rehydrate();
    void useAlertStore.persist.rehydrate();
    void useLayoutStore.persist.rehydrate();
  }, []);

  const valueAreaPct = useUIStore((s) => s.indicators.valueAreaPct);
  const setValueAreaPct = useSessionStore((s) => s.setValueAreaPct);
  useEffect(() => setValueAreaPct(valueAreaPct), [valueAreaPct, setValueAreaPct]);

  return null;
}

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <MarketSessionProvider>
      <Suspense fallback={null}>
        <UrlMarketSync />
      </Suspense>
      <MarketRuntimeBridge />
      <GlobalTooltip />
      <HoverHint />
      {children}
      <AlertToasts />
    </MarketSessionProvider>
  );
}
