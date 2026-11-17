import { connection, NextResponse } from "next/server";
import { getScreenerRuntime } from "@/server/runtime";

export async function GET() {
  await connection();
  const runtime = await getScreenerRuntime();
  const latest = runtime.latest();
  return NextResponse.json(
    latest ?? { time: null, rows: [], newSignals: [], closed: [] },
    { headers: { "cache-control": "no-store" } }
  );
}
