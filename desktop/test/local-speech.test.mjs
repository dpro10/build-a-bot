/**
 * Voice typing's on-device speech (NVIDIA Parakeet, run by NVIDIA's NeMo-Speech.cpp), without
 * NVIDIA's files: a stand-in runtime (a script with the real one's flags, routes and key check),
 * a made-up model, and a download server that can cut a download off part-way or stall it.
 *
 * Getting it (resuming, hashes, room on disk, files that aren't there), running it (the key, the
 * idle stop, a runtime that keeps crashing, can't run at all or never gets ready), removing it
 * (even mid-download), tidying what it hears, and falling back to the server when it can't.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { LOCAL_LANGUAGES, LOCAL_MODEL, LocalSpeech, LocalSpeechError, RUNTIMES, localFirst, tidyLocalText } from "../src/main/voice/local-speech.mjs";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 15));
  }
}

/**
 * A stand-in for `nemo-speech serve`: the same flags, routes, key check and chatter as NVIDIA's.
 * FAKE_NEMO: "crash" exits at once, "gpu-crash" exits at once unless it's told to use the CPU,
 * "never-ready" never gets ready, "slow" takes 1.5 s to get ready, "broken" answers 500. No require
 * or import, so it runs the same as CommonJS or as a module.
 */
const FAKE_RUNTIME = `#!/usr/bin/env node
const http = process.getBuiltinModule("node:http");
const fs = process.getBuiltinModule("node:fs");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const mode = process.env.FAKE_NEMO || "";
if (process.env.FAKE_NEMO_LOG) fs.appendFileSync(process.env.FAKE_NEMO_LOG, JSON.stringify({ args, cwd: process.cwd(), keyed: Boolean(process.env.NEMO_SPEECH_HTTP_API_KEY) }) + "\\n");
if (args[0] !== "serve" || !fs.existsSync(flag("--asr-model"))) process.exit(2);
if (mode === "crash" || (mode === "gpu-crash" && flag("--device") !== "cpu")) process.exit(3);
const key = process.env.NEMO_SPEECH_HTTP_API_KEY;
const born = Date.now();
console.log("[nemo-speech] serve session started");
http.createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url === "/ready") return mode === "never-ready" || Date.now() - born < (mode === "slow" ? 1500 : 100) ? send(503, { status: "loading" }) : send(200, { status: "ready" });
  if (req.method !== "POST" || req.url !== "/v1/audio/transcriptions") return send(404, { error: "not found" });
  if (!key || req.headers.authorization !== "Bearer " + key) return send(401, { error: { message: "unauthorized" } });
  const parts = [];
  req.on("data", (c) => parts.push(c));
  req.on("end", () => {
    const body = Buffer.concat(parts).toString("latin1");
    if (mode === "broken") return send(500, { error: { message: "boom" } });
    const wav = /filename="audio\\.wav"\\r\\ncontent-type: audio\\/wav\\r\\n\\r\\nRIFF/i.test(body);
    const json = /name="response_format"\\r\\n\\r\\njson\\r\\n/i.test(body);
    if (!wav || !json) return send(400, { error: { message: "send a WAV file" } });
    console.log('INFO: Proto String: tokenizer_grammar:  "tokenizer.ascii_proto"');
    console.error("decoded: Let's meet at 3.30 on Friday");
    send(200, { text: " Let's meet at 3.30 on Friday,   or 03:45.  " });
  });
}).listen(Number(flag("--port")), flag("--host"));
`;

/**
 * A .tar.gz, written here so the tests need no tar of their own (the engine still unpacks with the
 * system's, as in the app). `tar -xf` goes by what's inside, so it serves for the .tar.bz2 too.
 * @param {{ name: string, data?: string }[]} entries  a name ending in "/" is a folder
 */
function tarGz(entries) {
  const parts = [];
  for (const e of entries) {
    const dir = e.name.endsWith("/");
    const data = Buffer.from(dir ? "" : (e.data ?? ""));
    const h = Buffer.alloc(512);
    const field = (value, at, size) => h.write(value.padStart(size - 1, "0") + "\0", at, size, "latin1");
    h.write(e.name, 0, 100, "latin1");
    field((dir ? 0o755 : 0o644).toString(8), 100, 8);
    field("0", 108, 8);
    field("0", 116, 8);
    field(data.length.toString(8), 124, 12);
    field(Math.floor(Date.now() / 1000).toString(8), 136, 12);
    h.write(dir ? "5" : "0", 156, 1, "latin1");
    h.write("ustar\u000000", 257, 8, "latin1");
    h.fill(" ", 148, 156);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

/** The stand-in runtime, its number rules and a model, packed the way NVIDIA ships them. */
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), "bab-local-fix-"));
process.on("exit", () => fs.rmSync(FIX, { recursive: true, force: true }));
const FILES = {
  "/bogus.tar.gz": tarGz([{ name: "nothing-here/" }]),
  "/runtime.tar.gz": tarGz([
    { name: "nemo-speech-0.2.0-linux-x86_64-cpu/" },
    { name: "nemo-speech-0.2.0-linux-x86_64-cpu/bin/" },
    { name: "nemo-speech-0.2.0-linux-x86_64-cpu/bin/nemo-speech", data: FAKE_RUNTIME },
    { name: "nemo-speech-0.2.0-linux-x86_64-cpu/lib/" },
    { name: "nemo-speech-0.2.0-linux-x86_64-cpu/lib/libggml.so", data: "not really" },
  ]),
  "/itn_configs.tar.bz2": tarGz([{ name: "itn_configs/" }, { name: "itn_configs/en/" }, { name: "itn_configs/en/tagger.fst", data: "rules" }]),
  "/model.gguf": randomBytes(400_000),
};

/**
 * Serves files the way Hugging Face and GitHub do (ranges → 206). `cut`: send `bytes` of a file
 * and drop the connection, the next `times` times it's asked for. `stall`: send this many bytes
 * and hold the connection open. `status`: answer this instead.
 */
async function fileServer() {
  /** @type {{ path: string, range: string | null }[]} */
  const requests = [];
  const cut = new Map();
  const stall = new Map();
  const status = new Map();
  const srv = http.createServer((req, res) => {
    const at = new URL(req.url ?? "/", "http://x").pathname;
    requests.push({ path: at, range: req.headers.range ?? null });
    if (status.has(at)) {
      res.writeHead(status.get(at));
      return res.end();
    }
    const body = FILES[at];
    if (!body) {
      res.writeHead(404);
      return res.end();
    }
    let start = 0;
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (m) {
      start = Number(m[1]);
      if (start >= body.length) {
        res.writeHead(416, { "content-range": `bytes */${body.length}` });
        return res.end();
      }
      res.writeHead(206, { "content-length": body.length - start, "content-range": `bytes ${start}-${body.length - 1}/${body.length}` });
    } else {
      res.writeHead(200, { "content-length": body.length, "accept-ranges": "bytes" });
    }
    const rest = body.subarray(start);
    const c = cut.get(at);
    if (c && c.times > 0) {
      c.times--;
      return res.write(rest.subarray(0, c.bytes), () => setTimeout(() => res.socket?.destroy(), 20));
    }
    if (stall.has(at)) return res.write(rest.subarray(0, stall.get(at)));
    res.end(rest);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(undefined)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}`;
  return {
    base,
    requests,
    cut,
    stall,
    status,
    hits: (p) => requests.filter((r) => r.path === p),
    close() {
      srv.closeAllConnections();
      return new Promise((r) => srv.close(() => r(undefined)));
    },
  };
}

/**
 * One engine in its own folder, downloading from its own file server, running the stand-in
 * runtime with this Node.
 * @param {import('node:test').TestContext} t
 * @param {{ mode?: string, spawnImpl?: any, sources?: object | ((base: string) => object), [k: string]: any }} [o]
 */
async function setup(t, o = {}) {
  const server = await fileServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bab-local-"));
  const engineLog = path.join(dir, "..", `${path.basename(dir)}.engine.jsonl`);
  const spawned = [];
  const logs = [];
  const { mode, spawnImpl, sources, ...rest } = o;
  /** Every engine made here, stopped before the folder goes (Windows can't delete a folder a running program is in). */
  const made = [];
  const make = (extra = {}) => {
    const m = new LocalSpeech({
      dir,
      platform: "linux",
      arch: "x64",
      log: (m) => logs.push(m),
      retryMs: 5,
      idleMs: 60_000,
      readyTimeoutMs: 5000,
      freeSpace: async () => 50e9,
      spawnImpl:
        spawnImpl ??
        ((cmd, args, opts) => {
          if (path.basename(cmd) !== "nemo-speech") return spawn(cmd, args, opts);
          spawned.push(args);
          return spawn(process.execPath, [cmd, ...args], { ...opts, env: { ...opts.env, FAKE_NEMO: mode ?? "", FAKE_NEMO_LOG: engineLog } });
        }),
      sources: {
        runtimeUrl: `${server.base}/runtime.tar.gz`,
        runtimeSha256: sha256(FILES["/runtime.tar.gz"]),
        itnUrl: `${server.base}/itn_configs.tar.bz2`,
        itnSha256: sha256(FILES["/itn_configs.tar.bz2"]),
        modelUrl: `${server.base}/model.gguf`,
        modelSha256: sha256(FILES["/model.gguf"]),
        modelBytes: FILES["/model.gguf"].length,
        ...(typeof sources === "function" ? sources(server.base) : sources),
      },
      ...rest,
      ...extra,
    });
    made.push(m);
    return m;
  };
  const local = make();
  const states = [];
  local.on("change", (s) => states.push(s));
  t.after(async () => {
    await Promise.all(made.map((m) => m.stop()));
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(engineLog, { force: true });
  });
  const engineRuns = () =>
    fs.existsSync(engineLog)
      ? fs
          .readFileSync(engineLog, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
  return { local, server, dir, spawned, logs, states, make, engineRuns };
}

/** Half a second of 16 kHz silence, as WAV. */
function wav(seconds = 0.5) {
  const n = Math.round(16000 * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  return new Uint8Array(b);
}

// ---------------------------------------------------------------------------
// What it is
// ---------------------------------------------------------------------------

test("it's pinned to one runtime per platform and one Parakeet model, each with its hash", () => {
  assert.equal(LOCAL_MODEL.id, "parakeet-tdt-0.6b-v3");
  assert.match(LOCAL_MODEL.url, /^https:\/\/huggingface\.co\/nvidia\/parakeet-tdt-0\.6b-v3\/resolve\/[0-9a-f]{40}\/parakeet-tdt-0\.6b-v3\.q8_0\.gguf$/);
  assert.match(LOCAL_MODEL.sha256, /^[0-9a-f]{64}$/);
  for (const [key, r] of Object.entries(RUNTIMES)) {
    assert.match(r.sha256, /^[0-9a-f]{64}$/, key);
    assert.match(r.file, /^nemo-speech-0\.2\.0-/, key);
  }
  assert.match(RUNTIMES["darwin-arm64"].file, /macos-aarch64-metal/, "Apple silicon runs it on the GPU");
  assert.equal(RUNTIMES["win32-x64"].itn, false, "the Windows build has no number rules");
  assert.ok(LOCAL_LANGUAGES.has("en") && LOCAL_LANGUAGES.has("es") && !LOCAL_LANGUAGES.has("ja"));
});

test("a computer NVIDIA has no runtime for says so, and never downloads anything", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bab-local-"));
  const local = new LocalSpeech({ dir, platform: "linux", arch: "arm64", fetchImpl: () => assert.fail("no downloads") });
  assert.equal(local.state, "unsupported");
  assert.equal(local.supported(), false);
  assert.equal(local.isInstalled(), false);
  assert.equal(local.status().supported, false);
  await assert.rejects(local.install(), (e) => e instanceof LocalSpeechError && e.code === "unsupported");
  const win = new LocalSpeech({ dir, platform: "win32", arch: "x64" });
  assert.equal(win.state, "absent");
  assert.equal(path.basename(win.paths.bin), "nemo-speech.exe");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a folder named with letters from outside English: kept as is where the engine opens it, else Windows' short name", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bab-local-"));
  const dir = path.join(base, "José Muñoz", "speech");
  if (process.platform === "win32") {
    // As on a Windows computer (where NVIDIA's engine can't open such a path, even relative).
    const local = new LocalSpeech({ dir, platform: "win32", arch: "x64" });
    const place = await local.place();
    if (place === null) {
      assert.equal(local.blocked(), true, "no short names on this drive: it says it can't run here");
    } else {
      assert.match(place, /^[\x20-\x7e]+$/, "plain ASCII");
      fs.writeFileSync(path.join(dir, "marker"), "same folder");
      assert.equal(fs.readFileSync(path.join(place, "marker"), "utf8"), "same folder");
      assert.equal(local.blocked(), false);
    }
  } else {
    const local = new LocalSpeech({ dir, platform: process.platform, arch: "x64" });
    assert.equal(await local.place(), dir, "macOS and Linux open it as it is");
    assert.equal(local.blocked(), false);
  }
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Getting it
// ---------------------------------------------------------------------------

test("downloads NVIDIA's runtime, its number rules and the model, checks them, and picks up a cut-off download where it stopped", async (t) => {
  const { local, server, dir, states, make } = await setup(t);
  assert.equal(local.state, "absent");
  server.cut.set("/model.gguf", { bytes: 150_000, times: 1 });

  const first = local.install();
  assert.equal(local.install(), first, "a second call joins the first");
  await first;

  assert.equal(local.state, "installed");
  assert.equal(local.isInstalled(), true);
  assert.equal(local.error, null);
  // The model came in two pieces: the second asked for the rest.
  const model = server.hits("/model.gguf");
  assert.equal(model.length, 2);
  assert.equal(model[0].range, null);
  assert.match(model[1].range ?? "", /^bytes=\d+-$/);
  assert.ok(Number(/\d+/.exec(model[1].range ?? "")?.[0]) > 0);
  assert.deepEqual(fs.readFileSync(local.paths.model), FILES["/model.gguf"]);
  // Unpacked where it runs from, runnable, with its number rules; nothing left over.
  if (process.platform !== "win32") assert.ok(fs.statSync(local.paths.bin).mode & 0o100, "the runtime can run");
  assert.ok(fs.existsSync(path.join(local.paths.runtime, "lib", "libggml.so")));
  assert.ok(fs.existsSync(path.join(local.paths.itn, "en", "tagger.fst")));
  assert.equal(fs.existsSync(local.paths.downloads), false);
  assert.equal(fs.existsSync(path.join(dir, "runtime.tmp")), false);
  const marker = JSON.parse(fs.readFileSync(local.paths.marker, "utf8"));
  assert.equal(marker.runtime, sha256(FILES["/runtime.tar.gz"]));
  assert.equal(marker.model, sha256(FILES["/model.gguf"]));
  // The settings window heard about it as it went.
  assert.equal(states[0].state, "downloading");
  assert.equal(states.at(-1).state, "installed");
  assert.deepEqual(local.status(), { state: "installed", supported: true, blocked: false, received: 0, total: 0, error: null, model: "NVIDIA Parakeet", bytes: 400_000 });

  // Already here: nothing to download, and the next run of the app knows it.
  const before = server.requests.length;
  await local.install();
  assert.equal(server.requests.length, before);
  assert.equal(make().state, "installed");
  // An app update that pins another model (or runtime) downloads again.
  assert.equal(make({ sources: { ...local.src, modelSha256: "0".repeat(64) } }).state, "absent");
  assert.equal(make({ sources: { ...local.src, runtimeSha256: "0".repeat(64) } }).state, "absent");
});

test("keeps going through a connection that keeps dropping, as long as each try gets further", async (t) => {
  const { local, server, logs } = await setup(t);
  server.cut.set("/model.gguf", { bytes: 60_000, times: 5 });
  await local.install();
  assert.equal(local.state, "installed");
  assert.equal(server.hits("/model.gguf").length, 6);
  assert.equal(logs.filter((m) => /model download dropped/.test(m)).length, 5);
  assert.deepEqual(fs.readFileSync(local.paths.model), FILES["/model.gguf"]);
});

test("gives up after four tries in a row that get nowhere", async (t) => {
  const { local, server } = await setup(t);
  server.status.set("/model.gguf", 503);
  await assert.rejects(local.install());
  assert.equal(server.hits("/model.gguf").length, 4);
  assert.equal(local.state, "error");
  assert.equal(local.error, "The download didn't finish. Check your internet and try again.");

  // The next try doesn't download the runtime again: it's already here and checked.
  server.status.delete("/model.gguf");
  await local.install();
  assert.equal(local.state, "installed");
  assert.equal(local.error, null);
  assert.equal(server.hits("/runtime.tar.gz").length, 1);
});

test("a download that finished just before the app quit isn't downloaded again", async (t) => {
  const { local, server } = await setup(t);
  fs.mkdirSync(local.paths.downloads, { recursive: true });
  fs.writeFileSync(path.join(local.paths.downloads, `${LOCAL_MODEL.file}.part`), FILES["/model.gguf"]);
  await local.install();
  assert.equal(local.state, "installed");
  assert.deepEqual(
    server.hits("/model.gguf").map((r) => r.range),
    ["bytes=400000-"],
  );
});

test("a download that doesn't match its hash is thrown away", async (t) => {
  const { local, server } = await setup(t, { sources: { modelSha256: "f".repeat(64) } });
  await assert.rejects(local.install(), (e) => e instanceof LocalSpeechError && e.code === "damaged");
  assert.equal(local.state, "error");
  assert.equal(local.status().error, "The download was damaged. Try again.");
  assert.equal(local.isInstalled(), false);
  assert.equal(fs.existsSync(path.join(local.paths.downloads, `${LOCAL_MODEL.file}.part`)), false, "the bad file is gone");
  assert.equal(server.hits("/model.gguf").length, 1);
});

test("doesn't start without room for it", async (t) => {
  const { local, server } = await setup(t, { freeSpace: async () => 200e6 });
  await assert.rejects(local.install(), (e) => e instanceof LocalSpeechError && e.code === "disk");
  assert.equal(local.state, "error");
  assert.match(local.error ?? "", /^It needs about 0\.\d GB free on this computer\.$/);
  assert.equal(server.requests.length, 0, "nothing was downloaded");
});

test("a file that isn't there isn't asked for again and again", async (t) => {
  const { local, server } = await setup(t);
  server.status.set("/runtime.tar.gz", 404);
  await assert.rejects(local.install());
  assert.equal(server.hits("/runtime.tar.gz").length, 1);
  assert.equal(server.hits("/model.gguf").length, 0);
  assert.equal(local.state, "error");
  assert.equal(local.error, "The download didn't finish. Check your internet and try again.");
});

test("a runtime archive without NVIDIA's program in it is refused", async (t) => {
  const { local } = await setup(t, { sources: (base) => ({ runtimeUrl: `${base}/bogus.tar.gz`, runtimeSha256: sha256(FILES["/bogus.tar.gz"]) }) });
  await assert.rejects(local.install(), (e) => e instanceof LocalSpeechError && e.code === "unpack");
  assert.equal(local.state, "error");
  assert.match(local.error ?? "", /NVIDIA's runtime wasn't where it should be/);
  assert.equal(fs.existsSync(local.paths.runtime), false);
});

test("the number rules are a bonus: without them it still installs, and runs without them", async (t) => {
  const { local, server, logs, engineRuns } = await setup(t);
  server.status.set("/itn_configs.tar.bz2", 404);
  await local.install();
  assert.equal(local.state, "installed");
  assert.equal(fs.existsSync(local.paths.itn), false);
  assert.ok(logs.some((m) => /no number rules/.test(m)));
  await local.transcribe(wav());
  assert.equal(engineRuns()[0].args.includes("--itn-model-dir"), false);
});

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

test("runs it on 127.0.0.1 behind a key of its own, and tidies what it heard", async (t) => {
  const { local, states, engineRuns, dir } = await setup(t);
  await local.install();
  states.length = 0;

  const text = await local.transcribe(wav(), { durationMs: 500 });
  assert.equal(text, "Let's meet at 3:30 on Friday, or 3:45.");
  assert.equal(local.state, "ready");
  assert.deepEqual(
    states.map((s) => s.state),
    ["starting", "ready"],
  );
  const run = engineRuns().at(-1);
  assert.equal(run.keyed, true, "the key is in its environment, not on its command line");
  assert.equal(fs.realpathSync.native(run.cwd).toLowerCase(), fs.realpathSync.native(dir).toLowerCase(), "it runs in its own folder");
  const args = run.args;
  assert.equal(args[0], "serve");
  assert.equal(path.resolve(run.cwd, args[args.indexOf("--asr-model") + 1]), path.resolve(run.cwd, path.relative(dir, local.paths.model)));
  assert.equal(path.isAbsolute(args[args.indexOf("--asr-model") + 1]), false, "relative to its folder, so no user name in it");
  assert.equal(args[args.indexOf("--host") + 1], "127.0.0.1");
  assert.equal(args[args.indexOf("--port") + 1], String(local.port));
  assert.equal(args[args.indexOf("--itn-model-dir") + 1], path.relative(dir, local.paths.itn));
  assert.equal(args[args.indexOf("--device") + 1], "cpu", "NVIDIA's Linux, Windows and Intel Mac runtimes are CPU-only");
  assert.ok(args.includes("--no-ui"));
  assert.equal(args.join(" ").includes(local.secret), false);

  // Other programs on the computer can't use it without the key.
  const form = new FormData();
  form.append("file", new Blob([wav()], { type: "audio/wav" }), "audio.wav");
  form.append("response_format", "json");
  const res = await fetch(`http://127.0.0.1:${local.port}/v1/audio/transcriptions`, { method: "POST", body: form });
  assert.equal(res.status, 401);

  // A second dictation uses the same engine.
  await local.transcribe(wav());
  assert.equal(engineRuns().length, 1);

  await local.stop();
  assert.equal(local.state, "installed");
  assert.equal(local.child, null);
  assert.equal(local.crashes.length, 0, "stopping it isn't a crash");
});

test("its log keeps what it's doing, never its chatter or what was said", async (t) => {
  const { local, logs } = await setup(t);
  await local.install();
  await local.transcribe(wav());
  await local.stop();
  assert.ok(logs.includes("local speech: [nemo-speech] serve session started"));
  assert.equal(logs.some((m) => /Proto String|meet at/.test(m)), false, logs.join("\n"));
});

test("a dictation doesn't wait long for an engine that's still loading; the next one finds it ready", async (t) => {
  const { local, engineRuns } = await setup(t, { mode: "slow" });
  await local.install();
  await assert.rejects(local.transcribe(wav(), { startWaitMs: 200 }), (e) => e instanceof LocalSpeechError && e.code === "starting");
  assert.equal(local.state, "starting", "it keeps loading");
  await until(() => local.state === "ready", 5000);
  assert.equal(await local.transcribe(wav(), { startWaitMs: 200 }), "Let's meet at 3:30 on Friday, or 3:45.");
  assert.equal(engineRuns().length, 1, "the same engine");
});

// It checks the process with `ps` here (the tests run the engine as on Linux); on Windows it asks
// `tasklist`, which scripts/check-private-speech.mjs covers with NVIDIA's real engine.
test("an engine left running by a run of the app that was force-quit is stopped; anything else with that id isn't", { skip: process.platform === "win32" && "covered on Windows by scripts/check-private-speech.mjs" }, async (t) => {
  const { local, make, logs } = await setup(t);
  await local.install();
  await local.transcribe(wav());
  const orphan = local.child;
  assert.ok(orphan?.pid);
  await until(() => fs.existsSync(local.paths.pid));
  // The app dies without stopping it.
  local.child = null;
  const gone = new Promise((r) => orphan.once("exit", r));
  const next = make();
  t.after(() => next.stop());
  await next.transcribe(wav());
  await gone;
  assert.ok(logs.some((m) => /stopped an engine left running/.test(m)));
  assert.equal(JSON.parse(fs.readFileSync(next.paths.pid, "utf8")).pid, next.child?.pid, "the new one is recorded");

  // A process id that now belongs to another program is left alone.
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
  t.after(() => other.kill());
  await next.stop();
  fs.writeFileSync(next.paths.pid, JSON.stringify({ pid: other.pid }));
  const third = make();
  t.after(() => third.stop());
  await third.transcribe(wav());
  assert.equal(other.exitCode, null);
  assert.doesNotThrow(() => process.kill(/** @type {number} */ (other.pid), 0), "still running");
});

test("when the app starts it stops an engine left running, before any dictation; one said right away waits for that", { skip: process.platform === "win32" && "covered on Windows by scripts/check-private-speech.mjs" }, async (t) => {
  const { local, make, logs } = await setup(t);
  await local.install();
  await local.transcribe(wav());
  const orphan = local.child;
  await until(() => fs.existsSync(local.paths.pid));
  local.child = null;
  const gone = new Promise((r) => orphan.once("exit", r));
  // The app starts again: it checks at once (index.mjs), and the owner talks right away.
  const next = make();
  const check = next.reap();
  assert.equal(next.reap(), check, "one check per run");
  const heard = next.transcribe(wav());
  await gone;
  assert.match(await heard, /Friday/);
  assert.equal(logs.filter((m) => /stopped an engine left running/.test(m)).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(next.paths.pid, "utf8")).pid, next.child?.pid);
});

test("warm() starts it while the owner is still talking", async (t) => {
  const { local } = await setup(t);
  local.warm();
  assert.equal(local.child, null, "not before it's downloaded");
  await local.install();
  local.warm();
  await until(() => local.state === "ready");
  local.warm();
  assert.equal(local.state, "ready");
});

test("stops after a while unused, so the model isn't in memory all day", async (t) => {
  const { local } = await setup(t, { idleMs: 150 });
  await local.install();
  await local.transcribe(wav());
  assert.equal(local.state, "ready");
  await until(() => local.state === "installed", 3000);
  assert.equal(local.child, null);
  assert.equal(local.crashes.length, 0);
  // And starts again for the next one.
  assert.equal(await local.transcribe(wav()), "Let's meet at 3:30 on Friday, or 3:45.");
});

// Apple silicon's runtime has a GPU (Metal): these run the engine as there.
const APPLE_SILICON = { platform: "darwin", arch: "arm64" };

test("a runtime that keeps crashing (on the GPU, then on the CPU) is given up on: the server hears the owner instead", async (t) => {
  const { local, spawned } = await setup(t, { mode: "crash", ...APPLE_SILICON });
  await local.install();
  // The GPU, then at once the CPU; then the CPU again.
  for (let i = 0; i < 2; i++) await assert.rejects(local.ensureRunning(), (e) => e instanceof LocalSpeechError && e.code === "crashed");
  assert.deepEqual(
    spawned.map((a) => a[a.indexOf("--device") + 1]),
    ["auto", "cpu", "cpu"],
  );
  assert.equal(local.state, "installed");
  await assert.rejects(local.ensureRunning(), (e) => e instanceof LocalSpeechError && e.code === "crashing");
  await assert.rejects(local.transcribe(wav()), (e) => e instanceof LocalSpeechError && e.code === "crashing");
  assert.equal(spawned.length, 3, "it wasn't started a fourth time");
});

test("the GPU failing on this computer moves it to the CPU, at once and from then on", async (t) => {
  const { local, make, engineRuns, logs } = await setup(t, { mode: "gpu-crash", ...APPLE_SILICON });
  await local.install();
  assert.equal(await local.transcribe(wav()), "Let's meet at 3:30 on Friday, or 3:45.", "this dictation is still heard here");
  const devices = () => engineRuns().map((r) => r.args[r.args.indexOf("--device") + 1]);
  assert.deepEqual(devices(), ["auto", "cpu"]);
  assert.ok(logs.some((m) => /it didn't start on the GPU \(it stopped: 3\); using the CPU from now on/.test(m)), logs.join("\n"));
  assert.equal(JSON.parse(fs.readFileSync(local.paths.device, "utf8")).device, "cpu");
  await local.stop();
  // The next run of the app goes straight to the CPU…
  const next = make();
  t.after(() => next.stop());
  await next.transcribe(wav());
  assert.deepEqual(devices(), ["auto", "cpu", "cpu"]);
  // …until NVIDIA's runtime changes: a new one gets another try on the GPU.
  assert.equal(make({ sources: { ...local.src, runtimeSha256: "0".repeat(64) } }).loadDevice(), "auto");
});

test("a runtime that can't run at all fails at once instead of hanging the dictation", async (t) => {
  const { local, logs } = await setup(t, { spawnImpl: (cmd, args, opts) => spawn(path.basename(cmd) === "nemo-speech" ? `${cmd}-missing` : cmd, args, opts) });
  await local.install();
  const t0 = Date.now();
  await assert.rejects(local.ensureRunning(), (e) => e instanceof LocalSpeechError && e.code === "crashed");
  assert.ok(Date.now() - t0 < 2000, `gave up after ${Date.now() - t0} ms`);
  assert.equal(local.child, null);
  assert.equal(local.state, "installed");
  assert.ok(logs.some((m) => /couldn't run it \(ENOENT\)/.test(m)));
  await local.stop();
});

test("a runtime that never gets ready is stopped (and that isn't a crash)", async (t) => {
  const { local } = await setup(t, { mode: "never-ready", readyTimeoutMs: 500 });
  await local.install();
  await assert.rejects(local.ensureRunning(), (e) => e instanceof LocalSpeechError && e.code === "slow");
  assert.equal(local.child, null);
  assert.equal(local.state, "installed");
  assert.equal(local.crashes.length, 0);
});

test("an engine error is an error (and the caller falls back)", async (t) => {
  const { local } = await setup(t, { mode: "broken" });
  await local.install();
  await assert.rejects(local.transcribe(wav()), (e) => e instanceof LocalSpeechError && e.code === "engine");
});

// ---------------------------------------------------------------------------
// Removing it
// ---------------------------------------------------------------------------

test("remove() stops it and deletes everything", async (t) => {
  const { local, dir } = await setup(t);
  await local.install();
  await local.transcribe(wav());
  assert.equal(local.state, "ready");
  await local.remove();
  assert.equal(local.child, null);
  assert.equal(local.state, "absent");
  assert.equal(fs.existsSync(dir), false);
  assert.equal(local.isInstalled(), false);
});

test("remove() in the middle of the download stops it and leaves nothing behind", async (t) => {
  const { local, server, dir } = await setup(t);
  server.stall.set("/model.gguf", 50_000);
  const installing = local.install();
  await until(() => (local.files.get("model")?.received ?? 0) >= 50_000);
  assert.equal(local.state, "downloading");
  assert.ok(local.status().received >= 50_000);
  assert.ok(local.status().total > 400_000, "the total counts the runtime too");
  await local.remove();
  await assert.rejects(installing, (e) => /** @type {any} */ (e).name === "AbortError");
  assert.equal(local.state, "absent");
  assert.equal(local.error, null, "stopping it isn't an error");
  assert.equal(fs.existsSync(dir), false);
});

// ---------------------------------------------------------------------------
// What it hears
// ---------------------------------------------------------------------------

test("tidies the times Parakeet writes British-style, and nothing that isn't a time", () => {
  const same = (s) => [s, s];
  for (const [heard, typed] of [
    ["Let's meet at 3.30 tomorrow.", "Let's meet at 3:30 tomorrow."],
    ["Call me at 03:30.", "Call me at 3:30."],
    ["Lunch at 12.15 p.m. works", "Lunch at 12:15 p.m. works"],
    ["Be there by 9.45, please", "Be there by 9:45, please"],
    ["It's at 10.05", "It's at 10:05"],
    ["Let's go at 4.15.", "Let's go at 4:15."],
    ["between 1.15 and 2", "between 1:15 and 2"],
    same("Version 3.30 shipped"),
    same("It grew at 3.30 percent"),
    same("Selling at 2.50 dollars each"),
    same("Up at 1.25% today"),
    same("at 3.305"),
    same("at 13.30"),
    same("20:30 and 10:05 stay"),
    ["  extra   spaces  ", "extra spaces"],
  ]) {
    assert.equal(tidyLocalText(heard), typed, heard);
  }
  assert.equal(tidyLocalText(null), "");
  assert.equal(tidyLocalText(undefined), "");
});

// ---------------------------------------------------------------------------
// On this computer first
// ---------------------------------------------------------------------------

test("dictation goes through this computer's Parakeet first, and only the words go to the server", async () => {
  const calls = [];
  const api = {
    dictate: async (audio, p) => (calls.push(["audio", audio, p]), { kind: "text", text: "from the server" }),
    dictateText: async (heard, audio, p) => (calls.push(["text", heard, audio, p]), { kind: "text", text: heard }),
  };
  const logs = [];
  let use = true;
  let fail = null;
  const local = {
    transcribe: async (w, o) => {
      calls.push(["local", w.length, o]);
      if (fail) throw fail;
      return "Hi there.";
    },
  };
  const dictate = localFirst({ local, api, use: () => use, log: (m) => logs.push(m) });
  const rec = { bytes: new Uint8Array(10), mime: "audio/webm", durationMs: 1200, speechMs: 900, wav: new Uint8Array(64) };
  const p = { category: "chat", lang: "en" };

  assert.deepEqual(await dictate(rec, p), { kind: "text", text: "Hi there.", local: true });
  assert.deepEqual(calls, [
    ["local", 64, { durationMs: 1200 }],
    ["text", "Hi there.", rec, p],
  ]);
  assert.match(logs[0], /^voice: heard on this computer in \d+ ms$/);

  // It failed on the computer: the recording goes to the server as before.
  calls.length = 0;
  fail = new LocalSpeechError("engine", "It answered 500.");
  assert.deepEqual(await dictate(rec, p), { kind: "text", text: "from the server" });
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["local", "audio"],
  );
  assert.match(logs.at(-1), /failed \(engine\); sending the recording instead/);

  // Not on (or not ready), or no WAV: straight to the server.
  calls.length = 0;
  use = false;
  await dictate(rec, p);
  use = true;
  await dictate({ ...rec, wav: undefined }, p);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["audio", "audio"],
  );

  // The server's own answer (out of words, unpaired…) stands: the audio isn't sent as well.
  calls.length = 0;
  fail = null;
  const limit = Object.assign(new Error("Out of words"), { status: 402 });
  const strict = localFirst({ local, api: { ...api, dictateText: async () => Promise.reject(limit) }, use: () => true });
  await assert.rejects(strict(rec, p), limit);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["local"],
  );
});
