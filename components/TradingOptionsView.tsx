"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import MarketSubpageHeader from "@/components/MarketSubpageHeader";
import TradeOperationChart from "@/components/TradeOperationChart";
import { DialogShell } from "@/components/ui/Primitives";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useUIStore } from "@/lib/store/uiStore";
import { useTimeframeKlines } from "@/hooks/useTimeframeKlines";
import { analyzeHighVolumeNodes } from "@/lib/engine/orderFlowEngine";
import {
  DEFAULT_ACCOUNT_EQUITY_USD,
  DEFAULT_RISK_PCT,
  MAX_RISK_PCT,
  MIN_RISK_PCT,
  evaluateTradingOptions,
  type TradeSetupOption,
} from "@/lib/engine/tradingOptions";
import { formatCompact, formatPriceValue, priceDecimals } from "@/lib/format";
import {
  ArrowDownRight,
  ArrowUpRight,
  LineChart,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  TrendingUp,
  X,
} from "lucide-react";

const RISK_PRESETS = [1, 2, 2.5, 3, 5] as const;

function TradeOptionCard({
  option,
  selected,
  onSelect,
  onOpenChart,
  decimals,
  baseSymbol,
}: {
  option: TradeSetupOption;
  selected: boolean;
  onSelect: () => void;
  onOpenChart: () => void;
  decimals: number;
  baseSymbol: string;
}) {
  const isLong = option.direction === "long";
  const dirColor = isLong ? "var(--buy)" : "var(--sell)";

  return (
    <article
      onClick={onSelect}
      className={`flex cursor-pointer flex-col gap-3.5 rounded-[var(--radius-card)] border bg-bg-panel p-4 transition-colors ${
        selected ? "border-accent bg-bg-panel-alt/50" : "border-border hover:border-text-muted"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border-muted pb-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-muted">
            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: dirColor }}>
              {isLong ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {isLong ? "LONG" : "SHORT"}
            </span>
            <span>·</span>
            <span>Confianza {option.confidence} ({option.score}/100)</span>
          </div>
          <h2 className="mt-1 text-[15px] font-bold tracking-tight text-text-primary">{option.title}</h2>
          <p className="text-[12px] text-text-secondary">{option.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChart();
          }}
          className={`ui-button chip whitespace-nowrap shrink-0 ${selected ? "is-primary" : ""}`}
          title="Abrir gráfico en tiempo real mostrando Entrada, Stop Loss, TP1 y TP2"
        >
          <LineChart size={13} />
          <span>{selected ? "Proyectado en gráfico" : "Ver en gráfico"}</span>
        </button>
      </div>

      {/* Primary Required Fields: Entrada, TP1, TP2, Stop Loss */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-[var(--radius)] border border-border bg-bg-surface p-2.5">
          <div className="text-[11px] font-medium text-text-muted">Entrada</div>
          <div className="mt-0.5 font-mono text-[15px] font-bold tabular-nums text-text-primary">
            {formatPriceValue(option.entry, decimals)}
          </div>
          <div className="mt-0.5 text-[10.5px] text-text-muted">{option.entryLabel}</div>
        </div>

        <div className="rounded-[var(--radius)] border border-border bg-bg-surface p-2.5">
          <div className="text-[11px] font-medium text-text-muted">Take Profit 1</div>
          <div className="mt-0.5 font-mono text-[15px] font-bold tabular-nums text-buy">
            {formatPriceValue(option.tp1, decimals)}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-buy">
            {option.rr1.toFixed(2)}R · +${formatCompact(option.rewardTp1Usd, 1)}
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-border bg-bg-surface p-2.5">
          <div className="text-[11px] font-medium text-text-muted">Take Profit 2</div>
          <div className="mt-0.5 font-mono text-[15px] font-bold tabular-nums text-buy">
            {formatPriceValue(option.tp2, decimals)}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-buy">
            {option.rr2.toFixed(2)}R · +${formatCompact(option.rewardTp2Usd, 1)}
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-border bg-bg-surface p-2.5">
          <div className="text-[11px] font-medium text-text-muted">Stop Loss (ATR+BB)</div>
          <div className="mt-0.5 font-mono text-[15px] font-bold tabular-nums text-sell">
            {formatPriceValue(option.stopLoss, decimals)}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-sell">
            -{option.stopDistancePct.toFixed(2)}% · -${formatCompact(option.riskUsd, 1)}
          </div>
        </div>
      </div>

      {/* Risk & Position Sizing Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border-muted bg-bg-surface/70 px-3 py-2 font-mono text-[11.5px] tabular-nums">
        <div className="flex items-center gap-2 text-text-secondary">
          <ShieldAlert size={13} className="text-warn" />
          <span>
            Riesgo configurado: <strong className="text-text-primary">{option.riskPct.toFixed(1)}%</strong> (${option.riskUsd.toFixed(2)})
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-text-secondary">
          <span>
            Tamaño: <strong className="text-text-primary">{option.positionUnits.toFixed(option.entry >= 100 ? 4 : 2)} {baseSymbol}</strong>
          </span>
          <span>·</span>
          <span>
            Nocional: <strong className="text-text-primary">${formatCompact(option.positionNotionalUsd, 2)}</strong>
          </span>
        </div>
      </div>

      {/* Rationale bullets */}
      <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-text-secondary">
        {option.rationale.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dirColor }} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function TradingOptionsView() {
  const symbol = useSessionStore((s) => s.symbol);
  const marketType = useSessionStore((s) => s.marketType);
  const timeframe = useSessionStore((s) => s.timeframe);
  const tickSize = useSessionStore((s) => s.tickSize);
  const ticker = useSessionStore((s) => s.ticker);
  const session = useSessionStore((s) => s.session);
  const volumeProfile = useSessionStore((s) => s.volumeProfile);
  const orderBook = useSessionStore((s) => s.orderBook);
  const aggregatedBook = useSessionStore((s) => s.aggregatedBook);
  const currentOBI = useSessionStore((s) => s.currentOBI);
  const flowBars = useSessionStore((s) => s.flowBars);
  const liveBar = useSessionStore((s) => s.liveBar);
  const derivatives = useSessionStore((s) => s.derivatives);
  const hvnThreshold = useUIStore((s) => s.indicators.hvnThreshold);

  const [riskPct, setRiskPct] = useState<number>(DEFAULT_RISK_PCT);
  const [accountBalanceUsd, setAccountBalanceUsd] = useState<number>(DEFAULT_ACCOUNT_EQUITY_USD);
  const [selectedOptionId, setSelectedOptionId] = useState<TradeSetupOption["id"]>("primary-bias");
  const [chartModalOpen, setChartModalOpen] = useState(false);

  const { bars, status } = useTimeframeKlines(120);

  const activeBook = aggregatedBook ?? orderBook;
  const livePrice = ticker?.price ?? session?.last ?? liveBar?.close ?? bars[bars.length - 1]?.close ?? 0;
  const decimals = priceDecimals(tickSize, livePrice);
  const baseSymbol = marketType === "forex" ? symbol.split("/")[0] : symbol.replace(/USDT?$|USDC$/, "");

  const hvnAnalysis = useMemo(
    () => (volumeProfile ? analyzeHighVolumeNodes(volumeProfile, hvnThreshold, tickSize) : null),
    [volumeProfile, hvnThreshold, tickSize]
  );

  const mergedFlow = useMemo(
    () => (liveBar ? [...flowBars, liveBar] : flowBars),
    [flowBars, liveBar]
  );

  const analysis = useMemo(
    () =>
      evaluateTradingOptions({
        symbol,
        marketType,
        timeframe,
        currentPrice: livePrice,
        tickSize,
        bars,
        session,
        volumeProfile,
        hvnAnalysis,
        currentOBI,
        flowBars: mergedFlow,
        derivatives,
        riskPct,
        accountBalanceUsd,
      }),
    [
      symbol,
      marketType,
      timeframe,
      livePrice,
      tickSize,
      bars,
      session,
      volumeProfile,
      hvnAnalysis,
      currentOBI,
      mergedFlow,
      derivatives,
      riskPct,
      accountBalanceUsd,
    ]
  );

  const activeOption =
    analysis.options.find((o) => o.id === selectedOptionId) ?? analysis.options[0] ?? null;

  const biasText =
    analysis.overallBias === "long"
      ? "Sesgo Alcista (Long)"
      : analysis.overallBias === "short"
        ? "Sesgo Bajista (Short)"
        : "Equilibrio / Neutral";
  const biasColor =
    analysis.overallBias === "long"
      ? "var(--buy)"
      : analysis.overallBias === "short"
        ? "var(--sell)"
        : "var(--warn)";

  const openProjectedChart = (optionId: TradeSetupOption["id"]) => {
    setSelectedOptionId(optionId);
    setChartModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-bg-base text-text-primary flex flex-col">
      <MarketSubpageHeader />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-5 px-4 py-5 md:px-6">
        {/* Page Heading + Live Context Strip */}
        <section className="flex flex-col gap-4 border-b border-border-muted pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-muted">
              <Target size={13} className="text-accent" />
              <span>Opciones de Trading en Tiempo Real</span>
              <span>·</span>
              <span>{marketType === "forex" ? symbol : `${baseSymbol}/USDT`}</span>
              <span>·</span>
              <span>Temporalidad {timeframe}</span>
              <span>·</span>
              <span>{analysis.candleCount} velas analizadas</span>
            </div>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-tight text-text-primary sm:text-[25px]">
              Motor de Operaciones por Volatilidad (ATR + Bollinger) y Order Flow
            </h1>
            <p className="mt-1 text-[13px] text-text-secondary">
              Calcula niveles de <strong>Entrada</strong>, <strong>Take Profit 1 y 2</strong>, y <strong>Stop Loss dinámico</strong> calibrado según el ATR(14) y las Bandas de Bollinger (20, 2σ) del activo y temporalidad seleccionados, ajustado a tu porcentaje de riesgo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-bg-panel px-3.5 py-2.5 font-mono tabular-nums">
            <div>
              <div className="text-[10.5px] uppercase text-text-muted">Precio vivo</div>
              <div className="text-[16px] font-bold text-text-primary">
                {livePrice > 0 ? formatPriceValue(livePrice, decimals) : "—"}
              </div>
            </div>
            <div className="h-7 w-px bg-border-muted" />
            <div>
              <div className="text-[10.5px] uppercase text-text-muted">Confluencia</div>
              <div className="text-[14px] font-semibold" style={{ color: biasColor }}>
                {biasText} ({analysis.confluenceScore >= 0 ? "+" : ""}{analysis.confluenceScore})
              </div>
            </div>
          </div>
        </section>

        {/* Risk Configuration & Volatility Formula Bar */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* Adjustable Risk Panel (Default 2.5%, inside 2-3%) */}
          <div className="flex flex-col justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={15} className="text-accent" />
                <h2 className="text-[14px] font-semibold text-text-primary">
                  Gestión de Riesgo Ajustable (Inicial 2–3%)
                </h2>
              </div>
              <span className="font-mono text-[13px] font-bold tabular-nums text-accent">
                {riskPct.toFixed(1)}% por operación
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                type="range"
                min={MIN_RISK_PCT}
                max={MAX_RISK_PCT}
                step={0.5}
                value={riskPct}
                onChange={(e) => setRiskPct(Number(e.target.value))}
                aria-label="Porcentaje de riesgo por operación"
                className="h-2 flex-1 min-w-[160px] cursor-pointer accent-[var(--accent)]"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {RISK_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRiskPct(preset)}
                    className={`ui-button chip font-mono tabular-nums ${
                      Math.abs(riskPct - preset) < 0.05 ? "is-primary" : ""
                    }`}
                  >
                    {preset}%
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-muted pt-3 text-[12px]">
              <label className="flex items-center gap-2 text-text-secondary">
                <span>Capital de referencia (USD):</span>
                <input
                  type="number"
                  min={100}
                  step={500}
                  value={accountBalanceUsd}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) setAccountBalanceUsd(next);
                  }}
                  aria-label="Capital de cuenta en USD"
                  className="w-28 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-2.5 py-1 font-mono text-[12.5px] font-semibold tabular-nums text-text-primary outline-none focus:border-accent"
                />
              </label>
              <span className="font-mono tabular-nums text-text-secondary">
                Pérdida máxima al Stop Loss:{" "}
                <strong className="text-sell">
                  ${((accountBalanceUsd * riskPct) / 100).toFixed(2)}
                </strong>
              </span>
            </div>
          </div>

          {/* ATR + Bollinger Stop-Loss Calibration Card */}
          <div className="flex flex-col justify-between gap-2.5 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-warn" />
                <h2 className="text-[14px] font-semibold text-text-primary">
                  Cálculo Stop Loss: ATR(14) + Bandas de Bollinger
                </h2>
              </div>
              <span className="font-mono text-[11px] uppercase text-text-muted">
                {analysis.volatility?.bollinger.regime === "squeeze"
                  ? "Squeeze"
                  : analysis.volatility?.bollinger.regime === "expansion"
                    ? "Expansión"
                    : "Normal"}
              </span>
            </div>

            {analysis.volatility ? (
              <>
                <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
                  <div className="rounded-[var(--radius-sm)] border border-border-muted bg-bg-surface p-2">
                    <div className="text-[10.5px] text-text-muted">ATR(14) × 1.5</div>
                    <div className="text-[13px] font-semibold text-text-primary">
                      {formatPriceValue(analysis.volatility.atrComponent, decimals)}
                    </div>
                    <div className="text-[10.5px] text-text-muted">
                      ATR = {analysis.volatility.atrPct.toFixed(2)}%
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] border border-border-muted bg-bg-surface p-2">
                    <div className="text-[10.5px] text-text-muted">Bollinger 1.5σ</div>
                    <div className="text-[13px] font-semibold text-vwap">
                      {formatPriceValue(analysis.volatility.bbComponent, decimals)}
                    </div>
                    <div className="text-[10.5px] text-text-muted">
                      Ancho {analysis.volatility.bollinger.bandwidthPct.toFixed(2)}%
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] border border-border-muted bg-bg-surface p-2">
                    <div className="text-[10.5px] text-text-muted">Distancia SL Base</div>
                    <div className="text-[13px] font-bold text-sell">
                      ±{formatPriceValue(analysis.volatility.stopDistance, decimals)}
                    </div>
                    <div className="text-[10.5px] text-sell">
                      ±{analysis.volatility.stopDistancePct.toFixed(2)}%
                    </div>
                  </div>
                </div>
                <p className="text-[11.5px] text-text-muted">
                  Fórmula activa: 60% × (1.5 × ATR 14) + 40% × (1.5σ Bollinger), protegido por encima de 1.15× la mayor dispersión de volatilidad en {timeframe}.
                </p>
              </>
            ) : (
              <div className="py-4 text-[12.5px] text-text-muted">
                {status === "loading"
                  ? `Cargando velas OKX de ${timeframe} para calibrar ATR y Bandas de Bollinger…`
                  : "Esperando flujo de velas suficiente para calcular ATR(14) y Bandas de Bollinger…"}
              </div>
            )}
          </div>
        </section>

        {/* Generated Trade Options Cards */}
        {analysis.options.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label="Opciones de operación sugeridas">
            {analysis.options.map((option) => (
              <TradeOptionCard
                key={option.id}
                option={option}
                selected={activeOption?.id === option.id}
                onSelect={() => setSelectedOptionId(option.id)}
                onOpenChart={() => openProjectedChart(option.id)}
                decimals={decimals}
                baseSymbol={baseSymbol}
              />
            ))}
          </section>
        ) : (
          <section className="rounded-[var(--radius-card)] border border-border bg-bg-panel p-8 text-center">
            <p className="text-[13.5px] text-text-secondary">
              Recopilando histórico OKX y ticks en tiempo real para {symbol} ({timeframe})…
            </p>
            <p className="mt-1 text-[12px] text-text-muted">
              En cuanto haya al menos 2 velas activas se mostrarán las opciones de Entrada, TP1, TP2 y Stop Loss.
            </p>
          </section>
        )}

        {/* Inline Interactive Chart: Price + Bollinger Bands + Active Trade Levels */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-text-primary">
                  Mapa Visual en Vivo: Operación Proyectada y Bandas de Bollinger
                </h2>
                <p className="text-[12px] text-text-secondary">
                  Proyección en tiempo real de Entrada, Stop Loss, TP1 y TP2 sobre {timeframe} y ticks 1s
                </p>
              </div>
            </div>

            <TradeOperationChart
              symbol={symbol}
              baseSymbol={baseSymbol}
              marketType={marketType}
              timeframe={timeframe}
              decimals={decimals}
              tickSize={tickSize}
              livePrice={livePrice}
              vwap={session?.vwap}
              bollingerSeries={analysis.bollingerSeries}
              flowBars={flowBars}
              liveBar={liveBar}
              orderBook={activeBook}
              activeOption={activeOption}
              height={320}
              onExpand={() => setChartModalOpen(true)}
            />
          </div>

          {/* Live App Parameter Diagnostics */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-panel p-4">
            <div className="flex items-center justify-between border-b border-border-muted pb-2.5">
              <h2 className="text-[15px] font-semibold text-text-primary">
                Parámetros Técnicos de la App
              </h2>
              <Link href="/interactive-charts" className="text-[11.5px] font-medium text-accent hover:underline">
                Ver en gráficos →
              </Link>
            </div>

            <div className="flex flex-col divide-y divide-border-muted">
              {analysis.signals.map((sig) => {
                const badgeColor =
                  sig.bias === "bullish"
                    ? "var(--buy)"
                    : sig.bias === "bearish"
                      ? "var(--sell)"
                      : "var(--text-muted)";
                return (
                  <div key={sig.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-semibold text-text-primary">{sig.label}</span>
                      <span
                        className="font-mono text-[11.5px] font-semibold tabular-nums"
                        style={{ color: badgeColor }}
                      >
                        {sig.value}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-text-secondary">{sig.detail}</p>
                  </div>
                );
              })}
              {analysis.signals.length === 0 && (
                <p className="py-6 text-center text-[12px] text-text-muted">
                  Esperando métricas activas de la sesión…
                </p>
              )}
            </div>
          </div>
        </section>

        <p className="text-[11px] text-text-muted pb-3">
          Nota operativa: Los niveles mostrados combinan indicadores técnicos y de flujo de órdenes en tiempo real (ATR 14, Bandas de Bollinger 20/2σ, VWAP, OBI, Delta y VAP). Úsalos como referencia analítica junto a tu propia gestión del riesgo.
        </p>
      </main>

      {/* Interactive Modal opened when clicking "Proyectado en gráfico" / "Ver en gráfico" */}
      <DialogShell
        open={chartModalOpen}
        onOpenChange={setChartModalOpen}
        title="Gráfico en Tiempo Real de la Operación"
        description="Proyección interactiva en vivo de Entrada, Take Profit 1, Take Profit 2 y Stop Loss calibrado con ATR y Bandas de Bollinger"
      >
        <div className="flex w-[min(1060px,calc(100vw-24px))] max-h-[90vh] flex-col gap-4 overflow-y-auto rounded-[var(--radius-card)] border border-border bg-bg-panel p-4 sm:p-5 shadow-2xl">
          {/* Modal Top Header */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-muted pb-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-muted">
                <span
                  className="inline-flex items-center gap-1 font-bold"
                  style={{
                    color: activeOption?.direction === "short" ? "var(--sell)" : "var(--buy)",
                  }}
                >
                  {activeOption?.direction === "short" ? (
                    <ArrowDownRight size={13} />
                  ) : (
                    <ArrowUpRight size={13} />
                  )}
                  {activeOption?.direction === "short" ? "SHORT" : "LONG"}
                </span>
                <span>·</span>
                <span>{marketType === "forex" ? symbol : `${baseSymbol}/USDT`}</span>
                <span>·</span>
                <span>Temporalidad {timeframe}</span>
              </div>
              <h2 className="mt-1 text-[17px] font-bold tracking-tight text-text-primary">
                {activeOption?.title ?? "Proyección en Tiempo Real de la Operación"}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {analysis.options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedOptionId(opt.id)}
                  className={`ui-button chip ${activeOption?.id === opt.id ? "is-primary" : ""}`}
                >
                  {opt.id === "primary-bias" ? "Principal" : "Estructural"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setChartModalOpen(false)}
                aria-label="Cerrar gráfico de operación"
                className="ui-button icon-only"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Live Operation Parameters Summary inside Modal */}
          {activeOption && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 font-mono tabular-nums">
              <div className="rounded-[var(--radius)] border border-border bg-bg-surface px-3 py-2">
                <div className="text-[10.5px] font-sans text-text-muted">Precio Vivo</div>
                <div className="mt-0.5 text-[14px] font-bold text-text-primary">
                  {livePrice > 0 ? formatPriceValue(livePrice, decimals) : "—"}
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-surface px-3 py-2">
                <div className="text-[10.5px] font-sans text-text-muted">Entrada</div>
                <div className="mt-0.5 text-[14px] font-bold text-accent">
                  {formatPriceValue(activeOption.entry, decimals)}
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-surface px-3 py-2">
                <div className="text-[10.5px] font-sans text-text-muted">Stop Loss</div>
                <div className="mt-0.5 text-[14px] font-bold text-sell">
                  {formatPriceValue(activeOption.stopLoss, decimals)}
                </div>
                <div className="text-[10px] text-sell">
                  -${formatCompact(activeOption.riskUsd, 1)} ({activeOption.riskPct.toFixed(1)}%)
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-surface px-3 py-2">
                <div className="text-[10.5px] font-sans text-text-muted">Take Profit 1</div>
                <div className="mt-0.5 text-[14px] font-bold text-buy">
                  {formatPriceValue(activeOption.tp1, decimals)}
                </div>
                <div className="text-[10px] text-buy">
                  {activeOption.rr1.toFixed(2)}R · +${formatCompact(activeOption.rewardTp1Usd, 1)}
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-surface px-3 py-2">
                <div className="text-[10.5px] font-sans text-text-muted">Take Profit 2</div>
                <div className="mt-0.5 text-[14px] font-bold text-buy">
                  {formatPriceValue(activeOption.tp2, decimals)}
                </div>
                <div className="text-[10px] text-buy">
                  {activeOption.rr2.toFixed(2)}R · +${formatCompact(activeOption.rewardTp2Usd, 1)}
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-surface px-3 py-2">
                <div className="text-[10.5px] font-sans text-text-muted">Tamaño Posición</div>
                <div className="mt-0.5 text-[14px] font-bold text-text-primary">
                  {activeOption.positionUnits.toFixed(activeOption.entry >= 100 ? 4 : 2)} {baseSymbol}
                </div>
                <div className="text-[10px] text-text-muted">
                  ${formatCompact(activeOption.positionNotionalUsd, 2)}
                </div>
              </div>
            </div>
          )}

          {/* Full Real-Time Trade Operation Chart */}
          <TradeOperationChart
            symbol={symbol}
            baseSymbol={baseSymbol}
            marketType={marketType}
            timeframe={timeframe}
            decimals={decimals}
            tickSize={tickSize}
            livePrice={livePrice}
            vwap={session?.vwap}
            bollingerSeries={analysis.bollingerSeries}
            flowBars={flowBars}
            liveBar={liveBar}
            orderBook={activeBook}
            activeOption={activeOption}
            height={380}
          />

          {/* Quick Risk Control inside Modal */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-muted pt-3 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text-secondary">Ajustar riesgo rápido:</span>
              {([2, 2.5, 3] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRiskPct(preset)}
                  className={`ui-button chip font-mono tabular-nums ${
                    Math.abs(riskPct - preset) < 0.05 ? "is-primary" : ""
                  }`}
                >
                  {preset}%
                </button>
              ))}
            </div>
            <span className="text-text-muted">
              Alterna entre <strong>Velas + BB ({timeframe})</strong> y <strong>Tick a Tick (1s Vivo)</strong> para seguir cada ejecución en tiempo real.
            </span>
          </div>
        </div>
      </DialogShell>
    </div>
  );
}
