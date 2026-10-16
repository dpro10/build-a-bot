/**
 * The upload spool: a small folder where a piece of a meeting waits only when it can't be sent
 * yet: NVIDIA Parakeet is still on its way (it hears meetings on this computer), an upload failed
 * (a network blip), or the app is quitting with pieces pending. Each file is deleted as soon as
 * the piece is sent (as the lines heard in it, or as audio to a server that hears it), or the
 * meeting is discarded. This is the only place audio is ever written on this computer.
 *
 *   <userData>/spool/<meetingId>/<track>-<chunk>.webm   the audio
 *   <userData>/spool/<meetingId>/<track>-<chunk>.json   where it belongs
 */
import nodeFs from "node:fs";
import path from "node:path";

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * @typedef {object} ChunkItem
 * @property {string} server
 * @property {string} botId
 * @property {string} meetingId
 * @property {'mic'|'system'} track
 * @property {number} chunk
 * @property {number} startMs
 * @property {number} durationMs
 * @property {boolean} silent
 * @property {string} mime
 * @property {Uint8Array | null} [bytes]
 */

export class Spool {
  /** @param {string} dir @param {{ fs?: typeof nodeFs, maxBytes?: number }} [opts] */
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.fs = opts.fs ?? nodeFs;
    this.maxBytes = opts.maxBytes ?? 200 * 1024 * 1024;
  }

  /** @param {ChunkItem} item */
  paths(item) {
    if (!SAFE_ID.test(item.meetingId) || !/^(mic|system)$/.test(item.track) || !Number.isInteger(item.chunk)) throw new Error("bad spool item");
    const base = path.join(this.dir, item.meetingId, `${item.track}-${item.chunk}`);
    return { audio: `${base}.webm`, meta: `${base}.json` };
  }

  usedBytes() {
    let total = 0;
    for (const m of this.safeReaddir(this.dir)) {
      for (const f of this.safeReaddir(path.join(this.dir, m))) {
        try {
          total += this.fs.statSync(path.join(this.dir, m, f)).size;
        } catch {
          /* gone */
        }
      }
    }
    return total;
  }

  /**
   * Save a chunk (bytes required). Returns false when the spool is full.
   * @param {ChunkItem} item
   */
  write(item) {
    if (!item.bytes) return false;
    if (this.usedBytes() + item.bytes.byteLength > this.maxBytes) return false;
    const p = this.paths(item);
    this.fs.mkdirSync(path.dirname(p.audio), { recursive: true, mode: 0o700 });
    this.fs.writeFileSync(p.audio, item.bytes, { mode: 0o600 });
    const { bytes: _b, ...meta } = item;
    this.fs.writeFileSync(p.meta, JSON.stringify(meta), { mode: 0o600 });
    return true;
  }

  /** @param {ChunkItem} item @returns {Uint8Array | null} */
  read(item) {
    try {
      return new Uint8Array(this.fs.readFileSync(this.paths(item).audio));
    } catch {
      return null;
    }
  }

  /** @param {ChunkItem} item */
  remove(item) {
    const p = this.paths(item);
    this.fs.rmSync(p.audio, { force: true });
    this.fs.rmSync(p.meta, { force: true });
    const dir = path.dirname(p.audio);
    if (!this.safeReaddir(dir).length) this.fs.rmSync(dir, { recursive: true, force: true });
  }

  /** @param {string} meetingId */
  removeMeeting(meetingId) {
    if (!SAFE_ID.test(meetingId)) return;
    this.fs.rmSync(path.join(this.dir, meetingId), { recursive: true, force: true });
  }

  clear() {
    this.fs.rmSync(this.dir, { recursive: true, force: true });
  }

  /** Leftovers from an earlier run (without their bytes; `read` loads them). @returns {ChunkItem[]} */
  list() {
    const items = [];
    for (const m of this.safeReaddir(this.dir)) {
      if (!SAFE_ID.test(m)) continue;
      for (const f of this.safeReaddir(path.join(this.dir, m))) {
        if (!f.endsWith(".json")) continue;
        try {
          const meta = JSON.parse(this.fs.readFileSync(path.join(this.dir, m, f), "utf8"));
          if (meta.meetingId !== m) continue;
          items.push({ ...meta, bytes: null, spooled: true });
        } catch {
          /* half-written: ignore */
        }
      }
    }
    return items.sort((a, b) => a.chunk - b.chunk || a.track.localeCompare(b.track));
  }

  safeReaddir(dir) {
    try {
      return this.fs.readdirSync(dir);
    } catch {
      return [];
    }
  }
}
