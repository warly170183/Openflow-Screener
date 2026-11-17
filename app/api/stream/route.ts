import { connection } from "next/server";
import { getScreenerRuntime } from "@/server/runtime";

export async function GET(request: Request) {
  await connection();
  const runtime = await getScreenerRuntime();
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup?.();
        }
      };

      send(": connected\n\n");

      const latest = runtime.latest();
      if (latest) {
        send(`event: scan\ndata: ${JSON.stringify(latest)}\n\n`);
      }

      const unsubscribe = runtime.subscribe((scan) => {
        send(`event: scan\ndata: ${JSON.stringify(scan)}\n\n`);
      });

      const keepAlive = setInterval(() => {
        send(": keepalive\n\n");
      }, 15_000);

      cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
      };

      request.signal.addEventListener("abort", () => {
        cleanup?.();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    },
  });
}
