import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { signBody, signCallToken, verifyBodySignature, verifyCallToken } from "../src/auth.ts";
import { OpenAiCompatibleLlm, redact, type LlmEvent } from "../src/brain/llm.ts";
import { talkerPrompt, talkerTools } from "../src/brain/talker.ts";
import { sessionInfo } from "./fixtures/fakes.ts";

const SECRET = "s".repeat(40);

test("call tokens: valid, tampered, expired, wrong secret", () => {
  const now = 1_800_000_000;
  const token = signCallToken(SECRET, { kind: "web", callId: "call_1", botId: "bot_1", exp: now + 60 });
  assert.deepEqual(verifyCallToken(SECRET, token, now), { kind: "web", callId: "call_1", botId: "bot_1", exp: now + 60 });
  assert.equal(verifyCallToken(SECRET, token, now + 61), null);
  assert.equal(verifyCallToken("x".repeat(40), token, now), null);
  const [v, body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ kind: "web", callId: "call_2", botId: "bot_1", exp: now + 60 })).toString("base64url");
  assert.equal(verifyCallToken(SECRET, `${v}.${forged}.${sig}`, now), null);
  assert.equal(verifyCallToken(SECRET, `${v}.${body}`, now), null);
  assert.equal(verifyCallToken(SECRET, "", now), null);
});

test("request signatures: fresh and exact, or refused", () => {
  const body = JSON.stringify({ callId: "call_1" });
  const header = signBody(SECRET, body, 1000);
  assert.ok(verifyBodySignature(SECRET, body, header, 1000));
  assert.ok(verifyBodySignature(SECRET, body, header, 1250));
  assert.ok(!verifyBodySignature(SECRET, body, header, 1301));
  assert.ok(!verifyBodySignature(SECRET, `${body} `, header, 1000));
  assert.ok(!verifyBodySignature("y".repeat(40), body, header, 1000));
  assert.ok(!verifyBodySignature(SECRET, body, null, 1000));
  assert.ok(!verifyBodySignature(SECRET, body, "t=1000,v1=zz", 1000));
});

/** A chat-completions server that streams the given SSE data lines. */
async function sseServer(lines: string[], status = 200) {
  const seen: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    seen.push({ auth: req.headers.authorization, ...JSON.parse(body) });
    if (status !== 200) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad key sk-abcdefghijklmnop" } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const l of lines) {
      res.write(`data: ${l}\n\n`);
      await new Promise((r) => setTimeout(r, 2));
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { url, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const delta = (content: string) => JSON.stringify({ choices: [{ delta: { content } }] });

async function collect(gen: AsyncGenerator<LlmEvent>) {
  const out: LlmEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

test("talker stream: text arrives as it's written; reasoning and inline tool calls are never spoken", async () => {
  const srv = await sseServer([
    delta("<think>The user wants"),
    delta(" the weather.</think>Sure"),
    delta(", one sec. <tool"),
    delta('_call>{"name": "ask_bot", "arguments": {"request": "weather in Austin"}}</tool_call>'),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 321, completion_tokens: 12 } }),
  ]);
  const llm = new OpenAiCompatibleLlm({ baseUrl: srv.url, apiKey: "k-test", model: "nvidia/Nemotron-3_5-Lightning", extraBody: { reasoning_effort: "none" } });
  const events = await collect(llm.stream({ system: "sys", messages: [{ role: "user", content: "hi" }], tools: [{ name: "ask_bot", description: "d", parameters: { type: "object" } }] }));
  const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
  assert.equal(text.trim(), "Sure, one sec.");
  const call = events.find((e) => e.type === "tool_call");
  assert.ok(call && call.type === "tool_call");
  assert.equal(call.call.function.name, "ask_bot");
  assert.deepEqual(call.args, { request: "weather in Austin" });
  const done = events.at(-1);
  assert.ok(done?.type === "done");
  assert.equal(done.finish, "tool_calls");
  assert.deepEqual(done.usage, { inputTokens: 321, outputTokens: 12 });
  assert.ok(done.firstTokenMs !== null && done.firstTokenMs >= 0);
  // What went to the server: the model, reasoning off, streaming with usage, the tools.
  const req = srv.seen[0];
  assert.equal(req.auth, "Bearer k-test");
  assert.equal(req.model, "nvidia/Nemotron-3_5-Lightning");
  assert.equal(req.reasoning_effort, "none");
  assert.equal(req.stream, true);
  assert.deepEqual(req.stream_options, { include_usage: true });
  assert.equal((req.messages as { role: string }[])[0].role, "system");
  await srv.close();
});

test("talker stream: native tool calls in pieces are put together", async () => {
  const tc = (index: number, fn: Record<string, string>, id?: string) => JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, ...(id ? { id } : {}), function: fn }] } }] });
  const srv = await sseServer([delta("Let me check. "), tc(0, { name: "ask_bot", arguments: "" }, "call_9"), tc(0, { arguments: '{"request": "cal' }), tc(0, { arguments: 'endar"}' }), JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })]);
  const llm = new OpenAiCompatibleLlm({ baseUrl: srv.url, apiKey: "k", model: "m" });
  const events = await collect(llm.stream({ system: "s", messages: [], tools: [{ name: "ask_bot", description: "d", parameters: {} }] }));
  const call = events.find((e) => e.type === "tool_call");
  assert.ok(call?.type === "tool_call");
  assert.equal(call.call.id, "call_9");
  assert.deepEqual(call.args, { request: "calendar" });
  await srv.close();
});

test(`talker stream: a "<" that isn't a tag is still spoken; errors never show a key`, async () => {
  const srv = await sseServer([delta("Is 3 < 5? "), delta("Yes.")]);
  const llm = new OpenAiCompatibleLlm({ baseUrl: srv.url, apiKey: "k", model: "m" });
  const text = (await collect(llm.stream({ system: "s", messages: [], tools: [] })))
    .filter((e) => e.type === "text")
    .map((e) => (e as { delta: string }).delta)
    .join("");
  assert.equal(text, "Is 3 < 5? Yes.");
  await srv.close();

  const bad = await sseServer([], 401);
  const llm2 = new OpenAiCompatibleLlm({ baseUrl: bad.url, apiKey: "k", model: "m" });
  await assert.rejects(collect(llm2.stream({ system: "s", messages: [], tools: [] })), (err: Error) => {
    assert.match(err.message, /model error 401/);
    assert.ok(!err.message.includes("sk-abcdefghijklmnop"));
    return true;
  });
  await bad.close();
  assert.equal(redact("Bearer abc.def key-1234567890abcdef"), "Bearer [redacted] [redacted]");
});

test("talker prompt and tools follow who's on the line", () => {
  const owner = sessionInfo();
  const p = talkerPrompt(owner, new Date("2026-10-16T15:00:00Z"));
  assert.match(p, /You are Otto, Diego's personal AI assistant, on a phone call\. Friendly and brief\./);
  assert.match(p, /You're talking with Diego, who owns you\./);
  assert.match(p, /Friday, October 16 at 10:00 AM for Diego/);
  assert.match(p, /Never make up anything about Diego's life/);
  assert.deepEqual(talkerTools(owner).map((t) => t.name), ["ask_bot", "end_call"]);

  const contact = sessionInfo({ speaker: "contact" });
  const pc = talkerPrompt(contact);
  assert.match(pc, /the caller is someone else/);
  assert.doesNotMatch(pc, /Never make up anything about/);
  assert.match(talkerTools(contact)[0].description, /Pass a message from this caller on to Diego/);

  assert.match(talkerPrompt(sessionInfo({ speaker: "unverified" })), /hasn't proved it yet/);
  assert.match(talkerPrompt(sessionInfo({ kind: "web" })), /on a voice call in the Build-a-bot app/);
});
