/**
 * What a call needs from the speech models: hear an utterance, speak a sentence (streamed, and
 * stoppable). Two implementations: the nemo-voice sidecar (sidecar.ts, the fast path), and any
 * `nemo-speech serve` over HTTP (http.ts: buffered synthesis, for a machine that only has NVIDIA's
 * stock server, like the desktop app's).
 */

export type Heard = {
  text: string;
  confidence: number;
  /** Language Parakeet detected, when it reports one ("en", "es"...). */
  language?: string;
  elapsedMs: number;
};

export type HearOptions = {
  language?: string;
  /** Words to listen out for: the bot's name, the owner's, contacts'. */
  phrases?: string[];
};

export type SpeakOptions = {
  /** Output rate: 8000 for phone calls, up to the model's 22050. */
  sampleRate: number;
  voice?: string;
  language?: string;
  signal?: AbortSignal;
};

export type Spoken = {
  status: "ok" | "cancelled" | "error";
  error?: string;
  /** Time to the first audio, measured by the engine. */
  ttfaMs: number;
  /** Seconds of audio per second of compute. */
  rtfx: number;
  audioS: number;
  elapsedS: number;
};

export type EngineInfo = {
  version: string;
  asr: boolean;
  tts: boolean;
  voices: string[];
  /** The voice when none is asked for. */
  voice: string;
  /** Magpie's native output rate. */
  sampleRate: number;
};

export interface SpeechEngine {
  readonly info: EngineInfo;
  hear(pcm: Int16Array, sampleRate: number, opts?: HearOptions): Promise<Heard>;
  /** Streams audio to onAudio as it's made; resolves when done, cancelled (signal) or failed. */
  speak(text: string, opts: SpeakOptions, onAudio: (pcm: Int16Array) => void): Promise<Spoken>;
  close(): Promise<void>;
}

export class EngineError extends Error {
  override name = "EngineError";
}
