/**
 * A PIN said out loud ("four four eight one", "my PIN is 4 4 8 1", "double five six two", "Yes,
 * 4481"). It counts when the utterance is just the digits, or a short sentence with one run of
 * them, so "call me at 5" or "book it for 4 people on 1234 Main" never reads as a PIN. While a PIN
 * is wanted, maskPin keeps digits that could be one away from the talker and the transcript.
 */

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  to: "2",
  too: "2",
  three: "3",
  four: "4",
  for: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};
/** Words that are digits only after another digit ("four oh one"), never first ("Oh, it's 4481", "for 4 people"). */
const LOOSE = new Set(["oh", "o", "to", "too", "for"]);
const FILLER = new Set([
  "my", "pin", "pin's", "is", "it's", "its", "the", "code", "number", "uh", "um", "okay", "ok", "it", "yeah", "yes", "yep", "sure",
  "so", "and", "hi", "hey", "hello", "that's", "thats", "here", "please",
]);

type Run = { start: number; end: number; digits: string };

function tokensOf(text: string): string[] {
  return (
    text
      .toLowerCase()
      // Times and decimals aren't PINs ("at 11:30", "$44.81"); "4,481" is.
      .replace(/\d+[:.]\d+/g, " x ")
      .replace(/(\d),(?=\d)/g, "$1")
      .replace(/[^a-z0-9' ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

/** The digits at tokens[i] ("4481", "four", "double five"): how many tokens they take, and whether they only maybe are digits. */
function digitAt(tokens: string[], i: number): { digits: string; take: number; loose: boolean } | null {
  const t = tokens[i];
  if (/^\d+$/.test(t)) return { digits: t, take: 1, loose: false };
  if ((t === "double" || t === "triple") && i + 1 < tokens.length) {
    const next = tokens[i + 1];
    const d = /^\d$/.test(next) ? next : DIGIT_WORDS[next];
    return d ? { digits: d.repeat(t === "double" ? 2 : 3), take: 2, loose: false } : null;
  }
  const d = DIGIT_WORDS[t];
  return d === undefined ? null : { digits: d, take: 1, loose: LOOSE.has(t) };
}

/** Runs of digits in a row, each with at least one that surely is one. */
function digitRuns(tokens: string[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < tokens.length; ) {
    let at = digitAt(tokens, i);
    if (!at) {
      i++;
      continue;
    }
    let start = i;
    let digits = "";
    while (at) {
      if (!digits && at.loose) start = i + at.take;
      else digits += at.digits;
      i += at.take;
      at = i < tokens.length ? digitAt(tokens, i) : null;
    }
    if (digits) runs.push({ start, end: i, digits });
  }
  return runs;
}

const isPin = (digits: string) => digits.length >= 4 && digits.length <= 8;

export function pinFromSpeech(text: string): string | null {
  const tokens = tokensOf(text);
  const runs = digitRuns(tokens);
  const others = tokens.filter((t, i) => !runs.some((r) => i >= r.start && i < r.end) && !FILLER.has(t)).length;
  // Just the digits, maybe in pieces ("four four, uh, eight one").
  if (!others) {
    const digits = runs.map((r) => r.digits).join("");
    return isPin(digits) ? digits : null;
  }
  // One run of them in a short sentence ("Hi Otto, it's 4481", "I think it's four four eight one").
  if (runs.length === 1 && others <= 2 && tokens.length <= 10 && isPin(runs[0].digits)) return runs[0].digits;
  return null;
}

/** Does it have any digits in it (said or written)? */
export function hasDigits(text: string): boolean {
  return digitRuns(tokensOf(text)).length > 0;
}

const UNIT = String.raw`(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|oh|double|triple)`;
const SEQUENCE = new RegExp(String.raw`(?<![\w:.$€£])${UNIT}(?:[\s,-]+${UNIT})*(?![\w:]|\.\d)`, "gi");

/**
 * Digits that could be a PIN, or part of one (2 to 8 of them), taken out. A time, an amount or a
 * phone number stays as it is.
 */
export function maskPin(text: string): string {
  return text.replace(SEQUENCE, (m) => {
    const n = digitRuns(tokensOf(m)).reduce((sum, r) => sum + r.digits.length, 0);
    return n >= 2 && n <= 8 ? "(a number)" : m;
  });
}
