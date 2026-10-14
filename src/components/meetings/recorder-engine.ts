/**
 * The browser recorder's engine (no React): records each audio source with its own
 * MediaRecorder, restarts them every `chunkMs` so every piece is a complete file,
 * measures loudness on the audio thread, and uploads the pieces in order with retries.
 *
 *   mic    = the owner's microphone (or the room, in person)
 *   system = the call's sound, from a shared tab
 *
 * Time only counts while listening: paused stretches are left out of startMs.
 */
import type { MeetingView, SegmentView } from "@/lib/meetings";

export type Track = "mic" | "system";

export type EngineProblem = {
  code: "limit" | "not_recording" | "gone" | "signed_out" | "too_long" | "no_audio" | "error";
  message: string;
  upgrade?: string;
};

export type EngineOptions = {
  botId: string;
  meetingId: string;
  chunkMs: number;
  streams: Partial<Record<Track, MediaStream | null>>;
  /** 0..1, about ten times a second while listening. */
  onLevel?: (level: number) => void;
  /** Transcript lines that came back with an upload. */
  onSegments?: (segments: SegmentView[]) => void;
  onUploads?: (state: { pending: number; trouble: boolean }) => void;
  /** Recording can't go on (plan limit, meeting stopped elsewhere, signed out…). The caller wraps up. */
  onProblem?: (problem: EngineProblem) => void;
  /** A source stopped on its own (the owner stopped sharing the tab, or unplugged the mic). */
  onTrackEnded?: (track: Track) => void;
  /** How long it has been quiet, while listening (checked every second). */
  onSilence?: (silentMs: number) => void;
};

/** Below this loudness (RMS) a stretch counts as silence (about -44 dBFS). */
const SILENT_RMS = 0.006;
/** The server's limit per piece of audio is 5 minutes. */
const MAX_CHUNK_MS = 299_000;
/** The server's limit per meeting is 4 hours. */
export const MAX_MEETING_MS = 4 * 3600_000;
/** While paused, a tiny silent piece now and then tells the server the recorder is still here. */
const PAUSE_PING_MS = 4 * 60_000;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm"];

export function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

/** What the server accepts: audio/webm, audio/ogg, audio/mp4… (Chrome sometimes labels audio-only webm as video/webm). */
function uploadType(type: string, fallback: string | undefined): string {
  const t = (type || fallback || "audio/webm").split(";")[0].trim().toLowerCase();
  if (t.startsWith("audio/")) return t;
  if (t.includes("webm")) return "audio/webm";
  if (t.includes("ogg")) return "audio/ogg";
  if (t.includes("mp4") || t.includes("m4a")) return "audio/mp4";
  return "audio/webm";
}

export function recorderSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** dBFS-ish loudness → 0..1 for the meter. */
function meter(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 52) / 40));
}

// Runs on the audio thread, so it keeps measuring while the tab is in the background
// (timers there are slowed to once a second). Posts the loudest block every ~100 ms.
const LEVEL_WORKLET = `
class BabLevel extends AudioWorkletProcessor {
  constructor() { super(); this.peak = 0; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      const rms = Math.sqrt(sum / ch.length);
      if (rms > this.peak) this.peak = rms;
    }
    if (++this.n >= 36) { this.port.postMessage(this.peak); this.peak = 0; this.n = 0; }
    return true;
  }
}
registerProcessor("bab-level", BabLevel);
`;

type Detached = { rec: MediaRecorder; chunk: number; start: number; peak: number; samples: number; done: Promise<Blob | null> | null };

type Piece = {
  track: Track;
  chunk: number;
  startMs: number;
  durationMs: number;
  silent: boolean;
  blob: Blob;
  attempts: number;
  nextAt: number;
};

class Source {
  rec: MediaRecorder | null = null;
  parts: Blob[] = [];
  chunk = 0;
  chunkStart = 0;
  peak = 0;
  samples = 0;
  level = 0;
  ended = false;
  /** Resolves with the finished piece when the current MediaRecorder stops. */
  done: Promise<Blob | null> | null = null;
  nodes: AudioNode[] = [];
  analyser: AnalyserNode | null = null;
  constructor(
    readonly track: Track,
    readonly stream: MediaStream,
  ) {}
  get live() {
    return !this.ended && this.stream.getAudioTracks().some((t) => t.readyState === "live");
  }
}

export class MeetingRecorder {
  private opts: EngineOptions;
  private sources = new Map<Track, Source>();
  private mime = pickMime();
  private ctx: AudioContext | null = null;
  private workletReady: Promise<boolean> | null = null;
  private analyserTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private activeBase = 0;
  private stretchStart: number | null = null;
  private nextChunk = 0;
  private queue: Piece[] = [];
  private inFlight = 0;
  private aborts = new Set<AbortController>();
  private lastSoundActive = 0;
  /** The loudness meter is working (without it, silence can't be told apart from a broken meter). */
  private meterAlive = false;
  private lastPing = 0;
  private lastTickWall = Date.now();
  private stopped = false;
  private fatal = false;
  private drainWaiters: (() => void)[] = [];
  readonly startedAt = Date.now();

  constructor(opts: EngineOptions) {
    this.opts = opts;
    for (const track of ["mic", "system"] as const) {
      const s = opts.streams[track];
      if (s && s.getAudioTracks().length) this.sources.set(track, new Source(track, s));
    }
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
  }

  get tracks(): Track[] {
    return [...this.sources.values()].filter((s) => s.live).map((s) => s.track);
  }

  get listening(): boolean {
    return this.stretchStart !== null;
  }

  /** Listening time so far (pauses don't count). */
  activeMs(): number {
    return this.activeBase + (this.stretchStart !== null ? performance.now() - this.stretchStart : 0);
  }

  get pending(): number {
    return this.queue.length + this.inFlight;
  }

  async start() {
    this.setupAudio();
    for (const s of this.sources.values()) this.watchEnded(s);
    this.stretchStart = performance.now();
    this.lastSoundActive = 0;
    this.openChunk();
    this.tickTimer = setInterval(this.tick, 1000);
  }

  pause() {
    if (this.stretchStart === null || this.stopped) return;
    this.closeChunk();
    this.activeBase = this.activeMs();
    this.stretchStart = null;
    this.lastPing = Date.now();
    for (const s of this.sources.values()) s.stream.getAudioTracks().forEach((t) => (t.enabled = false));
    this.opts.onLevel?.(0);
  }

  resume() {
    if (this.stretchStart !== null || this.stopped) return;
    for (const s of this.sources.values()) s.stream.getAudioTracks().forEach((t) => (t.enabled = true));
    this.stretchStart = performance.now();
    this.lastSoundActive = this.activeMs();
    this.openChunk();
  }

  /** Add (or replace) a source mid-recording, e.g. the call's tab shared after starting. */
  addStream(track: Track, stream: MediaStream) {
    if (this.stopped || !stream.getAudioTracks().length) return;
    const old = this.sources.get(track);
    if (old) {
      this.stopSource(old, true);
      old.stream.getTracks().forEach((t) => t.stop());
      old.nodes.forEach((n) => n.disconnect());
    }
    const s = new Source(track, stream);
    this.sources.set(track, s);
    this.watchEnded(s);
    this.attachMeter(s);
    if (this.stretchStart !== null) {
      // Join the current piece now; it closes with the others.
      s.chunk = Math.max(0, this.nextChunk - 1);
      s.chunkStart = this.activeMs();
      this.startRecorder(s);
    } else {
      stream.getAudioTracks().forEach((t) => (t.enabled = false));
    }
  }

  /**
   * Stop listening and send what's left. With `discard`, nothing more is sent and the
   * caller deletes the meeting. Returns once the last pieces are uploaded (or `waitMs` passed).
   */
  async stop(opts: { discard?: boolean; waitMs?: number } = {}): Promise<{ unsent: number }> {
    if (this.stopped) return { unsent: this.pending };
    if (opts.discard) {
      this.abort();
      return { unsent: 0 };
    }
    this.stopped = true;
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    const finals = this.stretchStart !== null ? this.closeChunk() : [];
    if (this.stretchStart !== null) {
      this.activeBase = this.activeMs();
      this.stretchStart = null;
    }
    await Promise.all(finals);
    this.release();
    await this.drain(opts.waitMs ?? 45_000);
    return { unsent: this.pending };
  }

  /** Stop everything without sending more (the meeting ended elsewhere). */
  abort() {
    this.stopped = true;
    this.fatal = true;
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    for (const s of this.sources.values()) this.stopSource(s, false);
    this.queue = [];
    for (const a of this.aborts) a.abort();
    this.release();
  }

  // -------------------------------------------------------------------------
  // pieces

  private openChunk() {
    const index = this.nextChunk++;
    const at = this.activeMs();
    for (const s of this.sources.values()) {
      if (!s.live) continue;
      s.chunk = index;
      s.chunkStart = at;
      this.startRecorder(s);
    }
    this.scheduleRotate();
  }

  private scheduleRotate() {
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    this.rotateTimer = setTimeout(this.rotate, this.opts.chunkMs);
  }

  private rotate = () => {
    if (this.stopped || this.stretchStart === null) return;
    const at = this.activeMs();
    const last = at >= MAX_MEETING_MS - 1000;
    const index = last ? -1 : this.nextChunk++;
    // Start the next recorders before stopping the current ones, so no audio falls in between.
    for (const s of this.sources.values()) {
      const prev = this.detach(s);
      if (!last && s.live) {
        s.chunk = index;
        s.chunkStart = at;
        this.startRecorder(s);
      }
      if (prev) void this.finishPiece(s.track, prev, at);
    }
    if (last) {
      this.opts.onProblem?.({ code: "too_long", message: "Meetings can be up to 4 hours, so I stopped here and wrote your notes." });
      return;
    }
    this.scheduleRotate();
  };

  private detach(s: Source): Detached | null {
    if (!s.rec) return null;
    const prev: Detached = { rec: s.rec, chunk: s.chunk, start: s.chunkStart, peak: s.peak, samples: s.samples, done: s.done };
    s.rec = null;
    s.parts = [];
    s.done = null;
    return prev;
  }

  /** Close the current pieces (pause/stop). Returns promises that settle once they're queued. */
  private closeChunk(): Promise<void>[] {
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    const at = this.activeMs();
    const out: Promise<void>[] = [];
    for (const s of this.sources.values()) {
      const prev = this.detach(s);
      if (prev) out.push(this.finishPiece(s.track, prev, at));
    }
    return out;
  }

  private startRecorder(s: Source) {
    let rec: MediaRecorder;
    const audioOnly = new MediaStream(s.stream.getAudioTracks());
    try {
      rec = new MediaRecorder(audioOnly, { ...(this.mime ? { mimeType: this.mime } : {}), audioBitsPerSecond: 32_000 });
    } catch {
      try {
        rec = new MediaRecorder(audioOnly);
      } catch {
        return; // tried again at the next piece
      }
    }
    const parts: Blob[] = [];
    s.parts = parts;
    s.peak = 0;
    s.samples = 0;
    s.done = new Promise<Blob | null>((resolve) => {
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) parts.push(e.data);
      };
      rec.onstop = () => resolve(parts.length ? new Blob(parts, { type: uploadType(parts[0].type || rec.mimeType, this.mime) }) : null);
      rec.onerror = () => resolve(parts.length ? new Blob(parts, { type: uploadType(parts[0].type || rec.mimeType, this.mime) }) : null);
    });
    s.rec = rec;
    try {
      rec.start();
    } catch {
      s.rec = null;
      s.done = null;
    }
  }

  private finishPiece(track: Track, prev: Detached, endAt: number): Promise<void> {
    const durationMs = Math.max(1, Math.min(MAX_CHUNK_MS, Math.round(endAt - prev.start)));
    // Only call it silence when the meter really listened the whole time (background tabs can starve a fallback meter).
    const expected = durationMs / 100;
    const silent = prev.samples >= expected * 0.5 && prev.peak < SILENT_RMS;
    try {
      if (prev.rec.state !== "inactive") prev.rec.stop();
    } catch {
      /* already stopped */
    }
    return (prev.done ?? Promise.resolve(null)).then((blob) => {
      if (this.fatal) return;
      // Nothing to hear: skip the audio itself, the server only needs to know the time passed.
      const body = silent || !blob ? new Blob([], { type: uploadType(blob?.type ?? "", this.mime) }) : blob;
      this.enqueue({ track, chunk: prev.chunk, startMs: Math.round(prev.start), durationMs, silent: silent || !blob, blob: body, attempts: 0, nextAt: 0 });
    });
  }

  private stopSource(s: Source, keepPiece: boolean) {
    const prev = this.detach(s);
    if (!prev) return;
    if (keepPiece) void this.finishPiece(s.track, prev, this.activeMs());
    else {
      try {
        if (prev.rec.state !== "inactive") prev.rec.stop();
      } catch {
        /* ignore */
      }
    }
  }

  private watchEnded(s: Source) {
    for (const t of s.stream.getAudioTracks()) {
      t.addEventListener("ended", () => {
        if (this.stopped || s.ended || this.sources.get(s.track) !== s) return;
        s.ended = true;
        // Keep what was recorded up to here.
        this.stopSource(s, true);
        this.opts.onTrackEnded?.(s.track);
        if (![...this.sources.values()].some((x) => x.live)) {
          this.opts.onProblem?.({ code: "no_audio", message: "The microphone and the call's sound both stopped, so I stopped too." });
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // loudness

  private setupAudio() {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: "playback" });
      void this.ctx.resume().catch(() => {});
      if (this.ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
        const url = URL.createObjectURL(new Blob([LEVEL_WORKLET], { type: "application/javascript" }));
        this.workletReady = this.ctx.audioWorklet
          .addModule(url)
          .then(() => true)
          .catch(() => false)
          .finally(() => URL.revokeObjectURL(url));
      } else this.workletReady = Promise.resolve(false);
      for (const s of this.sources.values()) this.attachMeter(s);
    } catch {
      this.ctx = null;
    }
  }

  private attachMeter(s: Source) {
    const ctx = this.ctx;
    if (!ctx || !this.workletReady) return;
    void this.workletReady.then((ok) => {
      if (this.stopped || this.sources.get(s.track) !== s || ctx.state === "closed") return;
      try {
        const src = ctx.createMediaStreamSource(new MediaStream(s.stream.getAudioTracks()));
        const mute = ctx.createGain();
        mute.gain.value = 0;
        mute.connect(ctx.destination);
        if (ok) {
          const node = new AudioWorkletNode(ctx, "bab-level", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
          node.port.onmessage = (e: MessageEvent<number>) => this.onRms(s, e.data);
          src.connect(node);
          node.connect(mute);
          s.nodes = [src, node, mute];
        } else {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          src.connect(analyser);
          analyser.connect(mute);
          s.analyser = analyser;
          s.nodes = [src, analyser, mute];
          this.startAnalyserLoop();
        }
      } catch {
        /* no meter for this source: pieces are never marked silent */
      }
    });
  }

  private startAnalyserLoop() {
    if (this.analyserTimer) return;
    const buf = new Float32Array(2048);
    this.analyserTimer = setInterval(() => {
      for (const s of this.sources.values()) {
        if (!s.analyser) continue;
        s.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        this.onRms(s, Math.sqrt(sum / buf.length));
      }
    }, 100);
  }

  private onRms(s: Source, rms: number) {
    if (this.stretchStart === null || this.stopped) return;
    this.meterAlive = true;
    s.level = rms;
    if (s.rec) {
      s.samples++;
      if (rms > s.peak) s.peak = rms;
    }
    if (rms > SILENT_RMS * 1.5) this.lastSoundActive = this.activeMs();
    let loudest = 0;
    for (const x of this.sources.values()) if (x.live && x.level > loudest) loudest = x.level;
    this.opts.onLevel?.(meter(loudest));
  }

  private tick = () => {
    const wall = Date.now();
    const gap = wall - this.lastTickWall;
    this.lastTickWall = wall;
    if (this.stopped) return;
    if (this.stretchStart !== null) {
      // The computer slept (timers stopped for minutes): pieces can't be longer than 5 minutes.
      if (gap > 120_000) this.rotate();
      if (this.meterAlive) this.opts.onSilence?.(this.activeMs() - this.lastSoundActive);
    } else if (wall - this.lastPing > PAUSE_PING_MS) {
      // Paused: a tiny silent piece keeps the meeting from being wrapped up as abandoned.
      this.lastPing = wall;
      const track = this.tracks[0] ?? "mic";
      this.enqueue({ track, chunk: this.nextChunk++, startMs: Math.round(this.activeBase), durationMs: 1, silent: true, blob: new Blob([], { type: uploadType("", this.mime) }), attempts: 0, nextAt: 0 });
    }
  };

  private release() {
    if (this.analyserTimer) clearInterval(this.analyserTimer);
    this.analyserTimer = null;
    for (const s of this.sources.values()) {
      s.nodes.forEach((n) => {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      });
      s.stream.getTracks().forEach((t) => t.stop());
    }
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close().catch(() => {});
    this.ctx = null;
    this.opts.onLevel?.(0);
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
  }

  // -------------------------------------------------------------------------
  // uploads

  private enqueue(p: Piece) {
    if (this.fatal) return;
    this.queue.push(p);
    this.reportUploads();
    this.pump();
  }

  private onOnline = () => this.pump();

  private reportUploads() {
    const trouble = this.queue.some((p) => p.attempts >= 3);
    this.opts.onUploads?.({ pending: this.pending, trouble });
    if (!this.pending) {
      const waiters = this.drainWaiters;
      this.drainWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  private pump = () => {
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = null;
    }
    if (this.fatal) return;
    const now = Date.now();
    while (this.inFlight < 2) {
      const i = this.queue.findIndex((p) => p.nextAt <= now);
      if (i === -1) break;
      const [p] = this.queue.splice(i, 1);
      this.inFlight++;
      void this.send(p).finally(() => {
        this.inFlight--;
        this.reportUploads();
        this.pump();
      });
    }
    if (this.queue.length && !this.pumpTimer) {
      const next = Math.min(...this.queue.map((p) => p.nextAt));
      this.pumpTimer = setTimeout(this.pump, Math.max(250, next - now));
    }
  };

  private retryLater(p: Piece) {
    p.attempts++;
    p.nextAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(p.attempts - 1, 5)) + Math.random() * 400;
    this.queue.push(p);
  }

  private async send(p: Piece) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.retryLater(p);
      return;
    }
    const q = new URLSearchParams({
      track: p.track,
      chunk: String(p.chunk),
      startMs: String(Math.max(0, p.startMs)),
      durationMs: String(Math.max(1, p.durationMs)),
      silent: p.silent ? "1" : "0",
    });
    const abort = new AbortController();
    this.aborts.add(abort);
    let res: Response;
    try {
      res = await fetch(`/api/bots/${this.opts.botId}/meetings/${this.opts.meetingId}/audio?${q}`, {
        method: "POST",
        headers: { "content-type": p.blob.type || uploadType("", this.mime) },
        body: p.blob,
        signal: abort.signal,
      });
    } catch {
      if (!abort.signal.aborted) this.retryLater(p);
      return;
    } finally {
      this.aborts.delete(abort);
    }
    const data = (await res.json().catch(() => ({}))) as { segments?: SegmentView[]; error?: string; code?: string; upgrade?: string };
    if (res.ok) {
      if (data.segments?.length) this.opts.onSegments?.(data.segments);
      return;
    }
    if (res.status === 503 || res.status === 429 || res.status >= 500) {
      this.retryLater(p);
      return;
    }
    const fail = (problem: EngineProblem) => {
      if (this.fatal) return;
      this.fatal = true;
      this.queue = [];
      this.opts.onProblem?.(problem);
    };
    if (res.status === 402) return fail({ code: "limit", message: data.error ?? "You've used this month's meeting minutes.", upgrade: data.upgrade });
    if (res.status === 409) return fail({ code: "not_recording", message: data.error ?? "This meeting isn't recording anymore." });
    if (res.status === 404) return fail({ code: "gone", message: "This meeting was deleted." });
    if (res.status === 401 || res.status === 403) return fail({ code: "signed_out", message: data.error ?? "You were signed out. Sign in again to keep taking notes." });
    if (res.status === 422 && data.code === "too_long") return fail({ code: "too_long", message: "Meetings can be up to 4 hours, so I stopped here." });
    // 413/415/422: this piece can't be used; move on.
  }

  private drain(waitMs: number): Promise<void> {
    if (!this.pending || this.fatal) return Promise.resolve();
    this.pump();
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, waitMs);
      this.drainWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

/** Tell the server the recording is paused or resumed (a paused meeting isn't wrapped up as abandoned). Best effort. */
export function markPaused(botId: string, meetingId: string, paused: boolean): void {
  void fetch(`/api/bots/${botId}/meetings/${meetingId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paused }),
  }).catch(() => {});
}

/** Stop listening on the server; the bot writes the notes right after. */
export async function finishMeeting(botId: string, meetingId: string, opts: { keepalive?: boolean } = {}): Promise<MeetingView | null> {
  try {
    const res = await fetch(`/api/bots/${botId}/meetings/${meetingId}/finish`, { method: "POST", keepalive: opts.keepalive });
    if (!res.ok) return null;
    const data = (await res.json()) as { meeting?: MeetingView };
    return data.meeting ?? null;
  } catch {
    return null;
  }
}
