/**
 * 16-bit PCM helpers. Every stage of a call passes mono Int16Array samples; the sample rate travels
 * alongside (16 kHz in from callers, whatever the transport plays out).
 */

/** Little-endian PCM16 bytes to samples. Copies when the bytes aren't 2-byte aligned. */
export function bytesToPcm(bytes: Uint8Array): Int16Array {
  const n = bytes.byteLength >> 1;
  if ((bytes.byteOffset & 1) === 0) return new Int16Array(bytes.buffer, bytes.byteOffset, n).slice();
  const out = new Int16Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function pcmToBytes(pcm: Int16Array): Buffer {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

export function concatPcm(parts: readonly Int16Array[]): Int16Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Int16Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Root-mean-square level in dBFS (silence is -100). */
export function dbfs(pcm: Int16Array): number {
  if (!pcm.length) return -100;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  const rms = Math.sqrt(sum / pcm.length) / 32768;
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

export function msToSamples(ms: number, rate: number): number {
  return Math.round((ms * rate) / 1000);
}

export function samplesToMs(samples: number, rate: number): number {
  return (samples * 1000) / rate;
}

/** A mono PCM16 WAV file. */
export function encodeWav(pcm: Int16Array, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcmToBytes(pcm)]);
}

/** Reads a PCM16 WAV (mono, or the first channel of several). */
export function decodeWav(file: Uint8Array): { pcm: Int16Array; rate: number } {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let at = 12;
  let rate = 0;
  let channels = 1;
  let bits = 16;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      const format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      if ((format !== 1 && format !== 0xfffe) || bits !== 16) throw new Error("only PCM16 WAV is supported");
    } else if (id === "data") {
      const end = Math.min(buf.length, body + size);
      const all = bytesToPcm(buf.subarray(body, end));
      if (channels === 1) return { pcm: all, rate };
      const pcm = new Int16Array(Math.floor(all.length / channels));
      for (let i = 0; i < pcm.length; i++) pcm[i] = all[i * channels];
      return { pcm, rate };
    }
    at = body + size + (size & 1);
  }
  throw new Error("WAV file has no audio");
}
