import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createVoiceServer, type ServerDeps } from "../src/server.ts";
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
  override async session(callId: string, kind: "web" | "phone"): Promise<SessionInfo> {
    this.sessions.push(callId);
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
