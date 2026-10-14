/**
 * Minimal Server-Sent Events reader for fetch() responses: yields each event's
 * `data` payload (multi-line data joined with \n). Handles \r\n and chunk splits.
 */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = parseEventData(rawEvent);
        if (data !== null) yield data;
      }
    }
    buffer += decoder.decode();
    const tail = parseEventData(buffer.replace(/\r\n/g, "\n"));
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseEventData(rawEvent: string): string | null {
  const lines = rawEvent.split("\n");
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
  }
  return data.length ? data.join("\n") : null;
}
