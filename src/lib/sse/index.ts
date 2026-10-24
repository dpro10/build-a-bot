/** Server-Sent Events response for streaming agent turns to the browser. */
export function sseResponse(run: (send: (event: unknown) => void, signal: AbortSignal) => Promise<void>, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const keepAlive = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            closed = true;
          }
        }
      }, 15000);
      try {
        await run(send, signal);
      } catch (err) {
        // Brain and tool failures are answered inside the turn; whatever lands here is ours.
        // The details go to the server log, and the chat gets a plain sentence (never SQL).
        console.error("[stream] the turn failed:", err);
        send({ type: "error", message: "Something went wrong on our side. Try again in a moment." });
      } finally {
        clearInterval(keepAlive);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
