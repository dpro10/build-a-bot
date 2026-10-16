/**
 * Sends a meeting's pieces to the server, in order, two at a time. What a piece becomes is up to
 * `send`: the lines NVIDIA Parakeet heard in it on this computer (meeting-speech.mjs), or its audio.
 * A piece `ready` says isn't ready yet (Parakeet is still on its way) waits on disk, unread, in
 * its place in line; waiting doesn't count as a try.
 *
 *   200            → done (the transcript lines come back for live captions)
 *   network / 5xx / 429 / 503 "retry" → try again with backoff; the chunk waits in the
 *                    spool so a blip (or quitting) doesn't lose it. Re-sending the same
 *                    (track, chunk) is safe: the server answers duplicates from what it has.
 *   402 limit      → stop recording (minutes used up)
 *   409 not_recording, 403, 404 → stop (the meeting ended or moved elsewhere)
 *   401            → stop (this computer was unpaired)
 *   422 too_long   → stop (4-hour cap)
 *   413/415/other 4xx → drop just that chunk
 *
 * No Electron here: `send` is injected, so it can be tested with a fake server.
 */

/** @typedef {import('./spool.mjs').ChunkItem & { attempts?: number, nextAt?: number, spooled?: boolean, queuedAt?: number }} QueueItem */
/** @typedef {{ status: number, body: any }} SendResult */

export class UploadQueue {
  /**
   * @param {object} o
   * @param {(item: QueueItem) => Promise<SendResult>} o.send  throws on network errors
   * @param {(item: QueueItem) => boolean} [o.ready]  a piece is tried only when this says so; until then it waits (in the spool)
   * @param {import('./spool.mjs').Spool | null} [o.spool]
   * @param {(item: QueueItem, body: any) => void} [o.onUploaded]
   * @param {(reason: 'limit'|'not_recording'|'gone'|'unpaired'|'too_long', item: QueueItem, body: any) => void} [o.onStop]
   * @param {(msg: string) => void} [o.log]
   * @param {number} [o.concurrency]
   * @param {number} [o.baseDelayMs]
   * @param {number} [o.maxDelayMs]
   * @param {number} [o.waitMs]  how often a piece that isn't ready is asked again
   * @param {() => number} [o.now]
   * @param {() => number} [o.random]
   */
  constructor(o) {
    this.send = o.send;
    this.ready = o.ready ?? (() => true);
    this.spool = o.spool ?? null;
    this.onUploaded = o.onUploaded ?? (() => {});
    this.onStop = o.onStop ?? (() => {});
    this.log = o.log ?? (() => {});
    this.concurrency = o.concurrency ?? 2;
    this.baseDelayMs = o.baseDelayMs ?? 1000;
    this.maxDelayMs = o.maxDelayMs ?? 30_000;
    this.waitMs = o.waitMs ?? 2000;
    this.now = o.now ?? Date.now;
    this.random = o.random ?? Math.random;
    /** @type {QueueItem[]} */
    this.queue = [];
    /** @type {Set<QueueItem>} */
    this.inFlight = new Set();
    /** @type {Set<string>} meetings whose remaining chunks are thrown away */
    this.dropped = new Set();
    this.timer = null;
    this.waiters = [];
    this.disposed = false;
    this.stats = { uploaded: 0, retried: 0, dropped: 0 };
  }

  /** @param {QueueItem} item */
  push(item) {
    if (this.disposed || this.dropped.has(item.meetingId)) return;
    this.queue.push({ attempts: 0, nextAt: 0, queuedAt: this.now(), ...item });
    this.pump();
  }

  /** How many chunks are waiting (for one meeting, or all). */
  size(meetingId) {
    const all = [...this.queue, ...this.inFlight];
    return meetingId ? all.filter((i) => i.meetingId === meetingId).length : all.length;
  }

  /** How long a meeting's oldest piece has been waiting (0 when none is). */
  oldestAge(meetingId) {
    const times = [...this.queue, ...this.inFlight].filter((i) => i.meetingId === meetingId).map((i) => i.queuedAt ?? this.now());
    return times.length ? Math.max(0, this.now() - Math.min(...times)) : 0;
  }

  /** The meeting's pieces were thrown away (it was discarded, or the server stopped or lost it). */
  isDropped(meetingId) {
    return this.dropped.has(meetingId);
  }

  /** Throw away everything for a meeting (it was discarded, stopped by the server, or deleted). */
  drop(meetingId) {
    this.dropped.add(meetingId);
    const gone = this.queue.filter((i) => i.meetingId === meetingId);
    this.queue = this.queue.filter((i) => i.meetingId !== meetingId);
    this.stats.dropped += gone.length;
    try {
      this.spool?.removeMeeting(meetingId);
    } catch {
      /* best effort */
    }
    this.settle();
  }

  /** Throw away everything queued, for every meeting (this computer was unpaired). */
  dropAll() {
    for (const meetingId of new Set([...this.queue, ...this.inFlight].map((i) => i.meetingId))) this.drop(meetingId);
  }

  /** Let a meeting id be used again (only tests need this). */
  undrop(meetingId) {
    this.dropped.delete(meetingId);
  }

  /**
   * Wait until a meeting's chunks (or all) are uploaded, or `timeoutMs` passes.
   * @returns {Promise<{ ok: boolean, left: number }>}
   */
  drain(meetingId, timeoutMs = 90_000) {
    if (this.size(meetingId) === 0) return Promise.resolve({ ok: true, left: 0 });
    // Retry waiting chunks right away: the owner is waiting for their notes.
    for (const i of this.queue) if (!meetingId || i.meetingId === meetingId) i.nextAt = Math.min(i.nextAt ?? 0, this.now());
    this.pump();
    return new Promise((resolve) => {
      const w = { meetingId, resolve, timer: null };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve({ ok: false, left: this.size(meetingId) });
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  /** On quit: write chunks that are only in memory to the spool so they're sent next time. */
  persist() {
    if (!this.spool) return 0;
    let n = 0;
    for (const i of [...this.queue, ...this.inFlight]) {
      if (i.spooled || !i.bytes || this.dropped.has(i.meetingId)) continue;
      try {
        if (this.spool.write(i)) {
          i.spooled = true;
          n++;
        }
      } catch {
        /* disk full or similar */
      }
    }
    return n;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  pump() {
    if (this.disposed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = this.now();
    while (this.inFlight.size < this.concurrency) {
      const idx = this.queue.findIndex((i) => (i.nextAt ?? 0) <= now);
      if (idx < 0) break;
      const [item] = this.queue.splice(idx, 1);
      this.inFlight.add(item);
      void this.attempt(item);
    }
    if (this.queue.length && this.inFlight.size < this.concurrency) {
      const next = Math.min(...this.queue.map((i) => i.nextAt ?? 0));
      this.timer = setTimeout(() => this.pump(), Math.max(10, next - now));
    }
    this.settle();
  }

  /** @param {QueueItem} item */
  async attempt(item) {
    let ready = true;
    try {
      ready = this.ready(item);
    } catch (err) {
      this.log(`upload: ready() threw ${err}`);
    }
    if (!ready) {
      // Not yet (e.g. NVIDIA Parakeet is still downloading): it waits on disk and is asked again.
      this.wait(item);
      return;
    }
    if (!item.bytes && item.spooled && this.spool) item.bytes = this.spool.read(item);
    if (!item.bytes) {
      this.log(`upload: ${item.track} #${item.chunk} has no audio left; skipping`);
      this.finish(item, "drop");
      return;
    }
    /** @type {SendResult | null} */
    let res = null;
    try {
      res = await this.send(item);
    } catch (err) {
      this.log(`upload: ${item.track} #${item.chunk} network error: ${/** @type {any} */ (err)?.message ?? err}`);
    }
    if (this.dropped.has(item.meetingId)) {
      this.finish(item, "drop");
      return;
    }
    const status = res?.status ?? 0;
    const code = res?.body?.code;
    if (status >= 200 && status < 300) {
      this.stats.uploaded++;
      this.finish(item, "done");
      try {
        this.onUploaded(item, res?.body);
      } catch (err) {
        this.log(`upload: onUploaded threw ${err}`);
      }
      return;
    }
    if (status === 0 || status === 429 || status >= 500 || code === "retry") {
      this.retry(item);
      return;
    }
    /** @type {'limit'|'not_recording'|'gone'|'unpaired'|'too_long'|null} */
    let stop = null;
    if (status === 402) stop = "limit";
    else if (status === 409) stop = "not_recording";
    else if (status === 401) stop = "unpaired";
    else if (status === 403 || status === 404) stop = "gone";
    else if (status === 422 && code === "too_long") stop = "too_long";
    if (stop) {
      this.log(`upload: server said ${status} ${code ?? ""}; stopping`);
      this.inFlight.delete(item);
      if (stop === "unpaired") for (const m of new Set([...this.queue, item].map((i) => i.meetingId))) this.drop(m);
      else this.drop(item.meetingId);
      try {
        this.onStop(stop, item, res?.body);
      } catch (err) {
        this.log(`upload: onStop threw ${err}`);
      }
      this.pump();
      return;
    }
    this.log(`upload: ${item.track} #${item.chunk} refused (${status}); dropping it`);
    this.stats.dropped++;
    this.finish(item, "drop");
  }

  /** @param {QueueItem} item */
  retry(item) {
    this.inFlight.delete(item);
    item.attempts = (item.attempts ?? 0) + 1;
    this.stats.retried++;
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.min(item.attempts - 1, 10));
    item.nextAt = this.now() + Math.round(exp * (0.75 + this.random() * 0.5));
    this.toDisk(item);
    // Retried chunks go back to the front (the server places lines by time, so order is a nicety).
    this.queue.unshift(item);
    this.pump();
  }

  /**
   * Not ready to be sent yet: asked again in a moment. It isn't a failed try (so it doesn't use up
   * the tries an engine gets later), and it keeps its place in line, so the pieces are heard in order.
   * @param {QueueItem} item
   */
  wait(item) {
    this.inFlight.delete(item);
    item.nextAt = this.now() + this.waitMs;
    this.toDisk(item);
    const at = this.queue.findIndex((i) => (i.queuedAt ?? 0) > (item.queuedAt ?? 0));
    if (at < 0) this.queue.push(item);
    else this.queue.splice(at, 0, item);
    this.pump();
  }

  /** Wait on disk, not in memory. @param {QueueItem} item */
  toDisk(item) {
    if (item.spooled || !this.spool || !item.bytes) return;
    try {
      item.spooled = this.spool.write(item);
      if (item.spooled) item.bytes = null;
    } catch (err) {
      this.log(`upload: couldn't spool: ${err}`);
    }
  }

  /** @param {QueueItem} item @param {'done'|'drop'} _how */
  finish(item, _how) {
    this.inFlight.delete(item);
    if (item.spooled && this.spool) {
      try {
        this.spool.remove(item);
      } catch {
        /* best effort */
      }
    }
    item.bytes = null;
    this.pump();
  }

  settle() {
    if (!this.waiters.length) return;
    for (const w of [...this.waiters]) {
      if (this.size(w.meetingId) === 0) {
        clearTimeout(w.timer);
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve({ ok: true, left: 0 });
      }
    }
  }
}
