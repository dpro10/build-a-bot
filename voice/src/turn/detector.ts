/**
 * Turn-taking: when has the caller started talking, paused, or finished?
 *
 * Fed one voice-activity probability per 32 ms. Hysteresis keeps a breath from splitting a turn;
 * two silence thresholds make it fast without cutting people off:
 *   pause  (~200 ms of quiet)  a guess that the turn is over: transcribe and start thinking now
 *   end    (~600 ms of quiet)  the turn really is over: answer
 * If they start again between the two, "resume" withdraws the guess. While the bot is talking it
 * takes longer, surer speech to count as the caller cutting in (barge-in), so a cough, an echo or
 * an "mm-hm" doesn't stop it mid-sentence.
 */

export type TurnEvent =
  | { type: "speech_start"; at: number }
  | { type: "pause"; at: number; speechMs: number }
  | { type: "resume"; at: number }
  | { type: "end"; at: number; speechMs: number }
  | { type: "barge_in"; at: number };

export type TurnOptions = {
  /** Probability at or above which a window is speech. */
  onThreshold: number;
  /** Probability below which a window is silence (between the two, nothing changes). */
  offThreshold: number;
  /** Speech needed before a turn starts. */
  minSpeechMs: number;
  /** Silence before the early guess. */
  pauseMs: number;
  /** Silence that ends the turn. */
  endMs: number;
  /** While the bot talks: speech needed to interrupt it, at bargeInThreshold or more. */
  bargeInMs: number;
  bargeInThreshold: number;
};

export const DEFAULT_TURN: TurnOptions = {
  onThreshold: 0.5,
  offThreshold: 0.35,
  minSpeechMs: 96,
  pauseMs: 192,
  endMs: 640,
  bargeInMs: 288,
  bargeInThreshold: 0.75,
};

export class TurnDetector {
  readonly opts: TurnOptions;
  /** The bot is talking: the bar for the caller to start a turn is barge-in's. */
  botSpeaking = false;
  private now = 0;
  private inTurn = false;
  private run = 0;
  private runStart = 0;
  private silenceMs = 0;
  private speechMs = 0;
  private paused = false;
  private endMs: number;

  constructor(opts: Partial<TurnOptions> = {}) {
    this.opts = { ...DEFAULT_TURN, ...opts };
    this.endMs = this.opts.endMs;
  }

  /** Time fed so far, in ms. */
  get time(): number {
    return this.now;
  }

  get speaking(): boolean {
    return this.inTurn;
  }

  /** Wait longer (or less) before ending this turn: "and…" wants more, a full question less. */
  setEndMs(ms: number): void {
    this.endMs = Math.max(this.opts.pauseMs + 32, ms);
  }

  push(prob: number, frameMs: number): TurnEvent[] {
    const at = this.now;
    this.now += frameMs;
    const events: TurnEvent[] = [];
    if (!this.inTurn) {
      const threshold = this.botSpeaking ? this.opts.bargeInThreshold : this.opts.onThreshold;
      const needed = this.botSpeaking ? this.opts.bargeInMs : this.opts.minSpeechMs;
      if (prob >= threshold) {
        if (this.run === 0) this.runStart = at;
        this.run += frameMs;
        if (this.run >= needed) {
          this.inTurn = true;
          this.speechMs = this.run;
          this.silenceMs = 0;
          this.paused = false;
          this.endMs = this.opts.endMs;
          if (this.botSpeaking) events.push({ type: "barge_in", at: this.runStart });
          events.push({ type: "speech_start", at: this.runStart });
          this.run = 0;
        }
      } else if (prob < this.opts.offThreshold || this.botSpeaking) {
        this.run = 0;
      }
      return events;
    }
    if (prob >= this.opts.onThreshold) {
      this.speechMs += frameMs;
      this.silenceMs = 0;
      if (this.paused) {
        this.paused = false;
        events.push({ type: "resume", at });
      }
    } else if (prob < this.opts.offThreshold || this.silenceMs > 0) {
      this.silenceMs += frameMs;
      if (!this.paused && this.silenceMs >= this.opts.pauseMs) {
        this.paused = true;
        events.push({ type: "pause", at: this.now, speechMs: this.speechMs });
      }
      if (this.silenceMs >= this.endMs) {
        events.push({ type: "end", at: this.now, speechMs: this.speechMs });
        this.inTurn = false;
        this.paused = false;
        this.silenceMs = 0;
        this.run = 0;
      }
    } else {
      this.speechMs += frameMs;
    }
    return events;
  }

  /** Forget any turn in progress (the call was reset or put on hold). */
  reset(): void {
    this.inTurn = false;
    this.paused = false;
    this.run = 0;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.endMs = this.opts.endMs;
  }
}

const TRAILING_CONTINUATION =
  /(?:\b(?:and|but|or|so|because|then|um+|uh+|like|the|a|an|to|of|for|with|my|your|is|if|that|which|who|when|where|about|from|at|in|on)|,|-|…)\s*$/i;

/**
 * How long to wait after a pause, from what they've said so far: someone who stopped on "and" or
 * "um" is still going; a finished question can be answered sooner.
 */
export function endDelayFor(transcript: string, base: number): number {
  const text = transcript.trim();
  if (!text) return base;
  if (TRAILING_CONTINUATION.test(text)) return Math.round(base * 1.9);
  if (/[?]$/.test(text)) return Math.round(base * 0.75);
  if (/[.!]$/.test(text) && text.split(/\s+/).length >= 3) return Math.round(base * 0.85);
  return base;
}
