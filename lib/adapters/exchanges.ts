// ============================================================
// EXCHANGE ADAPTERS — OKX (Perpetual & Spot) + FX
// ============================================================

import { BaseExchangeAdapter, num } from "./base";
import type {
  NormalizedOrderBook,
  OrderBookLevel,
  Venue,
} from "@/lib/types/market";
import { FinnhubForexAdapter } from "./forex";

/** Apply [price, size, ...] deltas to a book side; a size of 0 removes the level. */
function applyLevels(side: Map<number, number>, levels: ReadonlyArray<ReadonlyArray<string>>, multiplier: number) {
  for (const level of levels) {
    const price = parseFloat(level[0]);
    const qty = parseFloat(level[1]) * multiplier;
    if (!Number.isFinite(price)) continue;
    if (!(qty > 0)) side.delete(price);
    else side.set(price, qty);
  }
}

/** Levels kept per side. Deep enough for the resting-liquidity heatmap. */
export const BOOK_DEPTH = 200;

function emitBook(
  adapter: BaseExchangeAdapter & { venue: Venue; symbol: string },
  bidsMap: Map<number, number>,
  asksMap: Map<number, number>,
  emitFn: (book: NormalizedOrderBook) => void
) {
  const bids: OrderBookLevel[] = [...bidsMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, BOOK_DEPTH)
    .map(([price, size]) => ({ price, size, venue: adapter.venue }));
  const asks: OrderBookLevel[] = [...asksMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, BOOK_DEPTH)
    .map(([price, size]) => ({ price, size, venue: adapter.venue }));
  emitFn({ venue: adapter.venue, symbol: adapter.symbol, timestamp: Date.now(), localTimestamp: Date.now(), bids, asks });
}

// ============================================================
// OKX FUTURES ADAPTER
// ============================================================
export class OKXFuturesAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "okx-futures";
  private readonly BASE_WS = "wss://ws.okx.com:8443/ws/v5/public";
  private contractValue = 1;

  constructor(symbol: string) {
    // Accept BTCUSDT or BTC-USDT-SWAP — normalize to BTC-USDT-SWAP
    let s = symbol.toUpperCase();
    if (!s.includes("-")) {
      const base = s.replace("USDT", "").replace("USD", "");
      s = `${base}-USDT-SWAP`;
    }
    super(s);
  }

  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    const ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws = ws;
    // Start contractValue lookup in parallel with the WebSocket handshake.
    const cvPromise = this.loadContractValue();

    ws.onopen = async () => {
      if (this.ws !== ws) return;
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      // Wait briefly (max 800ms) for ctVal so initial trades use exact base sizing,
      // but never block subscription if OKX REST is slow or blocked in the browser.
      await Promise.race([cvPromise, new Promise((r) => setTimeout(r, 800))]);
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;

      const instId = this.symbol;
      const indexId = instId.replace(/-SWAP$/, "");
      ws.send(JSON.stringify({
        op: "subscribe",
        args: [
          { channel: "trades", instId },
          { channel: "books", instId },
          { channel: "open-interest", instId },
          { channel: "funding-rate", instId },
          { channel: "mark-price", instId },
          { channel: "index-tickers", instId: indexId },
          // Liquidations are only published for the whole instrument type.
          { channel: "liquidation-orders", instType: "SWAP" },
        ],
      }));
      this.setStatus("live");
      this.startPing(25_000);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastHeartbeat = Date.now();
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
      try {
        const raw = e.data as string;
        if (raw === "pong") return;
        const m = JSON.parse(raw);
        if (m.event === "error") {
          this.reportError(m.msg ? `OKX: ${m.msg}` : "OKX stream error");
          return;
        }
        if (m.arg && m.data) this.handleMessage(m);
      } catch { /**/ }
    };
    ws.onerror = () => {
      if (this.ws === ws) this.setStatus("error");
    };
    ws.onclose = () => {
      this.stopPing();
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.status !== "offline") {
        this.setStatus("connecting");
        this.reconnect();
      }
    };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { arg: { channel: string }; action?: string; data: unknown[] };
    const channel = msg.arg.channel;
    if (channel === "open-interest") {
      for (const d of msg.data as Array<{ oiCcy?: string; ts?: string }>) this.emitDerivatives({ openInterest: num(d.oiCcy), timestamp: num(d.ts) });
      return;
    }
    if (channel === "funding-rate") {
      for (const d of msg.data as Array<{ fundingRate?: string; fundingTime?: string; nextFundingTime?: string }>) {
        const next = num(d.fundingTime);
        const after = num(d.nextFundingTime);
        this.emitDerivatives({
          fundingRate: num(d.fundingRate),
          nextFundingTime: next,
          fundingIntervalHours: next && after && after > next ? (after - next) / 3_600_000 : undefined,
        });
      }
      return;
    }
    if (channel === "mark-price") {
      for (const d of msg.data as Array<{ markPx?: string }>) this.emitDerivatives({ markPrice: num(d.markPx) });
      return;
    }
    if (channel === "index-tickers") {
      for (const d of msg.data as Array<{ idxPx?: string }>) this.emitDerivatives({ indexPrice: num(d.idxPx) });
      return;
    }
    if (channel === "liquidation-orders") {
      for (const item of msg.data as Array<{ instId: string; details: Array<{ side: "buy" | "sell"; posSide: string; bkPx: string; sz: string; ts: string }> }>) {
        if (item.instId !== this.symbol) continue;
        for (const d of item.details ?? []) {
          // A forced sell (posSide long, or net mode) closes a long.
          const side = d.posSide === "long" || (d.posSide !== "short" && d.side === "sell") ? "long" : "short";
          this.emitLiquidation({ id: `okxl-${item.instId}-${d.ts}-${d.sz}`, symbol: item.instId, timestamp: parseInt(d.ts), price: parseFloat(d.bkPx), quantity: parseFloat(d.sz) * this.contractValue, side });
        }
      }
      return;
    }
    if (channel === "trades") {
      for (const t of msg.data as Array<{ tradeId: string; instId: string; px: string; sz: string; side: "buy" | "sell"; ts: string }>) {
        const price = parseFloat(t.px), qty = parseFloat(t.sz) * this.contractValue;
        this.emitTrade({ id: `okx-${t.tradeId}`, venue: this.venue, symbol: t.instId, timestamp: parseInt(t.ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: "perpetual" });
      }
    } else if (channel === "books") {
      // OKX sends one "snapshot" followed by incremental "update" messages;
      // a size of 0 removes the level.
      if (msg.action === "snapshot") { this.bids.clear(); this.asks.clear(); }
      for (const d of msg.data as Array<{ bids: [string, string, string, string][]; asks: [string, string, string, string][]; ts: string }>) {
        applyLevels(this.bids, d.bids, this.contractValue);
        applyLevels(this.asks, d.asks, this.contractValue);
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("ping"); }
  private async loadContractValue(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(
        `https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(this.symbol)}`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { data?: Array<{ ctVal?: string }> };
      const value = Number(body.data?.[0]?.ctVal);
      if (Number.isFinite(value) && value > 0) this.contractValue = value;
    } catch {
      // Non-fatal: keep default contractValue=1 or switch to server relay if WS also has no data.
    } finally {
      clearTimeout(timer);
    }
  }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// OKX SPOT ADAPTER
// ============================================================
export class OKXSpotAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "okx-spot";
  private readonly BASE_WS = "wss://ws.okx.com:8443/ws/v5/public";

  constructor(symbol: string) {
    let s = symbol.toUpperCase();
    if (!s.includes("-")) {
      const base = s.replace("USDT", "").replace("USD", "");
      s = `${base}-USDT`;
    }
    super(s);
  }

  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    const ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId: this.symbol }, { channel: "books", instId: this.symbol }] }));
      this.setStatus("live");
      this.startPing(25_000);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastHeartbeat = Date.now();
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
      try {
        const raw = e.data as string;
        if (raw === "pong") return;
        const m = JSON.parse(raw);
        if (m.event === "error") {
          this.reportError(m.msg ? `OKX: ${m.msg}` : "OKX stream error");
          return;
        }
        if (m.arg && m.data) this.handleMessage(m);
      } catch { /**/ }
    };
    ws.onerror = () => {
      if (this.ws === ws) this.setStatus("error");
    };
    ws.onclose = () => {
      this.stopPing();
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.status !== "offline") {
        this.setStatus("connecting");
        this.reconnect();
      }
    };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { arg: { channel: string }; action?: string; data: unknown[] };
    if (msg.arg.channel === "trades") {
      for (const t of msg.data as Array<{ tradeId: string; instId: string; px: string; sz: string; side: "buy" | "sell"; ts: string }>) {
        const price = parseFloat(t.px), qty = parseFloat(t.sz);
        this.emitTrade({ id: `okxs-${t.tradeId}`, venue: this.venue, symbol: t.instId, timestamp: parseInt(t.ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: "spot" });
      }
    } else if (msg.arg.channel === "books") {
      if (msg.action === "snapshot") { this.bids.clear(); this.asks.clear(); }
      for (const d of msg.data as Array<{ bids: [string, string, string, string][]; asks: [string, string, string, string][]; ts: string }>) {
        applyLevels(this.bids, d.bids, 1);
        applyLevels(this.asks, d.asks, 1);
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("ping"); }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// ADAPTER FACTORY
// ============================================================
export function createAdapter(venue: Venue, symbol: string): BaseExchangeAdapter | null {
  switch (venue) {
    case "finnhub-forex": return new FinnhubForexAdapter(symbol);
    case "okx-futures":   return new OKXFuturesAdapter(symbol);
    case "okx-spot":      return new OKXSpotAdapter(symbol);
    default:              return null;
  }
}
