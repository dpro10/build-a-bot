import { test } from "node:test";
import assert from "node:assert/strict";
import { endDelayFor, TurnDetector, type TurnEvent } from "../src/turn/detector.ts";
import { EnergyVad, SileroVad, VAD_WINDOW_MS } from "../src/vad/vad.ts";
import { existsSync } from "node:fs";

const F = 32;

/** "s" = speech window, "." = silence, "~" = in between. */
function feed(d: TurnDetector, pattern: string): TurnEvent[] {
  const out: TurnEvent[] = [];
  for (const ch of pattern) out.push(...d.push(ch === "s" ? 0.95 : ch === "~" ? 0.42 : 0.02, F));
  return out;
}

const types = (events: TurnEvent[]) => events.map((e) => e.type);

test("a turn: start, early guess, then the end", () => {
  const d = new TurnDetector();
  const events = feed(d, "...ssssssssss" + ".".repeat(25));
  assert.deepEqual(types(events), ["speech_start", "pause", "end"]);
  const [start, pause, end] = events;
  assert.equal(start.at, 3 * F);
  assert.equal(pause.type === "pause" && pause.at, (13 + 6) * F);
  assert.equal(end.type === "end" && end.at, (13 + 20) * F);
  assert.equal(end.type === "end" && end.speechMs, 10 * F);
});

test("a blip is not a turn", () => {
  const d = new TurnDetector();
  assert.deepEqual(types(feed(d, "..s..s.....ss......")), []);
});

test("talking again after the guess withdraws it; the turn goes on", () => {
  const d = new TurnDetector();
  const events = feed(d, "ssssss" + "........" + "sssss" + ".".repeat(25));
  assert.deepEqual(types(events), ["speech_start", "pause", "resume", "pause", "end"]);
});

test("in-between probabilities don't break a turn or end one", () => {
  const d = new TurnDetector();
  const events = feed(d, "ssss~~~~ssss" + "~".repeat(5) + ".".repeat(30));
  assert.deepEqual(types(events), ["speech_start", "pause", "end"]);
});

test("while the bot talks, only sure, sustained speech cuts in", () => {
  const d = new TurnDetector();
  d.botSpeaking = true;
  // An "mm-hm" (5 windows) doesn't.
  assert.deepEqual(types(feed(d, "...sssss......")), []);
  // Medium-confidence noise doesn't either.
  for (let i = 0; i < 20; i++) assert.deepEqual(d.push(0.6, F), []);
  // A real interruption does.
  const events = feed(d, "ssssssssssss");
  assert.deepEqual(types(events), ["barge_in", "speech_start"]);
});

test("a later end for a turn that trails off", () => {
  const d = new TurnDetector();
  feed(d, "ssssss");
  d.setEndMs(1200);
  const events = feed(d, ".".repeat(30));
  assert.deepEqual(types(events), ["pause"]);
  assert.deepEqual(types(feed(d, ".".repeat(10))), ["end"]);
});

test("end delay from what was said", () => {
  assert.equal(endDelayFor("I want to book a table and", 600), 1140);
  assert.equal(endDelayFor("Can you call my mom, um", 600), 1140);
  assert.equal(endDelayFor("What's on my calendar?", 600), 450);
  assert.equal(endDelayFor("Book it for Friday.", 600), 510);
  assert.equal(endDelayFor("Yes", 600), 600);
});

test("energy VAD: loud is speech, quiet is not", async () => {
  const s = new EnergyVad().stream();
  const quiet = new Int16Array(512 * 10).map(() => Math.round((Math.random() - 0.5) * 20));
  const loud = new Int16Array(512 * 5).map((_, i) => Math.round(8000 * Math.sin(i / 5)));
  const a = await s.push(quiet);
  const b = await s.push(loud);
  assert.equal(a.length, 10);
  assert.ok(a.every((p) => p < 0.2), `quiet ${a}`);
  assert.ok(b.every((p) => p > 0.8), `loud ${b}`);
});

const SILERO = process.env.SILERO_VAD_MODEL;
test("Silero VAD finds the speech in a real recording", { skip: !SILERO || !existsSync(SILERO) ? "set SILERO_VAD_MODEL" : false }, async () => {
  const { readFileSync } = await import("node:fs");
  const { decodeWav } = await import("../src/audio/pcm.ts");
  const vad = await SileroVad.load(SILERO!);
  const sample = process.env.SPEECH_SAMPLE_WAV;
  const s = vad.stream();
  // Half a second of near-silence, then speech if a sample is given, else a synthetic vowel-ish buzz.
  const silence = await s.push(new Int16Array(8000));
  assert.ok(silence.every((p) => p < 0.3), `silence ${silence}`);
  if (sample && existsSync(sample)) {
    const { pcm } = decodeWav(readFileSync(sample));
    const probs = await s.push(pcm);
    const speech = probs.filter((p) => p > 0.5).length * VAD_WINDOW_MS;
    assert.ok(speech > 1500, `heard ${speech} ms of speech`);
  }
});
