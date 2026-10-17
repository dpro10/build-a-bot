/**
 * "Give my bot a folder": the files in one folder the owner picked go to one bot's Library and stay
 * in step. New and changed files are uploaded (straight to private storage) and read; deleted ones
 * leave the Library. Nothing outside the folder is read, and the files go to the owner's own
 * Library only. The AI never gets the disk: it reads what's in the Library, like any file.
 *
 *   scan (sizes and times only) → hash what changed → the server says "same bytes" or where to
 *   upload → upload → ask it to read → remember (library-sync.json)
 *
 * It watches the folder (and looks again every 10 minutes, in case a change was missed), one file
 * at a time, and tries again later when the network is down.
 */
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../store.mjs";
import { MAX_FILES, scanFolder } from "./scan.mjs";

const SETTLE_MS = 2500;
const RESCAN_MS = 10 * 60_000;

/** A file's SHA-256, streamed (it can be 25 MB). @param {string} file */
export function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/** Errors that stop a pass (and try again later), unlike one file that can't be sent. @param {any} err */
export function stopsTheSync(err) {
  const s = err?.status;
  return typeof s === "number" && (s === 0 || s === 401 || s === 413 || s === 429 || s >= 500);
}

/** Upload bytes to private Blob storage with a token for one path. */
async function uploadToBlob(pathname, bytes, token) {
  const { put } = await import("@vercel/blob/client");
  await put(pathname, bytes, { access: "private", token, multipart: bytes.length > 8 * 1024 * 1024, contentType: "application/octet-stream" });
}

/**
 * @typedef {{ size: number, mtimeMs: number, sha256: string, fileId: string }} SyncedFile
 * @typedef {{ folder: string | null, botId: string | null, files: Record<string, SyncedFile> }} SyncState
 */

export class LibrarySync extends EventEmitter {
  /**
   * @param {object} o
   * @param {ReturnType<typeof import('../api.mjs').createApi>} o.api
   * @param {import('../account.mjs').Account} o.account
   * @param {import('../store.mjs').Settings} o.settings
   * @param {string} o.stateFile
   * @param {(pathname: string, bytes: Uint8Array, token: string) => Promise<void>} [o.uploadBlob]
   * @param {typeof fs.watch} [o.watch]
   * @param {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout, setInterval: typeof setInterval, clearInterval: typeof clearInterval }} [o.timers]
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    super();
    this.o = o;
    this.api = o.api;
    this.account = o.account;
    this.settings = o.settings;
    this.uploadBlob = o.uploadBlob ?? uploadToBlob;
    this.watchFn = o.watch ?? fs.watch;
    this.timers = o.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
    this.log = o.log ?? (() => {});
    /** @type {SyncState} */
    this.state = { folder: null, botId: null, files: {}, ...(readJson(o.stateFile) ?? {}) };
    this.watcher = null;
    this.rescan = null;
    this.settle = null;
    this.running = null;
    this.again = false;
    /** Files skipped (couldn't be read or sent), not tried again until they change: path → "size:mtime". */
    this.skippedFiles = new Map();
    /** In the folder now, what's left to send, what went wrong. */
    this.counts = { total: 0, pending: 0, skippedTooBig: 0, skippedTooMany: 0, skippedFailed: 0 };
    this.error = /** @type {string | null} */ (null);
    this.lastSyncAt = 0;
    this.stopped = false;
  }

  config() {
    const lib = this.settings.get().library ?? { folder: null, botId: null };
    return { folder: lib.folder ?? null, botId: lib.botId ?? null };
  }

  /** Can it sync now? Paired, a server that keeps files, a folder that's there, and a bot. */
  ready() {
    const { folder, botId } = this.config();
    if (!this.account.device || !folder || !botId) return false;
    if (this.account.session && this.account.session.library?.available === false) return false;
    return this.account.bots().length === 0 || this.account.bots().some((b) => b.id === botId);
  }

  start() {
    void this.apply();
  }

  /** Re-decide after pairing, a session refresh or a setting change. */
  async apply() {
    if (this.stopped) return;
    if (!this.ready()) {
      this.unwatch();
      this.emit("change");
      return;
    }
    const { folder } = this.config();
    if (!fs.existsSync(/** @type {string} */ (folder))) {
      this.unwatch();
      this.error = "The folder isn't there anymore (moved, renamed, or on a drive that's not connected).";
      this.emit("change");
      return;
    }
    this.watchFolder(/** @type {string} */ (folder));
    this.schedule(0);
  }

  /**
   * The owner picked a folder for a bot. Another folder (or bot) starts fresh: what the old one
   * added stays in that bot's Library.
   * @param {string} folder @param {string} botId
   */
  async choose(folder, botId) {
    const cur = this.config();
    if (cur.folder !== folder || cur.botId !== botId) {
      this.state = { folder, botId, files: {} };
      this.skippedFiles.clear();
      this.save();
      this.error = null;
    }
    this.settings.update({ library: { folder, botId } });
    this.log(`library: syncing a folder to ${botId}`);
    this.unwatch();
    await this.apply();
  }

  /** Stop syncing: files already added stay in the Library. */
  stop() {
    this.settings.update({ library: { folder: null, botId: null } });
    this.unwatch();
    this.state = { folder: null, botId: null, files: {} };
    this.save();
    this.counts = { total: 0, pending: 0, skippedTooBig: 0, skippedTooMany: 0, skippedFailed: 0 };
    this.error = null;
    this.emit("change");
  }

  /** Signed out: forget the folder's state (the next pairing starts fresh). */
  forget() {
    this.unwatch();
    this.state = { folder: null, botId: null, files: {} };
    this.save();
    this.emit("change");
  }

  dispose() {
    this.stopped = true;
    this.unwatch();
  }

  /** @param {string} folder */
  watchFolder(folder) {
    if (this.watcher) return;
    try {
      this.watcher = this.watchFn(folder, { recursive: true, persistent: false }, (_ev, name) => {
        const n = String(name ?? "");
        if (n.split(/[\\/]/).some((seg) => seg.startsWith(".") || seg.startsWith("~$"))) return;
        this.schedule(SETTLE_MS);
      });
      this.watcher.on?.("error", () => this.unwatch(false));
    } catch (err) {
      this.log(`library: can't watch the folder (${/** @type {any} */ (err)?.code ?? err}); looking every 10 minutes`);
      this.watcher = null;
    }
    if (!this.rescan) {
      this.rescan = this.timers.setInterval(() => this.schedule(0), RESCAN_MS);
      /** @type {any} */ (this.rescan)?.unref?.();
    }
  }

  unwatch(all = true) {
    try {
      this.watcher?.close();
    } catch {
      /* already closed */
    }
    this.watcher = null;
    if (all) {
      if (this.rescan) this.timers.clearInterval(this.rescan);
      this.rescan = null;
      if (this.settle) this.timers.clearTimeout(this.settle);
      this.settle = null;
    }
  }

  /** Sync after `ms` (changes settle first: a file being saved fires several events). */
  schedule(ms) {
    if (this.settle) this.timers.clearTimeout(this.settle);
    this.settle = this.timers.setTimeout(() => {
      this.settle = null;
      void this.sync();
    }, ms);
    /** @type {any} */ (this.settle)?.unref?.();
  }

  save() {
    try {
      writeJson(this.o.stateFile, this.state);
    } catch (err) {
      this.log(`library: couldn't save its state (${/** @type {any} */ (err)?.message ?? err})`);
    }
  }

  /** One pass: send what's new or changed, take out what's gone. Never two at once. */
  async sync() {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.pass().finally(() => {
      this.running = null;
      if (this.again && !this.stopped) {
        this.again = false;
        this.schedule(SETTLE_MS);
      }
    });
    return this.running;
  }

  async pass() {
    if (!this.ready()) return;
    const { folder, botId } = /** @type {{ folder: string, botId: string }} */ (this.config());
    const { files, skipped } = await scanFolder(folder);
    this.counts = { ...this.counts, total: files.length, pending: 0, skippedTooBig: skipped.tooBig, skippedTooMany: skipped.tooMany };
    const here = new Set(files.map((f) => f.rel));
    // An empty folder that had files is more likely a drive that isn't there yet (or a cloud folder
    // still syncing) than the owner deleting everything: don't empty the Library over it.
    if (!files.length && Object.keys(this.state.files).length) {
      this.error = "The folder looks empty right now, so nothing was removed. If you emptied it on purpose, stop syncing it.";
      this.emit("change");
      return;
    }
    const changed = files.filter((f) => {
      const s = this.state.files[f.rel];
      if (s && s.size === f.size && s.mtimeMs === f.mtimeMs) return false;
      return this.skippedFiles.get(f.rel) !== `${f.size}:${f.mtimeMs}`;
    });
    for (const rel of this.skippedFiles.keys()) if (!here.has(rel)) this.skippedFiles.delete(rel);
    const gone = Object.keys(this.state.files).filter((rel) => !here.has(rel));
    this.counts.pending = changed.length + gone.length;
    this.error = null;
    this.emit("change");

    for (const rel of gone) {
      if (this.stopped || !this.ready()) return;
      try {
        await this.api.libraryDelete(botId, rel);
        delete this.state.files[rel];
        this.save();
      } catch (err) {
        return this.failed(err);
      }
      this.counts.pending -= 1;
      this.emit("change");
    }
    for (const f of changed) {
      if (this.stopped || !this.ready()) return;
      try {
        await this.send(botId, f);
        this.skippedFiles.delete(f.rel);
      } catch (err) {
        // The network, the pairing or a full Library stops the pass; one file that can't be read
        // (deleted while syncing, locked) or that the server turns down is skipped until it changes.
        if (stopsTheSync(err)) return this.failed(err);
        this.skippedFiles.set(f.rel, `${f.size}:${f.mtimeMs}`);
        this.log(`library: skipped a file (${/** @type {any} */ (err)?.status ?? /** @type {any} */ (err)?.code ?? "?"})`);
      }
      this.counts.pending -= 1;
      this.emit("change");
    }
    this.counts.skippedFailed = this.skippedFiles.size;
    this.lastSyncAt = Date.now();
    if (changed.length || gone.length) this.log(`library: synced (${changed.length} sent, ${gone.length} removed, ${files.length} in the folder)`);
    this.emit("change");
  }

  /** @param {string} botId @param {import('./scan.mjs').FolderFile} f */
  async send(botId, f) {
    const sha256 = await hashFile(f.abs);
    const known = this.state.files[f.rel];
    if (known && known.sha256 === sha256) {
      // Touched, not changed.
      this.state.files[f.rel] = { ...known, size: f.size, mtimeMs: f.mtimeMs };
      this.save();
      return;
    }
    const started = await this.api.libraryStart({ botId, path: f.rel, size: f.size, sha256 });
    if (!started.unchanged) {
      const bytes = await fs.promises.readFile(f.abs);
      if (started.upload.mode === "blob") await this.uploadBlob(started.upload.pathname, bytes, started.upload.token);
      else await this.api.libraryUploadLocal(started.upload.url, bytes);
      await this.api.libraryRead(botId, started.file.id);
    }
    this.state.files[f.rel] = { size: f.size, mtimeMs: f.mtimeMs, sha256, fileId: started.file.id };
    this.save();
  }

  /** @param {any} err */
  failed(err) {
    const status = err?.status;
    this.error =
      status === 0
        ? "Can't reach Build-a-bot. It'll try again."
        : status === 413
          ? err.message
          : status === 401
            ? "This computer was unpaired."
            : err?.message || "Something went wrong syncing the folder.";
    this.log(`library: sync stopped (${status ?? "?"} ${err?.code ?? ""})`);
    this.emit("change");
    // Try again in a few minutes (the network may be back).
    if (status !== 401 && status !== 413) this.schedule(3 * 60_000);
  }

  /** For the tray and the pairing window. */
  info() {
    const { folder, botId } = this.config();
    const bot = this.account.bots().find((b) => b.id === botId) ?? null;
    const available = this.account.session ? this.account.session.library?.available !== false : true;
    const synced = Object.keys(this.state.files).length;
    let status = "";
    if (folder) {
      const name = path.basename(folder);
      if (this.error) status = this.error;
      else if (this.counts.pending > 0) status = `Syncing “${name}”: ${this.counts.pending} to go`;
      else status = `“${name}” → ${bot?.name ?? "your bot"} · ${synced} file${synced === 1 ? "" : "s"}`;
    }
    const notes = [
      this.counts.skippedTooBig ? `${this.counts.skippedTooBig} over 25 MB skipped` : "",
      this.counts.skippedTooMany ? `${this.counts.skippedTooMany} past the first ${MAX_FILES} skipped` : "",
      this.counts.skippedFailed ? `${this.counts.skippedFailed} couldn't be read` : "",
    ].filter(Boolean);
    return {
      available,
      folder,
      folderName: folder ? path.basename(folder) : null,
      botId,
      botName: bot?.name ?? null,
      synced,
      pending: this.counts.pending,
      status,
      note: notes.join(" · ") || null,
      error: this.error,
    };
  }
}
