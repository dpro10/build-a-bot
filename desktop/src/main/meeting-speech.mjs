/**
 * Meeting notes heard on this computer. Each piece of a call the capture page records (about 20
 * seconds of one track, webm/opus) becomes 16 kHz WAV (decoder-window.mjs), NVIDIA Parakeet hears it
 * with each word's time (voice/local-speech.mjs), and only the lines are sent: the audio never
 * leaves the computer.
 *
 *   a piece ─ silent ──────────────────────────▶ just its time (no audio, nothing to hear)
 *           ─ Parakeet hears here ─▶ WAV ─▶ timed words ─▶ lines ─▶ POST { heard: [...] }
 *           ─ it can't run here, and the server hears audio ──▶ the audio, as before
 *           ─ it's on its way (downloading) ──▶ wait: the upload queue keeps the piece (on disk)
 *             and tries again; the controller keeps the meeting alive on the server meanwhile
 *           ─ nothing ever can (Parakeet can't run here, and the server doesn't hear audio) ──▶ just
 *             its time, so the meeting moves on (the controller stops the notes and says why)
 *
 * No Electron here, so it can be tested with fakes.
 */
import { tidyLocalText } from "./voice/local-speech.mjs";

/** A pause this long between two words starts a new line. */
export const LINE_PAUSE_MS = 1200;
/** A line ends at a sentence's end once it has this many words, and never runs longer than the cap. */
const LINE_MIN_WORDS = 6;
const LINE_MAX_WORDS = 60;

/**
 * NVIDIA Parakeet's timed words → transcript lines: a new line after a pause, or where a sentence
 * ends once the line has a few words, so lines read like turns in the conversation.
 * @param {Array<{ word: string, start: number, end: number }>} words  times in seconds, within the piece
 * @param {{ durationMs: number, text?: string }} o  the piece's length; `text` is used when there are no word times
 * @returns {Array<{ startMs: number, endMs: number, text: string }>}
 */
export function linesFromWords(words, o) {
  const lines = [];
  const clamp = (ms) => Math.min(Math.max(0, Math.round(ms)), o.durationMs);
  /** @type {{ startMs: number, endMs: number, words: string[] } | null} */
  let cur = null;
  const flush = () => {
    if (cur?.words.length) lines.push({ startMs: cur.startMs, endMs: cur.endMs, text: tidyLocalText(cur.words.join(" ")) });
    cur = null;
  };
  for (const w of words ?? []) {
    const word = String(w?.word ?? "").trim();
    if (!word || !Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    const startMs = clamp(w.start * 1000);
    const endMs = Math.max(startMs, clamp(w.end * 1000));
    if (cur && (startMs - cur.endMs >= LINE_PAUSE_MS || cur.words.length >= LINE_MAX_WORDS)) flush();
    cur ??= { startMs, endMs, words: [] };
    cur.words.push(word);
    cur.endMs = Math.max(cur.endMs, endMs);
    if (/[.!?…]["'”’)\]]*$/.test(word) && cur.words.length >= LINE_MIN_WORDS) flush();
  }
  flush();
  // No word times (an engine that doesn't give them): the whole piece is one line.
  const text = tidyLocalText(o.text ?? "");
  if (!lines.length && text) lines.push({ startMs: 0, endMs: o.durationMs, text });
  return lines.filter((l) => l.text);
}

/**
 * How the next piece of a meeting is heard:
 *  - "local": NVIDIA Parakeet, on this computer (only the lines are sent);
 *  - "server": the server's speech-to-text (the audio is sent), when Parakeet can't run here;
 *  - "wait": Parakeet is on its way, or nothing can hear it right now: the piece waits;
 *  - "none": nothing ever will (Parakeet can't run on this computer, and the server doesn't hear
 *    audio): only the piece's time is sent, never its audio, so the pieces don't pile up.
 * @typedef {'local'|'server'|'wait'|'none'} HearingWay
 */

/**
 * The upload queue's `send` and `ready` for a meeting's pieces.
 * @param {object} o
 * @param {{ uploadChunk(item: any): Promise<{ status: number, body: any }>, uploadChunkText(item: any, lines: any[]): Promise<{ status: number, body: any }> }} o.api
 * @param {() => HearingWay} o.way
 * @param {() => boolean} o.takesText  the server takes lines heard on the computer
 * @param {(bytes: Uint8Array, mime: string) => Promise<Uint8Array>} o.toWav  16 kHz mono WAV
 * @param {(wav: Uint8Array, o: { durationMs: number }) => Promise<{ text: string, words: Array<{ word: string, start: number, end: number }> }>} o.hear
 * @param {(m: string) => void} [o.log]
 * @param {number} [o.maxEngineTries]  an engine that keeps refusing one piece: it's marked as nothing heard after this many tries
 */
export function meetingSender(o) {
  const log = o.log ?? (() => {});
  const maxEngineTries = o.maxEngineTries ?? 4;
  /** How pieces went (no words, ever): as the lines heard here, as audio, as just their time, or unheard. */
  const stats = { lines: 0, audio: 0, silent: 0, waited: 0, unheard: 0 };

  /** Can this piece be sent now? (A piece waiting for Parakeet stays on disk; its audio isn't read.) */
  function ready(item) {
    if (item.silent && o.takesText()) return true;
    return o.way() !== "wait";
  }

  /** @returns {Promise<{ status: number, body: any }>} */
  async function send(item) {
    // Nothing worth hearing: the server only needs its time (no audio leaves the computer).
    if (item.silent && o.takesText()) {
      stats.silent++;
      return o.api.uploadChunkText(item, []);
    }
    const way = o.way();
    if (way === "server") {
      stats.audio++;
      return o.api.uploadChunk(item);
    }
    // Nothing can ever hear it: only its time goes (never the audio), and it's off the computer's disk.
    if (way === "none" && o.takesText()) {
      stats.unheard++;
      return o.api.uploadChunkText(item, []);
    }
    if (way !== "local") {
      stats.waited++;
      return { status: 503, body: { code: "retry", waiting: true } };
    }
    let wav;
    try {
      wav = await o.toWav(item.bytes, item.mime);
    } catch (err) {
      // Audio it can't read (cut off by a crash): nothing heard there, and the meeting goes on.
      log(`meeting: couldn't read ${item.track} #${item.chunk} (${/** @type {any} */ (err)?.message ?? err}); marking it as nothing heard`);
      return o.api.uploadChunkText(item, []);
    }
    let heard;
    try {
      heard = await o.hear(wav, { durationMs: item.durationMs });
    } catch (err) {
      const e = /** @type {any} */ (err);
      // The engine answered but wouldn't take this piece, again and again: move on without it.
      if (e?.code === "engine" && (item.attempts ?? 0) + 1 >= maxEngineTries) {
        log(`meeting: Parakeet keeps refusing ${item.track} #${item.chunk}; marking it as nothing heard`);
        return o.api.uploadChunkText(item, []);
      }
      // Still starting, stopped, busy: the queue tries again in a moment.
      log(`meeting: Parakeet couldn't hear ${item.track} #${item.chunk} yet (${e?.code ?? e?.message ?? e})`);
      return { status: 503, body: { code: "retry", local: e?.code ?? "error" } };
    }
    stats.lines++;
    return o.api.uploadChunkText(item, linesFromWords(heard.words, { durationMs: item.durationMs, text: heard.text }));
  }

  return { send, ready, stats };
}
