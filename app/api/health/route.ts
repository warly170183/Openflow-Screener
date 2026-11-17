import { connection, NextResponse } from "next/server";
import { getScreenerRuntime } from "@/server/runtime";

export async function GET() {
  await connection();
  const runtime = await getScreenerRuntime();
  return NextResponse.json(
    { ok: true, ...runtime.health() },
    { headers: { "cache-control": "no-store" } }
  );
}
