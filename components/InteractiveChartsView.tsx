"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MarketSubpageHeader from "@/components/MarketSubpageHeader";
import FootprintChart from "@/components/FootprintChart";
import LiquidityCandlesChart from "@/components/LiquidityCandlesChart";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useUIStore } from "@/lib/store/uiStore";
import { useTimeframeKlines } from "@/hooks/useTimeframeKlines";
import { analyzeHighVolumeNodes } from "@/lib/engine/orderFlowEngine";
import { resampleBars, rollingRealizedVolatility, rollingVolumeZScores, secondsPerYear } from "@/lib/engine/analytics";
import { buildRollingObiSeries, OBI_ROLLING_WINDOW_MS } from "@/lib/engine/obiRolling";
import { computeBollingerSeries } from "@/lib/engine/tradingOptions";
import { formatClock, formatCompact, formatPercent, formatPriceValue, formatSigned, priceDecimals } from "@/lib/format";
import { Segmented } from "@/components/ui/Primitives";
import { Activity, BarChart3, Layers, Scale, TrendingUp } from "lucide-react";

type FlowBucketSec = 1 | 5 | 15 | 60;

const FLOW_RESOLUTIONS: { value: FlowBucketSec; label: string }[] = [
  { value: 1, label: "1s" },
  { value: 5, label: "5s" },
  { value: 15, label: "15s" },
  { value: 60, label: "1m" },
];

export default function InteractiveChartsView() {
  const symbol = useSessionStore((s) => s.symbol);
  const marketType = useSessionStore((s) => s.marketType);
  const timeframe = useSessionStore((s) => s.timeframe);
  const tickSize = useSessionStore((s) => s.tickSize);
  const ticker = useSessionStore((s) => s.ticker);
  const session = useSessionStore((s) => s.session);
  const flowBars = useSessionStore((s) => s.flowBars);
  const liveBar = useSessionStore((s) => s.liveBar);
  const volumeProfile = useSessionStore((s) => s.volumeProfile);
  const orderBook = useSessionStore((s) => s.orderBook);
  const aggregatedBook = useSessionStore((s) => s.aggregatedBook);
  const currentOBI = useSessionStore((s) => s.currentOBI);
  const obiPriceHistory = useSessionStore((s) => s.obiPriceHistory);
  const oiHistory = useSessionStore((s) => s.oiHistory);
  const derivatives = useSessionStore((s) => s.derivatives);
  const hvnThreshold = useUIStore((s) => s.indicators.hvnThreshold);

  const [flowResolution, setFlowResolution] = useState<FlowBucketSec>(5);
  const [liquidityTab, setLiquidityTab] = useState<"depth" | "obi">("depth");

  const { bars: klineBars } = useTimeframeKlines(80);
  const allFlow = useMemo(() => (liveBar ? [...flowBars, liveBar] : flowBars), [flowBars, liveBar]);
  const livePrice = ticker?.price ?? session?.last ?? allFlow.at(-1)?.close ?? klineBars.at(-1)?.close ?? 0;
  const decimals = priceDecimals(tickSize, livePrice);
  const baseSymbol = marketType === "forex" ? symbol.split("/")[0] : symbol.replace(/USDT?$|USDC$/, "");

  // 1. Price + Bollinger + VWAP series
  const priceSeries = useMemo(() => {
    const { series } = computeBollingerSeries(klineBars.slice(-60), 20, 2);
    const vwap = session?.vwap ?? null;
    return series.map((pt) => ({
      ...pt,
      label: formatClock(pt.time).slice(0, 5),
      vwap: vwap && vwap > 0 ? vwap : undefined,
    }));
  }, [klineBars, session?.vwap]);

  // 2. Aggressive Buy/Sell Volume + CVD + Volume Z-Score
  const flowChartData = useMemo(() => {
    const resampled = resampleBars(allFlow.slice(-1800), flowResolution);
    const zSeries = rollingVolumeZScores(resampled, 20);
    const rvSeries = rollingRealizedVolatility(resampled, 30, flowResolution, secondsPerYear(marketType));
    return resampled.slice(-72).map((b, idx, arr) => {
      const zIdx = zSeries.length - arr.length + idx;
      const rvIdx = rvSeries.length - arr.length + idx;
      return {
        time: b.time,
        label: formatClock(b.time),
        buyVolume: Number(b.buyVolume.toFixed(4)),
        sellVolume: -Number(b.sellVolume.toFixed(4)),
        absSellVolume: Number(b.sellVolume.toFixed(4)),
        cvd: Number(b.cvd.toFixed(3)),
        close: b.close,
        zScore: zSeries[zIdx]?.z ?? 0,
        rv: rvSeries[rvIdx]?.value ?? null,
      };
    });
  }, [allFlow, flowResolution, marketType]);

  // 3. Volume-at-Price (VAP) Profile + HVN Nodes
  const vapChartData = useMemo(() => {
    if (!volumeProfile?.levels.length) return [];
    const hvn = analyzeHighVolumeNodes(volumeProfile, hvnThreshold, tickSize);
    // Window around POC (max 28 levels so the interactive bar chart stays crisp)
    const sorted = [...volumeProfile.levels].sort((a, b) => a.price - b.price);
    const pocIdx = sorted.findIndex((l) => l.isPOC);
    const center = pocIdx >= 0 ? pocIdx : Math.floor(sorted.length / 2);
    const half = 14;
    const start = Math.max(0, center - half);
    const slice = sorted.slice(start, start + 28);
    return slice.map((lvl) => {
      const node = hvn.nodeByPrice.get(lvl.price);
      const inVA = lvl.price >= volumeProfile.val && lvl.price <= volumeProfile.vah;
      return {
        price: lvl.price,
        priceLabel: formatPriceValue(lvl.price, decimals),
        totalVolume: Number(lvl.totalVolume.toFixed(3)),
        bidVolume: Number(lvl.bidVolume.toFixed(3)),
        askVolume: Number(lvl.askVolume.toFixed(3)),
        delta: Number(lvl.delta.toFixed(3)),
        isPOC: lvl.isPOC,
        isHVN: Boolean(node),
        inVA,
      };
    });
  }, [volumeProfile, hvnThreshold, tickSize, decimals]);

  // 4. Order Book Cumulative Depth Curve + 30m OBI Rolling
  const depthCurveData = useMemo(() => {
    const book = aggregatedBook ?? orderBook;
    if (!book || (!book.bids.length && !book.asks.length)) return [];
    const bids = [...book.bids].slice(0, 20).sort((a, b) => a.price - b.price);
    const asks = [...book.asks].slice(0, 20).sort((a, b) => a.price - b.price);

    let cumBid = 0;
    const bidRunning: { price: number; bidDepth: number; askDepth: number | null }[] = [];
    for (let i = bids.length - 1; i >= 0; i--) {
      cumBid += bids[i].size;
      bidRunning.unshift({
        price: bids[i].price,
        bidDepth: Number(cumBid.toFixed(3)),
        askDepth: null,
      });
    }

    let cumAsk = 0;
    const askRunning: { price: number; bidDepth: number | null; askDepth: number }[] = [];
    for (let i = 0; i < asks.length; i++) {
      cumAsk += asks[i].size;
      askRunning.push({
        price: asks[i].price,
        bidDepth: null,
        askDepth: Number(cumAsk.toFixed(3)),
      });
    }

    return [...bidRunning, ...askRunning].map((pt) => ({
      ...pt,
      priceLabel: formatPriceValue(pt.price, decimals),
    }));
  }, [aggregatedBook, orderBook, decimals]);

  const { points: obiPoints } = useMemo(
    () => buildRollingObiSeries(obiPriceHistory, 5, OBI_ROLLING_WINDOW_MS),
    [obiPriceHistory]
  );

  // 5. Open Interest + Price chart for perpetuals
  const oiChartData = useMemo(() => {
    if (!oiHistory.length) return [];
    const step = Math.max(1, Math.floor(oiHistory.length / 60));
    return oiHistory
      .filter((_, i) => i % step === 0 || i === oiHistory.length - 1)
      .slice(-60)
      .map((pt) => ({
        label: formatClock(pt.time),
        openInterest: Number(pt.openInterest.toFixed(2)),
        price: pt.price,
      }));
  }, [oiHistory]);

  // Terminal-mirrored KPI computations
  const change = session ? livePrice - session.open : 0;
  const changePct = session && session.open ? (change / session.open) * 100 : 0;
  const delta = session ? session.buyVolume - session.sellVolume : 0;
  const buyShare = session && session.volume ? (session.buyVolume / session.volume) * 100 : 50;
  const last10 = allFlow.slice(-11, -1);
  const tradesPerSec = last10.length ? last10.reduce((s, b) => s + b.trades, 0) / last10.length : 0;
  const latestZ = flowChartData.at(-1)?.zScore ?? null;
  const latestRv = flowChartData.at(-1)?.rv ?? null;

  return (
    <div className="min-h-screen bg-bg-base text-text-primary flex flex-col">
      <MarketSubpageHeader />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-5 px-4 py-5 md:px-6">
        {/* Heading + Resolution Bar */}
        <section className="flex flex-col gap-3 border-b border-border-muted pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-muted">
              <BarChart3 size={13} className="text-accent" />
              <span>Gráficos Interactivos en Tiempo Real</span>
              <span>·</span>
              <span>{marketType === "forex" ? symbol : `${baseSymbol}/USDT`}</span>
              <span>·</span>
              <span>Temporalidad {timeframe}</span>
            </div>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-tight text-text-primary sm:text-[25px]">
              Telemetría Numérica del Terminal en Gráficos Dinámicos
            </h1>
            <p className="mt-1 text-[13px] text-text-secondary">
              Footprint interactivo Canvas DPR en vivo, gráfico de velas con niveles de liquidez del libro L2 y toda la telemetría del Terminal actualizándose con cada tick.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase text-text-muted">Ventana flujo</span>
              <Segmented
                size="xs"
                value={flowResolution}
                onChange={setFlowResolution}
                options={FLOW_RESOLUTIONS}
                ariaLabel="Resolución de gráficos de flujo"
              />
            </div>
            <Link href="/trading-options" className="ui-button chip is-primary whitespace-nowrap shrink-0">
              Abrir Opciones de Trading
            </Link>
          </div>
        </section>

        {/* Mirrored Live Terminal KPI Strip */}
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8 font-mono tabular-nums">
          <div className="rounded-[var(--radius)] border border-border bg-bg-panel px-3 py-2">
            <div className="text-[10.5px] font-sans text-text-muted">Precio Vivo</div>
            <div className="mt-0.5 text-[14px] font-bold text-text-primary">
              {livePrice > 0 ? formatPriceValue(livePrice, decimals) : "—"}
            </div>
            <div className={`text-[10.5px] ${change >= 0 ? "text-buy" : "text-sell"}`}>
              {change >= 0 ? "▲" : "▼"} {formatPercent(Math.abs(changePct), 2, false)}
            </div>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-bg-panel px-3 py-2">
            <div className="text-[10.5px] font-sans text-text-muted">VWAP Sesión</div>
            <div className="mt-0.5 text-[14px] font-semibold text-vwap">
              {session?.vwap ? formatPriceValue(session.vwap, decimals) : "—"}
            </div>
            <div className="text-[10.5px] text-text-muted">
              {session && session.vwapStd > 0 ? `${((livePrice - session.vwap) / session.vwapStd).toFixed(2)}σ` : "—"}
            </div>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-bg-panel px-3 py-2">
            <div className="text-[10.5px] font-sans text-text-muted">POC / Value Area</div>
            <div className="mt-0.5 text-[14px] font-semibold text-poc">
              {volumeProfile?.poc ? formatPriceValue(volumeProfile.poc, decimals) : "—"}
            </div>
            <div className="text-[10.5px] text-text-muted truncate">
              {volumeProfile ? `${formatPriceValue(volumeProfile.val, decimals)}–${formatPriceValue(volumeProfile.vah, decimals)}` : "—"}
            </div>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-bg-panel px-3 py-2">
            <div className="text-[10.5px] font-sans text-text-muted">Delta Acumulado</div>
            <div className={`mt-0.5 text-[14px] font-semibold ${delta >= 0 ? "text-buy" : "text-sell"}`}>
              {session ? formatSigned(delta) : "—"}
            </div>
            <div className="text-[10.5px] text-text-muted">{buyShare.toFixed(1)}% compras</div>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-bg-panel px-3 py-2">
            <div className="text-[10.5px] font-sans text-text-muted">OBI Instantáneo</div>
            <div className={`mt-0.5 text-[14px] font-semibold ${currentOBI >= 0 ? "text-buy" : "text-sell"}`}>
              {formatSigned(currentOBI * 100, 1)}%
            </div>
            <div className="text-[10.5px] text-text-muted">Bid vs Ask libro</div>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-bg-panel px-3 py-2">
            <div className="text-[10.5px] font-sans text-text-muted">Volumen Sesión</div>
            <div className="mt-0.5 text-[14px] font-semibold text-text-primary">
              {session ? formatCompact(session.volume) : "—"}
            </div>
            <div className="text-[10.5px] text-text-muted">
              {session ? `$${formatCompact(session.notional)}` : "—"}
            </div>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-bg-panel px-3 py-2">
            <div className="text-[10.5px] font-sans text-text-muted">Volume Z / Ritmo</div>
            <div className="mt-0.5 text-[14px] font-semibold text-accent">
              {latestZ !== null ? `${latestZ >= 0 ? "+" : ""}${latestZ.toFixed(2)}σ` : "—"}
            </div>
            <div className="text-[10.5px] text-text-muted">{tradesPerSec.toFixed(1)} trades/s</div>
          </div>

          <div className="rounded-[var(--radius)] border border-border bg-bg-panel px-3 py-2">
            <div className="text-[10.5px] font-sans text-text-muted">
              {marketType === "perpetual" ? "Open Interest" : "Volatilidad RV"}
            </div>
            <div className="mt-0.5 text-[14px] font-semibold text-warn">
              {marketType === "perpetual"
                ? derivatives?.openInterestValue
                  ? `$${formatCompact(derivatives.openInterestValue, 2)}`
                  : "—"
                : latestRv !== null
                  ? `${latestRv.toFixed(1)}%`
                  : "—"}
            </div>
            <div className="text-[10.5px] text-text-muted">
              {marketType === "perpetual" && derivatives?.primaryFundingRate != null
                ? `Fund ${(derivatives.primaryFundingRate * 100).toFixed(4)}%`
                : "Anualizada"}
            </div>
          </div>
        </section>

        {/* Live Interactive Footprint Canvas */}
        <section
          aria-label="Gráfico Footprint en Tiempo Real"
          className="flex h-[500px] lg:h-[580px] w-full flex-col"
        >
          <FootprintChart />
        </section>

        {/* Live Candlestick Chart + L2 Liquidity Levels */}
        <LiquidityCandlesChart
          symbol={symbol}
          marketType={marketType}
          timeframe={timeframe}
          tickSize={tickSize}
          decimals={decimals}
          bars={klineBars}
          livePrice={livePrice}
          orderBook={aggregatedBook ?? orderBook}
          volumeProfile={volumeProfile}
          hvnThreshold={hvnThreshold}
        />

        {/* Chart Grid Row 1: Price+BB+VWAP + Aggressive Buy/Sell & CVD */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* Chart 1: Price + Bollinger + VWAP + POC */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-muted pb-2.5">
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-accent" />
                <div>
                  <h2 className="text-[14.5px] font-semibold text-text-primary">
                    Precio en Vivo, Bandas de Bollinger y VWAP ({timeframe})
                  </h2>
                  <p className="text-[11.5px] text-text-secondary">
                    Evolución del precio respecto a su envolvente estadística (±2σ), VWAP y POC
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 font-mono text-[10.5px] text-text-muted">
                <span className="text-text-primary">● Precio</span>
                <span className="text-vwap">● Bandas BB</span>
                <span className="text-poc">┄ POC</span>
              </div>
            </div>

            <div className="h-[260px] w-full">
              {priceSeries.length < 2 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  Sincronizando velas históricas OKX para {symbol} ({timeframe})…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
                  <ComposedChart data={priceSeries} margin={{ top: 8, right: 8, left: 2, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      minTickGap={28}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "var(--border-muted)" }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      width={66}
                      tickFormatter={(v: number) => formatPriceValue(v, decimals)}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-panel-alt)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                      }}
                      formatter={(val, name) => [
                        typeof val === "number" ? formatPriceValue(val, decimals) : String(val),
                        String(name),
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="bandRange"
                      name="Rango Bollinger"
                      stroke="none"
                      fill="var(--vwap)"
                      fillOpacity={0.1}
                      isAnimationActive={false}
                    />
                    <Line type="monotone" dataKey="upper" name="BB Superior" stroke="var(--vwap)" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="middle" name="SMA 20" stroke="var(--vwap)" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="lower" name="BB Inferior" stroke="var(--vwap)" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                    {session?.vwap && session.vwap > 0 && (
                      <ReferenceLine y={session.vwap} stroke="var(--accent)" strokeDasharray="4 2" />
                    )}
                    {volumeProfile?.poc && volumeProfile.poc > 0 && (
                      <ReferenceLine y={volumeProfile.poc} stroke="var(--poc)" strokeDasharray="4 4" />
                    )}
                    <Line type="monotone" dataKey="close" name="Precio Cierre" stroke="var(--text-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 2: Aggressive Buy vs Sell Bars + CVD Line */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-muted pb-2.5">
              <div className="flex items-center gap-2">
                <Activity size={15} className="text-buy" />
                <div>
                  <h2 className="text-[14.5px] font-semibold text-text-primary">
                    Flujo Agresivo (Compras vs Ventas) y CVD en Tiempo Real
                  </h2>
                  <p className="text-[11.5px] text-text-secondary">
                    Barras de presión compradora/vendedora + curva acumulada de Delta (CVD)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 font-mono text-[10.5px] text-text-muted">
                <span className="text-buy">■ Compras</span>
                <span className="text-sell">■ Ventas</span>
                <span className="text-accent">● CVD</span>
              </div>
            </div>

            <div className="h-[260px] w-full">
              {flowChartData.length < 2 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  Esperando ejecuciones en tiempo real de OKX para graficar el Delta y CVD…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
                  <ComposedChart data={flowChartData} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} stackOffset="sign">
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      minTickGap={30}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "var(--border-muted)" }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="vol"
                      width={48}
                      tickFormatter={(v: number) => formatCompact(Math.abs(v))}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="cvd"
                      orientation="right"
                      width={52}
                      tickFormatter={(v: number) => formatCompact(v)}
                      tick={{ fill: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <ReferenceLine yAxisId="vol" y={0} stroke="var(--border)" />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-panel-alt)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                      }}
                    />
                    <Bar yAxisId="vol" dataKey="buyVolume" name="Compras" stackId="flow" fill="var(--buy)" isAnimationActive={false} />
                    <Bar yAxisId="vol" dataKey="sellVolume" name="Ventas" stackId="flow" fill="var(--sell)" isAnimationActive={false} />
                    <Line yAxisId="cvd" type="monotone" dataKey="cvd" name="CVD Acumulado" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>

        {/* Chart Grid Row 2: VAP HVN Distribution + Book Depth / OBI */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* Chart 3: Volume-at-Price + HVN Nodes */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-muted pb-2.5">
              <div className="flex items-center gap-2">
                <Layers size={15} className="text-poc" />
                <div>
                  <h2 className="text-[14.5px] font-semibold text-text-primary">
                    Distribución Volume-at-Price (VAP) y Nodos HVN / POC
                  </h2>
                  <p className="text-[11.5px] text-text-secondary">
                    Niveles de precio con mayor concentración de volumen ejecutado en la sesión
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 font-mono text-[10.5px] text-text-muted">
                <span className="text-poc">■ POC</span>
                <span className="text-accent">■ Nodo HVN</span>
                <span className="text-buy">■ Value Area</span>
              </div>
            </div>

            <div className="h-[260px] w-full">
              {vapChartData.length < 2 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  Acumulando niveles de Volume-at-Price…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
                  <BarChart data={vapChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="priceLabel"
                      minTickGap={22}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "var(--border-muted)" }}
                      tickLine={false}
                    />
                    <YAxis
                      width={50}
                      tickFormatter={(v: number) => formatCompact(v)}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-panel-alt)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                      }}
                    />
                    <Bar dataKey="totalVolume" name="Volumen Total" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {vapChartData.map((entry) => (
                        <Cell
                          key={entry.price}
                          fill={
                            entry.isPOC
                              ? "var(--poc)"
                              : entry.isHVN
                                ? "var(--accent)"
                                : entry.inVA
                                  ? "var(--buy)"
                                  : "var(--neutral)"
                          }
                          fillOpacity={entry.isPOC || entry.isHVN ? 0.95 : entry.inVA ? 0.65 : 0.4}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 4: Interactive Liquidity Depth / OBI Rolling */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-muted pb-2.5">
              <div className="flex items-center gap-2">
                <Scale size={15} className="text-accent" />
                <div>
                  <h2 className="text-[14.5px] font-semibold text-text-primary">
                    {liquidityTab === "depth"
                      ? "Curva Acumulada del Libro (Bid / Ask Depth)"
                      : "Desequilibrio del Libro (OBI 30m Rolling)"}
                  </h2>
                  <p className="text-[11.5px] text-text-secondary">
                    {liquidityTab === "depth"
                      ? "Liquidez descansando a cada lado del spread en tiempo real"
                      : "Media móvil de 30 minutos de OBI junto al spot instantáneo"}
                  </p>
                </div>
              </div>
              <Segmented
                size="xs"
                value={liquidityTab}
                onChange={setLiquidityTab}
                options={[
                  { value: "depth", label: "Profundidad" },
                  { value: "obi", label: "OBI 30m" },
                ]}
                ariaLabel="Vista de liquidez"
              />
            </div>

            <div className="h-[260px] w-full">
              {liquidityTab === "depth" ? (
                depthCurveData.length < 2 ? (
                  <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                    Esperando libro de órdenes L2…
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
                    <AreaChart data={depthCurveData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="priceLabel"
                        minTickGap={26}
                        tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                        axisLine={{ stroke: "var(--border-muted)" }}
                        tickLine={false}
                      />
                      <YAxis
                        width={52}
                        tickFormatter={(v: number) => formatCompact(v)}
                        tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--bg-panel-alt)",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: "11px",
                        }}
                      />
                      <Area type="stepAfter" dataKey="bidDepth" name="Bids Acumulados" stroke="var(--buy)" fill="var(--buy)" fillOpacity={0.22} connectNulls={false} isAnimationActive={false} />
                      <Area type="stepBefore" dataKey="askDepth" name="Asks Acumulados" stroke="var(--sell)" fill="var(--sell)" fillOpacity={0.22} connectNulls={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )
              ) : obiPoints.length < 2 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  Recolectando muestras de 1s para el OBI 30m…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={210}>
                  <ComposedChart data={obiPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      minTickGap={28}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "var(--border-muted)" }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[-1, 1]}
                      width={46}
                      tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-panel-alt)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                      }}
                    />
                    <Area type="monotone" dataKey="rollingObi" name="OBI 30m Media" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.18} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="obi" name="OBI Spot" stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="2 2" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>

        {/* Chart Grid Row 3: Volume Z-Score + Open Interest / Realized Vol */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2 pb-4">
          {/* Volume Z-Score Chart */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex items-baseline justify-between border-b border-border-muted pb-2.5">
              <div>
                <h2 className="text-[14.5px] font-semibold text-text-primary">
                  Anomalía de Participación (Volume Z-Score)
                </h2>
                <p className="text-[11.5px] text-text-secondary">
                  Desviaciones estándar (σ) del volumen actual frente a la media móvil de 20 ventanas
                </p>
              </div>
              <span className="font-mono text-[11px] text-warn">Umbral alerta ≥ +2σ</span>
            </div>

            <div className="h-[220px] w-full">
              {flowChartData.length < 4 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  Calculando línea base de volumen…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
                  <BarChart data={flowChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      minTickGap={30}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "var(--border-muted)" }}
                      tickLine={false}
                    />
                    <YAxis
                      width={42}
                      tickFormatter={(v: number) => `${v.toFixed(1)}σ`}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <ReferenceLine y={2} stroke="var(--warn)" strokeDasharray="3 3" />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-panel-alt)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                      }}
                    />
                    <Bar dataKey="zScore" name="Volume Z-Score (σ)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {flowChartData.map((pt) => (
                        <Cell
                          key={pt.time}
                          fill={pt.zScore >= 3 ? "var(--accent)" : pt.zScore >= 2 ? "var(--warn)" : "var(--buy)"}
                          fillOpacity={pt.zScore >= 2 ? 0.9 : 0.55}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Open Interest (Perps) or Realized Volatility (Spot/FX) */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex items-baseline justify-between border-b border-border-muted pb-2.5">
              <div>
                <h2 className="text-[14.5px] font-semibold text-text-primary">
                  {marketType === "perpetual"
                    ? "Open Interest vs Precio (Perpetuos OKX)"
                    : "Volatilidad Realizada Dinámica (%)"}
                </h2>
                <p className="text-[11.5px] text-text-secondary">
                  {marketType === "perpetual"
                    ? "Contratos abiertos en tiempo real frente al movimiento del precio"
                    : "Volatilidad anualizada móvil calculada sobre retornos logarítmicos en vivo"}
                </p>
              </div>
            </div>

            <div className="h-[220px] w-full">
              {marketType === "perpetual" ? (
                oiChartData.length < 2 ? (
                  <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                    Recolectando muestras de Open Interest…
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
                    <ComposedChart data={oiChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        minTickGap={28}
                        tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                        axisLine={{ stroke: "var(--border-muted)" }}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="oi"
                        domain={["auto", "auto"]}
                        width={54}
                        tickFormatter={(v: number) => formatCompact(v, 2)}
                        tick={{ fill: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="px"
                        orientation="right"
                        domain={["auto", "auto"]}
                        width={62}
                        tickFormatter={(v: number) => formatPriceValue(v, decimals)}
                        tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--bg-panel-alt)",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: "11px",
                        }}
                      />
                      <Area yAxisId="oi" type="monotone" dataKey="openInterest" name="Open Interest" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.18} dot={false} isAnimationActive={false} />
                      <Line yAxisId="px" type="monotone" dataKey="price" name="Precio" stroke="var(--text-primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )
              ) : flowChartData.filter((d) => d.rv !== null).length < 2 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                  Acumulando retornos para calcular volatilidad realizada…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
                  <AreaChart data={flowChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      minTickGap={28}
                      tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={{ stroke: "var(--border-muted)" }}
                      tickLine={false}
                    />
                    <YAxis
                      width={48}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                      tick={{ fill: "var(--warn)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-panel-alt)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                      }}
                    />
                    <Area type="monotone" dataKey="rv" name="Volatilidad Realizada (%)" stroke="var(--warn)" fill="var(--warn)" fillOpacity={0.2} dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
