/**
 * NVIDIA's stock `nemo-speech serve` over HTTP: the same models, without streaming synthesis (each
 * sentence arrives whole). The fallback for a machine that runs NVIDIA's server rather than the
 * sidecar, such as the speech/ image or the desktop app's engine.
 */
import { bytesToPcm, encodeWav } from "../audio/pcm.ts";
import { EngineError, type EngineInfo, type Heard, type HearOptions, type SpeakOptions, type SpeechEngine, type Spoken } from "./engine.ts";

export type HttpEngineOptions = {
  baseUrl: string;
  apiKey?: string;
  voice?: string;
  fetchImpl?: typeof fetch;
};

export class HttpEngine implements SpeechEngine {
  info: EngineInfo = { version: "", asr: false, tts: false, voices: [], voice: "", sampleRate: 22050 };
  private readonly base: string;
  private readonly opts: HttpEngineOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpEngineOptions) {
    this.opts = opts;
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}`, ...extra } : extra;
  }

  /** Reads what the server has loaded. */
  async start(): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/v1/models`, { headers: this.headers() });
    if (!res.ok) throw new EngineError(`speech server answered ${res.status}`);
    const body = (await res.json()) as { data?: { capability?: string; id?: string; voices?: string[] }[] };
    const speech = body.data?.find((m) => m.capability === "speech");
    const asr = body.data?.some((m) => m.capability === "transcription") ?? false;
    const version = await this.fetchImpl(`${this.base}/version`)
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
    this.info = {
      version: version.trim(),
      asr,
      tts: Boolean(speech),
      voices: speech?.voices ?? [],
      voice: this.opts.voice || speech?.voices?.[0] || "",
      sampleRate: 22050,
    };
  }

  async hear(pcm: Int16Array, sampleRate: number, opts: HearOptions = {}): Promise<Heard> {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(encodeWav(pcm, sampleRate))], { type: "audio/wav" }), "turn.wav");
    form.set("response_format", "json");
    if (opts.language) form.set("language", opts.language);
    const phrases = (opts.phrases ?? []).filter(Boolean).slice(0, 50);
    if (phrases.length) form.set("speech_contexts", JSON.stringify([{ phrases, boost: 4 }]));
    const t0 = performance.now();
    const res = await this.fetchImpl(`${this.base}/v1/audio/transcriptions`, { method: "POST", body: form, headers: this.headers() });
    if (!res.ok) throw new EngineError(`speech recognition failed (${res.status})`);
    const body = (await res.json()) as { text?: string };
    return { text: (body.text ?? "").trim(), confidence: 1, elapsedMs: performance.now() - t0 };
  }

  async speak(text: string, opts: SpeakOptions, onAudio: (pcm: Int16Array) => void): Promise<Spoken> {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/v1/audio/speech`, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ input: text, voice: opts.voice || this.info.voice || "default", sample_rate: opts.sampleRate, response_format: "pcm", language: opts.language }),
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return { status: "cancelled", ttfaMs: 0, rtfx: 0, audioS: 0, elapsedS: (performance.now() - t0) / 1000 };
      return { status: "error", error: (err as Error).message, ttfaMs: 0, rtfx: 0, audioS: 0, elapsedS: (performance.now() - t0) / 1000 };
    }
    if (!res.ok) return { status: "error", error: `speech synthesis failed (${res.status})`, ttfaMs: 0, rtfx: 0, audioS: 0, elapsedS: (performance.now() - t0) / 1000 };
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      return { status: (err as Error).name === "AbortError" ? "cancelled" : "error", ttfaMs: 0, rtfx: 0, audioS: 0, elapsedS: (performance.now() - t0) / 1000 };
    }
    const ttfaMs = performance.now() - t0;
    const pcm = bytesToPcm(bytes);
    // Hand it over in 100 ms pieces, like the streaming engine.
    const step = Math.round(opts.sampleRate / 10);
    for (let i = 0; i < pcm.length; i += step) {
      if (opts.signal?.aborted) return { status: "cancelled", ttfaMs, rtfx: 0, audioS: i / opts.sampleRate, elapsedS: ttfaMs / 1000 };
      onAudio(pcm.subarray(i, i + step));
    }
    const audioS = pcm.length / opts.sampleRate;
    return { status: "ok", ttfaMs, rtfx: audioS / (ttfaMs / 1000), audioS, elapsedS: ttfaMs / 1000 };
  }

  async close(): Promise<void> {}
}
