/**
 * Spacing a dictation against what's next to the cursor, so words don't run together: a space
 * before it when it's typed right after a word or a sentence's end ("…at the lab." + "Bring the
 * slides." → "…at the lab. Bring the slides."), and one after it when it's typed right before a
 * word. None at the start of a box or a line, after a space, an opening bracket or quote, or "@",
 * "#", "/", "-" and the like; none before punctuation; none next to Chinese, Japanese or Thai,
 * which don't put spaces between words.
 *
 * `around` is what's right before the cursor (a few characters) and right after it, or around the
 * selection the words replace: read from the box (text-reader.mjs › around), or, when the box
 * can't be read, remembered from the last dictation (paste.mjs). Null when nothing is known: the
 * words go in as they are.
 */

const ZERO_WIDTH = /[​-‍⁠﻿]/gu;
/** Ends a word: letters, digits, accents, emoji, or an object in the text (a mention, an image). */
const WORDY = /[\p{L}\p{N}\p{M}\p{Extended_Pictographic}￼]/u;
/** Closes a sentence, a clause or a quote: a space goes after it, never before it. */
const CLOSERS = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", "”", "’", "»", "›", "…", "%", "‰"]);
/** Opens a bracket or a quote. */
const OPENERS = new Set(["(", "[", "{", "“", "‘", "«", "‹", "„", "‚", "¿", "¡"]);
/** Scripts written without spaces between words, and their punctuation. */
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}　-〿＀-￯]/u;
const SPACE = /\s/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** The characters of `s` (whole emoji, not halves), without zero-width ones. */
const chars = (s) => Array.from(String(s ?? "").replace(ZERO_WIDTH, ""));

/**
 * A word or a sentence ends with `ch`. A straight quote ends one when it closes a quote (`"hi"`,
 * `students'`), not when it opens one (after a space, an opening bracket, or nothing).
 * @param {string | undefined} ch @param {string | undefined} prev  the character before it
 */
function endsWord(ch, prev) {
  if (!ch) return false;
  if (WORDY.test(ch) || CLOSERS.has(ch)) return true;
  if (ch === '"' || ch === "'") return Boolean(prev) && !SPACE.test(/** @type {string} */ (prev)) && !OPENERS.has(/** @type {string} */ (prev));
  return false;
}

/**
 * The words as they should go in at the cursor.
 * @param {string} text  what was dictated
 * @param {{ before?: string, after?: string } | null | undefined} around  what's next to the cursor
 * @returns {{ text: string, before: boolean, after: boolean }}  `before`/`after`: a space was added there
 */
export function spaceOut(text, around) {
  const s = String(text ?? "");
  if (!around || !s) return { text: s, before: false, after: false };
  const prev = chars(around.before);
  const next = chars(around.after);
  const own = chars(s);
  const first = own[0];
  const last = own[own.length - 1];
  const left = prev[prev.length - 1];
  const right = next[0];
  // After a word or a sentence's end, unless the words start with a space or with punctuation.
  const before = Boolean(left && first) && endsWord(left, prev[prev.length - 2]) && !SPACE.test(first) && !CLOSERS.has(first) && !NO_SPACES.test(left) && !NO_SPACES.test(first);
  // Before a word, when the words end with one (or with a sentence's end).
  const after = Boolean(right && last) && LETTER_OR_DIGIT.test(right) && endsWord(last, own[own.length - 2]) && !NO_SPACES.test(right) && !NO_SPACES.test(last);
  return { text: `${before ? " " : ""}${s}${after ? " " : ""}`, before, after };
}
