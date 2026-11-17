import { OKXFuturesAdapter, OKXSpotAdapter } from "@/lib/adapters/exchanges";
import type { BaseExchangeAdapter } from "@/lib/adapters/base";
import type { NormalizedOrderBook, VenueConnection } from "@/lib/types/market";
import { venueSupports, venuesForSelection } from "@/lib/adapters/capabilities";
import { CRYPTO_ASSETS, CRYPTO_SYMBOLS } from "@/lib/config/instruments";

function feed(adapter: BaseExchangeAdapter, payload: unknown): void {
  (adapter as unknown as { handleMessage: (message: unknown) => void }).handleMessage(payload);
}

function capture(adapter: BaseExchangeAdapter) {
  const books: NormalizedOrderBook[] = [];
  const statuses: VenueConnection[] = [];
  adapter.on("orderbook", (book) => books.push(book));
  adapter.on("status", (status) => statuses.push(status));
  return { books, statuses };
}

describe("OKX books channel", () => {
  it.each([
    ["futures", () => new OKXFuturesAdapter("BTCUSDT")],
    ["spot", () => new OKXSpotAdapter("BTCUSDT")],
  ])("applies one-sided %s deltas on top of the snapshot", (_, make) => {
    const adapter = make();
    const { books, statuses } = capture(adapter);
    feed(adapter, {
      arg: { channel: "books" },
      action: "snapshot",
      data: [{ bids: [["100", "2", "0", "1"], ["99", "1", "0", "1"]], asks: [["101", "3", "0", "1"]], ts: "1" }],
    });
    // Update touching only the bid side, including a removal.
    feed(adapter, {
      arg: { channel: "books" },
      action: "update",
      data: [{ bids: [["99", "0", "0", "0"], ["100", "5", "0", "1"]], asks: [], ts: "2" }],
    });
    const last = books.at(-1)!;
    expect(last.bids).toEqual([expect.objectContaining({ price: 100, size: 5 })]);
    expect(last.asks).toEqual([expect.objectContaining({ price: 101, size: 3 })]);
    expect(statuses.some((s) => s.status === "error")).toBe(false);
  });
});

describe("OKX instrument coverage", () => {
  it("lists OKX perpetual and spot markets with active instruments", () => {
    expect(CRYPTO_SYMBOLS.length).toBeGreaterThanOrEqual(100);
    for (const asset of CRYPTO_ASSETS) {
      const symbol = `${asset.base}USDT`;
      const perpVenues = venuesForSelection("all-perps", "perpetual", symbol);
      const spotVenues = venuesForSelection("all-spot", "spot", symbol);
      expect(perpVenues.length + spotVenues.length).toBeGreaterThan(0);
      for (const v of perpVenues) expect(v).toBe("okx-futures");
      for (const v of spotVenues) expect(v).toBe("okx-spot");
    }
  });

  it("offers gold and silver on OKX perpetuals", () => {
    for (const symbol of ["XAUUSDT", "XAGUSDT"]) {
      expect(venuesForSelection("all-perps", "perpetual", symbol)).toEqual(["okx-futures"]);
      expect(venuesForSelection("all-spot", "spot", symbol)).toEqual([]);
    }
  });

  it("excludes unsupported symbols and FX pairs from crypto OKX venues", () => {
    for (const symbol of ["NVDAUSDT", "QQQUSDT", "TSLAUSDT", "EUR/USD"]) {
      expect(venueSupports("okx-futures", symbol, "perpetual")).toBe(false);
      expect(venueSupports("okx-spot", symbol, "spot")).toBe(false);
    }
  });
});
