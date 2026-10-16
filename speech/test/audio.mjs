/** Test audio: a WAV from samples, and a short tone in any format ffmpeg can write. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** A 16-bit PCM WAV (16 kHz mono unless said otherwise), optionally with a LIST chunk before the data. */
export function wav(samples, { rate = 16000, channels = 1, extraChunk = false } = {}) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const extra = extraChunk ? Buffer.concat([Buffer.from("LIST", "latin1"), u32(4), Buffer.from("INFO", "latin1")]) : Buffer.alloc(0);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "latin1");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * channels * 2, 16);
  fmt.writeUInt16LE(channels * 2, 20);
  fmt.writeUInt16LE(16, 22);
  const head = Buffer.concat([Buffer.from("data", "latin1"), u32(data.length)]);
  const body = Buffer.concat([Buffer.from("WAVE", "latin1"), fmt, extra, head, data]);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), u32(body.length), body]);
}

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

/** `seconds` of a voice-like tone, encoded by ffmpeg (needs ffmpeg). */
export function tone(seconds, { codec = "libopus", ext = "webm", rate = 48000, channels = 1 } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "speech-test-"));
  const file = path.join(dir, `tone.${ext}`);
  try {
    const r = spawnSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", `sine=frequency=180:sample_rate=${rate}:duration=${seconds}`,
      "-ac", String(channels), "-c:a", codec, file,
    ]);
    if (r.status !== 0) throw new Error(`ffmpeg couldn't make ${ext}: ${r.stderr}`);
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
