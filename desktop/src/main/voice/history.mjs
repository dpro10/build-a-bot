/**
 * What was typed by voice, kept on this computer only (the server keeps a word count, never the
 * words), so the owner can copy something again, fix a word and teach it to the dictionary.
 *
 *  - Encrypted with the system keychain (Electron safeStorage), like the device token. With no
 *    keychain, it's kept only until the app quits.
 *  - The last 100 dictations, none older than 30 days. Off in settings means nothing is kept.
 *
 * Stats are only numbers (words per day, time spoken), kept in settings.json.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { readJson, writeJson } from "../store.mjs";

export const MAX_ENTRIES = 100;
export const MAX_AGE_MS = 30 * 24 * 3600_000;

/**
 * kind: 'text' typed by voice; 'command' asked a bot ("Hey Otto, …"); 'edit' a selection changed
 * or text written by voice (`instruction` is what they said; `answer` when it answered instead).
 * @typedef {{ id: string, at: number, kind: 'text' | 'command' | 'edit', text: string, heard?: string, app?: string | null, words?: number, polished?: boolean, pasted?: boolean, bot?: string, reply?: string, instruction?: string, answer?: boolean }} HistoryEntry
 */

export class VoiceHistory {
  /**
   * @param {{ file: string, safeStorage: import('../store.mjs').SafeStorageLike, secure: () => boolean, now?: () => number }} o
   */
  constructor(o) {
    this.o = o;
    this.now = o.now ?? (() => Date.now());
    /** @type {HistoryEntry[]} newest first */
    this.entries = [];
    this.loaded = false;
  }

  load() {
    this.loaded = true;
    this.entries = [];
    const saved = readJson(this.o.file);
    if (!saved || saved.v !== 1 || typeof saved.data !== "string") return;
    try {
      const json = this.o.safeStorage.decryptString(Buffer.from(saved.data, "base64"));
      const list = JSON.parse(json);
      if (Array.isArray(list)) this.entries = list.filter((e) => e && typeof e.id === "string" && typeof e.text === "string");
    } catch {
      this.entries = []; // keychain changed: start over
    }
    this.prune();
  }

  save() {
    if (!this.o.secure()) {
      // No keychain: keep it in memory only, never in plain text on disk.
      this.clearFile();
      return;
    }
    try {
      const data = this.o.safeStorage.encryptString(JSON.stringify(this.entries)).toString("base64");
      writeJson(this.o.file, { v: 1, data });
    } catch {
      /* read-only disk: keep going in memory */
    }
  }

  prune() {
    const cutoff = this.now() - MAX_AGE_MS;
    this.entries = this.entries.filter((e) => e.at >= cutoff).slice(0, MAX_ENTRIES);
  }

  /** @returns {HistoryEntry[]} */
  list() {
    if (!this.loaded) this.load();
    this.prune();
    return this.entries;
  }

  /** @param {Omit<HistoryEntry, 'id' | 'at'> & { at?: number }} entry */
  add(entry) {
    if (!this.loaded) this.load();
    const e = { id: randomUUID(), at: this.now(), ...entry };
    this.entries.unshift(e);
    this.prune();
    this.save();
    return e;
  }

  get(id) {
    return this.list().find((e) => e.id === id) ?? null;
  }

  /** @param {string} id @param {Partial<HistoryEntry>} patch */
  update(id, patch) {
    const e = this.get(id);
    if (!e) return null;
    Object.assign(e, patch);
    this.save();
    return e;
  }

  remove(id) {
    const before = this.list().length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) this.save();
  }

  clear() {
    this.entries = [];
    this.loaded = true;
    this.clearFile();
  }

  /** The newest thing that was typed (for "Paste last dictation"). */
  lastText() {
    return this.list().find((e) => e.kind === "text" || (e.kind === "edit" && !e.answer)) ?? null;
  }

  clearFile() {
    try {
      fs.rmSync(this.o.file, { force: true });
    } catch {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------------------
// Stats: numbers only
// ---------------------------------------------------------------------------

/** @typedef {{ days: Record<string, number>, total: number, dictations: number, spokenMs: number }} VoiceStats */

export const EMPTY_STATS = Object.freeze({ days: {}, total: 0, dictations: 0, spokenMs: 0 });

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * @param {VoiceStats | null | undefined} stats
 * @param {{ words: number, spokenMs: number, at: number }} d
 * @returns {VoiceStats}
 */
export function addToStats(stats, d) {
  const s = { ...EMPTY_STATS, ...(stats ?? {}) };
  const days = { ...(s.days ?? {}) };
  const key = dayKey(d.at);
  days[key] = (days[key] ?? 0) + Math.max(0, d.words);
  // Keep about two months of days.
  const keys = Object.keys(days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 62))) delete days[k];
  return { days, total: s.total + Math.max(0, d.words), dictations: s.dictations + 1, spokenMs: s.spokenMs + Math.max(0, d.spokenMs) };
}

/** Words typed by voice in the last 7 days (today included). */
export function wordsThisWeek(stats, now = Date.now()) {
  let n = 0;
  for (let i = 0; i < 7; i++) n += stats?.days?.[dayKey(now - i * 86_400_000)] ?? 0;
  return n;
}

/**
 * Minutes saved compared with typing at 40 words a minute (an average typist), less the time
 * spent talking. Never below zero.
 */
export function minutesSaved(words, spokenMs) {
  return Math.max(0, Math.round(words / 40 - spokenMs / 60_000));
}

/** Speaking speed, in words a minute, for the stats (null until there's enough to say). */
export function wordsPerMinute(stats) {
  if (!stats || stats.spokenMs < 60_000) return null;
  return Math.round(stats.total / (stats.spokenMs / 60_000));
}
