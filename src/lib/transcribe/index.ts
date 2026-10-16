/**
 * Speech-to-text for meeting notes and voice typing.
 *
 * One interface over any OpenAI-compatible `POST /audio/transcriptions` endpoint
 * (multipart: file + model, `verbose_json` for timestamps). TRANSCRIBE_PROVIDER picks the base
 * URL and model; TRANSCRIBE_BASE_URL / TRANSCRIBE_MODEL override them.
 *
 * The recommended setup runs NVIDIA's open models: our own speech server (speech/: NVIDIA Parakeet
 * and Nemotron on a Nebius Serverless AI endpoint) first, and NVIDIA Parakeet on Together AI as the
 * backup. A language the main provider can't hear goes straight to the backup; on Together that's
 * Whisper for the languages Parakeet doesn't speak.
 *
 * Without a key, nothing is transcribed: never made up. Tests and screenshots can turn on a
 * scripted meeting (DEMO_SPEECH=1, in demo mode) so every flow can be clicked through.
 * Audio is transcribed in memory and never stored.
 */
import { config, demoSpeech } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/tools/net";
import { demoTranscription } from "./demo";

export type TranscriptSegment = { startMs: number; endMs: number; text: string };

export type Transcription = {
  segments: TranscriptSegment[];
  provider: string;
  model: string;
  /** True when no real speech-to-text ran (demo mode). */
  simulated: boolean;
  /** How long the audio really was, as the provider measured it (verbose_json `duration`). */
  audioMs?: number;
  /** The prompt (names and earlier sentences) was sent: the model takes hints. */
  prompted: boolean;
  /** What this transcription cost, in millionths of a dollar. */
  costMicros: number;
};

export type TranscribeInput = {
  audio: ArrayBuffer;
  mime: string;
  /** Length of this chunk, used when the provider returns no timestamps. */
  durationMs: number;
  /** The last few sentences before this chunk, or names to spell right: for models that take hints. */
  prompt?: string;
  /** ISO 639-1 ("en", "ja"), or unset to detect it. */
  language?: string;
  /** For the demo script. */
  track: "mic" | "system";
  chunk: number;
};

/** NVIDIA Parakeet TDT 0.6B v3: English and 24 European languages. */
export const PARAKEET_LANGUAGES: ReadonlySet<string> = new Set([
  "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it",
  "lt", "lv", "mt", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk",
]);

/** Our speech server (speech/) adds NVIDIA Nemotron 3.5 ASR for these. */
export const NEMOTRON_LANGUAGES: ReadonlySet<string> = new Set(["ar", "hi", "ja", "ko", "nb", "no", "tr", "vi", "zh"]);

type Preset = {
  baseUrl: string;
  model: string;
  label: (model: string) => string;
  /** US dollars per hour of audio, and the shortest a request is billed as. */
  costPerHour: number;
  minSeconds?: number;
  /** The languages the default model hears; unset = Whisper's (nearly all). */
  languages?: ReadonlySet<string>;
  /** The model for languages outside `languages` (Together: Whisper, where Parakeet can't go). */
  wideModel?: string;
};

const isWhisper = (model: string) => /whisper|gpt-4o.*transcribe/i.test(model);

/**
 * Providers with an OpenAI-shaped endpoint that returns segment timestamps (verbose_json) for webm/ogg.
 * Nebius Token Factory has no speech-to-text model; our own server on Nebius AI Cloud does that.
 */
export const TRANSCRIBE_PRESETS: Record<string, Preset> = {
  // Our speech server (speech/README.md): set TRANSCRIBE_BASE_URL to its URL + /v1. It runs on a
  // fixed-price machine; the cost here is that machine's price spread over the audio it can hear.
  nvidia: {
    baseUrl: "",
    model: "parakeet-tdt-0.6b-v3",
    label: () => "NVIDIA Parakeet and Nemotron on our speech server (Nebius)",
    costPerHour: 0.05,
    languages: new Set([...PARAKEET_LANGUAGES, ...NEMOTRON_LANGUAGES]),
  },
  // ~$0.04 per audio hour, billed at least 10 s per request; the free tier is 7,200 audio-seconds an hour.
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo", label: (m) => `${m} on Groq`, costPerHour: 0.04, minSeconds: 10 },
  // NVIDIA Parakeet at $0.0015 a minute (~$0.09 an hour); Whisper large-v3 for the languages Parakeet doesn't speak.
  together: {
    baseUrl: "https://api.together.ai/v1",
    model: "nvidia/parakeet-tdt-0.6b-v3",
    label: (m) => (/parakeet/i.test(m) ? "NVIDIA Parakeet on Together AI" : `${m} on Together AI`),
    costPerHour: 0.09,
    languages: PARAKEET_LANGUAGES,
    wideModel: "openai/whisper-large-v3",
  },
  // whisper-1 returns timestamps; the gpt-4o transcribe models return plain text (handled below).
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1", label: (m) => `${m} on OpenAI`, costPerHour: 0.36 },
  // Any OpenAI-compatible server: speaches/faster-whisper, whisper.cpp's server, LocalAI…
  custom: { baseUrl: "", model: "whisper-1", label: () => "Your speech-to-text server", costPerHour: 0 },
};

const DEFAULT_PROVIDER = "groq";

type Setup = { provider: string; baseUrl: string; model: string; label: string; apiKey: string };

function resolveSetup(t: { provider?: string; apiKey?: string; baseUrl?: string; model?: string }): Setup | null {
  if (!t.apiKey) return null;
  const provider = t.provider && TRANSCRIBE_PRESETS[t.provider] ? t.provider : t.baseUrl ? "custom" : DEFAULT_PROVIDER;
  const preset = TRANSCRIBE_PRESETS[provider];
  const baseUrl = (t.baseUrl ?? preset.baseUrl).replace(/\/$/, "");
  if (!baseUrl) return null;
  const model = t.model ?? preset.model;
  return { provider, baseUrl, model, label: preset.label(model), apiKey: t.apiKey };
}

/**
 * The model this setup uses for a language, or null when it can't hear that language. A model
 * someone set themselves (TRANSCRIBE_MODEL) is trusted with every language, except on our own server.
 */
function modelFor(setup: Setup, language: string | undefined): string | null {
  const preset = TRANSCRIBE_PRESETS[setup.provider];
  const lang = language?.toLowerCase();
  if (!lang || !preset.languages || preset.languages.has(lang)) return setup.model;
  if (setup.model !== preset.model) return setup.provider === "nvidia" ? null : setup.model;
  return preset.wideModel ?? null;
}

export function transcriptionSetup(): Omit<Setup, "apiKey"> | null {
  const s = resolveSetup(config.transcribe);
  if (!s) return null;
  const { apiKey: _k, ...rest } = s;
  return rest;
}

/** The key speech-to-text uses when it runs on Groq: voice typing's cleanup can use the same provider. */
export function groqApiKey(): string | null {
  for (const t of [config.transcribe, config.transcribe.fallback]) {
    const s = resolveSetup(t);
    if (s?.provider === "groq") return s.apiKey;
  }
  return null;
}

/** Meeting notes can run: a real speech-to-text key (or, in tests, scripted speech). */
export function transcriptionAvailable(): boolean {
  return Boolean(transcriptionSetup()) || demoSpeech;
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** "unsupported_language": this provider can't hear the language (another one might). */
    readonly code?: string,
  ) {
    super(message);
  }
}

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/flac": "flac",
};

export function audioExtension(mime: string): string | null {
  return EXT[mime.split(";")[0].trim().toLowerCase()] ?? null;
}

/**
 * Whisper-family models invent text on silence and music ("Thanks for watching!").
 * Drop segments the model itself thinks aren't speech, and the well-known phantom lines.
 */
const PHANTOM = /^(?:thanks?(?: you)? (?:so much )?for watching[.!]*|please subscribe[.!]*|subtitles? by .*|transcribed by .*|you|\.+|thank you\.?)$/i;

type VerboseSegment = { start?: number; end?: number; text?: string; no_speech_prob?: number; avg_logprob?: number };

export function cleanSegments(raw: VerboseSegment[], durationMs: number): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const s of raw) {
    const text = (s.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if ((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.7) continue;
    if (PHANTOM.test(text) && (s.no_speech_prob ?? 0) > 0.2) continue;
    const startMs = Math.max(0, Math.round((s.start ?? 0) * 1000));
    const endMs = Math.min(Math.max(startMs, Math.round((s.end ?? (s.start ?? 0)) * 1000)), Math.max(durationMs, startMs));
    out.push({ startMs, endMs, text });
  }
  return out;
}

const UNSUPPORTED = (language?: string) => new TranscriptionError(`Speech-to-text can't hear ${language ? `this language (${language})` : "this language"} yet.`, false, "unsupported_language");

export async function transcribe(input: TranscribeInput): Promise<Transcription> {
  const primary = resolveSetup(config.transcribe);
  if (!primary) {
    if (!demoSpeech) throw new TranscriptionError("Speech-to-text isn't set up on this server yet.", false);
    return { segments: demoTranscription(input.track, input.chunk, input.durationMs), provider: "demo", model: "demo", simulated: true, prompted: false, costMicros: 0 };
  }
  const fallback = resolveSetup(config.transcribe.fallback);
  const primaryModel = modelFor(primary, input.language);
  if (!primaryModel) {
    // The main provider doesn't hear this language: straight to the backup, if it does.
    const backupModel = fallback ? modelFor(fallback, input.language) : null;
    if (!fallback || !backupModel) throw UNSUPPORTED(input.language);
    return transcribeWith(fallback, backupModel, input);
  }
  try {
    return await transcribeWith(primary, primaryModel, input);
  } catch (err) {
    const backupModel = fallback ? modelFor(fallback, input.language) : null;
    const tryBackup = err instanceof TranscriptionError && (err.retryable || err.code === "unsupported_language");
    if (fallback && backupModel && tryBackup) return transcribeWith(fallback, backupModel, input);
    throw err;
  }
}

async function transcribeWith(setup: Setup, model: string, input: TranscribeInput): Promise<Transcription> {
  const ext = audioExtension(input.mime);
  if (!ext) throw new TranscriptionError(`Unsupported audio format: ${input.mime}`, false);
  // NVIDIA's models don't take hints; our server would read a prompt as one phrase to boost.
  const prompted = Boolean(input.prompt) && isWhisper(model);

  const send = async (format: "verbose_json" | "json") => {
    const form = new FormData();
    form.append("model", model);
    form.append("file", new Blob([input.audio], { type: input.mime.split(";")[0] }), `chunk.${ext}`);
    form.append("response_format", format);
    if (format === "verbose_json") form.append("timestamp_granularities[]", "segment");
    if (input.language) form.append("language", input.language);
    if (prompted) form.append("prompt", input.prompt!.slice(-600));
    form.append("temperature", "0");
    try {
      return await fetchWithTimeout(`${setup.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${setup.apiKey}` },
        body: form,
        timeoutMs: 90_000,
      });
    } catch {
      // Timeouts and dropped connections: the recorder retries the chunk.
      throw new TranscriptionError("Couldn't reach speech-to-text.", true);
    }
  };

  let res = await send("verbose_json");
  // Some models (e.g. the gpt-4o transcribe family) only return plain JSON: retry without timestamps.
  if (res.status === 400) {
    const body = await res.text().catch(() => "");
    if (/response_format|verbose_json|timestamp/i.test(body)) res = await send("json");
    else throw new TranscriptionError(`Speech-to-text refused the audio: ${body.slice(0, 200)}`, false);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 422 && /unsupported_language/.test(body)) throw UNSUPPORTED(input.language);
    throw new TranscriptionError(`Speech-to-text failed (${res.status}): ${body.slice(0, 200)}`, res.status === 429 || res.status >= 500);
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string; segments?: VerboseSegment[]; duration?: number };
  const segments = Array.isArray(data.segments)
    ? cleanSegments(data.segments, input.durationMs)
    : cleanSegments([{ start: 0, end: input.durationMs / 1000, text: data.text ?? "" }], input.durationMs);
  const audioMs = typeof data.duration === "number" && Number.isFinite(data.duration) && data.duration > 0 ? Math.round(data.duration * 1000) : undefined;
  const preset = TRANSCRIBE_PRESETS[setup.provider];
  const billedSeconds = Math.max(preset.minSeconds ?? 0, (audioMs ?? input.durationMs) / 1000);
  const costMicros = Math.round(billedSeconds * (preset.costPerHour / 3600) * 1_000_000);
  return { segments, provider: setup.provider, model, simulated: false, prompted, costMicros, ...(audioMs ? { audioMs } : {}) };
}
