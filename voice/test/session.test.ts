import { test } from "node:test";
import assert from "node:assert/strict";
import { CallSession, sanitizeHistory, type SessionConfig } from "../src/call/session.ts";
import { ENGINE_TROUBLE, PhraseCache } from "../src/call/phrases.ts";
import { EnergyVad } from "../src/vad/vad.ts";
import { pinFromSpeech } from "../src/call/pin.ts";
import type { ChatMessage, LlmRequest } from "../src/brain/llm.ts";
import { Caller, FakeApp, FakeEngine, FakeLlm, FakeTransport, sessionInfo, sleep, until, type LlmScript } from "./fixtures/fakes.ts";
import type { SessionInfo } from "../src/brain/app.ts";

const FAST: Partial<SessionConfig> = {
  turn: { minSpeechMs: 64, pauseMs: 96, endMs: 320, bargeInMs: 160 },
  fillerAfterMs: 5000,
  actWaitMs: 400,
  idleMs: 60_000,
};

function lastUser(req: LlmRequest): string {
  const m = [...req.messages].reverse().find((x) => x.role === "user");
  return m?.role === "user" ? m.content : "";
}

function setup(opts: { script: LlmScript; transcribe?: (ms: number) => string; info?: Partial<SessionInfo>; config?: Partial<SessionConfig>; speakFactor?: number }) {
  const engine = new FakeEngine({ transcribe: opts.transcribe, speakFactor: opts.speakFactor });
  const llm = new FakeLlm(opts.script);
  const app = new FakeApp();
  const transport = new FakeTransport();
  const phrases = new PhraseCache(engine);
  const logs: { event: string; fields?: Record<string, unknown> }[] = [];
  const session = new CallSession({
    engine,
    vad: new EnergyVad(),
    llm,
    app,
    phrases,
    transport,
    info: sessionInfo(opts.info),
    config: { ...FAST, ...opts.config, turn: { ...FAST.turn, ...opts.config?.turn } },
    log: (event, fields) => logs.push({ event, fields }),
  });
  const caller = new Caller(transport);
  const transcript = () => app.turns.map((t) => `${t.role}: ${t.text}${t.interrupted ? " [cut]" : ""}`);
  /** The greeting has played, and the caller says something (talkMs of speech, then quiet). */
  const greetedThenSays = async (talkMs = 400) => {
    await until(() => transport.events.some((e) => e.type === "state" && e.state === "listening"), 3000, "greeting played");
    await caller.silence(300);
    await caller.talk(talkMs);
    await caller.silence(800);
  };
  return { engine, llm, app, transport, phrases, session, caller, logs, transcript, greetedThenSays };
}

test("greets, hears a question, answers it, and reports the call", async () => {
  const t = setup({ script: () => ({ text: "You have two meetings tomorrow." }), transcribe: () => "What's on tomorrow?" });
  const done = t.session.start();
  await until(() => t.engine.spoken.length >= 1, 2000, "greeting");
  assert.equal(t.engine.spoken[0], "Hey Diego, it's Otto.");
  await until(() => t.transport.events.some((e) => e.type === "state" && e.state === "listening"), 2000, "greeting played");
  await t.caller.silence(600);
  await t.caller.talk(500);
  await t.caller.silence(500);
  await until(() => t.engine.spoken.includes("You have two meetings tomorrow."), 3000, "answer");
  assert.equal(lastUser(t.llm.requests[0]), "What's on tomorrow?");
  // The model saw the voice prompt and the tools.
  assert.match(t.llm.requests[0].system, /You are Otto, Diego's personal AI assistant, on a phone call/);
  assert.deepEqual(t.llm.requests[0].tools.map((x) => x.name), ["ask_bot", "end_call"]);
  // The words to listen for went to speech recognition.
  assert.deepEqual(t.engine.heard[0].opts?.phrases, ["Otto", "Diego"]);
  await until(() => t.logs.some((l) => l.event === "latency"), 3000, "latency");
  await t.session.end("caller");
  const report = await done;
  assert.equal(report.endedBy, "caller");
  assert.deepEqual(t.transcript(), ["bot: Hey Diego, it's Otto.", "caller: What's on tomorrow?", "bot: You have two meetings tomorrow."]);
  assert.equal(report.latency.turns, 1);
  assert.ok(report.latency.p50Ms !== null && report.latency.p50Ms < 1500, `latency ${report.latency.p50Ms}`);
  assert.equal(report.usage.model, "fake-nemotron");
  assert.equal(t.app.reports.length, 1);
  assert.equal(t.transport.closed, "caller");
});

test("starts answering at the first pause and releases it the moment the turn ends", async () => {
  const t = setup({ script: () => ({ text: "Sure thing." }), transcribe: () => "Remind me to call mom." });
  void t.session.start();
  await t.caller.silence(300);
  await t.caller.talk(400);
  await t.caller.silence(600);
  await until(() => t.engine.spoken.includes("Sure thing."), 3000, "answer");
  assert.ok(t.logs.some((l) => l.event === "speculation_used"));
  // One hearing for the turn: the early one was used.
  assert.equal(t.engine.heard.length, 1);
  await t.session.end("caller");
});

test("a pause that wasn't the end: the early answer is dropped and the whole turn answered", async () => {
  const t = setup({
    script: (req) => ({ text: `Answering: ${lastUser(req)}`, delayMs: 30 }),
    transcribe: (ms) => (ms < 500 ? "Book a table" : "Book a table for two at seven"),
  });
  void t.session.start();
  await t.caller.silence(300);
  await t.caller.talk(320);
  await t.caller.silence(160); // a pause, but not the end
  await t.caller.talk(480);
  await t.caller.silence(600);
  await until(() => t.engine.spoken.some((s) => s.startsWith("Answering")), 3000, "answer");
  assert.deepEqual(
    t.engine.spoken.filter((s) => s.startsWith("Answering")),
    ["Answering: Book a table for two at seven"],
  );
  assert.ok(t.logs.some((l) => l.event === "reply_dropped"));
  await t.session.end("caller");
});

test("the caller cuts in: the bot stops mid-sentence, remembers where, and answers the new turn", async () => {
  let n = 0;
  const long = "Here is a very long answer that goes on and on with many many words so that there is plenty of time to interrupt it before it ends.";
  const t = setup({
    script: (req) => (lastUser(req).includes("stop") ? { text: "Okay, stopping." } : { text: long }),
    transcribe: () => (n++ === 0 ? "Tell me everything." : "Okay stop."),
  });
  void t.session.start();
  await t.caller.silence(1200);
  await t.caller.talk(400);
  await t.caller.silence(450);
  await until(() => t.transport.sentMs > 300, 3000, "bot talking");
  await sleep(300);
  await t.caller.talk(500);
  await until(() => t.transport.clears > 0, 3000, "clear");
  await t.caller.silence(600);
  await until(() => t.engine.spoken.includes("Okay, stopping."), 3000, "second answer");
  // What the talker remembers of the cut-off answer ends with the marker.
  const secondReq = t.llm.requests[t.llm.requests.length - 1];
  const cutOff = secondReq.messages.find((m) => m.role === "assistant" && m.content.includes("[cut off by the caller]"));
  assert.ok(cutOff, JSON.stringify(secondReq.messages));
  assert.ok(t.app.turns.some((x) => x.role === "bot" && x.interrupted), JSON.stringify(t.app.turns));
  await t.session.end("caller");
});

test("work for the bot's agent: a filler first, then the answer from the result", async () => {
  const t = setup({
    script: (req) => {
      const tool = [...req.messages].reverse().find((m) => m.role === "tool");
      if (tool?.role === "tool") return { text: `Your agent says: ${(JSON.parse(tool.content) as { answer: string }).answer}` };
      return { tools: [{ name: "ask_bot", args: { request: "What's on Diego's calendar tomorrow?" } }] };
    },
    transcribe: () => "What's on my calendar tomorrow?",
  });
  t.app.actResult = () => ({ text: "Standup at nine.", status: "ok", approvals: [] });
  void t.session.start();
  await t.caller.silence(1000);
  await t.caller.talk(400);
  await t.caller.silence(500);
  await until(() => t.engine.spoken.some((s) => s.startsWith("Your agent says")), 4000, "answer");
  assert.deepEqual(t.app.acts, ["What's on Diego's calendar tomorrow?"]);
  // "Let me check." was said while it worked (synthesized, or from the cache).
  assert.ok(t.engine.spoken.includes("Let me check.") || t.transport.sentMs > 0);
  assert.equal(t.engine.spoken.at(-1), "Your agent says: Standup at nine.");
  await t.session.end("caller");
});

test("slow work: the talker says it'll follow up, and passes the result on when it lands", async () => {
  const t = setup({
    script: (req) => {
      const last = req.messages[req.messages.length - 1];
      if (last.role === "user" && last.content.startsWith("<update>")) return { text: "Good news, the table is booked." };
      if (last.role === "tool") return { text: "Working on it, I'll let you know." };
      return { text: "Let me book that.", tools: [{ name: "ask_bot", args: { request: "Book a table for two at seven" } }] };
    },
    transcribe: () => "Book a table for two at seven.",
  });
  t.app.actDelayMs = 900;
  t.app.actResult = () => ({ text: "Booked at Luigi's for 7 PM.", status: "ok", approvals: [] });
  void t.session.start();
  await t.caller.silence(1000);
  await t.caller.talk(400);
  await t.caller.silence(500);
  await until(() => t.engine.spoken.includes("Working on it, I'll let you know."), 4000, "follow-up promise");
  await until(() => t.engine.spoken.includes("Good news, the table is booked."), 4000, "update");
  const updateReq = t.llm.requests.find((r) => lastUser(r).startsWith("<update>"));
  assert.match(lastUser(updateReq!), /Booked at Luigi's/);
  await t.session.end("caller");
});

test("goodbye: the talker hangs up after its last words", async () => {
  const t = setup({ script: () => ({ text: "Bye, Diego!", tools: [{ name: "end_call", args: { reason: "done" } }] }), transcribe: () => "That's all, bye." });
  const done = t.session.start();
  await t.caller.silence(1000);
  await t.caller.talk(300);
  await t.caller.silence(500);
  const report = await done;
  assert.equal(report.endedBy, "bot");
  assert.ok(t.engine.spoken.includes("Bye, Diego!"));
  assert.equal(t.app.reports.length, 1);
});

test("a PIN said out loud unlocks the owner, and never reaches the model", async () => {
  const t = setup({
    script: () => ({ text: "How can I help?" }),
    transcribe: () => "four four eight one",
    info: { speaker: "unverified", pinAvailable: true, greeting: "Hi, it's Otto. What's your PIN?" },
  });
  void t.session.start();
  await t.caller.silence(800);
  await t.caller.talk(400);
  await t.caller.silence(600);
  await until(() => t.engine.spoken.includes("Thanks, Diego. What can I do for you?"), 3000, "unlock");
  assert.deepEqual(t.app.pins, ["4481"]);
  for (const r of t.llm.requests) assert.ok(!JSON.stringify(r.messages).includes("four four"), "PIN went to the model");
  assert.equal(t.session.info.speaker, "owner");
  assert.ok(t.app.turns.some((x) => x.text === "(said a PIN)"));
  await t.session.end("caller");
});

test("a PIN typed on the keypad", async () => {
  const t = setup({ script: () => ({ text: "Hi." }), info: { speaker: "unverified", pinAvailable: true } });
  void t.session.start();
  for (const d of "4481#") t.transport.onDtmf?.(d);
  await until(() => t.app.pins.length === 1, 2000, "pin check");
  assert.deepEqual(t.app.pins, ["4481"]);
  await until(() => t.session.info.speaker === "owner", 2000, "owner");
  await t.session.end("caller");
});

test("noise that isn't words gets no answer", async () => {
  const t = setup({ script: () => ({ text: "Should not be said." }), transcribe: () => "" });
  void t.session.start();
  await t.caller.silence(800);
  await t.caller.talk(200);
  await t.caller.silence(600);
  await sleep(300);
  assert.ok(!t.engine.spoken.includes("Should not be said."));
  await t.session.end("caller");
});

test("nobody there: it asks, then says goodbye", async () => {
  const t = setup({ script: () => ({ text: "x" }), config: { idleMs: 400 } });
  const done = t.session.start();
  await until(() => t.engine.spoken.includes("Are you still there?"), 4000, "still there");
  const report = await done;
  assert.equal(report.endedBy, "bot");
  assert.ok(t.engine.spoken.includes("I'll let you go. Talk soon!"));
});

test("history is mended so the chat API accepts it", () => {
  const call = { id: "c1", type: "function" as const, function: { name: "ask_bot", arguments: "{}" } };
  const msgs: ChatMessage[] = [
    { role: "tool", tool_call_id: "orphan", content: "{}" },
    { role: "assistant", content: "", tool_calls: [{ ...call, id: "c0" }] },
    { role: "user", content: "hi" },
    { role: "assistant", content: "Checking.", tool_calls: [call] },
    { role: "user", content: "wait" },
    { role: "assistant", content: "", tool_calls: [{ ...call, id: "c2" }] },
    { role: "tool", tool_call_id: "c2", content: "{\"status\":\"done\"}" },
  ];
  assert.deepEqual(sanitizeHistory(msgs), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "Checking." },
    { role: "user", content: "wait" },
    { role: "assistant", content: "", tool_calls: [{ ...call, id: "c2" }] },
    { role: "tool", tool_call_id: "c2", content: "{\"status\":\"done\"}" },
  ]);
});

test("PINs said out loud", () => {
  assert.equal(pinFromSpeech("four four eight one"), "4481");
  assert.equal(pinFromSpeech("My PIN is 4 4 8 1."), "4481");
  assert.equal(pinFromSpeech("It's 4481"), "4481");
  assert.equal(pinFromSpeech("double five six oh"), "5560");
  assert.equal(pinFromSpeech("call me at 5"), null);
  assert.equal(pinFromSpeech("one two three"), null);
  assert.equal(pinFromSpeech("book it for 4 people on 1234 Main"), null);
});

// ---- hanging up early ------------------------------------------------------------------------

test("a caller who hung up before the call started: it ends at once, with nothing to post", async () => {
  const t = setup({ script: () => ({ text: "x" }) });
  t.transport.open = false;
  const report = await t.session.start();
  assert.equal(report.endedBy, "caller");
  assert.equal(report.durationS, 0);
  assert.deepEqual(report.turns, []);
  assert.deepEqual(t.engine.spoken, [], "no greeting for nobody");
  assert.equal(t.app.reports.length, 1);
});

test("a hang-up during the greeting ends the call at once, and a call the caller never spoke in has no transcript", async () => {
  const t = setup({ script: () => ({ text: "x" }) });
  const done = t.session.start();
  await until(() => t.engine.spoken.length >= 1, 2000, "greeting");
  const at = Date.now();
  t.transport.hangUp();
  const report = await done;
  assert.ok(Date.now() - at < 1000, `took ${Date.now() - at} ms`);
  assert.equal(report.endedBy, "caller");
  assert.deepEqual(report.turns, []);
});

// ---- the speech engine failing ---------------------------------------------------------------

test("the speech engine goes down mid-call: the caller hears sorry (made in advance) and the call ends", async () => {
  const t = setup({ script: () => ({ text: "Sure." }), transcribe: () => "Hello?" });
  await t.phrases.make(ENGINE_TROUBLE, "Aria", 8000); // as index.ts does at start-up
  const done = t.session.start();
  await until(() => t.transport.events.some((e) => e.type === "state" && e.state === "listening"), 3000, "greeting played");
  t.engine.down = true;
  t.engine.ready = false;
  const sentBefore = t.transport.sentMs;
  await t.caller.silence(300);
  await t.caller.talk(400);
  await t.caller.silence(500);
  const report = await done;
  assert.equal(report.endedBy, "error");
  assert.ok(t.transcript().includes(`bot: ${ENGINE_TROUBLE}`), JSON.stringify(t.transcript()));
  assert.ok(t.transport.sentMs > sentBefore, "the apology was played");
  assert.ok(t.logs.some((l) => l.event === "engine_trouble"));
});

test("a speech engine that keeps failing (though it says it's up) ends the call instead of leaving silence", async () => {
  const t = setup({ script: () => ({ text: "Sure." }), transcribe: () => "Hello?" });
  const done = t.session.start();
  await until(() => t.transport.events.some((e) => e.type === "state" && e.state === "listening"), 3000, "greeting played");
  t.engine.down = true;
  for (let i = 0; i < 2; i++) {
    await t.caller.silence(300);
    await t.caller.talk(400);
    await t.caller.silence(500);
  }
  const report = await done;
  assert.equal(report.endedBy, "error");
});
