/**
 * Speech made slower than it plays: without pacing the far end runs dry every chunk (the voice
 * stutters); with it, each sentence waits until enough is ready, then plays through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Speaker, SpeechPace } from "../src/call/speaker.ts";
import { FakeEngine, FakeTransport, sleep, until } from "./fixtures/fakes.ts";

/** A transport that plays like a phone or browser: tracks when the far end has nothing to play. */
class PlayingTransport extends FakeTransport {
  private playhead = 0;
  private started = false;
  /** Times the far end ran out of audio in the middle of speech. */
  gaps = 0;

  override sendAudio(pcm: Int16Array): void {
    super.sendAudio(pcm);
    const now = performance.now();
    if (!this.started) {
      this.started = true;
      this.playhead = now;
    } else if (now > this.playhead + 2) {
      this.gaps++;
    }
    this.playhead = Math.max(this.playhead, now) + (pcm.length * 1000) / this.outputRate;
  }
}

const SENTENCE = "word ".repeat(30).trim(); // 1.8 s of the fake engine's audio

async function speakOnce(pace: SpeechPace | undefined): Promise<PlayingTransport> {
  // 25 ms of work for every 20 ms of audio: 0.8x real time, like Magpie on a small CPU.
  const engine = new FakeEngine({ speakFactor: 1.25 });
  const transport = new PlayingTransport("phone");
  const speaker = new Speaker({ engine, transport, pace });
  speaker.say(SENTENCE);
  for (let i = 0; i < 400 && (speaker.busy || transport.sentMs === 0); i++) await sleep(10);
  speaker.close();
  return transport;
}

test("without pacing, speech made at 0.8x real time runs dry again and again", async () => {
  const t = await speakOnce(undefined);
  assert.ok(t.sentMs > 1700, `${t.sentMs} ms sent`);
  assert.ok(t.gaps >= 5, `${t.gaps} gaps`);
});

test("with pacing, the sentence waits until it can play through without a gap", async () => {
  // msPerChar matched to the fake engine (60 ms a 5-character word).
  const t = await speakOnce(new SpeechPace(0.8, 12));
  assert.ok(t.sentMs > 1700, `${t.sentMs} ms sent`);
  assert.ok(t.gaps <= 1, `${t.gaps} gaps`);
});

test("a sentence the engine goes quiet on is given up on as an error, and the next one is said", async () => {
  const engine = new FakeEngine();
  engine.hung = true;
  const transport = new FakeTransport("phone");
  const errors: string[] = [];
  const starts: { text: string; made: boolean }[] = [];
  const speaker = new Speaker({ engine, transport, stallMs: 50, events: { onError: (e) => errors.push(e.message), onAudioStart: (p) => starts.push(p) } });
  speaker.say("hello there");
  await until(() => errors.length === 1, 3000, "given up");
  assert.match(errors[0], /no audio from the speech engine/);
  engine.hung = false;
  speaker.say("second one");
  await until(() => starts.length === 1, 3000, "next sentence");
  assert.equal(starts[0].text, "second one");
  assert.equal(starts[0].made, true, "made by the engine");
  // Pre-made audio (a filler from the cache) didn't come from the engine.
  speaker.say("Mm-hm.", new Int16Array(800).fill(1000));
  await until(() => starts.length === 2, 3000, "filler");
  assert.equal(starts[1].made, false);
  speaker.close();
});

test("stopping a sentence a stuck engine is making doesn't wait for the engine", async () => {
  const engine = new FakeEngine();
  engine.hung = true;
  const transport = new FakeTransport("phone");
  const errors: string[] = [];
  const speaker = new Speaker({ engine, transport, stallMs: 60_000, events: { onError: (e) => errors.push(e.message) } });
  speaker.say("hello there");
  await sleep(30);
  assert.ok(speaker.busy);
  speaker.stop();
  await until(() => !speaker.busy, 1000, "quiet");
  assert.deepEqual(errors, [], "a stop isn't an engine error");
  speaker.close();
});

test("pace: fast machines don't wait; slow ones wait for about the shortfall", () => {
  assert.equal(new SpeechPace(1.3, 62).leadMs(100), 0);
  const slow = new SpeechPace(0.8, 62).leadMs(100); // 6.2 s of speech, 20% short
  assert.ok(slow > 1300 && slow < 1700, `${slow}`);
  assert.equal(new SpeechPace(0.1, 62).leadMs(1000), 6000);
});

test("pace learns the machine's speed and the voice's length from what it makes", () => {
  const pace = new SpeechPace(1, 62);
  for (let i = 0; i < 6; i++) pace.observe(4000, 5000, 4300, 70);
  assert.ok(Math.abs(pace.rate - 0.8) < 0.03, `${pace.rate}`);
  assert.ok(Math.abs(pace.msPerChar - 4300 / 70) < 3, `${pace.msPerChar}`);
  // Pieces too short to measure don't move it.
  pace.observe(300, 900, 400, 8);
  assert.ok(Math.abs(pace.rate - 0.8) < 0.03);
});
