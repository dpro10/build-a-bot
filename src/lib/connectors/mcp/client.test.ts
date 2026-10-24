import { describe, expect, it } from "vitest";
import { readRpcResponse } from "./client";

/** A response whose body sends `parts` and then, if `open`, never ends (a server holding its stream). */
function streamed(parts: string[], type: string, open = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
      if (!open) controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": type } });
}

describe("reading an MCP server's answer", () => {
  it("stops at the event that answers, even if the server keeps the stream open", async () => {
    const res = streamed(['event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n', 'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n'], "text/event-stream", true);
    await expect(readRpcResponse(res, 7)).resolves.toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
  });

  it("reads a plain JSON answer, split across pieces", async () => {
    const res = streamed(['{"jsonrpc":"2.0","id":3,', '"result":{"tools":[]}}'], "application/json");
    await expect(readRpcResponse(res, 3)).resolves.toMatchObject({ result: { tools: [] } });
  });

  it("refuses an answer that's too large", async () => {
    const big = "x".repeat(1_000_000);
    const res = streamed([`{"result":"${big}`, big, big, big, big], "application/json", true);
    await expect(readRpcResponse(res, 1)).rejects.toThrow(/too large/);
  });
});
