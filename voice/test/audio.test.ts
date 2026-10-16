import { test } from "node:test";
import assert from "node:assert/strict";
import { mulawToPcm, pcmToMulaw, MULAW_SILENCE } from "../src/audio/mulaw.ts";
import { Resampler, resample } from "../src/audio/resample.ts";
import { bytesToPcm, concatPcm, dbfs, decodeWav, encodeWav, pcmToBytes } from "../src/audio/pcm.ts";

function sine(freq: number, rate: number, seconds: number, amplitude = 12000): Int16Array {
  const n = Math.round(rate * seconds);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / rate));
  return out;
}

/** Amplitude of one frequency (a single DFT bin), ignoring the first `skip` samples. */
function toneLevel(pcm: Int16Array, freq: number, rate: number, skip = 200): number {
  let re = 0;
  let im = 0;
  const n = pcm.length - skip;
  for (let i = skip; i < pcm.length; i++) {
    re += pcm[i] * Math.cos((2 * Math.PI * freq * i) / rate);
    im += pcm[i] * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return (2 * Math.sqrt(re * re + im * im)) / n;
}

test("μ-law: known codes and a round trip within the codec's step size", () => {
  assert.equal(MULAW_SILENCE, 0xff);
  assert.deepEqual([...pcmToMulaw(Int16Array.from([0, 32767, -32768]))], [0xff, 0x80, 0x00]);
  assert.deepEqual([...mulawToPcm(Uint8Array.from([0xff, 0x7f, 0x80, 0x00]))], [0, 0, 32124, -32124]);
  for (let s = -32768; s <= 32767; s += 37) {
    const back = mulawToPcm(pcmToMulaw(Int16Array.of(s)))[0];
    // Logarithmic steps: at most ~3% of the value (plus a few counts near zero).
    assert.ok(Math.abs(back - s) <= Math.max(8, Math.abs(s) * 0.035), `${s} → ${back}`);
  }
});

test("μ-law decode covers all 256 codes symmetrically", () => {
  const all = mulawToPcm(Uint8Array.from({ length: 256 }, (_, i) => i));
  for (let i = 0; i < 128; i++) assert.equal(all[i] + all[i + 128], 0);
});

test("resampling 8 kHz → 16 kHz keeps a 1 kHz tone and its level", () => {
  const out = resample(sine(1000, 8000, 0.5), 8000, 16000);
  assert.ok(Math.abs(out.length - 8000) <= 2);
  const level = toneLevel(out, 1000, 16000);
  assert.ok(Math.abs(level - 12000) < 400, `level ${level}`);
});

test("resampling 48 kHz → 16 kHz removes what can't be represented", () => {
  // 1 kHz stays; 11 kHz (above the new 8 kHz Nyquist) must not alias into the band.
  const mix = sine(1000, 48000, 0.5);
  const high = sine(11000, 48000, 0.5);
  for (let i = 0; i < mix.length; i++) mix[i] += high[i];
  const out = resample(mix, 48000, 16000);
  assert.ok(Math.abs(toneLevel(out, 1000, 16000) - 12000) < 400);
  // 11 kHz would fold to 5 kHz.
  assert.ok(toneLevel(out, 5000, 16000) < 60, `alias ${toneLevel(out, 5000, 16000)}`);
});

test("resampling in chunks gives the same samples as all at once", () => {
  const input = sine(440, 22050, 0.3);
  const whole = new Resampler(22050, 8000).process(input);
  const r = new Resampler(22050, 8000);
  const parts: Int16Array[] = [];
  for (let i = 0; i < input.length; i += 317) parts.push(r.process(input.subarray(i, i + 317)));
  assert.deepEqual([...concatPcm(parts)], [...whole]);
});

test("a steady level passes through unchanged", () => {
  const out = resample(new Int16Array(4000).fill(5000), 16000, 8000);
  for (const s of out.subarray(200, out.length - 200)) assert.ok(Math.abs(s - 5000) <= 3, `${s}`);
});

test("same rate in and out is a copy", () => {
  const input = Int16Array.from([1, 2, 3]);
  const out = resample(input, 16000, 16000);
  assert.deepEqual([...out], [1, 2, 3]);
  assert.notEqual(out, input);
});

test("WAV round trip, and PCM bytes at any alignment", () => {
  const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
  const wav = encodeWav(pcm, 16000);
  const back = decodeWav(wav);
  assert.equal(back.rate, 16000);
  assert.deepEqual([...back.pcm], [...pcm]);
  const shifted = Buffer.concat([Buffer.from([9]), pcmToBytes(pcm)]).subarray(1);
  assert.deepEqual([...bytesToPcm(shifted)], [...pcm]);
});

test("levels in dBFS", () => {
  assert.equal(dbfs(new Int16Array(100)), -100);
  assert.ok(Math.abs(dbfs(new Int16Array(100).fill(32767)) - 0) < 0.01);
  assert.ok(Math.abs(dbfs(sine(1000, 16000, 0.1, 32767)) + 3.01) < 0.05);
});
