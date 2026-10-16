/**
 * Starts the voice server: the speech models (NVIDIA Parakeet and Magpie via nemo-voice), Silero
 * VAD, the talker (Nemotron 3.5 Lightning on Token Factory), then HTTP and WebSockets.
 * Logs are one JSON object a line, and never carry what anyone said.
 */
import { loadConfig } from "./config.ts";
import { HttpApp } from "./brain/app.ts";
import { OpenAiCompatibleLlm } from "./brain/llm.ts";
import { PhraseCache, FILLERS } from "./call/phrases.ts";
import { createVoiceServer } from "./server.ts";
import { HttpEngine } from "./speech/http.ts";
import { SidecarEngine } from "./speech/sidecar.ts";
import type { SpeechEngine } from "./speech/engine.ts";
import { EnergyVad, SileroVad, type Vad } from "./vad/vad.ts";

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}

const config = loadConfig();
let ready = false;

let engine: SpeechEngine;
if (config.speech.kind === "sidecar") {
  engine = new SidecarEngine({ bin: config.speech.bin, args: config.speech.args, log: (line) => log("engine", { line }) });
} else {
  engine = new HttpEngine({ baseUrl: config.speech.url, apiKey: config.speech.apiKey, voice: config.voice });
}

let vad: Vad;
try {
  vad = await SileroVad.load(config.vadModel);
} catch (err) {
  log("vad_fallback", { error: (err as Error).message });
  vad = new EnergyVad();
}

const llm = new OpenAiCompatibleLlm({ baseUrl: config.talker.baseUrl, apiKey: config.talker.apiKey, model: config.talker.model, extraBody: config.talker.extraBody });
const app = new HttpApp({ baseUrl: config.appUrl, secret: config.secret });
const phrases = new PhraseCache(engine);

const voice = createVoiceServer({
  secret: config.secret,
  allowedOrigins: config.allowedOrigins,
  maxCalls: config.maxCalls,
  webRate: config.webRate,
  engine,
  vad,
  llm,
  app,
  phrases,
  ready: () => ready,
  log,
});
voice.server.listen(config.port, config.host, () => log("listening", { port: config.port }));

const t0 = performance.now();
try {
  await (engine as SidecarEngine | HttpEngine).start();
} catch (err) {
  log("engine_failed", { error: (err as Error).message });
  process.exit(1);
}
log("engine_ready", { ms: Math.round(performance.now() - t0), version: engine.info.version, voices: engine.info.voices });
// Fillers in the default voice, at phone and browser rates, before the first call.
for (const rate of [8000, config.webRate]) await phrases.warm(FILLERS, engine.info.voice || config.voice, rate);
ready = true;
log("ready", { ms: Math.round(performance.now() - t0) });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log("shutting_down", { signal, calls: voice.calls() });
    ready = false;
    void voice
      .close()
      .then(() => engine.close())
      .finally(() => process.exit(0));
  });
}
