// ============================================================
// INTERNAL SCREENER SERVICE
// Self-contained backend order-flow screener running directly inside
// the Next.js server process — zero dependency on external screener services.
//
// Responsibilities:
//   1. Discovers top live OKX USDT perpetuals and connects over WebSocket v5.
//   2. Streams live trades, open interest, funding, and liquidations into
//      ScreenerCore / SymbolTracker to compute Volume-at-Price (POC, VAH, VAL),
//      Bid/Ask & stacked imbalances, Volume Z-Scores, delta share, OI regime,
//      and setup scores across all tracked symbols.
//   3. Publishes scan snapshots over SSE (/api/stream) and JSON (/api/screener)
//      and persists forward-test signal history via Store.
// ============================================================

import { ScreenerCore, type ScanResult, type ScreenerOptions } from "@/lib/screener/screenerCore";
import { SignalTracker, type TrackedSignal, type TrackerStats } from "@/lib/signals/tracker";
import type { DerivativesSnapshot, NormalizedLiquidation, NormalizedTrade } from "@/lib/types/market";
import { loadConfig, type ServerConfig } from "./config";
import { DemoFeed } from "./demoFeed";
import { Notifier } from "./notify";
import { loadSwaps, OkxFeed, type FeedHealth, type FeedSink, type SwapInfo } from "./okxFeed";
import { Store } from "./store";

export type ScreenerMode = "okx" | "demo" | "starting";

export type ScanListener = (scan: ScanResult) => void;

export interface ScreenerFeedHandle {
  start(): void;
  stop(): void;
  health(): FeedHealth;
}

export interface ScreenerServiceHealth {
  engine: "internal";
  uptimeSec: number;
  mode: ScreenerMode;
  feed: FeedHealth;
  notifications: boolean;
  lastScanAt: number | null;
  trackedSymbols: number;
}

export interface ScreenerServiceDeps {
  config?: ServerConfig;
  screenerOptions?: Partial<ScreenerOptions>;
  loadSwaps?: (limit: number, include?: string[], fetchImpl?: typeof fetch, categories?: string[]) => Promise<SwapInfo>;
  createFeed?: (mode: "okx" | "demo", swaps: SwapInfo, sink: FeedSink, log: (msg: string) => void) => ScreenerFeedHandle;
  store?: Pick<Store, "init" | "loadTracker" | "saveTracker" | "append"> | null;
  notifier?: Pick<Notifier, "enabled" | "notifySignal" | "notifyClosed">;
  log?: (message: string) => void;
  now?: () => number;
  disableTimers?: boolean;
}

const DEMO_SYMBOLS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "SUI", "LINK", "AVAX"].map(
  (s) => `${s}-USDT-SWAP`
);

export class InternalScreenerService {
  readonly config: ServerConfig;
  private readonly log: (message: string) => void;
  private readonly now: () => number;
  private readonly loadSwapsImpl: NonNullable<ScreenerServiceDeps["loadSwaps"]>;
  private readonly createFeedImpl: NonNullable<ScreenerServiceDeps["createFeed"]>;
  private readonly store: Pick<Store, "init" | "loadTracker" | "saveTracker" | "append"> | null;
  private readonly notifier: Pick<Notifier, "enabled" | "notifySignal" | "notifyClosed">;
  private readonly screenerOptions: Partial<ScreenerOptions>;
  private readonly disableTimers: boolean;

  private core: ScreenerCore | null = null;
  private trackerInstance = new SignalTracker();
  private feed: ScreenerFeedHandle | null = null;
  private trackedSymbols = new Set<string>();
  private mode: ScreenerMode = "starting";
  private latestScan: ScanResult | null = null;
  private listeners = new Set<ScanListener>();
  private startedAt = Date.now();
  private startPromise: Promise<void> | null = null;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private initialScanTimer: ReturnType<typeof setTimeout> | null = null;
  private earlyScanTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: ScreenerServiceDeps = {}) {
    this.config = deps.config ?? loadConfig();
    this.log = deps.log ?? ((message: string) => console.log(`[screener] ${new Date().toISOString()} ${message}`));
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
    this.loadSwapsImpl = deps.loadSwaps ?? loadSwaps;
    this.createFeedImpl =
      deps.createFeed ??
      ((mode, swaps, sink, log) =>
        mode === "demo" ? new DemoFeed(swaps.symbols, sink) : new OkxFeed(swaps, sink, log));
    this.store = deps.store !== undefined ? deps.store : new Store(this.config.dataDir);
    this.notifier =
      deps.notifier ??
      new Notifier(
        {
          telegramToken: this.config.telegramToken,
          telegramChatId: this.config.telegramChatId,
          webhookUrl: this.config.webhookUrl,
        },
        fetch,
        this.log
      );
    this.screenerOptions = deps.screenerOptions ?? {};
    this.disableTimers = deps.disableTimers ?? false;
  }

  get tracker(): SignalTracker {
    return this.trackerInstance;
  }

  get ready(): Promise<void> {
    return this.start();
  }

  start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.boot();
    }
    return this.startPromise;
  }

  private async boot(): Promise<void> {
    if (this.store) {
      try {
        await this.store.init();
        const loaded = await this.store.loadTracker();
        if (loaded.length > 0) {
          this.trackerInstance = SignalTracker.fromJSON(loaded);
        }
      } catch {
        // Ephemeral filesystem fallback — continue cleanly in memory.
      }
    }

    this.core = new ScreenerCore(
      {
        minScore: this.config.minScore,
        cooldownMs: this.config.cooldownMs,
        warmupMs: this.config.warmupMs,
        minVolume1mUsd: this.config.minVolume1mUsd,
        ...this.screenerOptions,
      },
      this.trackerInstance
    );

    const demoRequested = process.env.DEMO === "1";
    let swaps: SwapInfo | null = null;

    if (!demoRequested) {
      try {
        swaps = await this.loadSwapsImpl(
          this.config.symbolLimit,
          this.config.symbols,
          fetch,
          this.config.categories
        );
      } catch (err) {
        this.log(
          `OKX swap discovery failed (${err instanceof Error ? err.message : String(err)}), falling back to DEMO feed`
        );
      }
    }

    const useDemo = demoRequested || !swaps || swaps.symbols.length === 0;
    const resolvedSwaps: SwapInfo = useDemo
      ? { symbols: DEMO_SYMBOLS, contractValues: new Map() }
      : swaps!;

    this.trackedSymbols = new Set(resolvedSwaps.symbols);
    const sink: FeedSink = {
      trade: (trade) => this.ingestTrade(trade),
      liquidation: (liquidation) => this.ingestLiquidation(liquidation),
      derivatives: (symbol, snapshot) => this.ingestDerivatives(symbol, snapshot),
    };

    if (useDemo) {
      this.mode = "demo";
      this.log("DEMO mode active: synthetic data, not real prices");
      this.feed = this.createFeedImpl("demo", resolvedSwaps, sink, this.log);
    } else {
      this.mode = "okx";
      this.log(`Tracking ${resolvedSwaps.symbols.length} OKX perpetuals in internal screener service`);
      this.feed = this.createFeedImpl("okx", resolvedSwaps, sink, this.log);
    }

    this.feed.start();

    if (!this.disableTimers) {
      this.initialScanTimer = setTimeout(() => {
        this.scanNow();
      }, 150);
      this.scanTimer = setInterval(() => {
        this.scanNow();
      }, this.config.scanIntervalMs);
      this.persistTimer = setInterval(() => {
        this.trackerInstance.prune();
        if (this.store) {
          void this.store.saveTracker(this.trackerInstance.toJSON()).catch(() => undefined);
        }
      }, 60_000);
    }
  }

  ingestTrade(trade: NormalizedTrade): void {
    this.core?.onTrade(trade);
    if (
      !this.disableTimers &&
      !this.earlyScanTimer &&
      (!this.latestScan || this.latestScan.rows.length === 0)
    ) {
      this.earlyScanTimer = setTimeout(() => {
        this.earlyScanTimer = null;
        this.scanNow();
      }, 350);
    }
  }

  ingestLiquidation(liquidation: NormalizedLiquidation): void {
    if (!this.trackedSymbols.has(liquidation.symbol)) return;
    this.core?.onLiquidation(liquidation);
  }

  ingestDerivatives(symbol: string, snapshot: DerivativesSnapshot): void {
    if (!this.trackedSymbols.has(symbol)) return;
    this.core?.onDerivatives(symbol, snapshot);
  }

  scanNow(timestamp = this.now()): ScanResult {
    if (!this.core) {
      return { time: timestamp, rows: [], newSignals: [], closed: [] };
    }
    const scan = this.core.scan(timestamp);
    this.latestScan = scan;
    for (const listener of this.listeners) {
      try {
        listener(scan);
      } catch {
        // Ignore disconnected SSE listeners.
      }
    }
    for (const signal of scan.newSignals) {
      if (this.store) {
        void this.store.append({ type: "signal", at: scan.time, signal }).catch(() => undefined);
      }
      this.notifier.notifySignal(signal);
    }
    for (const closed of scan.closed) {
      if (this.store) {
        void this.store.append({ type: "closed", at: scan.time, tracked: closed }).catch(() => undefined);
      }
      this.notifier.notifyClosed(closed);
    }
    return scan;
  }

  latest(): ScanResult | null {
    return this.latestScan;
  }

  recentSignals(limit = 50): TrackedSignal[] {
    return this.trackerInstance.recent(limit);
  }

  stats(): TrackerStats {
    return this.trackerInstance.stats();
  }

  health(): ScreenerServiceHealth {
    return {
      engine: "internal",
      uptimeSec: Math.round((this.now() - this.startedAt) / 1000),
      mode: this.mode,
      feed: this.feed?.health() ?? {
        connected: false,
        lastMessageAt: null,
        reconnects: 0,
        symbols: this.trackedSymbols.size,
      },
      notifications: this.notifier.enabled,
      lastScanAt: this.latestScan?.time ?? null,
      trackedSymbols: this.trackedSymbols.size,
    };
  }

  subscribe(listener: ScanListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async stop(): Promise<void> {
    if (this.initialScanTimer) {
      clearTimeout(this.initialScanTimer);
      this.initialScanTimer = null;
    }
    if (this.earlyScanTimer) {
      clearTimeout(this.earlyScanTimer);
      this.earlyScanTimer = null;
    }
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    this.feed?.stop();
    this.listeners.clear();
    if (this.store) {
      await this.store.saveTracker(this.trackerInstance.toJSON()).catch(() => undefined);
    }
  }
}
