/**
 * Voice typing's text rules. Pure functions (no database, no network), so every rule is tested.
 *
 *  - tidyTranscript: the cleanup that needs no AI (fillers, stutters, spoken line breaks,
 *    "scratch that"). It runs on every dictation, and is the whole cleanup when the AI is off
 *    or answers badly.
 *  - Dictionary: the owner's words are spelled their way; snippets type something longer.
 *  - matchCommand: "Hey Otto, …" is for the bot, not the app they're typing in.
 *  - acceptPolish: the AI's cleanup is used only if it still says what they said.
 */

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "word" }) : null;

/** Words in a text, the way a word counter counts them (also for languages without spaces). */
export function countWords(text: string): number {
  if (!text.trim()) return 0;
  if (segmenter) {
    let n = 0;
    for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
    return n;
  }
  return text.trim().split(/\s+/).length;
}

/** Lowercase, accents off, punctuation as spaces: for comparing what was said. */
export function normalizeSpeech(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A phrase as a regex that ignores case and the spaces, commas, dots or dashes between its words. */
function phraseRe(phrase: string, flags = "giu"): RegExp | null {
  const words = phrase
    .trim()
    .split(/[\s,.\-–—]+/)
    .filter(Boolean)
    .map(escapeRe);
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[\\s,.\\-–—]+")}(?![\\p{L}\\p{N}])`, flags);
}

// ---------------------------------------------------------------------------
// The cleanup that needs no AI
// ---------------------------------------------------------------------------

/** Sounds people make while thinking. Only ones that are never real words ("like" and "so" can be). */
const FILLERS = new Set(["um", "umm", "ummm", "uh", "uhh", "uhhh", "uhm", "erm", "er"]);

/** "um" or "Um", but not "ER" (the emergency room) or "UH" in all capitals. */
const isFiller = (core: string) => FILLERS.has(core.toLowerCase()) && !(core.length > 1 && core === core.toUpperCase());

/** Doubled by a stutter, never on purpose ("that that" and "had had" can be right, so they're not here). */
const STUTTER = new Set(["i", "a", "an", "the", "to", "and", "of", "we", "you", "my", "for", "on", "with", "so", "but", "at", "our", "your", "me", "in", "it's", "i'm", "i'll"]);

type Token = { lead: string; core: string; trail: string };

function tokenize(line: string): Token[] {
  return line
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const m = w.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
      return m ? { lead: m[1], core: m[2], trail: m[3] } : { lead: "", core: w, trail: "" };
    });
}

const endsSentence = (t: Token | undefined) => !t || /[.!?]["')\]]*$/.test(t.trail);

function capitalize(word: string): string {
  return word ? word[0].toLocaleUpperCase() + word.slice(1) : word;
}

/** Fillers out (keeping the sentence's punctuation and capitals right), stutters collapsed. */
function tidyLine(line: string): string {
  const out: Token[] = [];
  let capNext = false;
  for (const tok of tokenize(line)) {
    const lower = tok.core.toLowerCase();
    if (isFiller(tok.core)) {
      const prev = out[out.length - 1];
      if (prev && !/[.!?]/.test(prev.trail)) {
        // The commas around a filler go with it ("I was, um, thinking" → "I was thinking"),
        // and "…tomorrow, um." keeps its full stop.
        prev.trail = prev.trail.replace(/[,;:]+$/, "") + tok.trail.replace(/[^.!?]/g, "");
      }
      // A sentence that began with "Um," still starts with a capital.
      if (!prev || endsSentence(prev)) capNext = true;
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && !prev.trail && !tok.lead && STUTTER.has(lower) && prev.core.toLowerCase() === lower) {
      prev.trail = tok.trail;
      continue;
    }
    if (capNext && tok.core) {
      tok.core = capitalize(tok.core);
      capNext = false;
    }
    out.push({ ...tok });
  }
  // A comma left hanging where a filler was ("So, um, I think" → "So, I think"; "Well, um." → "Well.").
  return out
    .map((t) => t.lead + t.core + t.trail)
    .join(" ")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/,{2,}/g, ",")
    .replace(/^[,;:]\s*/, "");
}

/** Spoken line breaks. "New paragraph" almost never means anything else; "new line" can ("our new line of shoes"). */
function spokenBreaks(text: string): string {
  const before = String.raw`(^|[.!?,;:]\s*)`;
  // "New paragraph" when it's set off from the words around it on either side.
  text = text.replace(new RegExp(`${before}(?:new|next) paragraph\\b[.!?,;:]?\\s*`, "giu"), (_m, pre: string) => `${pre.trimEnd()}\n\n`);
  text = text.replace(/\s*\b(?:new|next) paragraph(?:[.!?,;:]\s*|\s*$)/giu, "\n\n");
  // "New line" only when it's a sentence of its own ("Thanks. New line. Diego").
  text = text.replace(new RegExp(`${before}(?:new ?line|next line)(?:[.!?,;:]\\s*|\\s*$)`, "giu"), (_m, pre: string) => `${pre.trimEnd()}\n`);
  return text;
}

/** "I'll be there at 5. Scratch that. I'll be there at 6." → "I'll be there at 6." */
function scratchThat(text: string): string {
  // A sentence ends at . ! or ? before a space or the end ("3.5" and "site.com" don't end one).
  const sentences = text.match(/[^\n]+?(?:[.!?]+(?=\s|$)|(?=\n)|$)[ \t]*|\n+/g) ?? [text];
  const kept: string[] = [];
  for (const s of sentences) {
    if (/^\s*scratch that[.!?]*\s*$/i.test(s)) {
      // Drop the sentence before it (not a line break).
      for (let i = kept.length - 1; i >= 0; i--) {
        if (kept[i].trim()) {
          kept.splice(i, 1);
          break;
        }
      }
      continue;
    }
    kept.push(s);
  }
  return kept.join("");
}

/**
 * The cleanup that needs no AI: fillers and stutters out, spoken line breaks, "scratch that",
 * tidy spaces and capitals. Words are never reworded here.
 */
export function tidyTranscript(raw: string): string {
  let text = raw.replace(/[ \t ]+/g, " ").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  text = spokenBreaks(text);
  text = scratchThat(text);
  text = text
    .split("\n")
    .map((line) => tidyLine(line.trim()))
    .join("\n");
  text = text
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/([.!?])[,;:]+/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
  // Each line starts with a capital, like the first word of a sentence.
  return text.replace(/(^|\n)(\p{Ll})/gu, (_m, pre: string, ch: string) => pre + ch.toLocaleUpperCase());
}

// ---------------------------------------------------------------------------
// The personal dictionary
// ---------------------------------------------------------------------------

export type DictionaryWord = { text: string; heard: string[] };
export type Snippet = { text: string; heard: string[] };

/**
 * A word worth fixing the case of wherever it appears: "GitHub", "iPhone", "TAMU", "Build-a-bot",
 * "K8s" or a phrase. Plain capitalized names ("Will", "May", "Rose") aren't: they're also everyday
 * words, so only what speech-to-text writes instead of them (the owner's "heard as") is replaced.
 */
export function isDistinctive(word: string): boolean {
  const w = word.trim();
  if (/\s/.test(w)) return true;
  if (/[\p{N}&@+#._\-/]/u.test(w)) return true;
  if (/^\p{Lu}{2,}$/u.test(w)) return true;
  return /^.\p{L}*\p{Lu}/u.test(w) || /^\p{Ll}+\p{Lu}/u.test(w);
}

/** Spell the owner's words their way. */
export function applyDictionary(text: string, words: DictionaryWord[]): string {
  // Longest first, so "Build-a-bot site" wins over "Build-a-bot".
  const rules: { re: RegExp; to: string }[] = [];
  for (const w of words) {
    const to = w.text.trim();
    if (!to) continue;
    const variants = [...w.heard.filter((h) => normalizeSpeech(h) !== normalizeSpeech(to)), ...(isDistinctive(to) ? [to] : [])];
    for (const v of variants) {
      const re = phraseRe(v);
      if (re) rules.push({ re, to });
    }
  }
  rules.sort((a, b) => b.re.source.length - a.re.source.length);
  let out = text;
  for (const r of rules) {
    out = out.replace(r.re, (m) => {
      // Keep a capital at the start of a sentence for everyday words ("pro zee" → "Prozzi" anyway).
      if (m[0] && m[0] !== m[0].toLowerCase() && r.to[0] === r.to[0].toLowerCase() && !isDistinctive(r.to)) return capitalize(r.to);
      return r.to;
    });
  }
  return out;
}

/** Markers the AI is told to keep exactly ("⟦1⟧"). */
const slotMark = (i: number) => `⟦${i + 1}⟧`;
const SLOT_RE = /⟦(\d+)⟧/g;

/** Swap each snippet's phrase for a marker, so the AI can't reword it; restoreSnippets puts the text in. */
export function protectSnippets(text: string, snippets: Snippet[]): { text: string; slots: string[] } {
  const slots: string[] = [];
  const triggers = snippets
    .flatMap((s) => s.heard.map((h) => ({ h, text: s.text })))
    .filter((t) => t.h.trim() && t.text)
    .sort((a, b) => b.h.length - a.h.length);
  let out = text;
  for (const t of triggers) {
    const re = phraseRe(t.h);
    if (!re) continue;
    out = out.replace(re, () => {
      slots.push(t.text);
      return slotMark(slots.length - 1);
    });
  }
  return { text: out, slots };
}

/** The snippets' text back in place of their markers; null when a marker went missing or doubled. */
export function restoreSnippets(text: string, slots: string[]): string | null {
  const seen = new Set<number>();
  let bad = false;
  const out = text.replace(SLOT_RE, (_m, n: string) => {
    const i = Number(n) - 1;
    if (i < 0 || i >= slots.length || seen.has(i)) {
      bad = true;
      return "";
    }
    seen.add(i);
    return slots[i];
  });
  if (bad || seen.size !== slots.length) return null;
  // A snippet said on its own ("my address.") is typed exactly as written, without the full stop.
  const alone = slots.length === 1 && /^\s*⟦1⟧[.!?,]?\s*$/.test(text);
  return alone ? slots[0] : out;
}

// ---------------------------------------------------------------------------
// The owner's words, from what their bots know
// ---------------------------------------------------------------------------

const NOT_NAMES = new Set(
  (
    "i i'm i'll i've i'd the a an and but or so if when then she he they her his their its it we you my our your this that these those there here " +
    "what who how why where which mr mrs ms dr ai yes no not also likes loves prefers wants works lives has is was are were will would can could should " +
    "january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday " +
    "today tomorrow yesterday morning evening night am pm usa us uk"
  ).split(" "),
);

/**
 * Names and words worth spelling right, from what the owner's bots remember ("Diego's sister is
 * Ana; she lives in Austin" → Ana, Austin). Capitalized words that also show up in lowercase, or are
 * everyday words, are left out. Most mentioned first.
 */
export function properNouns(texts: string[], limit = 30): string[] {
  const lowerSeen = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/(?<![\p{L}'’])(\p{Ll}[\p{L}'’-]*)/gu)) lowerSeen.add(m[1].toLowerCase());
  const counts = new Map<string, { word: string; n: number }>();
  for (const t of texts) {
    for (const m of t.matchAll(/\p{Lu}[\p{L}\p{M}'’-]*(?:\s+\p{Lu}[\p{L}\p{M}'’-]*){0,2}/gu)) {
      const phrase = m[0]
        .split(/\s+/)
        .map((w) => w.replace(/['’]s$/u, "").replace(/[-'’]+$/u, ""))
        .filter((w) => w.length >= 2 && !NOT_NAMES.has(w.toLowerCase()) && !lowerSeen.has(w.toLowerCase()))
        .join(" ");
      if (!phrase) continue;
      const key = phrase.toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.n++;
      else counts.set(key, { word: phrase, n: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((c) => c.word);
}

/** Words in order, case-insensitive duplicates out. */
export function uniqueWords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const t = w.replace(/\s+/g, " ").trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * The speech-to-text prompt: Whisper reads it as the text that came before, so a short list of
 * the owner's names and words steers its spelling. It's capped well under Whisper's 224 tokens.
 */
export function whisperPrompt(vocabulary: string[], maxChars = 400): string | undefined {
  let out = "";
  for (const w of vocabulary) {
    const next = out ? `${out}, ${w}` : w;
    if (next.length > maxChars) break;
    out = next;
  }
  return out ? `${out}.` : undefined;
}

/**
 * Whisper sometimes "hears" its prompt in near-silence: a transcript that's a piece of the prompt,
 * or three or more of its words and nothing else, is nothing.
 */
export function isPromptEcho(text: string, prompt: string | undefined): boolean {
  if (!prompt) return false;
  const t = normalizeSpeech(text);
  const p = normalizeSpeech(prompt);
  const words = t.split(" ").filter(Boolean);
  if (words.length >= 2 && ` ${p} `.includes(` ${t} `)) return true;
  const vocab = new Set(p.split(" "));
  return words.length >= 3 && words.every((w) => vocab.has(w));
}

/** What speech-to-text writes for silence or a cough. */
const PHANTOM = /^(?:thank you(?: (?:so much|very much))?|thanks(?: for watching)?|you|bye|okay|oh|hmm|mm|uh|um|ah|so|\.+)[.!?]*$/i;

export function isPhantom(text: string): boolean {
  return PHANTOM.test(text.trim());
}

// ---------------------------------------------------------------------------
// "Hey Otto, …": talking to the bot
// ---------------------------------------------------------------------------

/**
 * How a word sounds, roughly: "Otto" and "Auto", "Saige" and "Sage", "Kai" and "Ky" match.
 * Good enough for a bot's name right after "hey", where speech-to-text may spell it like a word.
 */
export function phoneticKey(word: string): string {
  let w = word
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!w) return "";
  w = w
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/gh/g, "")
    .replace(/wh/g, "w")
    .replace(/^kn/, "n")
    .replace(/th/g, "t")
    .replace(/dg/g, "j")
    .replace(/y/g, "i")
    .replace(/([aeiou])h/g, "$1")
    .replace(/(.)\1+/g, "$1")
    .replace(/[aeiou]+/g, "a");
  return w;
}

export function soundsLike(a: string, b: string): boolean {
  const ka = phoneticKey(a);
  return ka.length >= 2 && ka === phoneticKey(b);
}

const WAKE = new Set(["hey", "hi", "hello", "okay", "ok"]);

export type CommandBot = { id: string; name: string };

/**
 * "Hey Otto, remind me to call Mom at 5" → Otto, "remind me to call Mom at 5".
 * Only right at the start, after "hey", "hi", "hello" or "okay": "I told Otto" stays text.
 */
export function matchCommand<B extends CommandBot>(raw: string, bots: B[]): { bot: B; command: string } | null {
  const text = raw.trim();
  // Words with where they are, so the command keeps the rest exactly as it was written.
  const words = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)];
  if (words.length < 2 || !WAKE.has(words[0][0].toLowerCase())) return null;
  let best: { bot: B; end: number; exact: boolean } | null = null;
  for (const bot of bots) {
    const nameWords = normalizeSpeech(bot.name).split(" ").filter(Boolean);
    if (!nameWords.length || words.length < 1 + nameWords.length) continue;
    const said = words.slice(1, 1 + nameWords.length).map((m) => m[0]);
    const exact = said.every((w, i) => normalizeSpeech(w) === nameWords[i]);
    // Speech-to-text may spell the name like a word it knows ("Hey Auto" for Otto).
    const close = exact || said.every((w, i) => normalizeSpeech(w) === nameWords[i] || (nameWords[i].length >= 3 && soundsLike(w, nameWords[i])));
    if (!close) continue;
    const last = words[nameWords.length];
    const end = (last.index ?? 0) + last[0].length;
    // A name said exactly beats one that only sounds alike; then the longer name ("Otto Two" over "Otto").
    if (!best || (exact && !best.exact) || (exact === best.exact && end > best.end)) best = { bot, end, exact };
  }
  if (!best) return null;
  const command = text
    .slice(best.end)
    .replace(/^[\s,.:;!?–—-]+/, "")
    .trim();
  return { bot: best.bot, command: command ? capitalize(command) : "" };
}

// ---------------------------------------------------------------------------
// Checking the AI's cleanup
// ---------------------------------------------------------------------------

/** How an assistant starts when it answers instead of cleaning up. */
const META_START = /^(?:sure|certainly|of course|okay|ok|here(?:'s| is| are)|i(?:'m| am) sorry|sorry|as an ai|i can(?:not|'t)|the (?:cleaned|corrected|edited)|cleaned[- ]up|corrected (?:text|version)|note:)\b/i;

/** How a question starts (after the plain cleanup). "What a day" starts the same way, and loses only the AI's touch. */
const QUESTION_START = /^(?:(?:so|and|but|okay|ok|hey|hi)\s+)?(?:what|what's|who|who's|where|where's|when|why|how|how's|which|is|are|am|was|were|can|could|do|does|did|will|would|should|shall|have|has)\s/;

/** Content words (4+ letters) in `b` that aren't in `a`. */
function novelShare(a: string, b: string, known: Set<string>): number {
  const base = new Set(normalizeSpeech(a).split(" "));
  const words = normalizeSpeech(b)
    .split(" ")
    .filter((w) => w.length >= 4 && /\p{L}/u.test(w));
  if (!words.length) return 0;
  const novel = words.filter((w) => !base.has(w) && !known.has(w) && !base.has(w.replace(/s$/, "")) && !base.has(`${w}s`));
  return novel.length / words.length;
}

/**
 * The AI's cleanup, if it still says what they said; null to fall back to the plain cleanup.
 * Catches the AI answering ("Sure! Here's a poem…"), adding or dropping too much, and losing a
 * snippet marker.
 */
export function acceptPolish(input: string, output: string, vocabulary: string[] = []): string | null {
  let out = output.replace(/^\s*<dictation>\s*|\s*<\/dictation>\s*$/g, "").trim();
  // A whole reply in quotes, when the dictation wasn't.
  if (/^["“].*["”]$/s.test(out) && !/^["“]/.test(input.trim())) out = out.slice(1, -1).trim();
  if (!out) return null;
  if (/<\/?dictation>/i.test(out)) return null;
  if (META_START.test(out) && !META_START.test(normalizeSpeech(input))) return null;

  const inWords = countWords(input.replace(SLOT_RE, " x "));
  const outWords = countWords(out.replace(SLOT_RE, " x "));
  // Corrections and fillers take words out; nothing should add many.
  if (outWords > Math.ceil(inWords * 1.25) + 4) return null;
  if (inWords >= 8 && outWords < Math.floor(inWords * 0.4)) return null;

  const known = new Set(vocabulary.flatMap((v) => normalizeSpeech(v).split(" ")));
  if (inWords >= 4 && novelShare(input, out, known) > 0.34) return null;

  // A question stays a question: "what is the capital of france" isn't "The capital of France is Paris."
  if ((input.includes("?") || QUESTION_START.test(normalizeSpeech(input))) && !out.includes("?")) return null;

  // Every snippet marker is kept, once.
  const marks = (s: string) => [...s.matchAll(SLOT_RE)].map((m) => m[0]).sort().join(",");
  if (marks(input) !== marks(out)) return null;
  return out;
}

/** Bot replies shown in a small bubble: plain text, no markdown. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
