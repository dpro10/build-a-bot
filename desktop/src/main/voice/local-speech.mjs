/**
 * Voice typing's ears on this computer: NVIDIA Parakeet TDT 0.6B v3, run by NVIDIA's NeMo-Speech.cpp,
 * so what the owner says never leaves the computer. Only the words go on to the server, for the
 * cleanup and "Hey {bot}".
 *
 *  - The first time, it downloads NVIDIA's runtime for this platform (about 5 MB) and the model
 *    (714 MB) into the app's folder. Each is pinned to one version and checked against its SHA-256
 *    before it's used, and a cut-off download picks up where it stopped.
 *  - The runtime runs as `nemo-speech serve` on 127.0.0.1, on a random port, behind a random key
 *    (so other programs on the computer can't use it). It starts when voice typing is used and
 *    stops after a while unused, so the model isn't in memory all day.
 *  - A recording is sent to it in memory, as 16 kHz WAV, and never written to disk.
 *
 * Until it's ready (or if it fails), voice typing uses the server's speech-to-text as before.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export const LOCAL_MODEL = Object.freeze({
  id: "parakeet-tdt-0.6b-v3",
  label: "NVIDIA Parakeet",
  file: "parakeet-tdt-0.6b-v3.q8_0.gguf",
  url: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/resolve/541d1f99c6b0c3cd0b11a95167540bb8edefd82b/parakeet-tdt-0.6b-v3.q8_0.gguf",
  bytes: 713_975_456,
  sha256: "e3880d0aaaaf2c308ea2c35016b2b895c423eb3fda924c1b463d1c19b7f4d32e",
});

const RELEASE = "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.2.0";

/** NeMo-Speech.cpp 0.2.0 for each platform (the hashes NVIDIA publishes with the release). */
export const RUNTIMES = Object.freeze({
  "darwin-arm64": { file: "nemo-speech-0.2.0-macos-aarch64-metal.tar.gz", sha256: "5cb02ba7c04f0b5585ce5cde9c830be5f0b7dfb4c83083c500109c381b4f2da9", itn: true, gpu: true },
  "darwin-x64": { file: "nemo-speech-0.2.0-macos-x86_64-cpu.tar.gz", sha256: "d52c318d8197511d4f7eee02bcf05511f7e91b300555a130b562e571695a0f39", itn: true },
  "win32-x64": { file: "nemo-speech-0.2.0-windows-x86_64-cpu.zip", sha256: "82c80451086e86194aba9af19f800da77cd66d1c28d993d0efceffd6cdb49bb8", itn: false },
  "linux-x64": { file: "nemo-speech-0.2.0-linux-x86_64-cpu.tar.gz", sha256: "f396057150f1b774935c7414fd32ebc04195a795a34120d78d8c9ecefa1b7507", itn: true },
});

/** Its number rules ("three thirty" → 3:30), for macOS and Linux (the Windows build has none). */
export const ITN = Object.freeze({ file: "itn_configs.tar.bz2", sha256: "880c9365d1d52c17450bd930950b0e58eca294421b7be62eb71666fb21b8997f" });

/** The languages Parakeet hears ("auto" detects among them). */
export const LOCAL_LANGUAGES = new Set([
  "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it",
  "lt", "lv", "mt", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk",
]);

const FOLDER_PROBLEM = "It can't run from this Windows account's folder: its name has letters from outside English, and Windows keeps no short name for it.";

/** Room the download needs besides the model itself. */
const SPARE_BYTES = 300 * 1024 * 1024;

/**
 * The engine's own lines worth keeping in the app's log: which model and device, that it's
 * listening, and problems. Not the rest (its number rules print their setup on every request).
 */
const ENGINE_LOG = /^\[(asr|nemo-speech)\]|^HTTP API listening|error|fail|warn|abort/i;

export class LocalSpeechError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * A clock time Parakeet writes British-style after an English time word ("at 3.30" → "at 3:30"),
 * and the hour's leading zero its number rules add ("03:30" → "3:30").
 */
const CLOCK_TIME =
  /\b(at|by|until|till|before|after|around|from|between)\s+(1[0-2]|[1-9])\.([0-5]\d)(?=\s*(?:[ap]\.?m\.?)?(?:[\s,;:!?)]|\.(?:\s|$)|$))(?!\s*(?:%|percent|per\b|times\b|x\b|dollars?|cents?|euros?|pounds?|points?|degrees?|kg\b|km\b|miles?|meters?|feet|inches|lbs?\b|gb\b|mb\b|million|billion|thousand))/gi;

export function tidyLocalText(text) {
  return String(text ?? "")
    .replace(/(^|[^\d:])0([1-9]):([0-5]\d)(?!\d)/g, "$1$2:$3")
    .replace(CLOCK_TIME, "$1 $2:$3")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bytes free where `dir` lives, or null if the system won't say. */
async function freeSpace(dir) {
  try {
    let at = dir;
    while (!fs.existsSync(at)) at = path.dirname(at);
    const s = await fsp.statfs(at);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {net.AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The tar that unpacks the downloads: on Windows its own (bsdtar, which opens .zip too), not one a PATH puts first. */
function tarFor(platform) {
  return platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

/** Run a program to the end; reject with its last words if it fails. */
function run(spawnImpl, cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(cmd, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    child.stderr?.on("data", (d) => {
      if (err.length < 1000) err += d;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}: ${err.trim().slice(0, 300)}`))));
  });
}

/** Plain ASCII, which every program can open as a path. */
const ascii = (s) => /^[\x20-\x7e]*$/.test(s);

/**
 * Windows: a folder's short name (C:\Users\JOS~1\…), plain ASCII where its long name isn't, or
 * null when Windows keeps none for it (short names can be turned off for a drive).
 */
function shortPath(spawnImpl, dir) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawnImpl(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:BAB_SHORT_OF).ShortPath"],
      { env: { ...process.env, BAB_SHORT_OF: dir }, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    child.stdout?.on("data", (d) => (out += d));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && out.trim() ? out.trim() : null));
  });
}

/** Run a program and give back what it printed (empty if it fails). */
function output(spawnImpl, cmd, args) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawnImpl(cmd, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    child.stdout?.on("data", (d) => {
      if (out.length < 10_000) out += d;
    });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out));
  });
}

/** The folder (at most three levels down) that has `bin/nemo-speech`. */
async function findRuntimeRoot(dir, exe, depth = 0) {
  if (fs.existsSync(path.join(dir, "bin", exe))) return dir;
  if (depth >= 3) return null;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = await findRuntimeRoot(path.join(dir, entry.name), exe, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * @typedef {'unsupported'|'absent'|'downloading'|'installed'|'starting'|'ready'|'error'} LocalState
 */

export class LocalSpeech extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dir  where the runtime and the model live
   * @param {string} [o.platform]
   * @param {string} [o.arch]
   * @param {typeof fetch} [o.fetchImpl]  for the downloads (the app's own network stack, so a proxy works)
   * @param {typeof fetch} [o.localFetch]  for the engine on 127.0.0.1
   * @param {typeof spawn} [o.spawnImpl]
   * @param {(m: string) => void} [o.log]
   * @param {number} [o.idleMs]  stop the engine after this long unused
   * @param {number} [o.readyTimeoutMs]
   * @param {number} [o.retryMs]  the first wait before downloading again after a dropped connection
   * @param {(dir: string) => Promise<number | null>} [o.freeSpace]
   * @param {{ runtimeUrl?: string, itnUrl?: string, modelUrl?: string, runtimeSha256?: string, itnSha256?: string, modelSha256?: string, modelBytes?: number }} [o.sources]
   *   other places to download from (tests, a mirror); the hashes still have to match
   */
  constructor(o) {
    super();
    this.dir = o.dir;
    this.platform = o.platform ?? process.platform;
    this.runtime = RUNTIMES[`${this.platform}-${o.arch ?? process.arch}`] ?? null;
    this.fetch = o.fetchImpl ?? fetch;
    this.localFetch = o.localFetch ?? fetch;
    this.spawn = o.spawnImpl ?? spawn;
    this.log = o.log ?? (() => {});
    this.idleMs = o.idleMs ?? 20 * 60_000;
    this.readyTimeoutMs = o.readyTimeoutMs ?? 120_000;
    this.retryMs = o.retryMs ?? 800;
    this.freeSpace = o.freeSpace ?? freeSpace;
    const s = o.sources ?? {};
    this.src = {
      runtimeUrl: s.runtimeUrl ?? (this.runtime ? `${RELEASE}/${this.runtime.file}` : ""),
      runtimeSha256: s.runtimeSha256 ?? this.runtime?.sha256 ?? "",
      itnUrl: s.itnUrl ?? `${RELEASE}/${ITN.file}`,
      itnSha256: s.itnSha256 ?? ITN.sha256,
      modelUrl: s.modelUrl ?? LOCAL_MODEL.url,
      modelSha256: s.modelSha256 ?? LOCAL_MODEL.sha256,
      modelBytes: s.modelBytes ?? LOCAL_MODEL.bytes,
    };
    this.exe = this.platform === "win32" ? "nemo-speech.exe" : "nemo-speech";
    /** @type {LocalState} */
    this.state = !this.runtime ? "unsupported" : this.isInstalled() ? "installed" : "absent";
    this.error = null;
    /** Download progress, per file. @type {Map<string, { received: number, total: number }>} */
    this.files = new Map();
    this.installing = null;
    this.starting = null;
    /** @type {import('node:child_process').ChildProcess | null} */
    this.child = null;
    this.port = 0;
    this.secret = "";
    this.stopping = false;
    /** When the engine stopped on its own lately. */
    this.crashes = [];
    this.idleTimer = null;
    this.abort = null;
    this.lastEmit = 0;
    /** Checked for an engine an earlier run left behind. */
    this.reaped = false;
    /**
     * Where it runs the model, with a runtime that has a GPU (Metal on Apple silicon): "auto" (the
     * GPU) until that fails on this computer, then "cpu" from then on. Read from engine.json at
     * the first start. The other runtimes are CPU-only.
     * @type {'auto'|'cpu'|null}
     */
    this.device = null;
    /** Windows: the folder as the engine can open it (see place()); undefined until asked. @type {string | null | undefined} */
    this.short = undefined;
  }

  /**
   * The folder as a path NVIDIA's engine can open. Its Windows build can't open files in a folder
   * whose name has letters from outside English (C:\Users\José\…), even given relative to it: it
   * gets Windows' short name for the folder instead (C:\Users\JOS~1\…), plain ASCII. Null when
   * Windows keeps no short name there: then it can't run on this computer.
   */
  async place() {
    if (this.platform !== "win32" || ascii(this.dir)) return this.dir;
    if (this.short === undefined) {
      await fsp.mkdir(this.dir, { recursive: true });
      const short = await shortPath(this.spawn, this.dir);
      this.short = short && ascii(short) ? short : null;
      this.log(`local speech: the folder's name isn't plain ASCII; ${this.short ? "using its short name" : "Windows keeps no short name for it"}`);
    }
    return this.short;
  }

  /** It can't run here (Windows, a folder it can't open; see place()). */
  blocked() {
    return this.short === null;
  }

  get paths() {
    return {
      runtime: path.join(this.dir, "runtime"),
      bin: path.join(this.dir, "runtime", "bin", this.exe),
      itn: path.join(this.dir, "runtime", "itn_configs"),
      model: path.join(this.dir, "models", LOCAL_MODEL.file),
      downloads: path.join(this.dir, "downloads"),
      marker: path.join(this.dir, "installed.json"),
      /** The running engine's process id, so a run of the app that was force-quit can be cleaned up after. */
      pid: path.join(this.dir, "engine.pid"),
      /** The GPU didn't work here: run on the CPU (kept until NVIDIA's runtime changes). */
      device: path.join(this.dir, "engine.json"),
    };
  }

  supported() {
    return Boolean(this.runtime);
  }

  /** Both pieces are here, and they're the versions this app expects. */
  isInstalled() {
    if (!this.runtime) return false;
    try {
      const m = JSON.parse(fs.readFileSync(this.paths.marker, "utf8"));
      if (m.runtime !== this.src.runtimeSha256 || m.model !== this.src.modelSha256) return false;
      return fs.existsSync(this.paths.bin) && fs.statSync(this.paths.model).size === this.src.modelBytes;
    } catch {
      return false;
    }
  }

  /** What the settings window shows. */
  status() {
    let received = 0;
    let total = 0;
    for (const f of this.files.values()) {
      received += f.received;
      total += f.total;
    }
    return { state: this.state, supported: this.supported(), blocked: this.blocked(), received, total, error: this.error, model: LOCAL_MODEL.label, bytes: this.src.modelBytes };
  }

  /** @param {LocalState} state */
  set(state) {
    if (this.state === state) return;
    this.state = state;
    this.lastEmit = Date.now();
    this.emit("change", this.status());
  }

  progress() {
    if (Date.now() - this.lastEmit < 400) return;
    this.lastEmit = Date.now();
    this.emit("change", this.status());
  }

  // -------------------------------------------------------------------------
  // Getting it
  // -------------------------------------------------------------------------

  /** Download and check everything it needs (once; a second call joins the first). */
  install() {
    if (!this.runtime) return Promise.reject(new LocalSpeechError("unsupported", "This computer can't run it."));
    if (this.isInstalled()) {
      if (this.state === "absent" || this.state === "error") this.set("installed");
      return Promise.resolve();
    }
    this.installing ??= this.doInstall()
      .catch((err) => {
        const e = /** @type {any} */ (err);
        this.error = e?.name === "AbortError" ? null : e instanceof LocalSpeechError ? e.message : "The download didn't finish. Check your internet and try again.";
        this.log(`local speech: install failed (${e?.code ?? e?.name ?? "error"}: ${String(e?.message ?? e).slice(0, 200)})`);
        this.set(this.error ? "error" : "absent");
        throw err;
      })
      .finally(() => {
        this.installing = null;
        this.abort = null;
      });
    return this.installing;
  }

  async doInstall() {
    const p = this.paths;
    this.error = null;
    if (!(await this.place())) throw new LocalSpeechError("folder", FOLDER_PROBLEM);
    this.abort = new AbortController();
    this.files = new Map([["model", { received: 0, total: this.src.modelBytes }]]);
    this.set("downloading");
    await fsp.mkdir(p.downloads, { recursive: true });
    const free = await this.freeSpace(this.dir);
    if (free !== null && free < this.src.modelBytes + SPARE_BYTES) {
      throw new LocalSpeechError("disk", `It needs about ${Math.ceil((this.src.modelBytes + SPARE_BYTES) / 1e9 * 10) / 10} GB free on this computer.`);
    }

    // NVIDIA's runtime (and its number rules), unpacked into runtime/.
    const archive = await this.download("runtime", this.src.runtimeUrl, path.join(p.downloads, path.basename(new URL(this.src.runtimeUrl).pathname)), this.src.runtimeSha256);
    const unpack = path.join(this.dir, "runtime.tmp");
    await fsp.rm(unpack, { recursive: true, force: true });
    await fsp.mkdir(unpack, { recursive: true });
    try {
      await run(this.spawn, tarFor(this.platform), ["-xf", archive, "-C", unpack]);
    } catch (err) {
      throw new LocalSpeechError("unpack", `Couldn't unpack NVIDIA's runtime (${String(/** @type {any} */ (err)?.message ?? err).slice(0, 120)}).`);
    }
    const root = await findRuntimeRoot(unpack, this.exe);
    if (!root) throw new LocalSpeechError("unpack", "NVIDIA's runtime wasn't where it should be in the download.");
    await fsp.rm(p.runtime, { recursive: true, force: true });
    await fsp.rename(root, p.runtime);
    await fsp.rm(unpack, { recursive: true, force: true });
    if (this.platform !== "win32") await fsp.chmod(p.bin, 0o755);
    // macOS: if the system marked the download as quarantined, Gatekeeper would stop NVIDIA's
    // (ad-hoc signed) runtime from running. It matched NVIDIA's published hash above.
    if (this.platform === "darwin") await run(this.spawn, "/usr/bin/xattr", ["-dr", "com.apple.quarantine", p.runtime]).catch(() => {});
    if (this.runtime?.itn) {
      try {
        const itn = await this.download("itn", this.src.itnUrl, path.join(p.downloads, ITN.file), this.src.itnSha256);
        await run(this.spawn, tarFor(this.platform), ["-xf", itn, "-C", p.runtime]);
      } catch (err) {
        // Numbers come out as words without them; the cleanup still writes them as digits.
        if (/** @type {any} */ (err)?.name === "AbortError") throw err;
        this.log(`local speech: no number rules (${String(/** @type {any} */ (err)?.message ?? err).slice(0, 120)})`);
      }
    }

    // The model.
    await fsp.mkdir(path.dirname(p.model), { recursive: true });
    const model = await this.download("model", this.src.modelUrl, path.join(p.downloads, LOCAL_MODEL.file), this.src.modelSha256, this.src.modelBytes);
    await fsp.rename(model, p.model);
    await fsp.writeFile(p.marker, JSON.stringify({ runtime: this.src.runtimeSha256, model: this.src.modelSha256, at: new Date().toISOString() }));
    await fsp.rm(p.downloads, { recursive: true, force: true });
    this.files.clear();
    this.set("installed");
    this.log("local speech: installed");
  }

  /**
   * Download to `dest`, resuming a `.part` left from before, retrying a dropped connection, then
   * check the SHA-256. A file that doesn't match is deleted.
   */
  async download(name, url, dest, sha256, expected = 0) {
    const part = `${dest}.part`;
    const entry = { received: 0, total: expected };
    this.files.set(name, entry);
    // Already here from a try that stopped later on.
    if (fs.existsSync(dest) && (await sha256File(dest)) === sha256) {
      entry.received = entry.total = (await fsp.stat(dest)).size;
      return dest;
    }
    // Four tries in a row that get nowhere and it gives up; one that got further starts the count again.
    let failures = 0;
    for (;;) {
      const before = entry.received;
      try {
        await this.fetchTo(url, part, entry);
        break;
      } catch (err) {
        const e = /** @type {any} */ (err);
        if (this.abort?.signal.aborted) throw this.abort.signal.reason ?? err;
        if (e?.name === "AbortError" || e?.fatal) throw err;
        failures = entry.received > before ? 1 : failures + 1;
        if (failures >= 4) throw err;
        this.log(`local speech: ${name} download dropped (${String(e?.message ?? e).slice(0, 120)}); retrying`);
        await sleep(this.retryMs * 2 ** (failures - 1));
      }
    }
    const got = await sha256File(part);
    if (got !== sha256) {
      await fsp.rm(part, { force: true });
      throw new LocalSpeechError("damaged", "The download was damaged. Try again.");
    }
    await fsp.rename(part, dest);
    entry.received = entry.total;
    return dest;
  }

  async fetchTo(url, part, entry) {
    let have = 0;
    try {
      have = (await fsp.stat(part)).size;
    } catch {
      /* a fresh start */
    }
    const res = await this.fetch(url, { headers: have ? { range: `bytes=${have}-` } : {}, signal: this.abort?.signal, redirect: "follow", cache: "no-store" });
    // Already all here.
    if (res.status === 416 && have) {
      entry.received = entry.total = have;
      return;
    }
    if (!res.ok || !res.body) {
      const err = new Error(`HTTP ${res.status}`);
      if (res.status === 404 || res.status === 403 || res.status === 410) Object.assign(err, { fatal: true });
      throw err;
    }
    const resumed = have > 0 && res.status === 206;
    if (!resumed) have = 0;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length) entry.total = have + length;
    entry.received = have;
    const out = await fsp.open(part, resumed ? "a" : "w");
    try {
      for await (const chunk of /** @type {any} */ (res.body)) {
        try {
          await out.write(chunk);
        } catch (err) {
          if (/** @type {any} */ (err)?.code === "ENOSPC") throw Object.assign(new LocalSpeechError("disk", "This computer ran out of space for it."), { fatal: true });
          throw err;
        }
        entry.received += chunk.length;
        this.progress();
      }
    } finally {
      await out.close();
    }
    if (entry.total && entry.received < entry.total) throw new Error("the connection closed early");
  }

  /** Stop any download, stop the engine, and delete everything (it downloads again next time). */
  async remove() {
    this.abort?.abort();
    await this.installing?.catch(() => {});
    await this.stop();
    // One left running by an earlier run would hold the folder open (Windows won't delete it then).
    this.reaped = false;
    await this.reap();
    // Windows lets go of a stopped program's files a moment later.
    await fsp.rm(this.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    this.files.clear();
    this.error = null;
    this.set(this.runtime ? "absent" : "unsupported");
  }

  // -------------------------------------------------------------------------
  // Running it
  // -------------------------------------------------------------------------

  /** Start the engine ahead of a dictation (the shortcut was just pressed). */
  warm() {
    if (this.isInstalled() && !this.child) void this.ensureRunning().catch(() => {});
  }

  ensureRunning() {
    if (this.child && this.state === "ready") return Promise.resolve();
    this.starting ??= this.start().finally(() => (this.starting = null));
    return this.starting;
  }

  /**
   * An engine left running by a run of the app that couldn't stop it (force-quit, crashed): stop it,
   * so it doesn't hold the model in memory for nothing. Only if that process is still our engine
   * (a process id can be reused by another program).
   */
  async reap() {
    if (this.reaped) return;
    this.reaped = true;
    let pid = 0;
    let port = 0;
    try {
      ({ pid, port } = JSON.parse(await fsp.readFile(this.paths.pid, "utf8")));
    } catch {
      return;
    }
    await fsp.rm(this.paths.pid, { force: true });
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
    // By what ps always prints the same: the program's name and its arguments, all plain ASCII
    // (a folder named José can come out as "Jos?").
    const ours =
      this.platform === "win32"
        ? (await output(this.spawn, "tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"])).trim().toLowerCase().startsWith(`"${this.exe}"`)
        : ((cmd) => cmd.includes(`${this.exe} serve --asr-model ${path.relative(this.dir, this.paths.model)}`) && cmd.includes(`--port ${port} `))(
            await output(this.spawn, "ps", ["-p", String(pid), "-o", "command="]),
          );
    if (!ours) return;
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      process.kill(pid);
    } catch {
      return;
    }
    // Gone before the new one loads the model, so the two don't share the memory for it.
    for (let i = 0; i < 50 && alive(); i++) await sleep(100);
    if (alive()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* gone just now */
      }
    }
    this.log("local speech: stopped an engine left running by an earlier run");
  }

  /** It failed on the GPU on this computer (it crashed or hung): the CPU from now on. */
  useCpu(why) {
    if (this.device === "cpu") return;
    this.device = "cpu";
    this.log(`local speech: it didn't start on the GPU (${why}); using the CPU from now on`);
    // Written at once (it's tiny), so it can't land in a folder that's being deleted.
    try {
      fs.writeFileSync(this.paths.device, JSON.stringify({ device: "cpu", runtime: this.src.runtimeSha256, why: String(why), at: new Date().toISOString() }));
    } catch {
      /* it tries the GPU again next time */
    }
  }

  loadDevice() {
    try {
      const d = JSON.parse(fs.readFileSync(this.paths.device, "utf8"));
      // A new runtime from NVIDIA gets another try on the GPU.
      if (d.device === "cpu" && d.runtime === this.src.runtimeSha256) return "cpu";
    } catch {
      /* not decided yet */
    }
    return "auto";
  }

  async start() {
    try {
      return await this.startOnce();
    } catch (err) {
      // It crashed on the GPU while loading: straight away, once more on the CPU.
      if (err instanceof LocalSpeechError && err.code === "crashed" && this.lastDevice !== "cpu" && this.device === "cpu") return this.startOnce();
      throw err;
    }
  }

  async startOnce() {
    if (!this.isInstalled()) throw new LocalSpeechError("absent", "It isn't downloaded yet.");
    const root = await this.place();
    if (!root) throw new LocalSpeechError("folder", FOLDER_PROBLEM);
    await this.reap();
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < 10 * 60_000);
    if (this.crashes.length >= 3) throw new LocalSpeechError("crashing", "It keeps stopping on this computer, so voice typing uses Build-a-bot's servers for now.");
    const p = this.paths;
    this.port = await freePort();
    this.secret = randomBytes(24).toString("hex");
    const device = this.runtime?.gpu ? (this.device ??= this.loadDevice()) : "cpu";
    this.lastDevice = device;
    // It runs in its own folder (as place() gives it), with paths relative to it.
    const bin = path.join(root, path.relative(this.dir, p.bin));
    const args = ["serve", "--asr-model", path.relative(this.dir, p.model), "--host", "127.0.0.1", "--port", String(this.port), "--no-ui", "--device", device];
    if (fs.existsSync(p.itn)) args.push("--itn-model-dir", path.relative(this.dir, p.itn));
    const env = { ...process.env, NEMO_SPEECH_HTTP_API_KEY: this.secret };
    if (this.platform === "win32") {
      // Its DLLs sit next to it; and its temporary files go in its folder too, not the user's.
      env.PATH = `${path.dirname(bin)};${env.PATH ?? ""}`;
      await fsp.mkdir(path.join(this.dir, "tmp"), { recursive: true });
      env.TEMP = env.TMP = path.join(root, "tmp");
    }
    this.stopping = false;
    this.set("starting");
    const child = this.spawn(bin, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    if (child.pid) {
      try {
        fs.writeFileSync(p.pid, JSON.stringify({ pid: child.pid, port: this.port }));
      } catch {
        /* only the clean-up after a force-quit needs it */
      }
    }
    const lines = (d) => {
      for (const line of String(d).split("\n")) if (ENGINE_LOG.test(line.trim())) this.log(`local speech: ${line.trim().slice(0, 200)}`);
    };
    child.stdout?.on("data", lines);
    child.stderr?.on("data", lines);
    const ended = (why) => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(this.idleTimer);
      fs.rmSync(p.pid, { force: true });
      if (!this.stopping) {
        this.crashes.push(Date.now());
        this.log(`local speech: stopped on its own (${why})`);
        if (device !== "cpu" && child.pid !== undefined) this.useCpu(`it stopped: ${why}`);
      }
      this.set(this.isInstalled() ? "installed" : "absent");
    };
    child.on("exit", (code, signal) => ended(signal ?? code));
    // It couldn't be run at all (no process, so no "exit" either).
    child.on("error", (err) => {
      this.log(`local speech: couldn't run it (${/** @type {any} */ (err).code ?? err.message})`);
      if (child.pid === undefined) ended("not started");
    });
    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (this.child !== child) throw new LocalSpeechError("crashed", "It stopped while starting.");
      try {
        const r = await this.localFetch(`http://127.0.0.1:${this.port}/ready`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) {
          this.set("ready");
          this.touch();
          return;
        }
      } catch {
        /* not listening yet */
      }
      await sleep(250);
    }
    await this.stop();
    if (device !== "cpu") this.useCpu("it took too long to start");
    throw new LocalSpeechError("slow", "It took too long to start.");
  }

  /** Used just now: stop it later if nothing else comes. */
  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.stop(), this.idleMs);
    this.idleTimer.unref?.();
  }

  async stop() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    const gone = new Promise((resolve) => {
      child.once("exit", resolve);
      child.once("error", resolve);
    });
    child.kill();
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    // SIGKILL always ends it; the cap only keeps a quit from waiting on a process that's already gone.
    let cap;
    await Promise.race([gone, new Promise((resolve) => (cap = setTimeout(resolve, 5000)))]);
    clearTimeout(timer);
    clearTimeout(cap);
    if (this.child === child) {
      this.child = null;
      this.set(this.isInstalled() ? "installed" : "absent");
    }
  }

  /**
   * One recording (16 kHz WAV, in memory) → what was said. A dictation waits at most `startWaitMs`
   * for the engine to load (it was started when the shortcut was pressed); the next one finds it ready.
   * @param {Uint8Array} wav
   * @param {{ durationMs?: number, startWaitMs?: number }} [o]
   */
  async transcribe(wav, o = {}) {
    const running = this.ensureRunning();
    running.catch(() => {});
    let timer;
    try {
      await Promise.race([running, new Promise((_, reject) => (timer = setTimeout(() => reject(new LocalSpeechError("starting", "It's still starting.")), o.startWaitMs ?? 15_000)))]);
    } finally {
      clearTimeout(timer);
    }
    this.touch();
    const form = new FormData();
    form.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
    form.append("response_format", "json");
    const res = await this.localFetch(`http://127.0.0.1:${this.port}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.secret}` },
      body: form,
      signal: AbortSignal.timeout(Math.max(30_000, (o.durationMs ?? 0) * 3)),
    });
    if (!res.ok) throw new LocalSpeechError("engine", `It answered ${res.status}.`);
    const data = /** @type {{ text?: string }} */ (await res.json());
    this.touch();
    return tidyLocalText(data.text);
  }
}

/**
 * Voice typing's dictate(), on this computer first: Parakeet hears the WAV and only the words go to
 * the server. If it can't (not ready, failed), the recording goes to the server as before. Errors
 * from the server itself (out of words, unpaired…) are the server's answer either way.
 * @param {{ local: { transcribe(wav: Uint8Array, o?: { durationMs?: number }): Promise<string> }, api: { dictate: Function, dictateText: Function }, use: () => boolean, log?: (m: string) => void }} o
 */
export function localFirst(o) {
  const log = o.log ?? (() => {});
  return async function dictate(audio, p) {
    if (audio?.wav && o.use()) {
      const t = Date.now();
      let heard = null;
      try {
        heard = await o.local.transcribe(audio.wav, { durationMs: audio.durationMs });
        log(`voice: heard on this computer in ${Date.now() - t} ms`);
      } catch (err) {
        const e = /** @type {any} */ (err);
        log(`voice: on-device speech-to-text failed (${e?.code ?? e?.name ?? "error"}); sending the recording instead`);
      }
      if (heard !== null) return { ...(await o.api.dictateText(heard, audio, p)), local: true };
    }
    return o.api.dictate(audio, p);
  };
}
