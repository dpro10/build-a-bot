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

/** Defaults per provider. Any of them can be overridden with TRANSCRIBE_BASE_URL / TRANSCRIBE_MODEL. */
export const TRANSCRIBE_PRESETS: Record<string, Preset> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo", label: "Whisper large-v3 turbo on Groq" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1", label: "Whisper on OpenAI" },
  fireworks: { baseUrl: "https://audio-turbo.us-virginia-1.direct.fireworks.ai/v1", model: "whisper-v3-turbo", label: "Whisper v3 turbo on Fireworks" },
  deepinfra: { baseUrl: "https://api.deepinfra.com/v1/openai", model: "openai/whisper-large-v3-turbo", label: "Whisper large-v3 turbo on DeepInfra" },
  together: { baseUrl: "https://api.together.xyz/v1", model: "openai/whisper-large-v3", label: "Whisper large-v3 on Together" },
  custom: { baseUrl: "", model: "whisper-1", label: "Your speech-to-text server" },
};

const DEFAULT_PROVIDER = "groq";

export function transcriptionSetup(): { provider: string; baseUrl: string; model: string; label: string } | null {
  const t = config.transcribe;
  if (!t.apiKey) return null;
  const provider = t.provider && TRANSCRIBE_PRESETS[t.provider] ? t.provider : t.baseUrl ? "custom" : DEFAULT_PROVIDER;
  const preset = TRANSCRIBE_PRESETS[provider];
  const baseUrl = (t.baseUrl ?? preset.baseUrl).replace(/\/$/, "");
  if (!baseUrl) return null;
  return { provider, baseUrl, model: t.model ?? preset.model, label: preset.label };
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
  const setup = transcriptionSetup();
  if (!setup) {
    if (!demoMode) throw new TranscriptionError("Meeting notes aren't set up on this server yet.", false);
    return { segments: demoTranscription(input.track, input.chunk, input.durationMs), provider: "demo", model: "demo", simulated: true };
  }
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
    return fetchWithTimeout(`${setup.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.transcribe.apiKey}` },
      body: form,
      timeoutMs: 90_000,
    });
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
  const data = (await res.json().catch(() => ({}))) as { text?: string; segments?: VerboseSegment[] };
  const segments = Array.isArray(data.segments)
    ? cleanSegments(data.segments, input.durationMs)
    : cleanSegments([{ start: 0, end: input.durationMs / 1000, text: data.text ?? "" }], input.durationMs);
  return { segments, provider: setup.provider, model: setup.model, simulated: false };
}
