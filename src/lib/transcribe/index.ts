/**
 * Speech-to-text for meeting notes.
 *
 * One interface over any OpenAI-compatible `POST /audio/transcriptions` endpoint
 * (multipart: file + model, `verbose_json` for timestamps). TRANSCRIBE_PROVIDER picks
 * the base URL and model; TRANSCRIBE_BASE_URL / TRANSCRIBE_MODEL override them.
 * Without a key, demo mode returns a scripted meeting so every flow can be clicked through.
 *
 * Audio is transcribed in memory and never stored.
 */
import { config, demoMode } from "@/lib/env";
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
};

export type TranscribeInput = {
  audio: ArrayBuffer;
  mime: string;
  /** Length of this chunk, used when the provider returns no timestamps. */
  durationMs: number;
  /** The last few sentences before this chunk: helps the model keep names and spelling consistent. */
  prompt?: string;
  language?: string;
  /** For the demo script. */
  track: "mic" | "system";
  chunk: number;
};

type Preset = { baseUrl: string; model: string; label: string };

/**
 * Providers with an OpenAI-shaped endpoint that returns segment timestamps (verbose_json) for webm/ogg.
 * Nebius Token Factory has no speech-to-text model (docs/research/meetings-2026-10-14.md §4.1).
 */
export const TRANSCRIBE_PRESETS: Record<string, Preset> = {
  // ~$0.04 per audio hour, billed at least 10 s per request; the free tier is 7,200 audio-seconds an hour.
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo", label: "Whisper large-v3 turbo on Groq" },
  // ~$0.09 per audio hour; also offers nvidia/parakeet-tdt-0.6b-v3 and speaker separation (diarize).
  together: { baseUrl: "https://api.together.ai/v1", model: "openai/whisper-large-v3", label: "Whisper large-v3 on Together AI" },
  // whisper-1 returns timestamps; the gpt-4o transcribe models return plain text (handled below).
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1", label: "Whisper on OpenAI" },
  // Any OpenAI-compatible server: speaches/faster-whisper, whisper.cpp's server, LocalAI…
  custom: { baseUrl: "", model: "whisper-1", label: "Your speech-to-text server" },
};

const DEFAULT_PROVIDER = "groq";

type Setup = { provider: string; baseUrl: string; model: string; label: string; apiKey: string };

function resolveSetup(t: { provider?: string; apiKey?: string; baseUrl?: string; model?: string }): Setup | null {
  if (!t.apiKey) return null;
  const provider = t.provider && TRANSCRIBE_PRESETS[t.provider] ? t.provider : t.baseUrl ? "custom" : DEFAULT_PROVIDER;
  const preset = TRANSCRIBE_PRESETS[provider];
  const baseUrl = (t.baseUrl ?? preset.baseUrl).replace(/\/$/, "");
  if (!baseUrl) return null;
  return { provider, baseUrl, model: t.model ?? preset.model, label: preset.label, apiKey: t.apiKey };
}

export function transcriptionSetup(): Omit<Setup, "apiKey"> | null {
  const s = resolveSetup(config.transcribe);
  if (!s) return null;
  const { apiKey: _k, ...rest } = s;
  return rest;
}

/** Meeting notes can run: a real speech-to-text key, or demo mode. */
export function transcriptionAvailable(): boolean {
  return Boolean(transcriptionSetup()) || demoMode;
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
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

export async function transcribe(input: TranscribeInput): Promise<Transcription> {
  const primary = resolveSetup(config.transcribe);
  if (!primary) {
    if (!demoMode) throw new TranscriptionError("Meeting notes are coming soon.", false);
    return { segments: demoTranscription(input.track, input.chunk, input.durationMs), provider: "demo", model: "demo", simulated: true };
  }
  try {
    return await transcribeWith(primary, input);
  } catch (err) {
    const fallback = resolveSetup(config.transcribe.fallback);
    if (fallback && err instanceof TranscriptionError && err.retryable) return transcribeWith(fallback, input);
    throw err;
  }
}

async function transcribeWith(setup: Setup, input: TranscribeInput): Promise<Transcription> {
  const ext = audioExtension(input.mime);
  if (!ext) throw new TranscriptionError(`Unsupported audio format: ${input.mime}`, false);

  const send = async (format: "verbose_json" | "json") => {
    const form = new FormData();
    form.append("file", new Blob([input.audio], { type: input.mime.split(";")[0] }), `chunk.${ext}`);
    form.append("model", setup.model);
    form.append("response_format", format);
    if (format === "verbose_json") form.append("timestamp_granularities[]", "segment");
    if (input.language) form.append("language", input.language);
    if (input.prompt) form.append("prompt", input.prompt.slice(-600));
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
    throw new TranscriptionError(`Speech-to-text failed (${res.status}): ${body.slice(0, 200)}`, res.status === 429 || res.status >= 500);
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string; segments?: VerboseSegment[]; duration?: number };
  const segments = Array.isArray(data.segments)
    ? cleanSegments(data.segments, input.durationMs)
    : cleanSegments([{ start: 0, end: input.durationMs / 1000, text: data.text ?? "" }], input.durationMs);
  const audioMs = typeof data.duration === "number" && Number.isFinite(data.duration) && data.duration > 0 ? Math.round(data.duration * 1000) : undefined;
  return { segments, provider: setup.provider, model: setup.model, simulated: false, ...(audioMs ? { audioMs } : {}) };
}
