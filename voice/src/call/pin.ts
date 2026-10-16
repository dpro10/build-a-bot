/**
 * A PIN said out loud ("four four eight one", "my PIN is 4 4 8 1", "double five six two"). Only an
 * utterance that is essentially just the digits counts, so "call me at 5" never reads as a PIN.
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
const FILLER = new Set(["my", "pin", "is", "it's", "its", "the", "code", "number", "uh", "um", "okay", "ok", "it", "yeah", "sure", "so", "and"]);

export function pinFromSpeech(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let digits = "";
  let other = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) digits += t;
    else if ((t === "double" || t === "triple") && i + 1 < tokens.length) {
      const next = tokens[i + 1];
      const d = /^\d$/.test(next) ? next : DIGIT_WORDS[next];
      if (d) {
        digits += d.repeat(t === "double" ? 2 : 3);
        i++;
      } else other++;
    } else if (DIGIT_WORDS[t] !== undefined) digits += DIGIT_WORDS[t];
    else if (!FILLER.has(t)) other++;
  }
  if (digits.length < 4 || digits.length > 8 || other > 0) return null;
  return digits;
}
