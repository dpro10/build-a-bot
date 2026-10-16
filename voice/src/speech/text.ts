/**
 * Text on its way to the voice. The model writes for a screen; Magpie needs words exactly as they
 * should be said, and reads anything else literally ("asterisk", "dollar sign twelve"). So:
 *   speakable()          drops chat formatting: markdown, links, code, emoji
 *   normalizeForSpeech() says written forms out loud: $12.50, 3:30 PM, 20%, 1st, 2026, phone numbers
 *   SentenceChunker      cuts a streaming reply into pieces to synthesize while the rest is written
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
  [1e12, "trillion"],
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
];
const ORDINAL_WORDS: Record<string, string> = {
  one: "first",
  two: "second",
  three: "third",
  five: "fifth",
  eight: "eighth",
  nine: "ninth",
  twelve: "twelfth",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0 || !parts.length) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/** 1234 → "one thousand two hundred thirty-four" (whole numbers up to the trillions). */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return `minus ${numberToWords(-value)}`;
  let n = Math.floor(value);
  if (n < 1000) return under1000(n);
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${under1000(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0) parts.push(under1000(n));
  return parts.join(" ");
}

/** 1 → "first", 22 → "twenty-second", 100 → "one hundredth". */
export function ordinalWords(n: number): string {
  const words = numberToWords(n);
  const match = /([a-z]+)$/.exec(words);
  if (!match) return words;
  const last = match[1];
  const ordinal = ORDINAL_WORDS[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return words.slice(0, words.length - last.length) + ordinal;
}

/** 1999 → "nineteen ninety-nine", 2005 → "two thousand five", 2026 → "twenty twenty-six". */
export function yearWords(n: number): string {
  if (n >= 2000 && n < 2010) return numberToWords(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return `${numberToWords(hi)} hundred`;
  return `${numberToWords(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : numberToWords(lo)}`;
}

function digitsWords(digits: string): string {
  return digits
    .split("")
    .map((d) => (d === "0" ? "oh" : ONES[Number(d)]))
    .join(" ");
}

function decimalWords(text: string): string {
  const [whole, frac = ""] = text.replace(/,/g, "").split(".");
  const head = numberToWords(Number(whole || "0"));
  return frac ? `${head} point ${frac.split("").map((d) => ONES[Number(d)]).join(" ")}` : head;
}

function moneyWords(amount: string, unit: { one: string; many: string; cent: string; cents: string }, scale?: string): string {
  const clean = amount.replace(/,/g, "");
  if (scale) return `${decimalWords(clean)} ${scale} ${unit.many}`;
  const [whole, frac] = clean.split(".");
  const w = Number(whole || "0");
  const c = frac ? Math.round(Number(`0.${frac}`) * 100) : 0;
  const dollars = `${numberToWords(w)} ${w === 1 ? unit.one : unit.many}`;
  if (!c) return dollars;
  const cents = `${numberToWords(c)} ${c === 1 ? unit.cent : unit.cents}`;
  return w ? `${dollars} and ${cents}` : cents;
}

const CURRENCIES: Record<string, { one: string; many: string; cent: string; cents: string }> = {
  $: { one: "dollar", many: "dollars", cent: "cent", cents: "cents" },
  "€": { one: "euro", many: "euros", cent: "cent", cents: "cents" },
  "£": { one: "pound", many: "pounds", cent: "penny", cents: "pence" },
};

function timeWords(hour: number, minute: number, meridiem?: string): string {
  const h = numberToWords(hour);
  const m = minute === 0 ? (meridiem ? "" : " o'clock") : minute < 10 ? ` oh ${ONES[minute]}` : ` ${numberToWords(minute)}`;
  const suffix = meridiem ? ` ${meridiem.replace(/\./g, "").toLowerCase().startsWith("a") ? "A M" : "P M"}` : "";
  return `${h}${m}${suffix}`;
}

/** Chat formatting out: what's left is plain sentences. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "the link")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_](\S[^*_\n]*?)[*_](?=[\s).,!?;:]|$)/g, "$1$2")
    .replace(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu, "")
    .replace(/\s*\n[\s\n]*/g, (m) => ((m.match(/\n/g)?.length ?? 0) > 1 ? ". " : ", "))
    .replace(/([.!?:;,])\s*[.,](?=\s)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Written forms out loud, for a voice that reads exactly what it's given. */
export function normalizeForSpeech(input: string): string {
  let t = ` ${input} `;

  // Phone numbers, digit by digit with pauses: "(555) 123-4567", "+1 555 123 4567".
  t = t.replace(/(?<![\w$€£.])(\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-](\d{3})[\s.-](\d{4})(?![\w.]*\d)/g, (_m, _cc, a: string, b: string, c: string) =>
    `${digitsWords(a)}, ${digitsWords(b)}, ${digitsWords(c)}`,
  );
  // Money: "$1,234.56", "$2.5M", "€20", "$5 billion".
  t = t.replace(/([$€£])\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(million|billion|trillion|thousand|[kKmMbB])\b)?/g, (_m, sym: string, amount: string, scale?: string) => {
    const scaleWord = scale ? ({ k: "thousand", m: "million", b: "billion" } as Record<string, string>)[scale.toLowerCase()] ?? scale.toLowerCase() : undefined;
    return moneyWords(amount, CURRENCIES[sym], scaleWord);
  });
  // Percentages.
  t = t.replace(/(\d[\d,]*(?:\.\d+)?)\s?%/g, (_m, n: string) => `${decimalWords(n)} percent`);
  // Temperatures.
  t = t.replace(/(-?\d+(?:\.\d+)?)\s?°\s?([FC])\b/g, (_m, n: string, scale: string) =>
    `${n.startsWith("-") ? "minus " : ""}${decimalWords(n.replace("-", ""))} degrees ${scale === "F" ? "Fahrenheit" : "Celsius"}`,
  );
  t = t.replace(/(\d+(?:\.\d+)?)\s?°/g, (_m, n: string) => `${decimalWords(n)} degrees`);
  // Times: "3:30 PM", "10:00", "3pm", "9 a.m.".
  t = t.replace(/\b(\d{1,2}):(\d{2})\s?([AaPp]\.?[Mm]\.?)?(?=\W)/g, (_m, h: string, m: string, mer?: string) => timeWords(Number(h), Number(m), mer));
  t = t.replace(/\b(\d{1,2})\s?([AaPp]\.?[Mm]\.?)(?=\W)/g, (_m, h: string, mer: string) => timeWords(Number(h), 0, mer));
  // Dates: "2026-10-16", "Oct 16", "October 16th, 2026".
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y: string, mo: string, d: string) => {
    const month = MONTHS[Number(mo) - 1];
    return month && Number(d) >= 1 && Number(d) <= 31 ? `${month} ${ordinalWords(Number(d))}, ${yearWords(Number(y))}` : m;
  });
  t = t.replace(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\.?\s(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s(\d{4})\b)?/g,
    (_m, mon: string, d: string, y?: string) => {
      const month = MONTHS.find((name) => name.toLowerCase().startsWith(mon.toLowerCase().slice(0, 3))) ?? mon;
      return `${month} ${ordinalWords(Number(d))}${y ? `, ${yearWords(Number(y))}` : ""}`;
    },
  );
  // Ordinals.
  t = t.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_m, n: string) => ordinalWords(Number(n)));
  // Ranges: "3-5 days".
  t = t.replace(/\b(\d+)\s?[-–]\s?(\d+)\b/g, (_m, a: string, b: string) => `${a} to ${b}`);
  // Years in running text.
  t = t.replace(/(?<![\d,.$])\b(1[1-9]\d\d|20\d\d)\b(?![\d,.]|\s?(?:%|percent))/g, (_m, y: string) => yearWords(Number(y)));
  // Remaining numbers.
  t = t.replace(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\w])/g, (m, whole: string, frac?: string) => {
    const digits = whole.replace(/,/g, "");
    if (digits.length > 15 || (digits.length > 1 && digits.startsWith("0"))) return digitsWords(digits) + (frac ? ` point ${digitsWords(frac.slice(1))}` : "");
    return decimalWords(m);
  });
  // Symbols and abbreviations.
  t = t
    .replace(/\s&\s/g, " and ")
    .replace(/(\w)@(\w)/g, "$1 at $2")
    .replace(/\s@\s?/g, " at ")
    .replace(/\s\+\s/g, " plus ")
    .replace(/\s=\s/g, " equals ")
    .replace(/#\s?(?=\w)/g, "number ")
    .replace(/\be\.g\.,?/gi, "for example")
    .replace(/\bi\.e\.,?/gi, "that is")
    .replace(/\betc\./gi, "et cetera")
    .replace(/\bvs\.?(?=\s)/gi, "versus")
    .replace(/\bapprox\.(?=\s)/gi, "approximately")
    .replace(/\bMr\.(?=\s)/g, "Mister")
    .replace(/\bMrs\.(?=\s)/g, "Missus")
    .replace(/\bMs\.(?=\s)/g, "Miz")
    .replace(/\bDr\.(?=\s[A-Z])/g, "Doctor")
    .replace(/\b(mins?)\b(?=[\s.,!?])/g, "minutes")
    .replace(/\b(hrs?)\b(?=[\s.,!?])/g, "hours")
    .replace(/\bmph\b/gi, "miles per hour")
    .replace(/\bkm\b/g, "kilometers");
  // Characters Magpie reads literally or can't say.
  t = t.replace(/[*_`~^|{}[\]<>\\#]/g, " ").replace(/\s+([.,!?;:])/g, "$1").replace(/\s+/g, " ");
  return t.trim();
}

/** Everything a reply needs before the voice speaks it. */
export function forSpeech(text: string): string {
  return normalizeForSpeech(speakable(text));
}

const ABBREVIATIONS = /(?:^|\s)(?:mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e|a\.m|p\.m|u\.s|no|approx|jr|sr|inc|ltd|co|[a-z])\.$/i;

/**
 * Cuts a streaming reply into speakable pieces: whole sentences, except that the first piece may
 * end at a comma once it has a few words, so the voice can start sooner.
 */
export class SentenceChunker {
  private buf = "";
  private emitted = 0;
  private readonly firstClauseWords: number;
  private readonly maxWords: number;

  constructor(opts: { firstClauseWords?: number; maxWords?: number } = {}) {
    this.firstClauseWords = opts.firstClauseWords ?? 5;
    this.maxWords = opts.maxWords ?? 32;
  }

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut < 0) break;
      const piece = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut);
      if (/[\p{L}\p{N}]/u.test(piece)) {
        out.push(piece);
        this.emitted++;
      }
    }
    return out;
  }

  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = "";
    if (!/[\p{L}\p{N}]/u.test(rest)) return [];
    this.emitted++;
    return [rest];
  }

  /** How many pieces have been handed out (the first can be a clause). */
  get count(): number {
    return this.emitted;
  }

  private findCut(): number {
    const s = this.buf;
    // Sentence ends: terminal punctuation (and closing quotes) followed by whitespace.
    const sentence = /[.!?…]+["'”’)]*(?=\s)|\n/g;
    let m: RegExpExecArray | null;
    while ((m = sentence.exec(s))) {
      const end = m.index + m[0].length;
      if (m[0] !== "\n" && m[0].endsWith(".") && m[0].length === 1 && ABBREVIATIONS.test(s.slice(Math.max(0, m.index - 6), end))) continue;
      return end;
    }
    const words = s.trim().split(/\s+/).length;
    // The first piece can end at a clause so the first audio comes sooner.
    if (this.emitted === 0 && words > this.firstClauseWords) {
      const clause = /[,;:–—](?=\s)/g;
      while ((m = clause.exec(s))) {
        const before = s.slice(0, m.index).trim().split(/\s+/).length;
        if (before >= this.firstClauseWords - 1 && /\s\S/.test(s.slice(m.index + 1))) return m.index + 1;
      }
    }
    // A run-on with no punctuation: cut at the last comma, or after maxWords.
    if (words > this.maxWords && /\s\S+\s/.test(s)) {
      const comma = s.lastIndexOf(", ");
      if (comma > 0 && s.slice(0, comma).split(/\s+/).length >= 6) return comma + 1;
      let seen = 0;
      for (let i = 0; i < s.length; i++) {
        if (/\s/.test(s[i]) && i > 0 && !/\s/.test(s[i - 1]) && ++seen >= this.maxWords) return i;
      }
    }
    return -1;
  }
}
