import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createVoiceServer, SHUTDOWN_GOODBYE, type ServerDeps } from "../src/server.ts";
import { signCallToken } from "../src/auth.ts";
import { PhraseCache } from "../src/call/phrases.ts";
import { EnergyVad } from "../src/vad/vad.ts";
import { mulawToPcm, pcmToMulaw } from "../src/audio/mulaw.ts";
import { pcmToBytes } from "../src/audio/pcm.ts";
import { FakeApp, FakeEngine, FakeLlm, sessionInfo, sleep, until } from "./fixtures/fakes.ts";
import type { SessionInfo } from "../src/brain/app.ts";

const SECRET = "z".repeat(40);
const ORIGIN = "https://build-a-bot.site";

class SessionApp extends FakeApp {
  sessions: string[] = [];
  info: Partial<SessionInfo> = {};
  /** How long the app takes to say who's calling. */
  delayMs = 0;
  override async session(callId: string, kind: "web" | "phone"): Promise<SessionInfo> {
    this.sessions.push(callId);
    await sleep(this.delayMs);
    return sessionInfo({ callId, kind, ...this.info });
  }
}

async function start(over: Partial<ServerDeps> = {}) {
  const engine = new FakeEngine({ transcribe: () => "What's the weather?" });
  const app = new SessionApp();
  const deps: ServerDeps = {
    secret: SECRET,
    allowedOrigins: [ORIGIN],
    maxCalls: 2,
    webRate: 16000,
    engine,
    vad: new EnergyVad(),
    llm: new FakeLlm(() => ({ text: "Sunny and seventy." })),
    app,
    phrases: new PhraseCache(engine),
    ready: () => true,
    session: { turn: { minSpeechMs: 64, pauseMs: 96, endMs: 320 }, idleMs: 60_000 },
    log: process.env.DEBUG_VOICE ? (e, f) => console.log(Date.now() % 100000, e, JSON.stringify(f ?? {})) : undefined,
    ...over,
  };
  const voice = createVoiceServer(deps);
  await new Promise<void>((r) => voice.server.listen(0, "127.0.0.1", () => r()));
  const port = (voice.server.address() as AddressInfo).port;
  return { voice, port, engine, app, deps };
}

function token(kind: "web" | "phone", extra: Record<string, string> = {}) {
  return signCallToken(SECRET, { kind, callId: `call_${kind}`, botId: "bot_1", exp: Math.floor(Date.now() / 1000) + 60, ...extra });
}

/** A browser call's socket: what it's been sent, and how it closed. */
async function browser(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/call`, { origin: ORIGIN });
  const msgs: Record<string, unknown>[] = [];
  ws.on("message", (d, bin) => {
    if (bin) return;
    const msg = JSON.parse(d.toString()) as Record<string, unknown>;
    msgs.push(msg);
    // Play back instantly: echo marks.
    if (msg.type === "mark") ws.send(JSON.stringify({ type: "mark", name: msg.name }));
  });
  const closed = new Promise<number>((r) => ws.once("close", (c) => r(c)));
  await new Promise((r) => ws.once("open", r));
  return { ws, msgs, closed, hello: () => ws.send(JSON.stringify({ type: "hello", token: token("web"), sampleRate: 16000 })) };
}

/** Loud for `talkMs`, then quiet, as 16 kHz PCM16 frames. */
function speech(talkMs: number, quietMs: number, rate = 16000): Int16Array[] {
  const frames: Int16Array[] = [];
  const per = Math.round(rate * 0.02);
  for (let t = 0; t < talkMs + quietMs; t += 20) {
    const f = new Int16Array(per);
    if (t < talkMs) for (let i = 0; i < per; i++) f[i] = Math.round(9000 * Math.sin(i / 3));
    frames.push(f);
  }
  return frames;
}

test("health says whether calls can be taken", async () => {
  let ready = false;
  const s = await start({ ready: () => ready });
  let res = await fetch(`http://127.0.0.1:${s.port}/health`);
  assert.equal(res.status, 503);
  ready = true;
  res = await fetch(`http://127.0.0.1:${s.port}/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; talker: string; capacity: number };
  assert.equal(body.ok, true);
  assert.equal(body.talker, "fake-nemotron");
  assert.equal(body.capacity, 2);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/nope`)).status, 404);
  await s.voice.close();
});

test("a browser call: hello, greeting, a question, an answer, live transcript", async () => {
  const s = await start();
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/call`, { origin: ORIGIN });
  const events: Record<string, unknown>[] = [];
  let audioBytes = 0;
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      audioBytes += (data as Buffer).length;
      return;
    }
    const msg = JSON.parse(data.toString()) as Record<string, unknown>;
    events.push(msg);
    // Play back instantly: echo marks.
    if (msg.type === "mark") ws.send(JSON.stringify({ type: "mark", name: msg.name }));
  });
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "hello", token: token("web"), sampleRate: 16000 }));
  await until(() => events.some((e) => e.type === "ready"), 3000, "ready");
  const ready = events.find((e) => e.type === "ready")!;
  assert.equal(ready.outputRate, 16000);
  assert.equal(ready.bot, "Otto");
  await until(() => events.some((e) => e.type === "state" && e.state === "listening"), 3000, "greeting done");
  assert.ok(audioBytes > 0, "greeting audio");
  for (const f of speech(500, 600)) {
    ws.send(pcmToBytes(f));
    await sleep(5);
  }
  await until(() => events.some((e) => e.type === "transcript" && e.role === "bot" && e.text === "Sunny and seventy."), 4000, "answer");
  assert.ok(events.some((e) => e.type === "transcript" && e.role === "caller" && e.text === "What's the weather?"));
  await until(() => events.some((e) => e.type === "latency"), 3000, "latency");
  ws.send(JSON.stringify({ type: "hangup" }));
  await until(() => s.app.reports.length === 1, 3000, "report");
  assert.deepEqual(s.app.sessions, ["call_web"]);
  await s.voice.close();
});

test("browser calls need the app's origin and a good token", async () => {
  const s = await start();
  const wrongOrigin = new WebSocket(`ws://127.0.0.1:${s.port}/call`, { origin: "https://evil.example" });
  const err = await new Promise<Error>((r) => wrongOrigin.once("error", r));
  assert.match(err.message, /403/);

  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/call`, { origin: ORIGIN });
  const msgs: Record<string, unknown>[] = [];
  ws.on("message", (d, bin) => !bin && msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "hello", token: token("phone"), sampleRate: 16000 }));
  const code = await new Promise<number>((r) => ws.once("close", (c) => r(c)));
  assert.equal(code, 4001);
  assert.match(String(msgs[0]?.message), /expired/);
  assert.deepEqual(s.app.sessions, []);
  await s.voice.close();
});

test("a phone call over Twilio Media Streams: μ-law both ways, marks, keypad", async () => {
  const s = await start();
  s.app.info = { speaker: "unverified", pinAvailable: true, greeting: "Hi, it's Otto. What's your PIN?" };
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/twilio`);
  const out: { event: string; streamSid?: string; media?: { payload: string }; mark?: { name: string } }[] = [];
  ws.on("message", (d) => {
    const msg = JSON.parse(d.toString());
    out.push(msg);
    if (msg.event === "mark") ws.send(JSON.stringify({ event: "mark", streamSid: "MZ1", mark: { name: msg.mark.name } }));
  });
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
  ws.send(JSON.stringify({ event: "start", streamSid: "MZ1", start: { streamSid: "MZ1", callSid: "CA1", accountSid: "AC1", customParameters: { token: token("phone", { callSid: "CA1" }) } } }));
  await until(() => out.some((m) => m.event === "media"), 3000, "greeting audio");
  const media = out.find((m) => m.event === "media")!;
  assert.equal(media.streamSid, "MZ1");
  // The greeting is real μ-law audio.
  const pcm = mulawToPcm(Buffer.from(media.media!.payload, "base64"));
  assert.ok(pcm.some((v) => v !== 0));
  // Keypad PIN.
  for (const digit of "4481#") ws.send(JSON.stringify({ event: "dtmf", streamSid: "MZ1", dtmf: { track: "inbound_track", digit } }));
  await until(() => s.app.pins.length === 1, 3000, "pin");
  assert.deepEqual(s.app.pins, ["4481"]);
  // Then speech, as 8 kHz μ-law.
  await sleep(200);
  for (const f of speech(500, 700, 8000)) {
    ws.send(JSON.stringify({ event: "media", streamSid: "MZ1", media: { track: "inbound", payload: Buffer.from(pcmToMulaw(f)).toString("base64") } }));
    await sleep(5);
  }
  await until(() => s.app.turns.some((t) => t.role === "bot" && t.text === "Sunny and seventy."), 5000, "answer");
  ws.send(JSON.stringify({ event: "stop", streamSid: "MZ1", stop: { callSid: "CA1" } }));
  await until(() => s.app.reports.length === 1, 3000, "report");
  assert.equal(s.app.reports[0].endedBy, "caller");
  await s.voice.close();
});

test("a phone stream with a token for another call is dropped", async () => {
  const s = await start();
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/twilio`);
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ event: "start", streamSid: "MZ2", start: { streamSid: "MZ2", callSid: "CA_OTHER", customParameters: { token: token("phone", { callSid: "CA1" }) } } }));
  await new Promise((r) => ws.once("close", r));
  assert.deepEqual(s.app.sessions, []);
  await s.voice.close();
});

test("over capacity, the browser hears the line is busy", async () => {
  const s = await start({ maxCalls: 1 });
  const first = new WebSocket(`ws://127.0.0.1:${s.port}/call`, { origin: ORIGIN });
  await new Promise((r) => first.once("open", r));
  first.send(JSON.stringify({ type: "hello", token: token("web"), sampleRate: 16000 }));
  await until(() => s.voice.calls() === 1, 3000, "first call");
  const second = new WebSocket(`ws://127.0.0.1:${s.port}/call`, { origin: ORIGIN });
  const msgs: Record<string, unknown>[] = [];
  second.on("message", (d, bin) => !bin && msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => second.once("open", r));
  second.send(JSON.stringify({ type: "hello", token: token("web"), sampleRate: 16000 }));
  const code = await new Promise<number>((r) => second.once("close", (c) => r(c)));
  assert.equal(code, 4003);
  assert.match(String(msgs[0]?.message), /busy/);
  first.close();
  await s.voice.close();
});

test("two callers at once can't both take the last line", async () => {
  const s = await start({ maxCalls: 1 });
  s.app.delayMs = 300; // the app takes a moment to say who's calling
  const a = await browser(s.port);
  const b = await browser(s.port);
  a.hello();
  b.hello();
  const code = await Promise.race([a.closed, b.closed, sleep(3000).then(() => "neither was turned away")]);
  assert.equal(code, 4003);
  assert.equal(s.app.sessions.length, 1, "both were let in");
  assert.equal(s.voice.calls(), 1);
  a.ws.close();
  b.ws.close();
  await s.voice.close();
});

test("health says no while the speech engine is down or restarting, and calls aren't taken", async () => {
  const s = await start();
  s.engine.ready = false;
  const res = await fetch(`http://127.0.0.1:${s.port}/health`);
  assert.equal(res.status, 503);
  const body = (await res.json()) as { ok: boolean; engine: { ready: boolean } };
  assert.equal(body.ok, false);
  assert.equal(body.engine.ready, false);
  const call = await browser(s.port);
  call.hello();
  assert.equal(await call.closed, 4003);
  assert.match(String(call.msgs[0]?.message), /isn't available/);
  assert.deepEqual(s.app.sessions, []);
  s.engine.ready = true;
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/health`)).status, 200);
  await s.voice.close();
});

test("a caller who hangs up while the call is being set up is reported at once, and frees the line", async () => {
  const s = await start({ maxCalls: 1 });
  s.app.delayMs = 300;
  const call = await browser(s.port);
  call.hello();
  await until(() => s.app.sessions.length === 1, 2000, "session asked for");
  call.ws.close();
  await until(() => s.app.reports.length === 1, 2000, "report");
  assert.equal(s.app.reports[0].endedBy, "caller");
  assert.deepEqual(s.app.reports[0].turns, [], "nothing to post in the chat");
  assert.equal(s.app.reports[0].durationS, 0);
  assert.ok(!s.engine.spoken.includes("Hey Diego, it's Otto."), "greeted nobody");
  await until(() => s.voice.calls() === 0, 2000, "line free");
  await s.voice.close();
});

test("shutting down: a call hears a goodbye and is reported to the app before the server stops", async () => {
  const s = await start();
  const call = await browser(s.port);
  call.hello();
  await until(() => call.msgs.some((e) => e.type === "state" && e.state === "listening"), 3000, "greeting done");
  for (const f of speech(500, 600)) {
    call.ws.send(pcmToBytes(f));
    await sleep(5);
  }
  await until(() => call.msgs.some((e) => e.type === "transcript" && e.role === "bot" && e.text === "Sunny and seventy."), 4000, "answer");
  await s.voice.close();
  assert.equal(s.app.reports.length, 1);
  assert.equal(s.app.reports[0].endedBy, "error");
  assert.ok(s.app.reports[0].turns.some((t) => t.role === "bot" && t.text === SHUTDOWN_GOODBYE));
  assert.ok(s.engine.spoken.includes(SHUTDOWN_GOODBYE));
  assert.equal(s.voice.calls(), 0);
});

test("shutting down: a call still being set up is ended and reported too", async () => {
  const s = await start();
  s.app.delayMs = 300;
  const call = await browser(s.port);
  call.hello();
  await until(() => s.app.sessions.length === 1, 2000, "session asked for");
  await s.voice.close();
  assert.equal(s.app.reports.length, 1);
  assert.equal(s.app.reports[0].endedBy, "error");
  assert.equal(s.voice.calls(), 0);
});
