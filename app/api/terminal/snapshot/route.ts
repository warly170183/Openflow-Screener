import { connection, NextResponse } from "next/server";
import { getRelayChannel } from "@/server/terminalRelay";
import { venueSupports } from "@/lib/adapters/capabilities";
import type { MarketType, Venue } from "@/lib/types/market";

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const venue = searchParams.get("venue") as Venue | null;
  const symbol = searchParams.get("symbol");
  const marketType = (searchParams.get("marketType") ?? "perpetual") as MarketType;
  const since = Math.max(0, Number(searchParams.get("since") ?? "0") || 0);

  if (!venue || !symbol || !venueSupports(venue, symbol, marketType)) {
    return NextResponse.json({ error: "Unsupported venue/symbol/marketType" }, { status: 400 });
  }

  const channel = getRelayChannel(venue, symbol, marketType);
  return NextResponse.json(channel.snapshot(since), {
    headers: { "cache-control": "no-store" },
  });
}
