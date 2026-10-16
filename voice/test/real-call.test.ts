/**
 * A whole call on the real NVIDIA models: Magpie makes a caller's voice, the caller rings the voice
 * server (browser and phone paths), Silero finds the turn, Parakeet hears it, the talker's reply is
 * spoken by Magpie, and Parakeet checks the reply was intelligible. The talker is scripted (no
 * model key here). Needs NEMO_VOICE_BIN, NEMO_VOICE_ARGS and SILERO_VAD_MODEL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createVoiceServer } from "../src/server.ts";
import { signCallToken } from "../src/auth.ts";
import { PhraseCache, FILLERS } from "../src/call/phrases.ts";
import { SidecarEngine } from "../src/speech/sidecar.ts";
import { SileroVad } from "../src/vad/vad.ts";
import { concatPcm, bytesToPcm, pcmToBytes } from "../src/audio/pcm.ts";
import { resample } from "../src/audio/resample.ts";
import { mulawToPcm, pcmToMulaw } from "../src/audio/mulaw.ts";
import { FakeApp, FakeLlm, sessionInfo, sleep, until } from "./fixtures/fakes.ts";
import type { SessionInfo } from "../src/brain/app.ts";

const BIN = process.env.NEMO_VOICE_BIN;
const ARGS = process.env.NEMO_VOICE_ARGS;
const VAD = process.env.SILERO_VAD_MODEL;
const skip = !BIN || !existsSync(BIN) || !VAD || !existsSync(VAD) ? "set NEMO_VOICE_BIN, NEMO_VOICE_ARGS and SILERO_VAD_MODEL" : false;

const SECRET = "r".repeat(40);
const ORIGIN = "https://build-a-bot.site";
const QUESTION = "What's on my calendar tomorrow morning?";
const ANSWER = "You have a dentist appointment at nine thirty, then lunch with Maria at noon.";

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

function overlap(said: string, heard: string): number {
  const h = new Set(words(heard));
  const w = words(said);
  return w.filter((x) => h.has(x)).length / w.length;
}

test("a real call: Magpie's caller, Silero, Parakeet, the talker, Magpie's answer", { skip, timeout: 900_000 }, async (t) => {
  const engine = new SidecarEngine({ bin: BIN!, args: (ARGS ?? "").split(/\s+/).filter(Boolean), log: () => {} });
  t.after(() => engine.close());
  await engine.start();
  const vad = await SileroVad.load(VAD!);
  const phrases = new PhraseCache(engine);
  await phrases.warm(FILLERS, engine.info.voice, 16000);
  await phrases.warm(FILLERS, engine.info.voice, 8000);

  // The caller: a different Magpie voice, at 16 kHz.
  const callerVoice = engine.info.voices.find((v) => v !== engine.info.voice) ?? engine.info.voice;
  const parts: Int16Array[] = [];
  await engine.speak(QUESTION, { sampleRate: 16000, voice: callerVoice }, (p) => parts.push(p));
  const question = concatPcm(parts);

  const llm = new FakeLlm((req) => {
    const last = [...req.messages].reverse().find((m) => m.role === "user");
    return { text: last && last.role === "user" && /calendar/i.test(last.content) ? ANSWER : "Sorry, could you say that again?" };
  });
  const app = new (class extends FakeApp {
    override async session(callId: string, kind: "web" | "phone"): Promise<SessionInfo> {
      return sessionInfo({ callId, kind, phrases: ["Otto", "Diego", "Maria"] });
    }
  })();
  const logs: { event: string; fields?: Record<string, unknown> }[] = [];
  const voice = createVoiceServer({
    secret: SECRET,
    allowedOrigins: [ORIGIN],
    maxCalls: 2,
    webRate: 16000,
    engine,
    vad,
    llm,
    app,
    phrases,
    ready: () => true,
    log: (event, fields) => logs.push({ event, fields }),
  });
  t.after(() => voice.close());
  await new Promise<void>((r) => voice.server.listen(0, "127.0.0.1", () => r()));
  const port = (voice.server.address() as AddressInfo).port;
  const token = (kind: "web" | "phone", callSid?: string) =>
    signCallToken(SECRET, { kind, callId: `call_${kind}`, botId: "bot_1", callSid, exp: Math.floor(Date.now() / 1000) + 300 });

  // ---- browser ----
  {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/call`, { origin: ORIGIN });
    const events: Record<string, unknown>[] = [];
    const audio: Int16Array[] = [];
    let answerAudioFrom = -1;
    ws.on("message", (data, bin) => {
      if (bin) {
        audio.push(bytesToPcm(data as Buffer));
        return;
      }
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      events.push(msg);
      if (msg.type === "mark") setTimeout(() => ws.send(JSON.stringify({ type: "mark", name: msg.name })), 0);
      if (msg.type === "say" && msg.text === ANSWER && answerAudioFrom < 0) answerAudioFrom = audio.length;
    });
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "hello", token: token("web"), sampleRate: 16000 }));
    await until(() => events.some((e) => e.type === "ready"), 10_000, "ready");
    await until(() => events.some((e) => e.type === "state" && e.state === "listening"), 30_000, "greeting played");
    // Speak in real time, 20 ms at a time, then stay quiet.
    const frame = 320;
    const send = async (pcm: Int16Array) => {
      for (let i = 0; i < pcm.length; i += frame) {
        ws.send(pcmToBytes(pcm.subarray(i, i + frame)));
        await sleep(20);
      }
    };
    await send(new Int16Array(16000 * 0.5));
    await send(question);
    const quiet = send(new Int16Array(16000 * 6));
    await until(() => events.some((e) => e.type === "transcript" && e.role === "bot" && e.text === ANSWER), 60_000, "answer");
    await quiet;
    const heardQuestion = events.find((e) => e.type === "transcript" && e.role === "caller") as { text: string } | undefined;
    assert.ok(heardQuestion, "the caller's turn was heard");
    assert.ok(overlap(QUESTION, heardQuestion.text) >= 0.8, `heard "${heardQuestion.text}"`);
    const latency = events.find((e) => e.type === "latency") as { ms: number } | undefined;
    assert.ok(latency, "latency measured");
    // The answer, as audio, says what it should.
    await until(() => events.filter((e) => e.type === "state" && e.state === "listening").length >= 2, 60_000, "answer played");
    const answerAudio = concatPcm(audio.slice(Math.max(0, answerAudioFrom)));
    const back = await engine.hear(answerAudio, 16000, { phrases: ["Maria"] });
    assert.ok(overlap(ANSWER, back.text) >= 0.7, `answer heard back as "${back.text}"`);
    t.diagnostic(`browser: caller heard as "${heardQuestion.text}"; answer in ${latency.ms} ms; answer heard back as "${back.text}"`);
    ws.send(JSON.stringify({ type: "hangup" }));
    await until(() => app.reports.length === 1, 10_000, "report");
  }

  // ---- phone: 8 kHz μ-law both ways ----
  {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/twilio`);
    const out: { event: string; media?: { payload: string }; mark?: { name: string } }[] = [];
    const audio: Int16Array[] = [];
    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      out.push(msg);
      if (msg.event === "media") audio.push(mulawToPcm(Buffer.from(msg.media.payload, "base64")));
      if (msg.event === "mark") setTimeout(() => ws.send(JSON.stringify({ event: "mark", streamSid: "MZ9", mark: { name: msg.mark.name } })), 0);
    });
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ event: "start", streamSid: "MZ9", start: { streamSid: "MZ9", callSid: "CA9", accountSid: "AC1", customParameters: { token: token("phone", "CA9") } } }));
    await until(() => out.some((m) => m.event === "media"), 30_000, "greeting");
    await sleep(2500);
    const before = audio.length;
    const phoneQuestion = resample(question, 16000, 8000);
    const send = async (pcm: Int16Array) => {
      for (let i = 0; i < pcm.length; i += 160) {
        ws.send(JSON.stringify({ event: "media", streamSid: "MZ9", media: { track: "inbound", payload: Buffer.from(pcmToMulaw(pcm.subarray(i, i + 160))).toString("base64") } }));
        await sleep(20);
      }
    };
    await send(phoneQuestion);
    const quiet = send(new Int16Array(8000 * 6));
    await until(() => app.turns.filter((x) => x.role === "bot" && x.text === ANSWER).length >= 2, 60_000, "phone answer");
    await quiet;
    const callerTurns = app.turns.filter((x) => x.role === "caller");
    const heardOnPhone = callerTurns[callerTurns.length - 1].text;
    assert.ok(overlap(QUESTION, heardOnPhone) >= 0.7, `heard over the phone as "${heardOnPhone}"`);
    await sleep(6000);
    const reply8k = concatPcm(audio.slice(before));
    const back = await engine.hear(reply8k, 8000, { phrases: ["Maria"] });
    assert.ok(overlap(ANSWER, back.text) >= 0.6, `phone answer heard back as "${back.text}"`);
    const latencies = logs.filter((l) => l.event === "latency").map((l) => l.fields?.ms);
    t.diagnostic(`phone: caller heard as "${heardOnPhone}"; answer heard back as "${back.text}"; latencies ${JSON.stringify(latencies)}`);
    ws.send(JSON.stringify({ event: "stop", streamSid: "MZ9" }));
    await until(() => app.reports.length === 2, 10_000, "phone report");
  }
});
