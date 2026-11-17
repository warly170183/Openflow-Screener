import { connection, NextResponse } from "next/server";
import { getScreenerRuntime } from "@/server/runtime";

export async function GET(request: Request) {
  await connection();
  const runtime = await getScreenerRuntime();
  const { searchParams } = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit")) || 50));
  return NextResponse.json(runtime.tracker.recent(limit), {
    headers: { "cache-control": "no-store" },
  });
}
