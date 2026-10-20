/**
 * Learning from a fix made right where the words were typed: right after voice typing pastes,
 * the text box it typed into is read for a little while (text-reader.mjs: macOS Accessibility,
 * Windows UI Automation), and when the owner corrects a word it got wrong ("pro zee" → "Prozzi"),
 * that word is learned (learn.mjs › learnFromFix decides what's worth it; the caller adds it to
 * the dictionary).
 *
 * What's read, and when:
 *  - only the box the last dictation was typed into, for at most two minutes after each
 *    dictation, and only while its words can be followed there (sent, cleared, rewritten, or
 *    another box: it stops);
 *  - never a password box (the readers refuse them), never a box longer than the readers allow;
 *  - the comparison happens here, on this computer; nothing read leaves it, and nothing read is
 *    logged. Only the word learned goes to the owner's dictionary.
 *
 * Following the words: each reading is compared with the one before (a third of a second apart,
 * so what changed is one stretch of text). The words move with text added or taken away before
 * them, grow or shrink with a change inside them (a fix), and stay put for changes after them.
 * Text typed right at their end, or right against their start, is theirs (a word retyped after
 * deleting it); a change across their edge, or over all of them, ends it. So another dictation
 * into the same box, or a greeting typed above, doesn't stop it, and each of the last three
 * dictations is followed on its own.
 *
 * A fix is learned once it has held still for a few seconds (`settleMs`), so a word still being
 * typed ("Proz") isn't. When the owner moves on first (sends it, clears it, dictates into another
 * box), the newest fix counts if it held still a moment (`quickMs`). A word is learned once.
 * The pure parts are exported for tests.
 */
import { learnFromFix } from "./learn.mjs";

const ZERO_WIDTH = /[​-‍⁠﻿]/;

/**
 * The same text however an app stores it: "\r\n" and "\r" as "\n", no zero-width characters,
 * non-breaking spaces as spaces, curly quotes straight. `map[i]` is where normalized character i
 * came from (and `map[text.length]` the original length), for the caret.
 * @param {string} s
 * @returns {{ text: string, map: number[] }}
 */
export function normalizeText(s) {
  const src = String(s ?? "");
  let text = "";
  const map = [];
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (ch === "\r") {
      if (src[i + 1] === "\n") continue;
      ch = "\n";
    } else if (ZERO_WIDTH.test(ch)) continue;
    else if (ch === " " || ch === " " || ch === " ") ch = " ";
    else if (ch === "‘" || ch === "’") ch = "'";
    else if (ch === "“" || ch === "”") ch = '"';
    map.push(i);
    text += ch;
  }
  map.push(src.length);
  return { text, map };
}

/** An index in the original text (the caret) as an index in the normalized one. */
export function normalizedIndex(map, index) {
  if (!Number.isFinite(index) || index < 0) return null;
  for (let k = 0; k < map.length; k++) if (map[k] >= index) return k;
  return map.length - 1;
}

/**
 * Where the typed words are in the box: the last place they end at or before the caret (pasting
 * leaves the caret right after them), else the last place they are.
 * @returns {{ start: number, end: number } | null}
 */
export function findAnchor(value, typed, caret = null) {
  if (!typed) return null;
  const hits = [];
  for (let i = value.indexOf(typed); i >= 0 && hits.length < 50; i = value.indexOf(typed, i + 1)) hits.push(i);
  if (!hits.length) return null;
  let start = hits[hits.length - 1];
  if (caret != null) {
    const before = hits.filter((h) => h + typed.length <= caret);
    if (before.length) start = before[before.length - 1];
  }
  return { start, end: start + typed.length };
}

/**
 * The one stretch that differs between two readings: [start, before) of the old one became
 * [start, after) of the new one (all three equal when nothing changed).
 * @param {string} prev
 * @param {string} cur
 */
export function changedRange(prev, cur) {
  const min = Math.min(prev.length, cur.length);
  let start = 0;
  while (start < min && prev.charCodeAt(start) === cur.charCodeAt(start)) start++;
  let before = prev.length;
  let after = cur.length;
  while (before > start && after > start && prev.charCodeAt(before - 1) === cur.charCodeAt(after - 1)) {
    before--;
    after--;
  }
  return { start, before, after };
}

const SPACE = /\s/;

/**
 * Where the typed words are after one change (changedRange), or null when it took them away: all
 * of them, or across their edge (rewritten, sent, cleared). `added` is the text the change put in.
 * @param {{ start: number, end: number }} anchor
 * @param {{ start: number, before: number, after: number }} change
 * @param {string} [added]
 * @returns {{ start: number, end: number } | null}
 */
export function moveAnchor(anchor, change, added = "") {
  const { start, before, after } = change;
  const delta = after - before;
  if (start === before) {
    if (start === after) return anchor;
    // Text added: before them, after them, or theirs (inside; typed at their end; or typed right
    // against their start, a word retyped there).
    const glued = start === anchor.start && !SPACE.test(added.slice(-1));
    if (start < anchor.start || (start === anchor.start && !glued && anchor.end > anchor.start)) return { start: anchor.start + delta, end: anchor.end + delta };
    if (start > anchor.end) return anchor;
    return { start: anchor.start, end: anchor.end + delta };
  }
  if (before <= anchor.start) return { start: anchor.start + delta, end: anchor.end + delta };
  if (start >= anchor.end) return anchor;
  if (start >= anchor.start && before <= anchor.end) {
    const end = anchor.end + delta;
    return end > anchor.start ? { start: anchor.start, end } : null;
  }
  return null;
}

/** Reader errors worth another try right after pasting (the app may not have shown the words yet). */
const RETRY = new Set(["no-focus", "no-value", "not-found", "failed"]);
/** Reader errors worth another try while watching (an app busy for a moment). */
const HICCUP = new Set(["busy", "failed", "unreadable"]);
/** Ways a watch ends that mean the owner moved on: the newest fix counts if it held still a moment. */
const MOVED_ON = new Set(["next", "changed", "gone", "time"]);
/** Dictations followed at once (the newest). */
const MAX_WATCHES = 3;

export class FixWatcher {
  /**
   * @param {object} o
   * @param {{ supported: boolean, focus(): Promise<any>, read(): Promise<any>, forget(): Promise<any> }} o.reader
   * @param {() => boolean} o.enabled  voice typing on, "Learn from my fixes" on, paired
   * @param {(fix: { words: Array<{ text: string, heard: string[] }>, app: string | null }) => void} o.onFix
   * @param {(m: string) => void} [o.log]
   * @param {() => number} [o.now]
   * @param {(fn: () => void, ms: number) => any} [o.setTimer]
   * @param {(t: any) => void} [o.clearTimer]
   * @param {{ firstReadMs?: number, retryMs?: number, tries?: number, pollMs?: number, settleMs?: number, quickMs?: number, watchMs?: number, misses?: number, hiccups?: number }} [o.limits]
   */
  constructor(o) {
    this.o = o;
    this.log = o.log ?? (() => {});
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((t) => clearTimeout(t));
    this.limits = { firstReadMs: 250, retryMs: 300, tries: 6, pollMs: 300, settleMs: 3000, quickMs: 600, watchMs: 120_000, misses: 2, hiccups: 3, ...(o.limits ?? {}) };
    /** The dictations being watched, oldest first. @type {any[]} */
    this.watches = [];
    /** The reading loop's timer, and whether a reading is under way. */
    this.timer = null;
    this.reading = false;
    this.hiccups = 0;
    /** Words learned lately (by what was written and what it heard), so each is learned once. */
    this.recent = new Map();
    this.seq = 0;
    this.stats = { watched: 0, learned: 0, ended: /** @type {Record<string, number>} */ ({}) };
  }

  get watching() {
    return this.watches.length > 0;
  }

  /** The newest dictation's words were found in the box, and it's being followed. */
  get found() {
    return Boolean(this.watches[this.watches.length - 1]?.anchor);
  }

  /**
   * The words were just pasted where the cursor was: watch that box for a fix.
   * @param {{ text: string, app?: string | null }} job
   */
  watch(job) {
    if (!this.o.reader.supported || !this.o.enabled()) return this.stop("off");
    const typed = normalizeText(job.text).text.trim();
    // A word or two is too little to tell where it is; a page is more than anyone fixes this way.
    if (typed.length < 3 || typed.length > 4000) return;
    while (this.watches.length >= MAX_WATCHES) this.end(this.watches[0], "next");
    const w = {
      id: ++this.seq,
      typed,
      app: job.app ?? null,
      startedAt: this.now(),
      tries: 0,
      /** The box as last read, and where the words are in it (once found). */
      prev: "",
      anchor: /** @type {{ start: number, end: number } | null} */ (null),
      /** The newest reading's fix (the words to learn, as JSON); when it first and last read so. */
      last: "[]",
      changedAt: this.now(),
      seenAt: this.now(),
      misses: 0,
      timer: null,
      ended: false,
    };
    this.watches.push(w);
    this.stats.watched++;
    this.log(`learn: watching the box it typed into${w.app ? ` (${w.app})` : ""}`);
    this.later(w, this.limits.firstReadMs);
  }

  /**
   * Stop watching: "off" when learning, voice typing or the pairing is turned off, the screen
   * locks, or the app quits (nothing more is learned).
   * @param {'off'|'next'} [why]
   */
  stop(why = "off") {
    for (const w of [...this.watches]) this.end(w, why);
  }

  dispose() {
    this.stop("off");
  }

  /** Look for this dictation's words in the focused box in a moment. */
  later(w, ms) {
    w.timer = this.setTimer(() => {
      w.timer = null;
      if (!w.ended) void this.capture(w).catch((err) => this.end(w, `error: ${String(err?.message ?? err).slice(0, 80)}`));
    }, ms);
  }

  /** Find the typed words in the box that has the focus (it's the box the others follow too). */
  async capture(w) {
    let r;
    try {
      r = await this.o.reader.focus();
    } catch {
      r = { ok: false, error: "failed" };
    }
    if (w.ended) return;
    if (!r?.ok) {
      const why = String(r?.error ?? "failed");
      if (RETRY.has(why) && ++w.tries < this.limits.tries) return this.later(w, this.limits.retryMs);
      return this.end(w, why);
    }
    const base = normalizeText(r.value);
    const sel = r.selection;
    const caret = sel && Number.isFinite(sel.location) ? normalizedIndex(base.map, sel.location + (Number(sel.length) || 0)) : null;
    const anchor = findAnchor(base.text, w.typed, caret);
    if (!anchor) {
      if (++w.tries < this.limits.tries) return this.later(w, this.limits.retryMs);
      return this.end(w, "not-found");
    }
    w.prev = base.text;
    w.anchor = anchor;
    this.loop();
  }

  /** Read the box again in a moment (one reading for all the dictations followed). */
  loop() {
    if (this.timer || this.reading) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.poll().catch((err) => {
        for (const w of [...this.watches]) if (w.anchor) this.end(w, `error: ${String(err?.message ?? err).slice(0, 80)}`);
      });
    }, this.limits.pollMs);
  }

  /** Read the box: has a fix appeared, and has it settled? */
  async poll() {
    for (const w of this.watches.filter((x) => x.anchor)) if (this.now() - w.startedAt >= this.limits.watchMs) this.end(w, "time");
    if (!this.watches.some((x) => x.anchor)) return;
    let r;
    this.reading = true;
    try {
      r = await this.o.reader.read();
    } catch {
      r = { ok: false, error: "failed" };
    } finally {
      this.reading = false;
    }
    const live = this.watches.filter((x) => x.anchor && !x.ended);
    if (!live.length) return;
    if (!r?.ok) {
      const why = String(r?.error ?? "failed");
      if (HICCUP.has(why) && ++this.hiccups < this.limits.hiccups) return this.loop();
      for (const w of live) this.end(w, why);
      return;
    }
    this.hiccups = 0;
    const cur = normalizeText(r.value).text;
    for (const w of live) this.follow(w, cur);
    if (this.watches.some((x) => x.anchor)) this.loop();
  }

  /** One reading, for one dictation: where its words are now, and what fix they show. */
  follow(w, cur) {
    const change = changedRange(w.prev, cur);
    const moved = moveAnchor(w.anchor, change, cur.slice(change.start, change.after));
    if (!moved) {
      // Sent, cleared, rewritten or another box (twice in a row, so one odd reading doesn't end
      // it: the next is compared with the last good one).
      if (++w.misses >= this.limits.misses) this.end(w, "changed");
      return;
    }
    w.misses = 0;
    w.prev = cur;
    w.anchor = moved;
    // Only the typed words and a little after them matter; what's typed later is left out.
    const fix = JSON.stringify(learnFromFix(w.typed, cur.slice(moved.start, Math.min(moved.end, moved.start + w.typed.length * 2 + 200))));
    const now = this.now();
    if (fix !== w.last) {
      w.last = fix;
      w.changedAt = now;
    } else if (now - w.changedAt >= this.limits.settleMs) this.learn(w);
    w.seenAt = now;
  }

  /** Learn the newest fix's words that weren't learned lately (a word, or what it heard, once). */
  learn(w) {
    const now = this.now();
    for (const [k, at] of this.recent) if (now - at > 30 * 60_000) this.recent.delete(k);
    /** @type {Array<{ text: string, heard: string[] }>} */
    const words = JSON.parse(w.last).filter((/** @type {{ text: string, heard: string[] }} */ x) => {
      const keys = [`text:${x.text.toLowerCase()}`, ...x.heard.map((h) => `heard:${h.toLowerCase()}`)];
      if (keys.some((k) => this.recent.has(k))) return false;
      for (const k of keys) this.recent.set(k, now);
      return true;
    });
    if (!words.length) return;
    this.stats.learned += words.length;
    this.log(`learn: ${words.length} word${words.length === 1 ? "" : "s"} to learn`);
    try {
      this.o.onFix({ words, app: w.app });
    } catch (err) {
      this.log(`learn: couldn't learn (${String(/** @type {any} */ (err)?.message ?? err).slice(0, 80)})`);
    }
  }

  end(w, why) {
    if (w.ended) return;
    w.ended = true;
    if (w.timer) this.clearTimer(w.timer);
    w.timer = null;
    this.watches = this.watches.filter((x) => x !== w);
    this.stats.ended[why] = (this.stats.ended[why] ?? 0) + 1;
    this.log(`learn: stopped watching (${why})`);
    // Sent, cleared or dictated past right after a fix: it counts if it held still a moment (a
    // word still being typed when the box changed teaches nothing).
    if (MOVED_ON.has(why) && w.anchor && w.seenAt - w.changedAt >= this.limits.quickMs) this.learn(w);
    if (!this.watches.length) {
      if (this.timer) this.clearTimer(this.timer);
      this.timer = null;
      void Promise.resolve()
        .then(() => this.o.reader.forget())
        .catch(() => {});
    }
  }
}
