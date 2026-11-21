import { connection, NextResponse } from "next/server";
import { computeAdxSnapshot, type AdxSnapshot } from "@/lib/engine/wyckoff";
import type { OhlcBar } from "@/lib/engine/tradingOptions";
import { PERP_SYMBOLS } from "@/lib/config/instruments";
import { normalizeWatchlistSymbol } from "@/lib/store/uiStore";
import { getScreenerServiceInstance } from "@/server/runtime";

const BAR_MAP: Record<string, { req: "5m" | "15m" | "1h" | "4h"; okx: string }> = {
  "5m": { req: "5m", okx: "5m" },
  "15m": { req: "15m", okx: "15m" },
  "1h": { req: "1h", okx: "1H" },
  "1H": { req: "1h", okx: "1H" },
  "4h": { req: "4h", okx: "4H" },
  "4H": { req: "4h", okx: "4H" },
};

export interface AdxApiItem {
  symbol: string;
  instId: string;
  bars: OhlcBar[];
  snapshot: AdxSnapshot;
}

function toInstId(canonicalSymbol: string): string {
  const base = canonicalSymbol.replace(/USDT$|USD$/, "");
  return `${base}-USDT-SWAP`;
}

async function fetchOkxCandlesForSymbol(
  symbol: string,
  okxBar: string,
  limit = 60
): Promise<{ symbol: string; instId: string; bars: OhlcBar[] } | null> {
  const instId = toInstId(symbol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_500);
  try {
    const qs = new URLSearchParams({
      instId,
      bar: okxBar,
      limit: String(limit),
    });
    const res = await fetch(`https://www.okx.com/api/v5/market/candles?${qs.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: string[][] };
    const rows = body.data ?? [];
    if (!rows.length) return null;

    const bars: OhlcBar[] = [];
    for (const c of rows) {
      const openTime = Number(c[0]);
      const open = Number(c[1]);
      const high = Number(c[2]);
      const low = Number(c[3]);
      const close = Number(c[4]);
      const volume = Number(c[6] ?? c[5] ?? 0);
      if (
        !Number.isFinite(openTime) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        close <= 0
      ) {
        continue;
      }
      bars.push({
        openTime,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      });
    }

    bars.sort((a, b) => a.openTime - b.openTime);
    if (!bars.length) return null;
    return { symbol, instId, bars };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const barParam = searchParams.get("bar") ?? "15m";
  const barSpec = BAR_MAP[barParam] ?? BAR_MAP["15m"];

  const service = getScreenerServiceInstance();
  const latestScan = service.latest();
  const livePriceBySymbol = new Map<string, number>();
  if (latestScan?.rows) {
    for (const row of latestScan.rows) {
      const norm = normalizeWatchlistSymbol(row.symbol);
      if (norm && Number.isFinite(row.price) && row.price > 0) {
        livePriceBySymbol.set(norm, row.price);
      }
    }
  }

  const rawSymbols = searchParams.get("symbols");
  let targetSymbols: string[];
  if (rawSymbols && rawSymbols.trim().length > 0) {
    targetSymbols = Array.from(
      new Set(
        rawSymbols
          .split(",")
          .map(normalizeWatchlistSymbol)
          .filter(Boolean)
      )
    ).slice(0, 45);
  } else if (latestScan?.rows?.length) {
    targetSymbols = Array.from(
      new Set(latestScan.rows.map((r) => normalizeWatchlistSymbol(r.symbol)).filter(Boolean))
    ).slice(0, 45);
  } else {
    targetSymbols = PERP_SYMBOLS.slice(0, 40);
  }

  const items: AdxApiItem[] = [];
  const BATCH_SIZE = 8;
  for (let i = 0; i < targetSymbols.length; i += BATCH_SIZE) {
    const batch = targetSymbols.slice(i, i + BATCH_SIZE);
    const settled = await Promise.all(
      batch.map((sym) => fetchOkxCandlesForSymbol(sym, barSpec.okx, 60))
    );
    for (const entry of settled) {
      if (!entry) continue;
      const livePrice = livePriceBySymbol.get(entry.symbol);
      const snapshot = computeAdxSnapshot(entry.bars, livePrice, 14);
      items.push({
        symbol: entry.symbol,
        instId: entry.instId,
        bars: entry.bars,
        snapshot,
      });
    }
  }

  return NextResponse.json(
    {
      time: Date.now(),
      bar: barSpec.req,
      count: items.length,
      items,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
