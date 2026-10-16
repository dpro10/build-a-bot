/**
 * The nemo-voice sidecar (voice/native/nemo-voice.cpp): one process holding NVIDIA's Parakeet and
 * Magpie for every call on this server, spoken to in small binary frames over its stdin/stdout.
 * If it dies, every waiting request fails at once and it's started again (with a growing pause, so
 * a model that can't load doesn't spin).
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { bytesToPcm, pcmToBytes } from "../audio/pcm.ts";
import { EngineError, type EngineInfo, type Heard, type HearOptions, type SpeakOptions, type SpeechEngine, type Spoken } from "./engine.ts";

export const FRAME = {
  speak: 0x01,
  cancel: 0x02,
  hear: 0x03,
  ping: 0x04,
  ready: 0x81,
  audio: 0x82,
  spoken: 0x83,
  heard: 0x84,
  pong: 0x85,
  fatal: 0x86,
} as const;

export type Frame = { type: number; id: number; payload: Buffer };

export function encodeFrame(type: number, id: number, payload: Uint8Array = new Uint8Array(0)): Buffer {
  const head = Buffer.alloc(9);
  head[0] = type;
  head.writeUInt32LE(id >>> 0, 1);
  head.writeUInt32LE(payload.byteLength, 5);
  return Buffer.concat([head, payload]);
}

/** Reassembles frames from a byte stream cut at arbitrary points. */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Frame[] = [];
    while (this.buf.length >= 9) {
      const len = this.buf.readUInt32LE(5);
      if (this.buf.length < 9 + len) break;
      out.push({ type: this.buf[0], id: this.buf.readUInt32LE(1), payload: Buffer.from(this.buf.subarray(9, 9 + len)) });
      this.buf = this.buf.subarray(9 + len);
    }
    return out;
  }
}

function str16(s: string): Buffer {
  const body = Buffer.from(s, "utf8");
  if (body.length > 0xffff) throw new EngineError("string too long");
  const head = Buffer.alloc(2);
  head.writeUInt16LE(body.length);
  return Buffer.concat([head, body]);
}

export function speakPayload(text: string, opts: Pick<SpeakOptions, "sampleRate" | "voice" | "language">): Buffer {
  const rate = Buffer.alloc(4);
  rate.writeUInt32LE(opts.sampleRate);
  return Buffer.concat([rate, str16(opts.voice ?? ""), str16(opts.language ?? ""), Buffer.from(text, "utf8")]);
}

export function hearPayload(pcm: Int16Array, sampleRate: number, opts: HearOptions = {}): Buffer {
  const rate = Buffer.alloc(4);
  rate.writeUInt32LE(sampleRate);
  const phrases = Buffer.from(
    (opts.phrases ?? [])
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 50)
      .join("\n"),
    "utf8",
  );
  const plen = Buffer.alloc(4);
  plen.writeUInt32LE(phrases.length);
  return Buffer.concat([rate, str16(opts.language ?? ""), plen, phrases, pcmToBytes(pcm)]);
}

type Pending =
  | { kind: "speak"; onAudio: (pcm: Int16Array) => void; resolve: (s: Spoken) => void; reject: (e: Error) => void; carry?: Buffer }
  | { kind: "hear"; resolve: (h: Heard) => void; reject: (e: Error) => void }
  | { kind: "ping"; resolve: () => void; reject: (e: Error) => void };

/** Lines the engine prints when a synthesis is stopped on purpose (barge-in): not errors. */
const CANCEL_NOISE = /failed to write PCM callback output|failed to write streamed codec frame|codec worker failed: decode or audio output failed/;

export type SidecarOptions = {
  bin: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** How long to wait for the models to load. */
  readyTimeoutMs?: number;
};

export class SidecarEngine implements SpeechEngine {
  info: EngineInfo = { version: "", asr: false, tts: false, voices: [], voice: "", sampleRate: 22050 };
  private child: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private decoder = new FrameDecoder();
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private restarts = 0;
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private isReady = false;
  private readonly opts: SidecarOptions;
  private readonly log: (line: string) => void;

  constructor(opts: SidecarOptions) {
    this.opts = opts;
    this.log = opts.log ?? ((line) => console.error(`[nemo-voice] ${line}`));
  }

  get ready(): boolean {
    return this.isReady;
  }

  /** Starts the sidecar; resolves once the models are loaded and warm. */
  start(): Promise<void> {
    if (this.isReady) return Promise.resolve();
    const waiting = new Promise<void>((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
    if (!this.child) this.spawn();
    const timeout = this.opts.readyTimeoutMs ?? 10 * 60_000;
    return Promise.race([
      waiting,
      new Promise<void>((_, reject) => setTimeout(() => reject(new EngineError("speech models took too long to load")), timeout).unref()),
    ]);
  }

  private spawn(): void {
    const child = spawn(this.opts.bin, this.opts.args, { stdio: ["pipe", "pipe", "pipe"], env: this.opts.env ?? process.env });
    this.child = child;
    this.decoder = new FrameDecoder();
    child.stdout.on("data", (chunk: Buffer) => {
      for (const frame of this.decoder.push(chunk)) this.onFrame(frame);
    });
    let errBuf = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      errBuf += text;
      let nl: number;
      while ((nl = errBuf.indexOf("\n")) >= 0) {
        const line = errBuf.slice(0, nl).trimEnd();
        errBuf = errBuf.slice(nl + 1);
        if (line && !CANCEL_NOISE.test(line)) this.log(line);
      }
    });
    child.stdin.on("error", () => {
      /* the exit handler deals with it */
    });
    child.on("error", (err) => this.onExit(`couldn't start: ${err.message}`));
    child.on("exit", (code, signal) => this.onExit(`exited (${signal ?? code})`));
  }

  private onExit(why: string): void {
    if (!this.child) return;
    this.child = null;
    this.isReady = false;
    const err = new EngineError(`speech engine ${why}`);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    // Whoever is waiting for it to come up hears why it didn't (a missing model fails fast).
    for (const w of this.readyWaiters.splice(0)) w.reject(err);
    if (this.closed) return;
    this.log(`${why}; restarting`);
    const delay = Math.min(30_000, 500 * 2 ** this.restarts++);
    setTimeout(() => {
      if (!this.closed && !this.child) this.spawn();
    }, delay).unref();
  }

  private onFrame(frame: Frame): void {
    switch (frame.type) {
      case FRAME.ready: {
        const info = JSON.parse(frame.payload.toString("utf8")) as {
          version: string;
          asr: boolean;
          tts: boolean;
          voices: string[];
          voice: string;
          sample_rate: number;
        };
        this.info = {
          version: info.version,
          asr: info.asr,
          tts: info.tts,
          voices: info.voices,
          voice: info.voice || info.voices[0] || "",
          sampleRate: info.sample_rate || 22050,
        };
        this.isReady = true;
        this.restarts = 0;
        for (const w of this.readyWaiters.splice(0)) w.resolve();
        return;
      }
      case FRAME.fatal: {
        const { error } = JSON.parse(frame.payload.toString("utf8")) as { error: string };
        const err = new EngineError(`speech engine failed: ${error}`);
        for (const w of this.readyWaiters.splice(0)) w.reject(err);
        return;
      }
      case FRAME.audio: {
        const p = this.pending.get(frame.id);
        if (p?.kind !== "speak") return;
        // A chunk can split a sample in two: carry the odd byte to the next one.
        const bytes = p.carry ? Buffer.concat([p.carry, frame.payload]) : frame.payload;
        const even = bytes.length & ~1;
        p.carry = even < bytes.length ? bytes.subarray(even) : undefined;
        if (even) p.onAudio(bytesToPcm(bytes.subarray(0, even)));
        return;
      }
      case FRAME.spoken: {
        const p = this.pending.get(frame.id);
        if (p?.kind !== "speak") return;
        this.pending.delete(frame.id);
        const s = JSON.parse(frame.payload.toString("utf8")) as {
          status: Spoken["status"];
          error?: string;
          ttfa_ms?: number;
          rtfx?: number;
          audio_s?: number;
          elapsed_s?: number;
        };
        p.resolve({ status: s.status, error: s.error, ttfaMs: s.ttfa_ms ?? 0, rtfx: s.rtfx ?? 0, audioS: s.audio_s ?? 0, elapsedS: s.elapsed_s ?? 0 });
        return;
      }
      case FRAME.heard: {
        const p = this.pending.get(frame.id);
        if (p?.kind !== "hear") return;
        this.pending.delete(frame.id);
        const h = JSON.parse(frame.payload.toString("utf8")) as { text?: string; confidence?: number; language?: string; elapsed_ms?: number; error?: string };
        if (h.error) p.reject(new EngineError(h.error));
        else p.resolve({ text: (h.text ?? "").trim(), confidence: h.confidence ?? 0, language: h.language || undefined, elapsedMs: h.elapsed_ms ?? 0 });
        return;
      }
      case FRAME.pong: {
        const p = this.pending.get(frame.id);
        if (p?.kind !== "ping") return;
        this.pending.delete(frame.id);
        p.resolve();
        return;
      }
    }
  }

  private send(type: number, id: number, payload?: Uint8Array): void {
    if (!this.child || !this.isReady) throw new EngineError("speech engine isn't running");
    this.child.stdin.write(encodeFrame(type, id, payload));
  }

  private id(): number {
    const id = this.nextId;
    this.nextId = this.nextId >= 0xfffffff0 ? 1 : this.nextId + 1;
    return id;
  }

  hear(pcm: Int16Array, sampleRate: number, opts: HearOptions = {}): Promise<Heard> {
    const id = this.id();
    return new Promise<Heard>((resolve, reject) => {
      this.pending.set(id, { kind: "hear", resolve, reject });
      try {
        this.send(FRAME.hear, id, hearPayload(pcm, sampleRate, opts));
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  speak(text: string, opts: SpeakOptions, onAudio: (pcm: Int16Array) => void): Promise<Spoken> {
    const id = this.id();
    if (opts.signal?.aborted) return Promise.resolve({ status: "cancelled", ttfaMs: 0, rtfx: 0, audioS: 0, elapsedS: 0 });
    return new Promise<Spoken>((resolve, reject) => {
      const onAbort = () => {
        try {
          this.send(FRAME.cancel, id);
        } catch {
          /* already gone */
        }
      };
      const done = <T,>(fn: (v: T) => void) => (v: T) => {
        opts.signal?.removeEventListener("abort", onAbort);
        fn(v);
      };
      this.pending.set(id, { kind: "speak", onAudio, resolve: done(resolve), reject: done(reject) });
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        this.send(FRAME.speak, id, speakPayload(text, opts));
      } catch (err) {
        this.pending.delete(id);
        opts.signal?.removeEventListener("abort", onAbort);
        reject(err);
      }
    });
  }

  /** Round trip to the sidecar: is it alive and listening? */
  ping(timeoutMs = 5000): Promise<void> {
    const id = this.id();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EngineError("speech engine didn't answer"));
      }, timeoutMs);
      this.pending.set(id, {
        kind: "ping",
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.send(FRAME.ping, id);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }
}
