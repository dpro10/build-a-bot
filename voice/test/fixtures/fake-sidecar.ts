/**
 * Speaks nemo-voice's protocol without any models, for tests: SPEAK streams a tone in odd-sized
 * chunks (so samples straddle frames), CANCEL stops it, HEAR answers with how much audio it got,
 * and saying "crash" makes it exit.
 */
import { encodeFrame, FRAME, FrameDecoder } from "../../src/speech/sidecar.ts";

const out = (type: number, id: number, payload?: Uint8Array) => process.stdout.write(encodeFrame(type, id, payload));
const json = (type: number, id: number, value: unknown) => out(type, id, Buffer.from(JSON.stringify(value)));

const cancelled = new Set<number>();
const decoder = new FrameDecoder();

setTimeout(() => json(FRAME.ready, 0, { version: "fake", asr: true, tts: true, voices: ["Aria", "Leo"], voice: "Aria", sample_rate: 22050 }), 20);

process.stdin.on("data", (chunk: Buffer) => {
  for (const f of decoder.push(chunk)) {
    if (f.type === FRAME.speak) {
      const rate = f.payload.readUInt32LE(0);
      let at = 4;
      const vlen = f.payload.readUInt16LE(at);
      at += 2 + vlen;
      const llen = f.payload.readUInt16LE(at);
      at += 2 + llen;
      const text = f.payload.subarray(at).toString("utf8");
      if (text === "crash") process.exit(3);
      // 50 ms of tone per word, in 7-byte pieces at first.
      const samples = Math.round((rate * 0.05) * text.split(/\s+/).length);
      const pcm = Buffer.alloc(samples * 2);
      for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 3)), i * 2);
      let sent = 0;
      const step = () => {
        if (cancelled.has(f.id)) {
          cancelled.delete(f.id);
          json(FRAME.spoken, f.id, { status: "cancelled", ttfa_ms: 0, rtfx: 0, audio_s: sent / 2 / rate, elapsed_s: 0 });
          return;
        }
        if (sent >= pcm.length) {
          json(FRAME.spoken, f.id, { status: "ok", ttfa_ms: 5, rtfx: 10, audio_s: samples / rate, elapsed_s: 0.01 });
          return;
        }
        const size = sent === 0 ? 7 : 801;
        out(FRAME.audio, f.id, pcm.subarray(sent, sent + size));
        sent += size;
        setTimeout(step, 2);
      };
      step();
    } else if (f.type === FRAME.cancel) {
      cancelled.add(f.id);
    } else if (f.type === FRAME.hear) {
      const rate = f.payload.readUInt32LE(0);
      let at = 4;
      const llen = f.payload.readUInt16LE(at);
      at += 2 + llen;
      const plen = f.payload.readUInt32LE(at);
      const phrases = f.payload.subarray(at + 4, at + 4 + plen).toString("utf8");
      const samples = (f.payload.length - at - 4 - plen) / 2;
      json(FRAME.heard, f.id, { text: `heard ${samples} samples at ${rate}${phrases ? ` listening for ${phrases.split("\n").join(", ")}` : ""}`, confidence: 0.9, language: "en", audio_s: samples / rate, elapsed_ms: 3 });
    } else if (f.type === FRAME.ping) {
      out(FRAME.pong, f.id);
    }
  }
});
process.stdin.on("end", () => process.exit(0));
