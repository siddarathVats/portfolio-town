import { emote, leave, subscribe, upsert, type ServerMessage } from "@/lib/server/presence";

// Live, per-request, in this Node process (the hub is in memory).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-sent events: the player list whenever it changes, and emotes as they happen. */
export function GET(req: Request) {
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          stop();
        }
      };
      const unsubscribe = subscribe((m: ServerMessage) => write(`data: ${JSON.stringify(m)}\n\n`));
      // A comment every 15s keeps proxies from closing an idle stream.
      const ping = setInterval(() => write(": ping\n\n"), 15_000);
      stop = () => {
        clearInterval(ping);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}

/** A player's report: { id, name, color, s } to join or move, { id, emote } to emote, { id, leave: true } to go. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 512) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (body.leave === true) {
    leave(body.id);
    return new Response(null, { status: 204 });
  }
  if (typeof body.emote === "string") {
    return new Response(null, { status: emote(body.id, body.emote) ? 204 : 400 });
  }
  return new Response(null, { status: upsert(body) ? 204 : 400 });
}

