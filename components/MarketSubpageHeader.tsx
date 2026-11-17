"use client";

import React from "react";
import Link from "next/link";
import { useSessionStore } from "@/lib/session/SessionContext";
import { ALL_ASSETS, METALS, venuesWithData } from "@/lib/config/instruments";
import { FOREX_GROUPS, FOREX_SYMBOLS } from "@/lib/config/venues";
import { venueSupports } from "@/lib/adapters/capabilities";
import { AssetLogo, VenueLogo } from "@/components/AssetLogo";
import { Picker, type PickerOption } from "@/components/ui/Picker";
import { Segmented } from "@/components/ui/Primitives";
import { Wordmark } from "@/components/Logo";
import RouteNav from "@/components/RouteNav";
import ThemeMenu from "@/components/ThemeMenu";
import CommandPalette from "@/components/CommandPalette";
import type { Timeframe, Venue, VenueSelection } from "@/lib/types/market";

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
];

const VENUES: Record<"perpetual" | "spot", { value: Venue; label: string }[]> = {
  perpetual: [{ value: "okx-futures", label: "OKX Perp" }],
  spot: [{ value: "okx-spot", label: "OKX Spot" }],
};

export default function MarketSubpageHeader() {
  const symbol = useSessionStore((s) => s.symbol);
  const venue = useSessionStore((s) => s.venue);
  const marketType = useSessionStore((s) => s.marketType);
  const timeframe = useSessionStore((s) => s.timeframe);
  const connections = useSessionStore((s) => s.connections);
  const setSymbol = useSessionStore((s) => s.setSymbol);
  const setVenue = useSessionStore((s) => s.setVenue);
  const setSelectedVenues = useSessionStore((s) => s.setSelectedVenues);
  const setMarketType = useSessionStore((s) => s.setMarketType);
  const setTimeframe = useSessionStore((s) => s.setTimeframe);

  const isForex = marketType === "forex";
  const METAL_PREFIX = "metal:";

  const coinOption = (asset: (typeof ALL_ASSETS)[number], kind: "perpetual" | "spot"): PickerOption<string> => {
    const value = `${asset.base}USDT`;
    const venues = venuesWithData(value, kind).length;
    return {
      value,
      label: asset.kind === "metal" ? `${asset.base}/USDT` : value,
      sub: asset.name,
      keywords: `${asset.base} ${asset.name} ${asset.base}USD${asset.kind === "metal" ? ` ${asset.base}SD` : ""}`,
      icon: <AssetLogo symbol={value} size={20} />,
      group: asset.kind === "metal" ? "Metals" : "Crypto",
      trailing: `${venues}v`,
    };
  };

  const instrumentOptions: PickerOption<string>[] = isForex
    ? [
        ...FOREX_SYMBOLS.map((pair) => ({
          value: pair,
          label: pair,
          sub: FOREX_GROUPS[pair] === "Majors" ? "Major" : "Cross / exotic",
          icon: <AssetLogo symbol={pair} size={20} />,
          group: `FX ${FOREX_GROUPS[pair] === "Majors" ? "majors" : "crosses"}`,
        })),
        ...METALS.map((metal) => ({
          value: `${METAL_PREFIX}${metal.base}USDT`,
          label: `${metal.base}/USD`,
          sub: `${metal.name} · perpetual`,
          keywords: `${metal.base} ${metal.name} ${metal.base}USD ${metal.base}USDT`,
          icon: <AssetLogo symbol={`${metal.base}USDT`} size={20} />,
          group: "Metals",
          trailing: `${metal.perp.length}v`,
        })),
      ]
    : ALL_ASSETS.filter((asset) => venuesWithData(`${asset.base}USDT`, marketType).length > 0).map((asset) =>
        coinOption(asset, marketType === "spot" ? "spot" : "perpetual")
      );

  const venueOptions = marketType === "perpetual" || marketType === "spot" ? VENUES[marketType] : [];
  const aggregateValue: VenueSelection = marketType === "perpetual" ? "all-perps" : "all-spot";
  const aggregateFor = (sym: string) =>
    venueOptions.filter((v) => venueSupports(v.value, sym, marketType)).map((v) => v.value);

  const chooseSymbol = (next: string) => {
    if (next.startsWith(METAL_PREFIX)) {
      const metal = next.slice(METAL_PREFIX.length);
      setMarketType("perpetual");
      setSymbol(metal);
      setVenue("all-perps");
      setSelectedVenues([...venuesWithData(metal, "perpetual")]);
      return;
    }
    setSymbol(next);
    if (isForex) return;
    if (venue === aggregateValue) setSelectedVenues(aggregateFor(next));
    else if (!venueSupports(venue as Venue, next, marketType)) {
      const fallback = venueOptions.find((v) => venueSupports(v.value, next, marketType));
      if (fallback) setVenue(fallback.value);
    }
  };

  const venuePickerOptions: PickerOption<VenueSelection>[] = venueOptions.map((v) => ({
    value: v.value as VenueSelection,
    label: v.label,
    sub: venueSupports(v.value, symbol, marketType) ? "OKX WebSocket v5" : `No ${symbol} market`,
    disabled: !venueSupports(v.value, symbol, marketType),
    icon: <VenueLogo venue={v.value} size={18} />,
  }));

  const chooseVenue = (next: VenueSelection) => {
    setVenue(next);
    if (next === aggregateValue) setSelectedVenues(aggregateFor(symbol));
  };

  const connList = Object.values(connections);
  const liveCount = connList.filter((c) => c.status === "live").length;
  const connLabel = liveCount > 0 ? "En vivo · OKX" : connList.some((c) => c.status === "connecting") ? "Conectando…" : "Sincronizando";
  const connColor = liveCount > 0 ? "var(--buy)" : "var(--warn)";

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2.5 border-b border-border bg-bg-base/95 px-4 py-2.5 backdrop-blur">
      <Link className="brand shrink-0" href="/" aria-label="OrderFlow Screener home">
        <Wordmark size={26} />
      </Link>
      <RouteNav />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={marketType}
          onChange={(next) => {
            if (next === marketType) return;
            setMarketType(next);
            if (next === "forex") setSymbol("EUR/USD");
            else if (isForex || venuesWithData(symbol, next).length === 0) setSymbol("BTCUSDT");
          }}
          options={[
            { value: "perpetual", label: "Perp" },
            { value: "spot", label: "Spot" },
            { value: "forex", label: "FX" },
          ]}
          ariaLabel="Tipo de mercado"
        />

        <Picker
          searchable
          className="instrument-picker"
          value={symbol}
          options={instrumentOptions}
          onChange={chooseSymbol}
          ariaLabel="Activo seleccionado"
          width={240}
        />

        {!isForex && (
          <Picker
            value={venue}
            options={venuePickerOptions}
            onChange={chooseVenue}
            ariaLabel="Exchange"
            width={200}
          />
        )}

        <Segmented
          accent
          value={timeframe}
          onChange={setTimeframe}
          options={TIMEFRAMES}
          ariaLabel="Temporalidad"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1.5 font-mono text-[11.5px] sm:inline-flex whitespace-nowrap shrink-0" style={{ color: connColor }}>
          <span className="h-2 w-2 rounded-full" style={{ background: connColor }} />
          {connLabel}
        </span>
        <ThemeMenu />
        <CommandPalette
          onSelectInstrument={(nextSym, nextMarket) => {
            if (nextMarket !== marketType) setMarketType(nextMarket);
            chooseSymbol(nextSym);
          }}
        />
      </div>
    </header>
  );
}
