/**
 * The bot's mouth: speaks queued pieces in order, streaming Magpie's audio to the caller as it's
 * made, and knows what the caller has actually heard (marks the far end echoes back as its playback
 * passes them, or the clock when it can't).
 *
 * Audio can be held back (a reply prepared before the caller has finished: see session.ts) and
 * released at once, and everything can be stopped mid-word when the caller cuts in.
 *
 * When speech is made slower than it plays (Magpie on a small CPU), a sentence streamed straight
 * out would stutter, a little gap every chunk. With a SpeechPace, each sentence waits until enough
 * of it is ready to play through without a gap, and the pauses fall between sentences instead.
 *
 * A sentence the engine goes quiet on (no audio for stallMs) is given up on as an error, so a stuck
 * engine can't keep the call waiting forever.
 */
import type { SpeechEngine, Spoken } from "../speech/engine.ts";
import type { CallTransport } from "./transport.ts";
import { forSpeech } from "../speech/text.ts";

/**
 * How fast this machine makes speech, measured as it goes and shared by every call: seconds of
 * audio made per second while streaming (under 1 is slower than it plays), and how long speech
 * runs per character of text.
 */
export class SpeechPace {
  rate: number;
  msPerChar: number;

  constructor(rate = 1, msPerChar = 62) {
    this.rate = rate;
    this.msPerChar = msPerChar;
  }

  /** A piece was made: `streamMs` of wall time for `audioMs` of audio after its first chunk. */
  observe(audioMs: number, streamMs: number, totalAudioMs: number, chars: number): void {
    if (audioMs >= 800 && streamMs > 0) this.rate = this.rate * 0.6 + (audioMs / streamMs) * 0.4;
    if (chars >= 20 && totalAudioMs > 0) this.msPerChar = this.msPerChar * 0.8 + (totalAudioMs / chars) * 0.2;
  }

  /** Audio to have ready before a piece of `chars` characters starts, so it plays without a gap. */
  leadMs(chars: number): number {
    if (this.rate >= 1.15) return 0;
    const estimate = chars * this.msPerChar;
    return Math.min(6000, Math.round(estimate * Math.max(0, 1 - this.rate) * 1.15 + 150));
  }
}

type Piece = {
  id: number;
  /** What it says, as written (for the transcript). */
  text: string;
  /** Pre-made audio (a filler from the phrase cache), at the transport's rate. */
  audio?: Int16Array;
  /** Audio made but held until enough is ready to play without a gap (see SpeechPace). */
  pending: Int16Array[] | null;
  pendingMs: number;
  leadMs: number;
  /** Audio handed on so far. */
  durationMs: number;
  /** Wall time its audio starts playing at the far end (estimated); null until sent. */
  startsAt: number | null;
  /** All its audio has been made and handed on. */
  done: boolean;
  played: boolean;
};

type Out = { audio: Int16Array; piece: number } | { mark: number };

export type SpeakerEvents = {
  /** A piece's first audio went out (latency is measured to here). `made`: by the engine just now, not pre-made. */
  onAudioStart?: (piece: { id: number; text: string; made: boolean }) => void;
  /** The bot started talking (nothing was playing before). */
  onTalking?: () => void;
  /** Everything queued has been heard: the bot is quiet. */
  onQuiet?: () => void;
  /** Synthesis failed for a piece (it's skipped). */
  onError?: (err: Error) => void;
};

export class Speaker {
  private readonly engine: SpeechEngine;
  private readonly transport: CallTransport;
  private readonly events: SpeakerEvents;
  private readonly now: () => number;
  private readonly pace: SpeechPace | undefined;
  voice: string | undefined;
  language: string | undefined;
  private queue: Piece[] = [];
  private pieces = new Map<number, Piece>();
  private nextId = 1;
  private synth: AbortController | null = null;
  private pumping = false;
  private held = false;
  private heldOut: Out[] = [];
  /** Wall time the far end's buffer runs dry, if nothing more is sent. */
  private playhead = 0;
  private talking = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private closed = false;
  private readonly stallMs: number;

  constructor(opts: {
    engine: SpeechEngine;
    transport: CallTransport;
    voice?: string;
    language?: string;
    events?: SpeakerEvents;
    now?: () => number;
    pace?: SpeechPace;
    /** Give up on a sentence after this long without audio from the engine. */
    stallMs?: number;
  }) {
    this.engine = opts.engine;
    this.transport = opts.transport;
    this.pace = opts.pace;
    this.stallMs = opts.stallMs ?? 10_000;
    this.voice = opts.voice;
    this.language = opts.language;
    this.events = opts.events ?? {};
    this.now = opts.now ?? (() => performance.now());
    this.transport.onMark = (name) => {
      const m = /^p(\d+)$/.exec(name);
      if (m) this.played(Number(m[1]));
    };
  }

  /** Is the bot audible right now (or about to be)? */
  get isTalking(): boolean {
    return this.talking;
  }

  /** Is anything queued, being made, held or still playing? */
  get busy(): boolean {
    return this.talking || this.queue.length > 0 || this.pumping || this.heldOut.length > 0 || this.pieces.size > 0;
  }

  /** Hold audio back instead of sending it, until release(). */
  hold(): void {
    this.held = true;
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    for (const o of this.heldOut.splice(0)) this.emit(o);
    this.checkQuiet();
  }

  /** Queue a sentence (said as written: numbers, times and the rest are converted here). */
  say(text: string, audio?: Int16Array): number {
    const piece: Piece = { id: this.nextId++, text, audio, pending: null, pendingMs: 0, leadMs: 0, durationMs: 0, startsAt: null, done: false, played: false };
    this.queue.push(piece);
    this.pieces.set(piece.id, piece);
    void this.pump();
    return piece.id;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.closed) {
        const piece = this.queue[0];
        if (piece.audio) {
          this.out(piece, piece.audio);
        } else {
          const spoken = forSpeech(piece.text);
          if (spoken) {
            const ac = new AbortController();
            this.synth = ac;
            const lead = this.pace?.leadMs(spoken.length) ?? 0;
            if (lead > 0) {
              piece.pending = [];
              piece.leadMs = lead;
            }
            const rate = this.transport.outputRate;
            let firstAt = 0;
            let firstMs = 0;
            let madeMs = 0;
            // Stopped (stop(), close()) or stalled (the engine went quiet on it): don't wait for the
            // engine to agree, it may never answer.
            let stalled = false;
            let stallTimer: ReturnType<typeof setTimeout> | undefined;
            const gaveUp = new Promise<Spoken>((resolve) => {
              ac.signal.addEventListener(
                "abort",
                () => resolve({ status: stalled ? "error" : "cancelled", error: stalled ? "no audio from the speech engine" : undefined, ttfaMs: 0, rtfx: 0, audioS: 0, elapsedS: 0 }),
                { once: true },
              );
            });
            const watch = (ms = this.stallMs) => {
              clearTimeout(stallTimer);
              stallTimer = setTimeout(() => {
                stalled = true;
                ac.abort();
              }, ms);
            };
            // The first audio can take as long as the sentence lasts, from an engine that makes it whole (http.ts).
            watch(this.stallMs + spoken.length * (this.pace?.msPerChar ?? 62));
            try {
              const speaking = this.engine.speak(spoken, { sampleRate: rate, voice: this.voice, language: this.language, signal: ac.signal }, (pcm) => {
                if (ac.signal.aborted) return;
                watch();
                const ms = (pcm.length * 1000) / rate;
                if (!firstAt) {
                  firstAt = this.now();
                  firstMs = ms;
                }
                madeMs += ms;
                this.out(piece, pcm);
              });
              const result = await Promise.race([speaking, gaveUp]);
              if (result.status === "error") this.events.onError?.(new Error(result.error ?? "speech synthesis failed"));
              if (result.status === "ok" && firstAt) this.pace?.observe(madeMs - firstMs, this.now() - firstAt, madeMs, spoken.length);
            } catch (err) {
              this.events.onError?.(err as Error);
            } finally {
              clearTimeout(stallTimer);
              this.synth = null;
            }
            // stop() dropped the queue (and this piece) while it was being made.
            if (ac.signal.aborted && !stalled) continue;
            if (piece.pending) this.flush(piece);
          }
        }
        this.queue.shift();
        piece.done = true;
        if (piece.durationMs > 0) this.enqueue({ mark: piece.id });
        else this.played(piece.id);
      }
    } finally {
      this.pumping = false;
    }
    this.checkQuiet();
  }

  private out(piece: Piece, pcm: Int16Array): void {
    if (!pcm.length) return;
    if (piece.pending) {
      piece.pending.push(pcm);
      piece.pendingMs += (pcm.length * 1000) / this.transport.outputRate;
      // What's still playing ahead of it counts too.
      const ahead = this.held ? 0 : Math.max(0, this.playhead - this.now());
      if (piece.pendingMs + ahead >= piece.leadMs) this.flush(piece);
      return;
    }
    this.send(piece, pcm);
  }

  private flush(piece: Piece): void {
    const parts = piece.pending ?? [];
    piece.pending = null;
    for (const pcm of parts) this.send(piece, pcm);
  }

  private send(piece: Piece, pcm: Int16Array): void {
    piece.durationMs += (pcm.length * 1000) / this.transport.outputRate;
    this.enqueue({ audio: pcm, piece: piece.id });
  }

  private enqueue(o: Out): void {
    if (this.held) this.heldOut.push(o);
    else this.emit(o);
  }

  private emit(o: Out): void {
    const now = this.now();
    if ("audio" in o) {
      if (!this.talking) {
        this.talking = true;
        this.events.onTalking?.();
      }
      const start = Math.max(this.playhead, now);
      const piece = this.pieces.get(o.piece);
      if (piece && piece.startsAt === null) {
        piece.startsAt = start;
        this.events.onAudioStart?.({ id: piece.id, text: piece.text, made: !piece.audio });
      }
      this.playhead = start + (o.audio.length * 1000) / this.transport.outputRate;
      this.transport.sendAudio(o.audio);
      return;
    }
    // A mark: the far end says when it's played; the clock backs that up.
    const id = o.mark;
    if (this.transport.reportsMarks) this.transport.mark(`p${id}`);
    const due = Math.max(0, this.playhead - now) + (this.transport.reportsMarks ? 2500 : 0);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.played(id);
    }, due);
    this.timers.add(timer);
  }

  private played(id: number): void {
    const piece = this.pieces.get(id);
    if (!piece || piece.played) return;
    piece.played = true;
    // Marks arrive in order: everything finished before it has played too.
    for (const p of this.pieces.values()) if (p.id < id && p.done) p.played = true;
    for (const [pid, p] of this.pieces) if (p.played) this.pieces.delete(pid);
    this.checkQuiet();
  }

  private checkQuiet(): void {
    if (this.talking && !this.pumping && !this.queue.length && !this.heldOut.length && this.pieces.size === 0) {
      this.talking = false;
      this.events.onQuiet?.();
    }
  }

  /**
   * Stop talking now: cancel synthesis, drop the queue, clear what the far end hasn't played.
   * Returns roughly what the caller heard (the words up to where playback was cut).
   */
  stop(): { heard: string; cut: boolean } {
    const now = this.now();
    this.synth?.abort();
    this.queue = [];
    this.heldOut = [];
    this.held = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const heard: string[] = [];
    let cut = false;
    for (const p of [...this.pieces.values()].sort((a, b) => a.id - b.id)) {
      if (p.played) {
        heard.push(p.text);
        continue;
      }
      if (p.startsAt === null) continue;
      if (p.startsAt > now) {
        cut = true;
        continue;
      }
      const fraction = p.durationMs > 0 ? Math.min(1, (now - p.startsAt) / p.durationMs) : 0;
      if (p.done && fraction >= 0.98) {
        heard.push(p.text);
        continue;
      }
      cut = true;
      const words = p.text.split(/\s+/);
      const n = Math.floor(words.length * fraction);
      if (n > 0) heard.push(`${words.slice(0, n).join(" ")}…`);
    }
    this.pieces.clear();
    if (this.talking || cut) this.transport.clear();
    this.playhead = now;
    const wasTalking = this.talking;
    this.talking = false;
    if (wasTalking) this.events.onQuiet?.();
    return { heard: heard.join(" ").trim(), cut };
  }

  close(): void {
    this.closed = true;
    this.synth?.abort();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
