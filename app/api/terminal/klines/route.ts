import { connection, NextResponse } from "next/server";

const OKX_BAR_MAP: Record<string, { bar: string; ms: number }> = {
  "1m": { bar: "1m", ms: 60_000 },
  "5m": { bar: "5m", ms: 300_000 },
  "15m": { bar: "15m", ms: 900_000 },
  "30m": { bar: "30m", ms: 1_800_000 },
  "1h": { bar: "1H", ms: 3_600_000 },
  "1H": { bar: "1H", ms: 3_600_000 },
  "4h": { bar: "4H", ms: 14_400_000 },
  "4H": { bar: "4H", ms: 14_400_000 },
};

function toOkxInst(symbol: string, marketType: string): string {
  const s = symbol.toUpperCase();
  if (s.includes("-")) return s;
  const base = s.replace(/USDT$|USD$/, "");
  return marketType === "perpetual" ? `${base}-USDT-SWAP` : `${base}-USDT`;
}

async function fetchOkxCandles(
  symbol: string,
  marketType: string,
  bar: string,
  from: number,
  to: number,
  maxCandles: number
) {
  const instId = toOkxInst(symbol, marketType);
  const rowsByTs = new Map<number, unknown[]>();
  let after: string | undefined = String(to);
  const maxPages = Math.min(24, Math.max(1, Math.ceil(maxCandles / 100) + 1));

  // OKX returns up to 100 candles per page going backwards from `after`.
  for (let page = 0; page < maxPages; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_500);
    try {
      const endpoint = page === 0 ? "candles" : "history-candles";
      const qs = new URLSearchParams({ instId, bar, limit: "100" });
      if (page > 0 && after) qs.set("after", after);
      const res = await fetch(`https://www.okx.com/api/v5/market/${endpoint}?${qs.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        if (page === 0) throw new Error(`OKX klines HTTP ${res.status}`);
        break;
      }
      const body = (await res.json()) as { data?: string[][] };
      const data = body.data ?? [];
      if (!data.length) break;

      let oldest = Infinity;
      for (const c of data) {
        const ts = Number(c[0]);
        if (!Number.isFinite(ts)) continue;
        oldest = Math.min(oldest, ts);
        if (ts >= from && ts <= to) {
          // Keep canonical OKX row shape: [ts, open, high, low, close, volBase, volCcy, volCcyQuote]
          rowsByTs.set(ts, [ts, c[1], c[2], c[3], c[4], c[6] ?? c[5], c[5], c[7] ?? c[6] ?? "0"]);
        }
      }
      if (rowsByTs.size >= maxCandles || !Number.isFinite(oldest) || oldest <= from) break;
      after = String(oldest);
    } finally {
      clearTimeout(timer);
    }
  }

  return [...rowsByTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-maxCandles)
    .map(([, row]) => row);
}

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();
  const marketType = searchParams.get("marketType") === "spot" ? "spot" : "perpetual";
  const barSpec = OKX_BAR_MAP[searchParams.get("bar") ?? "5m"] ?? OKX_BAR_MAP["5m"];
  const limitParam = Number(searchParams.get("limit"));
  const maxCandles = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(2400, Math.floor(limitParam)) : 2400;
  const now = Date.now();
  const defaultSpan = searchParams.has("limit") ? maxCandles * barSpec.ms * 1.25 : 7 * 86_400_000;
  const from = Number(searchParams.get("from")) || Math.floor(now - defaultSpan);
  const to = Number(searchParams.get("to")) || now;

  try {
    const rows = await fetchOkxCandles(symbol, marketType, barSpec.bar, from, to, maxCandles);
    return NextResponse.json(rows, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load OKX klines" },
      { status: 502 }
    );
  }
}
