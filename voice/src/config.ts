/**
 * Settings, from the environment. Secrets (VOICE_SERVER_SECRET, TOKEN_FACTORY_API_KEY) come from
 * the deploy, never from the repo, and are never logged.
 */

export type VoiceConfig = {
  port: number;
  host: string;
  /** The Build-a-bot app this server works for (its /api/calls/* routes). */
  appUrl: string;
  secret: string;
  /** Browser origins allowed to open a web call. */
  allowedOrigins: string[];
  maxCalls: number;
  talker: { baseUrl: string; apiKey: string; model: string; extraBody: Record<string, unknown> };
  speech:
    | { kind: "sidecar"; bin: string; args: string[] }
    | { kind: "http"; url: string; apiKey?: string };
  voice: string;
  vadModel: string;
  /** Rate for browser calls (Magpie's own is 22050: no resampling). */
  webRate: number;
  /** Settings that were set but couldn't be used, and what's used instead (logged at start). */
  warnings: string[];
};

const env = (name: string) => {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
};

/** Calls at once: a whole number, 1 or more. Anything else is 1, never "no limit". */
export function parseMaxCalls(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export function loadConfig(): VoiceConfig {
  const missing: string[] = [];
  const need = (name: string) => {
    const v = env(name);
    if (!v) missing.push(name);
    return v ?? "";
  };
  const appUrl = need("APP_URL").replace(/\/$/, "");
  const secret = need("VOICE_SERVER_SECRET");
  const apiKey = need("TOKEN_FACTORY_API_KEY");
  if (missing.length) throw new Error(`Missing settings: ${missing.join(", ")}`);
  if (secret.length < 32) throw new Error("VOICE_SERVER_SECRET must be at least 32 characters");

  const voice = env("VOICE") ?? "Sofia";
  const speechUrl = env("SPEECH_URL");
  const models = env("MODELS_DIR") ?? "/opt/models";
  const sidecarArgs = env("NEMO_VOICE_ARGS")?.split(/\s+/).filter(Boolean) ?? [
    "--asr-model",
    env("ASR_MODEL") ?? `${models}/parakeet-tdt-0.6b-v3.q8_0.gguf`,
    "--tts-model",
    env("TTS_MODEL") ?? `${models}/magpie/magpie_tts_multilingual_357m.v2607.q8_0.gguf`,
    "--codec-model",
    env("CODEC_MODEL") ?? `${models}/magpie/nemo_nano_codec_22khz_1.89kbps_21.5fps.decoder.f16.gguf`,
    "--tokenizer-dir",
    env("TOKENIZER_DIR") ?? `${models}/magpie/tokenizer`,
    "--voice",
    voice,
    ...(env("ITN_DIR") ? ["--itn-dir", env("ITN_DIR")!] : []),
    ...(env("TTS_THREADS") ? ["--tts-threads", env("TTS_THREADS")!] : []),
    ...(env("CODEC_THREADS") ? ["--codec-threads", env("CODEC_THREADS")!] : []),
    // Classifier-free guidance: without it Magpie reads slower, with longer pauses (one voice went
    // from 183 to 147 words a minute). It costs almost nothing on a CPU, where the codec, not
    // Magpie, sets the speed. TTS_CFG=0 turns it off.
    ...(env("TTS_CFG") === "0" ? ["--no-cfg"] : []),
    ...(env("GPU") ? ["--gpu", env("GPU")!] : []),
  ];
  // Reasoning stays off: it would add a second or two before every answer. What keeps the talker
  // honest about the work is in brain/talker.ts and call/session.ts instead.
  let extraBody: Record<string, unknown> = { reasoning_effort: "none" };
  if (env("TALKER_EXTRA_BODY")) {
    try {
      extraBody = JSON.parse(env("TALKER_EXTRA_BODY")!) as Record<string, unknown>;
    } catch {
      throw new Error("TALKER_EXTRA_BODY isn't valid JSON");
    }
  }
  const appOrigin = new URL(appUrl).origin;
  const warnings: string[] = [];
  const maxCalls = env("MAX_CALLS") === undefined ? 1 : parseMaxCalls(env("MAX_CALLS"));
  if (maxCalls === null) warnings.push(`MAX_CALLS isn't a whole number of 1 or more, so it's 1`);
  return {
    port: Number(env("PORT") ?? 8080),
    host: env("HOST") ?? "0.0.0.0",
    appUrl,
    secret,
    allowedOrigins: [appOrigin, ...(env("ALLOWED_ORIGINS")?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])],
    maxCalls: maxCalls ?? 1,
    warnings,
    talker: {
      baseUrl: env("TOKEN_FACTORY_BASE_URL") ?? "https://api.tokenfactory.nebius.com/v1",
      apiKey,
      model: env("TALKER_MODEL") ?? "nvidia/Nemotron-3_5-Lightning",
      extraBody,
    },
    speech: speechUrl ? { kind: "http", url: speechUrl, apiKey: env("SPEECH_API_KEY") } : { kind: "sidecar", bin: env("NEMO_VOICE_BIN") ?? "/opt/nemo-speech/bin/nemo-voice", args: sidecarArgs },
    voice,
    vadModel: env("SILERO_VAD_MODEL") ?? `${models}/silero_vad.onnx`,
    webRate: Number(env("WEB_SAMPLE_RATE") ?? 22050),
  };
}
