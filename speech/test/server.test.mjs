import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { configFromEnv, createSpeechServer, superviseBackends } from "../server.mjs";
import { wavInfo } from "../lib.mjs";
import { tone, wav } from "./audio.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const KEY = "test-key-0123456789";
const SAID = "Hey Otto, remind me to call Priya at 03:30.";

/** Stands in for NeMo-Speech.cpp: remembers what it was sent and answers like it does. */
function fakeNemo(name, { ready = true, status = 200, delayMs = 0 } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === "/ready") {
      res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ready }));
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] } }).formData();
    const file = Buffer.from(await form.get("file").arrayBuffer());
    calls.push({ language: form.get("language"), format: form.get("response_format"), wav: wavInfo(file) });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (status !== 200) {
      res.writeHead(status, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "nope" } }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        task: "transcribe",
        language: name === "nemotron" ? "ja-JP" : "",
        duration: 3.5,
        text: SAID,
        words: SAID.split(" ").map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.25, confidence: 1 })),
      }),
    );
  });
  return { server, calls, listen: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`))) };
}

const parakeet = fakeNemo("parakeet");
const nemotron = fakeNemo("nemotron");
let base;
let speech;
let parakeetUrl;
const logs = [];

function config(extra = {}) {
  return {
    ...configFromEnv({ SPEECH_API_KEY: KEY, NEMOTRON_MODEL: "" }),
    ...extra,
  };
}

async function start(cfg) {
  const s = createSpeechServer(cfg, { log: (l) => logs.push(l) });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { server: s, url: `http://127.0.0.1:${s.address().port}` };
}

before(async () => {
  parakeetUrl = await parakeet.listen();
  const n = await nemotron.listen();
  const cfg = config();
  cfg.models.parakeet.url = parakeetUrl;
  cfg.models.nemotron = { file: "/nonexistent", url: n, port: 0 };
  speech = await start(cfg);
  base = speech.url;
});

after(() => {
  speech.server.close();
  parakeet.server.close();
  nemotron.server.close();
});

function post(url, { audio, filename = "clip.webm", type = "audio/webm", fields = {}, key = KEY } = {}) {
  const form = new FormData();
  if (audio) form.append("file", new Blob([audio], { type }), filename);
  for (const [k, v] of Object.entries(fields)) for (const one of [].concat(v)) form.append(k, one);
  return fetch(`${url}/v1/audio/transcriptions`, { method: "POST", body: form, headers: key ? { authorization: `Bearer ${key}` } : {} });
}

test("no key, or the wrong one: 401, and the health check stays open", async () => {
  assert.equal((await post(base, { audio: wav(new Int16Array(16000)), key: null })).status, 401);
  assert.equal((await post(base, { audio: wav(new Int16Array(16000)), key: "wrong" })).status, 401);
  assert.equal((await fetch(`${base}/v1/models`)).status, 401);
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const h = await health.json();
  assert.equal(h.status, "ok");
  assert.deepEqual(h.models.map((m) => [m.id, m.ready]), [["parakeet-tdt-0.6b-v3", true], ["nemotron-3.5-asr-streaming-0.6b", true]]);
  const models = await (await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${KEY}` } })).json();
  assert.deepEqual(models.data.map((m) => m.id), ["parakeet-tdt-0.6b-v3", "nemotron-3.5-asr-streaming-0.6b"]);
});

test("a browser recording (webm) is heard by Parakeet and comes back as OpenAI verbose_json", { skip: !hasFfmpeg && "needs ffmpeg" }, async () => {
  parakeet.calls.length = 0;
  const res = await post(base, { audio: tone(2.5), fields: { response_format: "verbose_json", "timestamp_granularities[]": ["segment", "word"], prompt: "Names: Priya" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-speech-model"), "parakeet-tdt-0.6b-v3");
  const out = await res.json();
  assert.equal(out.text, "Hey Otto, remind me to call Priya at 3:30.");
  assert.ok(Math.abs(out.duration - 2.5) < 0.1, `duration ${out.duration}`);
  assert.ok(out.segments.length >= 1 && out.segments.every((s) => s.end <= out.duration));
  assert.ok(out.words.length > 3);
  // What NeMo-Speech.cpp got: 16 kHz mono WAV with a second of silence after it, and no language.
  const call = parakeet.calls[0];
  assert.equal(call.wav.sampleRate, 16000);
  assert.equal(call.wav.channels, 1);
  assert.ok(Math.abs(call.wav.seconds - 3.5) < 0.1);
  assert.equal(call.language, null);
  assert.equal(call.format, "verbose_json");
});

test("json and text formats", { skip: !hasFfmpeg && "needs ffmpeg" }, async () => {
  const json = await (await post(base, { audio: tone(1), fields: { response_format: "json" } })).json();
  assert.equal(json.text, "Hey Otto, remind me to call Priya at 3:30.");
  const text = await (await post(base, { audio: tone(1), fields: { response_format: "text" } })).text();
  assert.equal(text, "Hey Otto, remind me to call Priya at 3:30.\n");
  const bad = await post(base, { audio: tone(1), fields: { response_format: "srt" } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error.message, /response_format/);
});

test("languages: European ones go to Parakeet, Japanese to Nemotron with its locale, unknown ones are refused", { skip: !hasFfmpeg && "needs ffmpeg" }, async () => {
  parakeet.calls.length = 0;
  nemotron.calls.length = 0;
  assert.equal((await post(base, { audio: tone(1), fields: { language: "de" } })).status, 200);
  assert.equal(parakeet.calls.length, 1);
  assert.equal(parakeet.calls[0].language, null);

  const ja = await post(base, { audio: tone(1), fields: { language: "ja", response_format: "verbose_json" } });
  assert.equal(ja.status, 200);
  assert.equal(ja.headers.get("x-speech-model"), "nemotron-3.5-asr-streaming-0.6b");
  assert.equal(nemotron.calls[0].language, "ja-JP");
  assert.equal((await ja.json()).language, "ja");

  const fa = await post(base, { audio: tone(1), fields: { language: "fa" } });
  assert.equal(fa.status, 422);
  assert.equal((await fa.json()).error.code, "unsupported_language");

  assert.equal((await post(base, { audio: tone(1), fields: { language: "klingon" } })).status, 400);
});

test("bad requests: no file, not audio, not a form", async () => {
  const none = await post(base, { fields: { model: "x" } });
  assert.equal(none.status, 400);
  const notAudio = await post(base, { audio: Buffer.from("#EXTM3U\nhttp://169.254.169.254/\n"), filename: "a.m3u8", type: "audio/x-mpegurl" });
  assert.equal(notAudio.status, 415);
  assert.equal((await notAudio.json()).error.code, "unsupported_format");
  const raw = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", body: "hello", headers: { authorization: `Bearer ${KEY}`, "content-type": "text/plain" } });
  assert.equal(raw.status, 400);
});

test("too large and too long are refused", { skip: !hasFfmpeg && "needs ffmpeg" }, async () => {
  const cfg = config({ maxUploadBytes: 400_000, maxAudioSeconds: 2 });
  cfg.models.parakeet.url = parakeetUrl;
  const small = await start(cfg);
  try {
    const big = await post(small.url, { audio: Buffer.alloc(500_000, 1) });
    assert.equal(big.status, 413);
    const long = await post(small.url, { audio: tone(4) });
    assert.equal(long.status, 413);
    assert.equal((await long.json()).error.code, "too_long");
  } finally {
    small.server.close();
  }
});

test("a burst past the queue gets 'busy' (with Retry-After), not a pile-up", { skip: !hasFfmpeg && "needs ffmpeg" }, async () => {
  const slow = fakeNemo("parakeet", { delayMs: 600 });
  const cfg = config({ maxConcurrent: 1, maxQueue: 0 });
  cfg.models.parakeet.url = await slow.listen();
  const s = await start(cfg);
  try {
    const audio = tone(1);
    const [a, b] = await Promise.all([post(s.url, { audio }), new Promise((r) => setTimeout(r, 150)).then(() => post(s.url, { audio }))]);
    assert.deepEqual([a.status, b.status].sort(), [200, 503]);
    const busy = a.status === 503 ? a : b;
    assert.equal(busy.headers.get("retry-after"), "2");
    assert.equal((await busy.json()).error.code, "busy");
  } finally {
    s.server.close();
    slow.server.close();
  }
});

test("NeMo down or failing: 503 (the app then uses its backup); health says so", { skip: !hasFfmpeg && "needs ffmpeg" }, async () => {
  const cfg = config();
  cfg.models.parakeet.url = "http://127.0.0.1:9";
  const s = await start(cfg);
  const failing = fakeNemo("parakeet", { status: 500 });
  const cfg2 = config();
  cfg2.models.parakeet.url = await failing.listen();
  const s2 = await start(cfg2);
  try {
    const down = await post(s.url, { audio: tone(1) });
    assert.equal(down.status, 503);
    assert.equal((await down.json()).error.code, "unavailable");
    assert.equal((await fetch(`${s.url}/health`)).status, 503);
    assert.equal((await post(s2.url, { audio: tone(1) })).status, 503);
  } finally {
    s.server.close();
    s2.server.close();
    failing.server.close();
  }
});

test("the log has times, lengths, the model and the language, and never what was said", () => {
  const posts = logs.filter((l) => l.path === "/v1/audio/transcriptions");
  assert.ok(posts.length >= 5);
  const ok = posts.find((l) => l.status === 200);
  assert.equal(ok.model, "parakeet-tdt-0.6b-v3");
  assert.equal(typeof ok.ms, "number");
  assert.equal(typeof ok.audioSeconds, "number");
  const all = JSON.stringify(logs);
  assert.ok(!all.includes("Priya") && !all.includes("Otto"), "a transcript reached the log");
  assert.ok(!all.includes(KEY), "the key reached the log");
});

test("without a key the server refuses everything unless told it's a local test", async () => {
  const locked = await start({ ...configFromEnv({ NEMOTRON_MODEL: "off" }) });
  const open = await start({ ...configFromEnv({ SPEECH_ALLOW_NO_AUTH: "1", NEMOTRON_MODEL: "off" }) });
  try {
    assert.equal((await fetch(`${locked.url}/v1/models`)).status, 401);
    assert.equal((await fetch(`${open.url}/v1/models`)).status, 200);
  } finally {
    locked.server.close();
    open.server.close();
  }
});

test("the supervisor starts NeMo-Speech.cpp per model on 127.0.0.1 and restarts it when it stops", async () => {
  const spawned = [];
  const fakeSpawn = (bin, args) => {
    const handlers = {};
    const child = {
      stdout: null,
      stderr: null,
      kill: () => handlers.exit?.(null, "SIGTERM"),
      on: (ev, fn) => (handlers[ev] = fn),
    };
    spawned.push({ bin, args, child, handlers });
    return child;
  };
  const cfg = configFromEnv({ PARAKEET_MODEL: new URL("../server.mjs", import.meta.url).pathname, NEMOTRON_MODEL: "off", NEMO_SPEECH_BIN: "/opt/nemo-speech/bin/nemo-speech", SPEECH_THREADS: "8", ITN_DIR: "/nonexistent" });
  const sup = superviseBackends(cfg, { spawnImpl: fakeSpawn, logErr: () => {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(spawned.length, 1);
  const { args } = spawned[0];
  assert.deepEqual(args.slice(0, 7), ["serve", "--asr-model", cfg.models.parakeet.file, "--host", "127.0.0.1", "--port", "8081"]);
  assert.ok(args.includes("--no-ui"));
  assert.equal(args[args.indexOf("--asr.backend.threads") + 1], "8");
  assert.ok(!args.includes("--itn-model-dir"));
  spawned[0].handlers.exit(1, null);
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(spawned.length, 2, "restarted after a crash");
  sup.stop();
});
