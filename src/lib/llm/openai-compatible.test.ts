import { describe, expect, it } from "vitest";
import { createOpenAiCompatibleProvider } from "./openai-compatible";

/** A chat-completions stream whose text comes in these pieces. */
function sse(pieces: string[]): Response {
  const events = [
    ...pieces.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(events.join(""), { headers: { "content-type": "text/event-stream" } });
}

async function run(pieces: string[]) {
  const provider = createOpenAiCompatibleProvider({ id: "test", baseUrl: "https://llm.test/v1", apiKey: "k", fetchImpl: (async () => sse(pieces)) as unknown as typeof fetch });
  let text = "";
  const calls: string[] = [];
  for await (const ev of provider.stream({ model: "m", system: "", messages: [{ role: "user", content: "hi" }], tools: [{ name: "get_weather", description: "", parameters: {} }] })) {
    if (ev.type === "text") text += ev.delta;
    if (ev.type === "tool_call") calls.push(`${ev.call.name}:${JSON.stringify(ev.call.args)}`);
  }
  return { text, calls };
}

describe("tool calls a model writes into its text", () => {
  it("are recovered, and the words before them are said once", async () => {
    const out = await run(["Let me check the weather. ", "<tool_", 'call>{"name":"get_weather","arguments":{"location":"Austin"}}</tool_call>']);
    expect(out.calls).toEqual(['get_weather:{"location":"Austin"}']);
    expect(out.text).toBe("Let me check the weather. ");
  });

  it("text that only looks like the start of a tag still gets through", async () => {
    const out = await run(["2 < 3, and ", "<b>bold</b> is fine"]);
    expect(out.text).toBe("2 < 3, and <b>bold</b> is fine");
    expect(out.calls).toEqual([]);
  });
});
