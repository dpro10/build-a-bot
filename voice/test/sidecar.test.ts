import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodeFrame, FrameDecoder, hearPayload, SidecarEngine, speakPayload } from "../src/speech/sidecar.ts";
import { concatPcm } from "../src/audio/pcm.ts";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.ts", import.meta.url));

test("frames survive being cut anywhere", () => {
  const a = encodeFrame(0x82, 7, Buffer.from([1, 2, 3, 4, 5]));
  const b = encodeFrame(0x83, 0xfffffff0, Buffer.from("{}"));
  const c = encodeFrame(0x85, 1);
  const all = Buffer.concat([a, b, c]);
  for (let cut = 1; cut < all.length; cut++) {
    const d = new FrameDecoder();
    const frames = [...d.push(all.subarray(0, cut)), ...d.push(all.subarray(cut))];
    assert.deepEqual(
      frames.map((f) => [f.type, f.id, [...f.payload]]),
      [
        [0x82, 7, [1, 2, 3, 4, 5]],
        [0x83, 0xfffffff0, [...Buffer.from("{}")]],
        [0x85, 1, []],
      ],
    );
  }
});

test("request payloads are laid out as the C++ side reads them", () => {
  const s = speakPayload("Hi é", { sampleRate: 8000, voice: "Aria", language: "en-US" });
  assert.equal(s.readUInt32LE(0), 8000);
  assert.equal(s.readUInt16LE(4), 4);
  assert.equal(s.subarray(6, 10).toString(), "Aria");
  assert.equal(s.readUInt16LE(10), 5);
  assert.equal(s.subarray(12, 17).toString(), "en-US");
  assert.equal(s.subarray(17).toString(), "Hi é");

  const h = hearPayload(Int16Array.from([1, -1]), 16000, { phrases: ["Otto", "  Diego  Prozzi "] });
  assert.equal(h.readUInt32LE(0), 16000);
  assert.equal(h.readUInt16LE(4), 0);
  const plen = h.readUInt32LE(6);
  assert.equal(h.subarray(10, 10 + plen).toString(), "Otto\nDiego Prozzi");
  assert.deepEqual([...h.subarray(10 + plen)], [1, 0, 255, 255]);
});

/** A sidecar on the fake engine, closed when the test ends whatever happens. */
function fake(t: { after: (fn: () => Promise<void>) => void }): SidecarEngine {
  const engine = new SidecarEngine({ bin: process.execPath, args: [FAKE], log: () => {} });
  t.after(() => engine.close());
  return engine;
}

test("speaks in a stream, with samples split across frames put back together", async (t) => {
  const engine = fake(t);
  await engine.start();
  assert.deepEqual(engine.info.voices, ["Aria", "Leo"]);
  const parts: Int16Array[] = [];
  const spoken = await engine.speak("one two three", { sampleRate: 8000 }, (pcm) => parts.push(pcm));
  assert.equal(spoken.status, "ok");
  const pcm = concatPcm(parts);
  assert.equal(pcm.length, 1200);
  for (let i = 0; i < pcm.length; i++) assert.equal(pcm[i], Math.round(8000 * Math.sin(i / 3)) + 0);
});

test("an abort stops the voice mid-sentence", async (t) => {
  const engine = fake(t);
  await engine.start();
  const ac = new AbortController();
  let got = 0;
  const p = engine.speak(Array(200).fill("word").join(" "), { sampleRate: 16000, signal: ac.signal }, (pcm) => {
    got += pcm.length;
    if (got > 2000) ac.abort();
  });
  const spoken = await p;
  assert.equal(spoken.status, "cancelled");
  assert.ok(got < 16000 * 0.05 * 200);
});

test("hears, with the words to listen for", async (t) => {
  const engine = fake(t);
  await engine.start();
  const heard = await engine.hear(new Int16Array(16000), 16000, { phrases: ["Otto"] });
  assert.equal(heard.text, "heard 16000 samples at 16000 listening for Otto");
  assert.equal(heard.language, "en");
  await engine.ping();
});

test("when it crashes, waiting requests fail and it comes back", async (t) => {
  const engine = fake(t);
  await engine.start();
  const crashed = engine.speak("crash", { sampleRate: 8000 }, () => {});
  await assert.rejects(crashed, /speech engine exited/);
  await engine.start();
  const heard = await engine.hear(new Int16Array(10), 8000);
  assert.match(heard.text, /heard 10 samples/);
});

test("a missing binary fails start() right away", async () => {
  const engine = new SidecarEngine({ bin: "/nonexistent/nemo-voice", args: [], log: () => {} });
  await assert.rejects(engine.start(), /couldn't start/);
  await engine.close();
});

const BIN = process.env.NEMO_VOICE_BIN;
const ARGS = process.env.NEMO_VOICE_ARGS;
test("the real NVIDIA engine: Magpie speaks, Parakeet hears it back", { skip: !BIN || !existsSync(BIN) ? "set NEMO_VOICE_BIN and NEMO_VOICE_ARGS" : false, timeout: 600_000 }, async (t) => {
  const engine = new SidecarEngine({ bin: BIN!, args: (ARGS ?? "").split(/\s+/).filter(Boolean), log: () => {} });
  t.after(() => engine.close());
  await engine.start();
  assert.ok(engine.info.tts && engine.info.asr);
  const parts: Int16Array[] = [];
  const text = "Your flight to Austin leaves at seven forty tomorrow morning.";
  const spoken = await engine.speak(text, { sampleRate: 16000, voice: "Aria" }, (pcm) => parts.push(pcm));
  assert.equal(spoken.status, "ok", spoken.error);
  const heard = await engine.hear(concatPcm(parts), 16000, { phrases: ["Austin"] });
  const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
  const said = words(text);
  const got = new Set(words(heard.text));
  const missing = said.filter((w) => !got.has(w));
  assert.ok(missing.length <= 1, `heard "${heard.text}"`);
});
