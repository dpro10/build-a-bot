#!/usr/bin/env node
/**
 * Build-a-bot's speech server: NVIDIA's open speech models behind one OpenAI-compatible
 * POST /v1/audio/transcriptions, for voice typing and meeting notes. Built to run on a Nebius
 * Serverless AI endpoint (speech/README.md); the app points TRANSCRIBE_BASE_URL at it.
 *
 *   - NVIDIA Parakeet TDT 0.6B v3 hears "detect it" and 25 languages; NVIDIA Nemotron 3.5 ASR
 *     hears the other languages it knows (Japanese, Chinese, Hindi, Arabic…). Both run on
 *     NVIDIA's NeMo-Speech.cpp, started and watched by this process on 127.0.0.1.
 *   - Any recording the apps make (webm, ogg, mp4, wav, mp3, flac) is turned into the WAV
 *     NeMo-Speech.cpp reads, with a second of silence after it so the last word isn't cut.
 *   - Bearer-key auth, upload and length limits, and a queue so a burst gets "busy" (the app
 *     then uses its backup) instead of a slow pile-up.
 *
 * Privacy: audio is handled in memory (ffmpeg's files go in /dev/shm when it has room, else the
 * temp folder) and deleted as soon as it's text. Nothing that was said is logged or kept: the
 * request log has times, lengths, the model and the language.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { AudioError, MODELS, languageOf, openAiTranscription, route, toWav16k } from "./lib.mjs";

const env = (e, name, fallback) => {
  const v = e[name];
  return v === undefined || v === "" ? fallback : v;
};
const int = (v, fallback) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function configFromEnv(e = process.env) {
  const off = (v) => /^(off|none|false|0)$/i.test(String(v ?? ""));
  const nemotronModel = env(e, "NEMOTRON_MODEL", "/models/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf");
  return {
    host: env(e, "HOST", "0.0.0.0"),
    port: int(e.PORT, 8000),
    apiKey: env(e, "SPEECH_API_KEY", ""),
    allowNoAuth: e.SPEECH_ALLOW_NO_AUTH === "1",
    bin: env(e, "NEMO_SPEECH_BIN", "/opt/nemo-speech/bin/nemo-speech"),
    itnDir: env(e, "ITN_DIR", "/opt/nemo-speech/itn_configs"),
    device: env(e, "SPEECH_DEVICE", "auto"),
    threads: int(e.SPEECH_THREADS, os.availableParallelism()),
    models: {
      parakeet: { file: env(e, "PARAKEET_MODEL", "/models/parakeet-tdt-0.6b-v3.q8_0.gguf"), url: env(e, "PARAKEET_URL", ""), port: 8081 },
      nemotron: off(nemotronModel) ? null : { file: nemotronModel, url: env(e, "NEMOTRON_URL", ""), port: 8082 },
    },
    ffmpeg: env(e, "FFMPEG", "ffmpeg"),
    maxUploadBytes: int(e.MAX_UPLOAD_MB, 25) * 1024 * 1024,
    maxAudioSeconds: int(e.MAX_AUDIO_SECONDS, 1800),
    maxConcurrent: int(e.MAX_CONCURRENT, 4),
    maxQueue: int(e.MAX_QUEUE, 32),
    queueTimeoutMs: int(e.QUEUE_TIMEOUT_MS, 20_000),
    backendTimeoutMs: int(e.BACKEND_TIMEOUT_MS, 180_000),
  };
}

/** The backends' URLs: given (PARAKEET_URL/NEMOTRON_URL), or the local ones this process starts. */
export function backendUrls(cfg) {
  const out = {};
  for (const [name, m] of Object.entries(cfg.models)) {
    if (!m) continue;
    if (m.url) out[name] = m.url.replace(/\/$/, "");
    else if (existsSync(m.file)) out[name] = `http://127.0.0.1:${m.port}`;
  }
  return out;
}

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** At most `max` transcriptions at once; a short queue behind them; "busy" past that. */
class Gate {
  constructor(max, queueMax) {
    this.max = max;
    this.queueMax = queueMax;
    this.active = 0;
    this.waiting = [];
  }
  async enter(timeoutMs) {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    if (this.waiting.length >= this.queueMax) throw new HttpError(503, "busy", "The speech server is busy. Try again in a moment.");
    await new Promise((resolve, reject) => {
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(entry), 1);
        reject(new HttpError(503, "busy", "The speech server is busy. Try again in a moment."));
      }, timeoutMs);
      this.waiting.push(entry);
    });
  }
  leave() {
    const next = this.waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    } else {
      this.active--;
    }
  }
}

const digest = (s) => createHash("sha256").update(String(s)).digest();

/** Reads the request body, refusing more than `limit` bytes. */
async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "too_large", "That recording is too large.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "too_large", "That recording is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

const RESPONSE_FORMATS = new Set(["json", "verbose_json", "text"]);

export function createSpeechServer(cfg, { log = (line) => process.stdout.write(`${JSON.stringify(line)}\n`), fetchImpl = fetch } = {}) {
  const backends = backendUrls(cfg);
  const gate = new Gate(cfg.maxConcurrent, cfg.maxQueue);
  const keyDigest = cfg.apiKey ? digest(cfg.apiKey) : null;
  let readyCache = { at: 0, value: null };

  const authorized = (req) => {
    if (!keyDigest) return cfg.allowNoAuth;
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""));
    return Boolean(m) && timingSafeEqual(digest(m[1].trim()), keyDigest);
  };

  async function readiness() {
    if (Date.now() - readyCache.at < 2000 && readyCache.value) return readyCache.value;
    const entries = await Promise.all(
      Object.entries(backends).map(async ([name, url]) => {
        try {
          const r = await fetchImpl(`${url}/ready`, { signal: AbortSignal.timeout(2000) });
          return [name, r.ok];
        } catch {
          return [name, false];
        }
      }),
    );
    const value = Object.fromEntries(entries);
    readyCache = { at: Date.now(), value };
    return value;
  }

  async function transcribe(req, res, meta) {
    const body = await readBody(req, cfg.maxUploadBytes);
    const type = String(req.headers["content-type"] ?? "");
    if (!/^multipart\/form-data/i.test(type)) throw new HttpError(400, "invalid_request", "Send the audio as multipart/form-data with a `file` field.");
    let form;
    try {
      form = await new Response(body, { headers: { "content-type": type } }).formData();
    } catch {
      throw new HttpError(400, "invalid_request", "Couldn't read the form data.");
    }
    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "invalid_request", "The `file` field is required.", { param: "file" });
    const format = String(form.get("response_format") ?? "json") || "json";
    if (!RESPONSE_FORMATS.has(format)) throw new HttpError(400, "invalid_request", "response_format must be json, verbose_json or text.", { param: "response_format" });
    const granularities = [...form.getAll("timestamp_granularities[]"), ...form.getAll("timestamp_granularities")].map(String);
    const language = languageOf(form.get("language"));
    if (language === undefined) throw new HttpError(400, "invalid_request", "language must be a language code such as `en` or `en-US`.", { param: "language" });
    meta.language = language ?? "auto";

    const picked = route(language, { nemotron: Boolean(backends.nemotron), model: form.get("model") });
    if (!picked || !backends[picked.model]) throw new HttpError(422, "unsupported_language", `This server can't transcribe that language (${language}) yet.`, { param: "language" });
    meta.model = MODELS[picked.model].id;

    await gate.enter(cfg.queueTimeoutMs);
    try {
      let audio;
      try {
        audio = await toWav16k(Buffer.from(await file.arrayBuffer()), { ffmpeg: cfg.ffmpeg, maxSeconds: cfg.maxAudioSeconds });
      } catch (err) {
        if (err instanceof AudioError) {
          if (err.message === "unsupported_format") throw new HttpError(415, "unsupported_format", "That audio format isn't supported (use webm, ogg, mp4, wav, mp3 or flac).", { param: "file" });
          throw new HttpError(422, "unreadable_audio", "Couldn't read that recording.", { param: "file" });
        }
        throw err;
      }
      meta.audioSeconds = Math.round(audio.seconds * 10) / 10;
      if (audio.seconds > cfg.maxAudioSeconds) throw new HttpError(413, "too_long", `A recording can be up to ${Math.round(cfg.maxAudioSeconds / 60)} minutes.`);

      const upstream = new FormData();
      upstream.append("file", new Blob([audio.wav], { type: "audio/wav" }), "audio.wav");
      upstream.append("response_format", "verbose_json");
      if (picked.locale) upstream.append("language", picked.locale);
      let r;
      try {
        r = await fetchImpl(`${backends[picked.model]}/v1/audio/transcriptions`, { method: "POST", body: upstream, signal: AbortSignal.timeout(cfg.backendTimeoutMs) });
      } catch {
        throw new HttpError(503, "unavailable", "Speech recognition isn't reachable right now. Try again in a moment.");
      }
      if (!r.ok) {
        await r.body?.cancel();
        if (r.status >= 400 && r.status < 500) throw new HttpError(422, "unreadable_audio", "Couldn't transcribe that recording.");
        throw new HttpError(503, "unavailable", "Speech recognition had a problem. Try again in a moment.");
      }
      const nemo = await r.json();
      const out = openAiTranscription(nemo, { seconds: audio.seconds, model: meta.model, language, withWords: granularities.includes("word") });
      res.setHeader("x-speech-model", meta.model);
      if (format === "text") return send(res, 200, `${out.text}\n`, "text/plain; charset=utf-8");
      if (format === "json") return sendJson(res, 200, { text: out.text, model: out.model, duration: out.duration });
      return sendJson(res, 200, out);
    } finally {
      gate.leave();
    }
  }

  async function handler(req, res) {
    const started = performance.now();
    const meta = { id: randomUUID().slice(0, 8), method: req.method, path: (req.url ?? "/").split("?")[0] };
    try {
      if (req.method === "GET" && (meta.path === "/health" || meta.path === "/ready")) {
        const ready = await readiness();
        const ok = ready.parakeet === true;
        return sendJson(res, ok ? 200 : 503, {
          status: ok ? "ok" : "starting",
          models: Object.entries(ready).map(([name, isReady]) => ({ id: MODELS[name].id, name: MODELS[name].label, ready: isReady })),
        });
      }
      if (req.method === "GET" && meta.path === "/") return sendJson(res, 200, { name: "build-a-bot-speech", transcriptions: "POST /v1/audio/transcriptions" });
      if (!authorized(req)) throw new HttpError(401, "unauthorized", "Missing or wrong API key.");
      if (req.method === "GET" && meta.path === "/v1/models") {
        const ready = await readiness();
        return sendJson(res, 200, {
          object: "list",
          data: Object.keys(backends).map((name) => ({ id: MODELS[name].id, object: "model", owned_by: "nvidia", ready: ready[name] === true })),
        });
      }
      if (req.method === "POST" && meta.path === "/v1/audio/transcriptions") return await transcribe(req, res, meta);
      throw new HttpError(404, "not_found", "Not found.");
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, "internal_error", "Something went wrong.");
      meta.error = e.code;
      if (!(err instanceof HttpError)) meta.detail = String(err?.code ?? err?.name ?? "error");
      if (e.status === 503) res.setHeader("retry-after", "2");
      if (e.status === 413) res.setHeader("connection", "close");
      sendJson(res, e.status, { error: { message: e.message, type: e.status >= 500 ? "server_error" : "invalid_request_error", code: e.code, param: e.extra.param ?? null } });
    } finally {
      meta.status = res.statusCode;
      meta.ms = Math.round(performance.now() - started);
      if (meta.path !== "/health" && meta.path !== "/ready") log({ t: new Date().toISOString(), ...meta });
    }
  }

  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.requestTimeout = cfg.backendTimeoutMs + 60_000;
  server.headersTimeout = 30_000;
  server.backends = backends;
  return server;
}

function send(res, status, body, type) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}
const sendJson = (res, status, value) => send(res, status, JSON.stringify(value), "application/json");

/**
 * Starts NeMo-Speech.cpp once per model on 127.0.0.1 and restarts it if it stops. Too many
 * crashes in a row stop the whole container, so the platform restarts it clean.
 */
export function superviseBackends(cfg, { spawnImpl = spawn, logErr = (s) => process.stderr.write(s) } = {}) {
  const children = new Map();
  let stopping = false;
  const crashes = [];
  for (const [name, m] of Object.entries(cfg.models)) {
    if (!m || m.url || !existsSync(m.file)) continue;
    const args = ["serve", "--asr-model", m.file, "--host", "127.0.0.1", "--port", String(m.port), "--no-ui", "--device", cfg.device, "--asr.backend.threads", String(cfg.threads)];
    if (cfg.itnDir && existsSync(cfg.itnDir)) args.push("--itn-model-dir", cfg.itnDir);
    const start = (delay) =>
      setTimeout(() => {
        if (stopping) return;
        const child = spawnImpl(cfg.bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        children.set(name, child);
        const prefix = (d) => String(d).split("\n").filter(Boolean).map((l) => `[${name}] ${l}\n`).join("");
        child.stdout?.on("data", (d) => logErr(prefix(d)));
        child.stderr?.on("data", (d) => logErr(prefix(d)));
        child.on("exit", (code, signal) => {
          children.delete(name);
          if (stopping) return;
          const now = Date.now();
          crashes.push(now);
          while (crashes.length && now - crashes[0] > 5 * 60_000) crashes.shift();
          logErr(`[${name}] stopped (${signal ?? code}); restarting\n`);
          if (crashes.length > 10) {
            logErr("speech backends keep crashing; exiting so the container restarts\n");
            process.exit(1);
          }
          start(Math.min(30_000, 1000 * 2 ** Math.min(crashes.length, 5)));
        });
      }, delay);
    start(0);
  }
  return {
    stop() {
      stopping = true;
      for (const child of children.values()) child.kill("SIGTERM");
    },
  };
}

async function main() {
  const cfg = configFromEnv();
  if (!cfg.apiKey && !cfg.allowNoAuth) {
    process.stderr.write("Set SPEECH_API_KEY (or SPEECH_ALLOW_NO_AUTH=1 to run without a key on your own machine).\n");
    process.exit(1);
  }
  const supervisor = superviseBackends(cfg);
  const server = createSpeechServer(cfg);
  if (!server.backends.parakeet) process.stderr.write(`No Parakeet model at ${cfg.models.parakeet.file} and no PARAKEET_URL: transcription will answer 503.\n`);
  server.listen(cfg.port, cfg.host, () => process.stderr.write(`speech server on http://${cfg.host}:${cfg.port} (models: ${Object.keys(server.backends).join(", ") || "none"})\n`));
  const stop = () => {
    server.close();
    supervisor.stop();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
