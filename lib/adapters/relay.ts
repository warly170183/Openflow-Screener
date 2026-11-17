"use client";

import { BaseExchangeAdapter } from "./base";
import type {
  DerivativesSnapshot,
  MarketType,
  NormalizedLiquidation,
  NormalizedOrderBook,
  NormalizedTrade,
  Venue,
  VenueConnection,
} from "@/lib/types/market";

/**
 * Client-side adapter that consumes normalized market data from the
 * same-origin Next.js relay (`/api/terminal/stream`), with automatic
 * JSON snapshot polling fallback (`/api/terminal/snapshot`) if SSE
 * streaming is buffered or blocked by a proxy.
 */
export class ServerRelayAdapter extends BaseExchangeAdapter {
  readonly venue: Venue;
  private readonly marketType: MarketType;
  private source: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sseFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private warmupTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private receivedSseData = false;
  private cursor = 0;
  private seenTradeIds = new Set<string>();
  private seenLiqIds = new Set<string>();

  constructor(venue: Venue, symbol: string, marketType: MarketType) {
    super(symbol.toUpperCase());
    this.venue = venue;
    this.marketType = marketType;
  }

  protected buildWsUrl(): string {
    return "";
  }

  protected handleMessage(): void {
    // Events are dispatched directly by EventSource / snapshot polling.
  }

  protected sendPing(): void {
    // Relay heartbeat is managed server-side.
  }

  connect(): void {
    this.active = true;
    this.receivedSseData = false;
    this.cursor = 0;
    this.seenTradeIds.clear();
    this.seenLiqIds.clear();
    this.stateFlag = "relay";
    this.setStatus("connecting");

    // Seed any buffered book/trades/derivatives immediately via HTTP JSON,
    // without waiting for the SSE stream to deliver the next event.
    void this.fetchSnapshotOnce();
    this.warmupTimer = setTimeout(() => {
      this.warmupTimer = null;
      if (this.active && !this.receivedSseData && !this.pollTimer) {
        void this.fetchSnapshotOnce();
      }
    }, 500);

    if (typeof EventSource === "undefined") {
      this.startPolling();
      return;
    }

    const qs = new URLSearchParams({
      venue: this.venue,
      symbol: this.symbol,
      marketType: this.marketType,
    }).toString();

    const source = new EventSource(`/api/terminal/stream?${qs}`);
    this.source = source;

    const markMarketData = () => {
      this.receivedSseData = true;
      this.lastHeartbeat = Date.now();
      if (this.warmupTimer) {
        clearTimeout(this.warmupTimer);
        this.warmupTimer = null;
      }
      if (this.sseFallbackTimer) {
        clearTimeout(this.sseFallbackTimer);
        this.sseFallbackTimer = null;
      }
    };

    source.addEventListener("status", (e) => {
      if (!this.active) return;
      this.lastHeartbeat = Date.now();
      try {
        const conn = JSON.parse((e as MessageEvent).data) as VenueConnection;
        this.errorMessage = conn.error;
        this.stateFlag = conn.stateFlag ?? "relay";
        this.lastHeartbeat = conn.lastHeartbeat || Date.now();
        this.reconnectAttempts = conn.reconnectAttempts ?? 0;
        this.setStatus(conn.status);
      } catch {
        // Ignore malformed status event.
      }
    });

    source.addEventListener("trade", (e) => {
      if (!this.active) return;
      markMarketData();
      try {
        const trade = JSON.parse((e as MessageEvent).data) as NormalizedTrade;
        if (this.status !== "live") this.setStatus("live");
        this.dispatchTrade(trade);
      } catch {
        // Ignore malformed trade event.
      }
    });

    source.addEventListener("orderbook", (e) => {
      if (!this.active) return;
      markMarketData();
      try {
        const book = JSON.parse((e as MessageEvent).data) as NormalizedOrderBook;
        if (this.status !== "live") this.setStatus("live");
        this.bids.clear();
        this.asks.clear();
        for (const b of book.bids) this.bids.set(b.price, b.size);
        for (const a of book.asks) this.asks.set(a.price, a.size);
        this.emitOrderBook(book);
      } catch {
        // Ignore malformed book event.
      }
    });

    source.addEventListener("derivatives", (e) => {
      if (!this.active) return;
      markMarketData();
      try {
        const deriv = JSON.parse((e as MessageEvent).data) as DerivativesSnapshot;
        this.emitDerivatives(deriv);
      } catch {
        // Ignore malformed derivatives event.
      }
    });

    source.addEventListener("liquidation", (e) => {
      if (!this.active) return;
      markMarketData();
      try {
        const liq = JSON.parse((e as MessageEvent).data) as NormalizedLiquidation;
        this.dispatchLiquidation(liq);
      } catch {
        // Ignore malformed liquidation event.
      }
    });

    source.onerror = () => {
      if (!this.active) return;
      // On any SSE drop or proxy error, switch to reliable JSON snapshot polling.
      this.closeSource();
      this.startPolling();
    };

    // If a reverse proxy buffers SSE without firing onerror (even if initial status arrived),
    // fall back to JSON snapshot polling within 1.2s.
    this.sseFallbackTimer = setTimeout(() => {
      if (this.active && !this.receivedSseData) {
        this.closeSource();
        this.startPolling();
      }
    }, 1_200);
  }

  private dispatchTrade(trade: NormalizedTrade): void {
    if (this.seenTradeIds.has(trade.id)) return;
    this.seenTradeIds.add(trade.id);
    if (this.seenTradeIds.size > 1_000) {
      const oldest = this.seenTradeIds.values().next().value;
      if (oldest !== undefined) this.seenTradeIds.delete(oldest);
    }
    this.emitTrade(trade);
  }

  private dispatchLiquidation(liq: NormalizedLiquidation): void {
    if (this.seenLiqIds.has(liq.id)) return;
    this.seenLiqIds.add(liq.id);
    if (this.seenLiqIds.size > 500) {
      const oldest = this.seenLiqIds.values().next().value;
      if (oldest !== undefined) this.seenLiqIds.delete(oldest);
    }
    this.emitLiquidation(liq);
  }

  private async fetchSnapshotOnce(): Promise<void> {
    if (!this.active) return;
    try {
      const qs = new URLSearchParams({
        venue: this.venue,
        symbol: this.symbol,
        marketType: this.marketType,
        since: String(this.cursor),
      });
      const res = await fetch(`/api/terminal/snapshot?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok || !this.active) return;
      const snap = (await res.json()) as {
        status: VenueConnection;
        orderBook: NormalizedOrderBook | null;
        derivatives: DerivativesSnapshot | null;
        trades: NormalizedTrade[];
        liquidations: NormalizedLiquidation[];
        cursor: number;
      };
      this.applySnapshot(snap);
    } catch {
      // SSE or polling loop will handle retries.
    }
  }

  private applySnapshot(snap: {
    status: VenueConnection;
    orderBook: NormalizedOrderBook | null;
    derivatives: DerivativesSnapshot | null;
    trades: NormalizedTrade[];
    liquidations: NormalizedLiquidation[];
    cursor: number;
  }): void {
    if (!this.active) return;
    this.cursor = Math.max(this.cursor, snap.cursor ?? 0);
    this.errorMessage = snap.status.error;
    this.stateFlag = snap.status.status === "live" ? (this.pollTimer ? "relay poll" : "relay") : snap.status.stateFlag ?? "relay poll";
    this.lastHeartbeat = snap.status.lastHeartbeat || Date.now();
    this.setStatus(snap.status.status);
    if (snap.orderBook) {
      this.bids.clear();
      this.asks.clear();
      for (const b of snap.orderBook.bids) this.bids.set(b.price, b.size);
      for (const a of snap.orderBook.asks) this.asks.set(a.price, a.size);
      this.emitOrderBook(snap.orderBook);
    }
    if (snap.derivatives) this.emitDerivatives(snap.derivatives);
    for (const t of snap.trades) this.dispatchTrade(t);
    for (const l of snap.liquidations) this.dispatchLiquidation(l);
  }

  private startPolling(): void {
    if (!this.active || this.pollTimer) return;
    this.stateFlag = "relay poll";
    const qsBase = new URLSearchParams({
      venue: this.venue,
      symbol: this.symbol,
      marketType: this.marketType,
    });

    const poll = async () => {
      if (!this.active) return;
      try {
        const qs = new URLSearchParams(qsBase);
        qs.set("since", String(this.cursor));
        const res = await fetch(`/api/terminal/snapshot?${qs.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const snap = (await res.json()) as {
          status: VenueConnection;
          orderBook: NormalizedOrderBook | null;
          derivatives: DerivativesSnapshot | null;
          trades: NormalizedTrade[];
          liquidations: NormalizedLiquidation[];
          cursor: number;
        };
        this.applySnapshot(snap);
      } catch (err) {
        if (!this.active) return;
        this.reportError(
          `Relay error: ${err instanceof Error ? err.message : String(err)}`,
          "relay error"
        );
      }
    };

    void poll();
    this.pollTimer = setInterval(() => void poll(), 750);
  }

  private closeSource(): void {
    if (this.warmupTimer) {
      clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
    }
    if (this.sseFallbackTimer) {
      clearTimeout(this.sseFallbackTimer);
      this.sseFallbackTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  disconnect(): void {
    this.active = false;
    this.closeSource();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.setStatus("offline");
  }
}
