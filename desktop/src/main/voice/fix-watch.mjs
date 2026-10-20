/**
 * Learning from a fix made right where the words were typed: right after voice typing pastes,
 * the text box it typed into is read for a little while (text-reader.mjs: macOS Accessibility,
 * Windows UI Automation), and when the owner corrects a word it got wrong ("pro zee" → "Prozzi"),
 * that word is learned (learn.mjs › learnFromFix decides what's worth it; the caller adds it to
 * the dictionary).
 *
 * What's read, and when:
 *  - only the box that was focused when the words were pasted, for at most two minutes, and only
 *    while the words typed can still be found in it (sent, cleared or rewritten: it stops);
 *  - never a password box (the readers refuse them), never a box longer than the readers allow;
 *  - the comparison happens here, on this computer; nothing read leaves it, and nothing read is
 *    logged. Only the word learned goes to the owner's dictionary.
 *
 * A fix is learned once it has held still for a few seconds (`settleMs`), so a word still being
 * typed ("Proz") isn't. When the owner moves on first (sends it, clears it, dictates again), the
 * newest fix counts if it held still a moment (`quickMs`). Each word is learned once a watch.
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
 * The typed words as they read now, or null when the text around them changed (sent, cleared,
 * rewritten): everything before them must be as it was, and so must everything after (words
 * typed right after them are part of what's returned; learnFromFix ignores added words).
 */
export function editedSpan(base, anchor, current) {
  const pre = base.slice(0, anchor.start);
  const post = base.slice(anchor.end);
  if (current.length < pre.length + post.length) return null;
  if (!current.startsWith(pre) || !current.endsWith(post)) return null;
  return current.slice(pre.length, current.length - post.length);
}

/** Reader errors worth another try right after pasting (the app may not have shown the words yet). */
const RETRY = new Set(["no-focus", "no-value", "not-found", "failed"]);
/** Reader errors worth another try while watching (an app busy for a moment). */
const HICCUP = new Set(["busy", "failed", "unreadable"]);
/** Ways a watch ends that mean the owner moved on: the newest fix counts if it held still a moment. */
const MOVED_ON = new Set(["next", "changed", "gone", "time"]);

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
    /** @type {any} */
    this.session = null;
    this.seq = 0;
    this.stats = { watched: 0, learned: 0, ended: /** @type {Record<string, number>} */ ({}) };
  }

  get watching() {
    return Boolean(this.session);
  }

  /** The typed words were found in the box, and it's being followed. */
  get found() {
    return Boolean(this.session?.anchor);
  }

  /**
   * The words were just pasted where the cursor was: watch that box for a fix.
   * @param {{ text: string, app?: string | null }} job
   */
  watch(job) {
    this.stop();
    if (!this.o.reader.supported || !this.o.enabled()) return;
    const typed = normalizeText(job.text).text.trim();
    // A word or two is too little to tell where it is; a page is more than anyone fixes this way.
    if (typed.length < 3 || typed.length > 4000) return;
    const s = {
      id: ++this.seq,
      typed,
      app: job.app ?? null,
      startedAt: this.now(),
      tries: 0,
      base: "",
      anchor: /** @type {{ start: number, end: number } | null} */ (null),
      /** The newest reading's fix (the words to learn, as JSON); when it first and last read so. */
      last: "[]",
      changedAt: this.now(),
      seenAt: this.now(),
      /** Words (and what it heard) learned in this watch, so each is learned once. */
      learned: new Set(),
      misses: 0,
      hiccups: 0,
      timer: null,
      ended: false,
    };
    this.session = s;
    this.stats.watched++;
    this.log(`learn: watching the box it typed into${s.app ? ` (${s.app})` : ""}`);
    this.later(s, this.limits.firstReadMs, () => this.capture(s));
  }

  /**
   * Stop watching: "next" when another dictation starts (the newest fix still counts if it held
   * still a moment); "off" when learning, voice typing or the pairing is turned off (nothing more
   * is learned).
   * @param {'next'|'off'} [why]
   */
  stop(why = "next") {
    if (this.session) this.end(this.session, why);
  }

  dispose() {
    this.stop("off");
  }

  later(s, ms, fn) {
    s.timer = this.setTimer(() => {
      s.timer = null;
      if (this.session === s) void fn().catch((err) => this.end(s, `error: ${String(err?.message ?? err).slice(0, 80)}`));
    }, ms);
  }

  /** Find the typed words in the box that has the focus. */
  async capture(s) {
    let r;
    try {
      r = await this.o.reader.focus();
    } catch {
      r = { ok: false, error: "failed" };
    }
    if (this.session !== s) return;
    if (!r?.ok) {
      const why = String(r?.error ?? "failed");
      if (RETRY.has(why) && ++s.tries < this.limits.tries) return this.later(s, this.limits.retryMs, () => this.capture(s));
      return this.end(s, why);
    }
    const base = normalizeText(r.value);
    const sel = r.selection;
    const caret = sel && Number.isFinite(sel.location) ? normalizedIndex(base.map, sel.location + (Number(sel.length) || 0)) : null;
    const anchor = findAnchor(base.text, s.typed, caret);
    if (!anchor) {
      if (++s.tries < this.limits.tries) return this.later(s, this.limits.retryMs, () => this.capture(s));
      return this.end(s, "not-found");
    }
    s.base = base.text;
    s.anchor = anchor;
    this.later(s, this.limits.pollMs, () => this.poll(s));
  }

  /** Read the box again: has a fix appeared, and has it settled? */
  async poll(s) {
    if (this.now() - s.startedAt >= this.limits.watchMs) return this.end(s, "time");
    let r;
    try {
      r = await this.o.reader.read();
    } catch {
      r = { ok: false, error: "failed" };
    }
    if (this.session !== s) return;
    if (!r?.ok) {
      const why = String(r?.error ?? "failed");
      if (HICCUP.has(why) && ++s.hiccups < this.limits.hiccups) return this.later(s, this.limits.pollMs, () => this.poll(s));
      return this.end(s, why);
    }
    s.hiccups = 0;
    const after = s.anchor ? editedSpan(s.base, s.anchor, normalizeText(r.value).text) : null;
    if (after === null) {
      // Sent, cleared or rewritten (twice in a row, so one odd reading doesn't end it).
      if (++s.misses >= this.limits.misses) return this.end(s, "changed");
      return this.later(s, this.limits.pollMs, () => this.poll(s));
    }
    s.misses = 0;
    // Only the typed words and a little after them matter; what's typed later is left out.
    const fix = JSON.stringify(learnFromFix(s.typed, after.slice(0, s.typed.length * 2 + 200)));
    const now = this.now();
    if (fix !== s.last) {
      s.last = fix;
      s.changedAt = now;
    } else if (now - s.changedAt >= this.limits.settleMs) this.learn(s);
    s.seenAt = now;
    this.later(s, this.limits.pollMs, () => this.poll(s));
  }

  /** Learn the newest fix's words that this watch hasn't learned yet (a word, or what it heard, once). */
  learn(s) {
    /** @type {Array<{ text: string, heard: string[] }>} */
    const words = JSON.parse(s.last).filter((/** @type {{ text: string, heard: string[] }} */ w) => {
      const keys = [`text:${w.text.toLowerCase()}`, ...w.heard.map((h) => `heard:${h.toLowerCase()}`)];
      if (keys.some((k) => s.learned.has(k))) return false;
      for (const k of keys) s.learned.add(k);
      return true;
    });
    if (!words.length) return;
    this.stats.learned += words.length;
    this.log(`learn: ${words.length} word${words.length === 1 ? "" : "s"} to learn`);
    try {
      this.o.onFix({ words, app: s.app });
    } catch (err) {
      this.log(`learn: couldn't learn (${String(/** @type {any} */ (err)?.message ?? err).slice(0, 80)})`);
    }
  }

  end(s, why) {
    if (s.ended) return;
    s.ended = true;
    if (s.timer) this.clearTimer(s.timer);
    s.timer = null;
    if (this.session === s) this.session = null;
    this.stats.ended[why] = (this.stats.ended[why] ?? 0) + 1;
    void Promise.resolve()
      .then(() => this.o.reader.forget())
      .catch(() => {});
    this.log(`learn: stopped watching (${why})`);
    // Sent, cleared or dictated again right after a fix: it counts if it held still a moment (a
    // word still being typed when the box changed teaches nothing).
    if (MOVED_ON.has(why) && s.seenAt - s.changedAt >= this.limits.quickMs) this.learn(s);
  }
}
