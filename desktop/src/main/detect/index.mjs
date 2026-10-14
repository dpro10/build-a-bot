/**
 * Call detection: every few seconds, ask the OS which meeting app has the microphone
 * open, debounce it (tracker.mjs) and emit "call-start" / "call-end". It only ever
 * reads who is using the mic (metadata), never audio.
 *
 * Test hook: BAB_FAKE_MEETING=<app> (or BAB_FAKE_MEETING_FILE=<path>, re-read on every
 * check, so a test can start and end a call by writing the file) simulates a call
 * instead of asking the OS.
 */
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { isAppId } from "../apps.mjs";
import { appFromBundleId } from "./catalog.mjs";
import { linuxSightings, parseSourceOutputs, parseSourceOutputsJson } from "./linux.mjs";
import { TABS_APPLESCRIPT, macHelperSightings, macProcessSightings, macTabSightings, parseHelperOutput, parsePs, parseTabLines } from "./macos.mjs";
import { createTracker } from "./tracker.mjs";
import { CONSENT_STORE_KEY, consentStoreEntries, parseRegQuery, parseTasklistCsv, windowsSightings } from "./windows.mjs";
import { WIN_BROWSERS } from "./catalog.mjs";

/** @typedef {import('./tracker.mjs').Sighting} Sighting */

/**
 * Run a program and return its stdout (UTF-8). Rejects with `code` on failure.
 * @param {string} file @param {string[]} args @param {{ timeout?: number, env?: Record<string,string> }} [opts]
 */
export function execText(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: opts.timeout ?? 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", env: opts.env ? { ...process.env, ...opts.env } : process.env },
      (err, stdout, stderr) => {
        if (err) {
          const e = /** @type {any} */ (err);
          e.stdout = stdout;
          e.stderr = stderr;
          reject(e);
        } else resolve(stdout);
      },
    );
  });
}

/** Fake calls for tests: "zoom", "zoom meet", or "" (no call). */
export function parseFakeMeeting(text) {
  return String(text || "")
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => isAppId(t))
    .map((app) => /** @type {Sighting} */ ({ key: `fake:${app}`, app, kind: app === "browser" ? "browser" : "native", pid: null, label: app, source: "fake", bounds: null }));
}

export class Detector extends EventEmitter {
  /**
   * @param {object} o
   * @param {NodeJS.Platform} [o.platform]
   * @param {number} [o.intervalMs]
   * @param {() => Set<number>} [o.ownPids]  this app's processes (they record too, once we take notes)
   * @param {string} [o.ownExe]
   * @param {string[]} [o.ownBinaries]
   * @param {string | null} [o.macHelper]  path to the Swift helper, if built
   * @param {() => boolean} [o.macTabs]  owner allowed reading browser tabs (macOS)
   * @param {string | null} [o.fakeApp]
   * @param {string | null} [o.fakeFile]
   * @param {ReturnType<typeof createTracker>} [o.tracker]
   * @param {typeof execText} [o.exec]
   * @param {() => number} [o.now]
   * @param {(msg: string, extra?: any) => void} [o.log]
   */
  constructor(o = {}) {
    super();
    this.platform = o.platform ?? process.platform;
    this.intervalMs = o.intervalMs ?? 3000;
    this.ownPids = o.ownPids ?? (() => new Set([process.pid]));
    this.ownExe = o.ownExe ?? process.execPath;
    this.ownBinaries = o.ownBinaries ?? [];
    this.macHelper = o.macHelper ?? null;
    this.macTabs = o.macTabs ?? (() => false);
    this.fakeApp = o.fakeApp ?? null;
    this.fakeFile = o.fakeFile ?? null;
    this.tracker = o.tracker ?? createTracker();
    this.exec = o.exec ?? execText;
    this.now = o.now ?? Date.now;
    this.log = o.log ?? (() => {});
    /** @type {{ mode: 'full'|'limited'|'fake'|'unavailable'|'starting', detail: string }} */
    this.status = { mode: "starting", detail: "" };
    this.timer = null;
    this.running = false;
    this.pactlJson = true;
  }

  get fake() {
    return Boolean(this.fakeFile || this.fakeApp);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      await this.check();
      if (this.running) this.timer = setTimeout(loop, this.intervalMs);
    };
    this.timer = setTimeout(loop, 250);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Calls in progress right now. */
  active() {
    return this.tracker.active();
  }

  async check() {
    let result;
    try {
      result = await this.probe();
    } catch (err) {
      // Don't end calls because a check failed; just report it.
      const e = /** @type {any} */ (err);
      this.setStatus("unavailable", e?.code === "ENOENT" ? `${e.path ?? "a system tool"} isn't installed` : String(e?.message ?? err).slice(0, 200));
      return;
    }
    this.setStatus(result.mode, result.detail ?? "");
    for (const ev of this.tracker.update(this.now(), result.sightings)) {
      this.log(`detect: ${ev.type} ${ev.app} (${ev.key})`);
      if (ev.type === "start") this.emit("call-start", ev);
      else if (ev.type === "end") this.emit("call-end", ev);
      else this.emit("call-update", ev);
    }
  }

  setStatus(mode, detail) {
    if (this.status.mode === mode && this.status.detail === detail) return;
    this.status = { mode, detail };
    this.emit("status", this.status);
  }

  /** @returns {Promise<{ mode: 'full'|'limited'|'fake', detail?: string, sightings: Sighting[] }>} */
  async probe() {
    if (this.fake) {
      let text = this.fakeApp ?? "";
      if (this.fakeFile) {
        try {
          text = fs.readFileSync(this.fakeFile, "utf8");
        } catch {
          text = "";
        }
      }
      return { mode: "fake", detail: "simulated calls (BAB_FAKE_MEETING)", sightings: parseFakeMeeting(text) };
    }
    if (this.platform === "linux") return this.probeLinux();
    if (this.platform === "win32") return this.probeWindows();
    if (this.platform === "darwin") return this.probeMac();
    return { mode: "limited", detail: `no call detection on ${this.platform}`, sightings: [] };
  }

  async probeLinux() {
    const env = { LC_ALL: "C", LANG: "C" };
    let outputs = null;
    if (this.pactlJson) {
      try {
        outputs = parseSourceOutputsJson(await this.exec("pactl", ["--format=json", "list", "source-outputs"], { env }));
      } catch (err) {
        if (/** @type {any} */ (err)?.code === "ENOENT") throw err;
        outputs = null;
      }
      if (!outputs) this.pactlJson = false; // older pactl: use the text format from now on
    }
    if (!outputs) outputs = parseSourceOutputs(await this.exec("pactl", ["list", "source-outputs"], { env }));
    return { mode: "full", sightings: linuxSightings(outputs, { ownPids: this.ownPids(), ownBinaries: this.ownBinaries }) };
  }

  async probeWindows() {
    let regText = "";
    try {
      regText = await this.exec("reg", ["query", CONSENT_STORE_KEY, "/s"], { timeout: 8000 });
    } catch (err) {
      // Exit code 1: the key doesn't exist yet (no app has used the mic). Nothing to see.
      const e = /** @type {any} */ (err);
      if (e?.code === "ENOENT") throw err;
      regText = e?.stdout ?? "";
    }
    const entries = consentStoreEntries(parseRegQuery(regText));
    if (!entries.some((e) => e.inUse)) return { mode: "full", sightings: [] };
    const processes = parseTasklistCsv(await this.exec("tasklist", ["/fo", "csv", "/nh"], { timeout: 8000 }));
    const browsers = [...new Set(entries.filter((e) => e.inUse && e.exe && WIN_BROWSERS.includes(e.exe)).map((e) => e.exe))];
    const titles = [];
    for (const b of browsers) {
      try {
        titles.push(...parseTasklistCsv(await this.exec("tasklist", ["/v", "/fo", "csv", "/nh", "/fi", `imagename eq ${b}`], { timeout: 8000 })));
      } catch {
        /* titles are a nice-to-have */
      }
    }
    return { mode: "full", sightings: windowsSightings(entries, processes, { ownExe: this.ownExe, titles }) };
  }

  async probeMac() {
    const own = this.ownPids();
    const tabsOn = this.macTabs();
    if (this.macHelper) {
      try {
        const out = parseHelperOutput(await this.exec(this.macHelper, ["mic"], { timeout: 4000 }));
        if (out.ok && out.api === "process-objects") {
          const browserOnMic = out.processes.some((p) => p.input && appFromBundleId(p.bundleId)?.kind === "browser");
          const tabs = tabsOn && browserOnMic ? await this.readTabs() : [];
          return { mode: "full", sightings: macHelperSightings(out, { ownPids: own, tabs }) };
        }
        if (out.ok && out.api === "device-only") {
          // macOS 13: no per-app mic info. Process names (and tabs, if allowed) still work.
          const sightings = macProcessSightings(parsePs(await this.exec("ps", ["-axo", "pid=,comm="])), { ownPids: own });
          if (tabsOn && out.inputInUse) sightings.push(...macTabSightings(await this.readTabs()));
          return { mode: "limited", detail: "app names for the mic need macOS 14", sightings };
        }
        this.log(`detect: mic helper said ${out.error ?? "no"}`);
      } catch (err) {
        this.log(`detect: mic helper failed: ${/** @type {any} */ (err)?.message ?? err}`);
      }
    }
    // Degraded: no per-app mic info on this Mac.
    const sightings = macProcessSightings(parsePs(await this.exec("ps", ["-axo", "pid=,comm="])), { ownPids: own });
    if (tabsOn) sightings.push(...macTabSightings(await this.readTabs()));
    return { mode: "limited", detail: this.macHelper ? "the mic helper isn't working" : "the mic helper isn't installed", sightings };
  }

  async readTabs() {
    try {
      return parseTabLines(await this.exec("osascript", ["-e", TABS_APPLESCRIPT], { timeout: 6000 }));
    } catch {
      return [];
    }
  }
}
