/**
 * Short things the bot says often ("Mm-hm.", "One sec."), made once per voice and rate and kept in
 * memory, so they play the instant they're needed instead of waiting for synthesis.
 */
import { concatPcm } from "../audio/pcm.ts";
import type { SpeechEngine } from "../speech/engine.ts";
import { forSpeech } from "../speech/text.ts";

export const FILLERS = ["Mm-hm.", "One sec.", "Let me check.", "Okay."] as const;

export class PhraseCache {
  private readonly engine: SpeechEngine;
  private readonly made = new Map<string, Int16Array>();
  private readonly making = new Map<string, Promise<Int16Array | null>>();

  constructor(engine: SpeechEngine) {
    this.engine = engine;
  }

  private key(text: string, voice: string, rate: number): string {
    return `${voice}|${rate}|${text}`;
  }

  /** The audio if it's ready; never waits. */
  get(text: string, voice: string, rate: number): Int16Array | undefined {
    return this.made.get(this.key(text, voice, rate));
  }

  /** Makes it if needed (one at a time, so a call's live speech isn't held up for long). */
  async make(text: string, voice: string, rate: number): Promise<Int16Array | null> {
    const key = this.key(text, voice, rate);
    const ready = this.made.get(key);
    if (ready) return ready;
    const pending = this.making.get(key);
    if (pending) return pending;
    const job = (async () => {
      const parts: Int16Array[] = [];
      const result = await this.engine.speak(forSpeech(text), { sampleRate: rate, voice }, (pcm) => parts.push(pcm)).catch(() => null);
      this.making.delete(key);
      if (!result || result.status !== "ok") return null;
      const pcm = concatPcm(parts);
      this.made.set(key, pcm);
      return pcm;
    })();
    this.making.set(key, job);
    return job;
  }

  async warm(texts: readonly string[], voice: string, rate: number): Promise<void> {
    for (const t of texts) await this.make(t, voice, rate);
  }
}
