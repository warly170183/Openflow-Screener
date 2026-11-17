import { OKXFuturesAdapter, OKXSpotAdapter } from "@/lib/adapters/exchanges";
import type { BaseExchangeAdapter } from "@/lib/adapters/base";

function feed(adapter: BaseExchangeAdapter, payload: unknown): void {
  (
    adapter as unknown as { handleMessage: (message: unknown) => void }
  ).handleMessage(payload);
}

function expectTrade(adapter: BaseExchangeAdapter, payload: unknown): void {
  const trades: unknown[] = [];
  adapter.on("trade", (trade) => trades.push(trade));
  feed(adapter, payload);
  expect(trades).toHaveLength(1);
}

describe("OKX exchange adapter payload fixtures", () => {
  it.each([
    ["OKX futures", new OKXFuturesAdapter("BTCUSDT")],
    ["OKX spot", new OKXSpotAdapter("BTCUSDT")],
  ])("normalizes %s trades", (_name, adapter) => {
    expectTrade(adapter, {
      arg: { channel: "trades" },
      data: [{ tradeId: "1", instId: "BTC-USDT", px: "50000", sz: "0.01", side: "buy", ts: "1700000000000" }],
    });
  });

  it("normalizes OKX perpetual derivatives, mark, index and liquidations", () => {
    const adapter = new OKXFuturesAdapter("BTCUSDT");
    const derivatives: unknown[] = [];
    const liquidations: unknown[] = [];
    adapter.on("derivatives", (d) => derivatives.push(d));
    adapter.on("liquidation", (l) => liquidations.push(l));

    feed(adapter, { arg: { channel: "open-interest" }, data: [{ oiCcy: "12345.5", ts: "1700000000000" }] });
    feed(adapter, { arg: { channel: "mark-price" }, data: [{ markPx: "50010" }] });
    feed(adapter, { arg: { channel: "index-tickers" }, data: [{ idxPx: "50000" }] });
    feed(adapter, {
      arg: { channel: "liquidation-orders" },
      data: [{
        instId: "BTC-USDT-SWAP",
        details: [{ side: "sell", posSide: "long", bkPx: "49900", sz: "2", ts: "1700000001000" }],
      }],
    });

    expect(derivatives).toHaveLength(3);
    expect(liquidations).toHaveLength(1);
  });
});
