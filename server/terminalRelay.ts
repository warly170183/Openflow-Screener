import { createAdapter } from "@/lib/adapters/exchanges";
import { venueSupports } from "@/lib/adapters/capabilities";
import type { BaseExchangeAdapter } from "@/lib/adapters/base";
import type {
  DerivativesSnapshot,
  MarketType,
  NormalizedLiquidation,
  NormalizedOrderBook,
  NormalizedTrade,
  Venue,
  VenueConnection,
} from "@/lib/types/market";

export type RelayEvent =
  | { type: "status"; payload: VenueConnection }
  | { type: "trade"; payload: NormalizedTrade }
  | { type: "orderbook"; payload: NormalizedOrderBook }
  | { type: "derivatives"; payload: DerivativesSnapshot }
  | { type: "liquidation"; payload: NormalizedLiquidation };

interface BufferedEvent {
  seq: number;
  event: RelayEvent;
}

type Listener = (event: RelayEvent) => void;

const IDLE_DISPOSE_MS = 15_000;
const BOOK_THROTTLE_MS = 100;
const NO_DATA_TIMEOUT_MS = 6_000;
const MAX_HISTORY = 250;

class RelayChannel {
  private adapter: BaseExchangeAdapter | null = null;
  private listeners = new Set<Listener>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private bookTimer: ReturnType<typeof setTimeout> | null = null;
  private noDataTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingBook: NormalizedOrderBook | null = null;
  private lastBookSentAt = 0;
  private receivedData = false;

  private lastStatus: VenueConnection;
  private lastBook: NormalizedOrderBook | null = null;
  private lastDerivatives: DerivativesSnapshot | null = null;
  private history: BufferedEvent[] = [];
  private seenTradeIds = new Set<string>();
  private disposed = false;
  private nextSeq = 1;

  constructor(
    readonly key: string,
    readonly venue: Venue,
    readonly symbol: string,
    readonly marketType: MarketType
  ) {
    this.lastStatus = {
      venue,
      status: "connecting",
      lastHeartbeat: 0,
      reconnectAttempts: 0,
      stateFlag: "relay",
    };
  }

  subscribe(listener: Listener): () => void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.listeners.add(listener);
    this.ensureStarted();

    // Replay current state and recent buffered prints to the newly connected listener.
    listener({ type: "status", payload: this.lastStatus });
    if (this.lastBook) listener({ type: "orderbook", payload: this.lastBook });
    if (this.lastDerivatives) listener({ type: "derivatives", payload: this.lastDerivatives });
    for (const item of this.history) {
      if (item.event.type === "trade" || item.event.type === "liquidation") {
        listener(item.event);
      }
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.scheduleIdleDispose();
      }
    };
  }

  snapshot(sinceSeq = 0): {
    status: VenueConnection;
    orderBook: NormalizedOrderBook | null;
    derivatives: DerivativesSnapshot | null;
    trades: NormalizedTrade[];
    liquidations: NormalizedLiquidation[];
    cursor: number;
  } {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.ensureStarted();
    this.scheduleIdleDispose();

    const trades: NormalizedTrade[] = [];
    const liquidations: NormalizedLiquidation[] = [];
    for (const item of this.history) {
      if (item.seq <= sinceSeq) continue;
      if (item.event.type === "trade") trades.push(item.event.payload);
      else if (item.event.type === "liquidation") liquidations.push(item.event.payload);
    }
    return {
      status: this.lastStatus,
      orderBook: this.lastBook,
      derivatives: this.lastDerivatives,
      trades,
      liquidations,
      cursor: this.nextSeq - 1,
    };
  }

  private ensureStarted(): void {
    if (this.adapter) return;
    if (!venueSupports(this.venue, this.symbol, this.marketType)) {
      this.lastStatus = {
        venue: this.venue,
        status: "error",
        lastHeartbeat: 0,
        reconnectAttempts: 0,
        error: `${this.venue} does not support ${this.symbol} ${this.marketType}`,
        stateFlag: "relay",
      };
      this.broadcast({ type: "status", payload: this.lastStatus });
      return;
    }

    const adapter = createAdapter(this.venue, this.symbol);
    if (!adapter) {
      this.lastStatus = {
        venue: this.venue,
        status: "error",
        lastHeartbeat: 0,
        reconnectAttempts: 0,
        error: `No adapter available for ${this.venue}`,
        stateFlag: "relay",
      };
      this.broadcast({ type: "status", payload: this.lastStatus });
      return;
    }

    this.adapter = adapter;
    this.receivedData = false;
    this.disposed = false;

    this.noDataTimer = setTimeout(() => {
      if (!this.receivedData && this.adapter === adapter) {
        this.lastStatus = {
          venue: this.venue,
          status: "error",
          lastHeartbeat: this.lastStatus.lastHeartbeat,
          reconnectAttempts: this.lastStatus.reconnectAttempts,
          error: `${this.venue} stream did not respond in time — try switching venue`,
          stateFlag: "relay timeout",
        };
        this.broadcast({ type: "status", payload: this.lastStatus });
      }
    }, NO_DATA_TIMEOUT_MS);

    adapter.on("status", (conn: VenueConnection) => {
      this.lastStatus = {
        ...conn,
        stateFlag: conn.stateFlag ?? "relay",
      };
      this.broadcast({ type: "status", payload: this.lastStatus });
    });

    adapter.on("trade", (trade: NormalizedTrade) => {
      this.recordTrade(trade);
    });

    adapter.on("liquidation", (liq: NormalizedLiquidation) => {
      this.markData();
      this.record({ type: "liquidation", payload: liq });
      this.broadcast({ type: "liquidation", payload: liq });
    });

    adapter.on("derivatives", (deriv: DerivativesSnapshot) => {
      this.markData();
      this.lastDerivatives = { ...(this.lastDerivatives ?? {}), ...deriv };
      this.broadcast({ type: "derivatives", payload: deriv });
    });

    adapter.on("orderbook", (book: NormalizedOrderBook) => {
      this.markData();
      this.lastBook = book;
      const now = Date.now();
      if (now - this.lastBookSentAt >= BOOK_THROTTLE_MS) {
        this.lastBookSentAt = now;
        this.pendingBook = null;
        if (this.bookTimer) {
          clearTimeout(this.bookTimer);
          this.bookTimer = null;
        }
        this.broadcast({ type: "orderbook", payload: book });
      } else {
        this.pendingBook = book;
        if (!this.bookTimer) {
          this.bookTimer = setTimeout(() => {
            this.bookTimer = null;
            if (this.pendingBook) {
              const latest = this.pendingBook;
              this.pendingBook = null;
              this.lastBookSentAt = Date.now();
              this.broadcast({ type: "orderbook", payload: latest });
            }
          }, BOOK_THROTTLE_MS);
        }
      }
    });

    adapter.connect();
    void this.seedInitialTrades();
  }

  private recordTrade(trade: NormalizedTrade): void {
    if (this.seenTradeIds.has(trade.id)) return;
    this.seenTradeIds.add(trade.id);
    if (this.seenTradeIds.size > 2_000) {
      const oldest = this.seenTradeIds.values().next().value;
      if (oldest !== undefined) this.seenTradeIds.delete(oldest);
    }
    this.markData();
    this.record({ type: "trade", payload: trade });
    this.broadcast({ type: "trade", payload: trade });
  }

  private toOkxInstId(): string {
    const s = this.symbol.toUpperCase();
    if (s.includes("-")) return s;
    const base = s.replace(/USDT$|USD$/, "");
    return this.marketType === "perpetual" ? `${base}-USDT-SWAP` : `${base}-USDT`;
  }

  private async seedInitialTrades(): Promise<void> {
    if (this.venue !== "okx-futures" && this.venue !== "okx-spot") return;
    const instId = this.toOkxInstId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const tradesUrl = `https://www.okx.com/api/v5/market/trades?instId=${encodeURIComponent(instId)}&limit=100`;
      const instUrl =
        this.marketType === "perpetual"
          ? `https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(instId)}`
          : null;

      const [tradesRes, instRes] = await Promise.all([
        fetch(tradesUrl, { signal: controller.signal, cache: "no-store" }),
        instUrl ? fetch(instUrl, { signal: controller.signal, cache: "no-store" }).catch(() => null) : Promise.resolve(null),
      ]);
      if (this.disposed || !tradesRes.ok) return;

      let contractValue = 1;
      if (instRes && instRes.ok) {
        const instBody = (await instRes.json()) as { data?: Array<{ ctVal?: string }> };
        const parsedCv = Number(instBody.data?.[0]?.ctVal);
        if (Number.isFinite(parsedCv) && parsedCv > 0) contractValue = parsedCv;
      }

      const body = (await tradesRes.json()) as {
        data?: Array<{
          tradeId: string;
          instId: string;
          px: string;
          sz: string;
          side: "buy" | "sell";
          ts: string;
        }>;
      };
      const rows = body.data ?? [];
      if (!rows.length || this.disposed) return;

      // OKX returns newest first — iterate oldest -> newest so candle/session state builds in order.
      for (let i = rows.length - 1; i >= 0; i--) {
        const t = rows[i];
        const price = parseFloat(t.px);
        const qty = parseFloat(t.sz) * contractValue;
        const ts = parseInt(t.ts, 10);
        if (!Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(ts)) continue;
        this.recordTrade({
          id: `okx-${t.tradeId}`,
          venue: this.venue,
          symbol: t.instId,
          timestamp: ts,
          localTimestamp: Date.now(),
          price,
          quantity: qty,
          quoteVolume: price * qty,
          side: t.side === "sell" ? "sell" : "buy",
          marketType: this.marketType,
        });
      }

      if (this.lastStatus.status === "connecting") {
        this.lastStatus = {
          ...this.lastStatus,
          status: "live",
          lastHeartbeat: Date.now(),
          stateFlag: "relay",
        };
        this.broadcast({ type: "status", payload: this.lastStatus });
      }
    } catch {
      // Non-fatal: live WebSocket adapter remains primary source.
    } finally {
      clearTimeout(timer);
    }
  }

  private markData(): void {
    if (!this.receivedData) {
      this.receivedData = true;
      if (this.noDataTimer) {
        clearTimeout(this.noDataTimer);
        this.noDataTimer = null;
      }
    }
  }

  private record(event: RelayEvent): void {
    this.history.push({ seq: this.nextSeq++, event });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }

  private broadcast(event: RelayEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore broken SSE listeners.
      }
    }
  }

  private scheduleIdleDispose(): void {
    if (this.idleTimer || this.listeners.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.listeners.size === 0) {
        this.dispose();
        channels.delete(this.key);
      }
    }, IDLE_DISPOSE_MS);
  }

  private dispose(): void {
    this.disposed = true;
    if (this.noDataTimer) clearTimeout(this.noDataTimer);
    if (this.bookTimer) clearTimeout(this.bookTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.noDataTimer = null;
    this.bookTimer = null;
    this.idleTimer = null;
    this.pendingBook = null;
    this.adapter?.disconnect();
    this.adapter = null;
  }
}

const globalRelay = globalThis as typeof globalThis & {
  __orderflowTerminalRelay?: Map<string, RelayChannel>;
};

const channels = (globalRelay.__orderflowTerminalRelay ??= new Map<string, RelayChannel>());

export function getRelayChannel(
  venue: Venue,
  symbol: string,
  marketType: MarketType
): RelayChannel {
  const norm = symbol.toUpperCase();
  const key = `${venue}:${marketType}:${norm}`;
  let channel = channels.get(key);
  if (!channel) {
    channel = new RelayChannel(key, venue, norm, marketType);
    channels.set(key, channel);
  }
  return channel;
}
