/**
 * Learning from a fix: when the owner corrects a dictation in the history ("pro zee" → "Prozzi"),
 * the words they changed become dictionary suggestions, with what speech-to-text wrote as
 * "heard as". Ordinary edits ("there" → "their", a reworded sentence) aren't suggested.
 *
 * A fix made right where the words were typed (fix-watch.mjs) is learned without asking, so it
 * takes more (learnFromFix): a word replaced by one that sounds like it, never an everyday word,
 * a different name ("Mark" → "Sarah"), or the same word changed ("Prozzi" → "Prozzi's").
 * Pure, so it's tested.
 */

/** Everyday words: changing to one of these is an edit, not a name to learn. */
const COMMON = new Set(
  (
    "a about after again all also am an and any are as at back be because been before being but by can could day did do does done down " +
    "each even every first for from get go going good got had has have he her here him his how i if in into is it its just know last let like " +
    "little look made make many may me more most much must my new no not now of off on one only or other our out over people really right said " +
    "same see she should so some still such take than that the their them then there these they thing think this those through time to too " +
    "two up us very want was way we well were what when where which while who why will with would year yes yet you your " +
    "monday tuesday wednesday thursday friday saturday sunday today tomorrow yesterday morning night week month " +
    "please thanks thank sorry okay ok hi hey hello bye great sure fine " +
    "i'm i'll i've i'd it's that's there's let's don't can't won't didn't isn't doesn't wasn't aren't they're we're you're we'll you'll"
  ).split(" "),
);

const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}'’&+_-]|\.(?=[\p{L}\p{N}]))*/gu;

const norm = (w) =>
  w
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/’/g, "'");

/** Spelled in a way worth remembering: "GitHub", "iOS", "K8s", "build-a-bot.site". */
function distinctive(word) {
  return /[\p{N}&@+_./-]/u.test(word) || /^\p{Lu}{2,}$/u.test(word) || /^.\p{L}*\p{Lu}/u.test(word);
}

/** Word-level diff (longest common subsequence): the spans that changed. */
function changes(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  let from = [];
  let to = [];
  const flush = () => {
    if (from.length || to.length) out.push({ from, to });
    from = [];
    to = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) to.push(b[j++]);
    else from.push(a[i++]);
  }
  flush();
  return out;
}

/**
 * Words to suggest for the dictionary after a fix.
 * @param {string} before  what was typed
 * @param {string} after   what the owner changed it to
 * @param {string[]} [known]  words already in the dictionary
 * @returns {Array<{ text: string, heard: string[] }>}
 */
export function suggestWords(before, after, known = []) {
  const a = String(before).match(WORD) ?? [];
  const b = String(after).match(WORD) ?? [];
  const have = new Set(known.map(norm));
  const out = [];
  for (const c of changes(a, b)) {
    if (!c.to.length || c.to.length > 3 || c.from.length > 6) continue;
    const text = c.to.join(" ");
    const heard = c.from.join(" ");
    const sameWords = norm(text) === norm(heard);
    // Only a capital changed: worth it for "GitHub", not for "Today".
    if (sameWords && !distinctive(text)) continue;
    // Names and odd spellings are worth learning; everyday words in lowercase are just edits.
    const special = c.to.some((w) => distinctive(w) || (/^\p{Lu}/u.test(w) && !COMMON.has(norm(w))));
    if (!special) continue;
    if (have.has(norm(text)) && (!heard || sameWords)) continue;
    if (out.some((o) => norm(o.text) === norm(text))) continue;
    // "pro zee" → "Prozzi" is how it's misheard; "the cafe" → "Cafe Lola" is an edit, and replacing
    // every "the cafe" later would be wrong. Only words speech-to-text made up are kept as "heard as".
    const misheard = heard && !sameWords && c.from.every((w) => !COMMON.has(norm(w)));
    out.push({ text, heard: misheard ? [heard] : [] });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * How a word sounds, roughly (the server's phoneticKey in src/lib/dictation/text.ts, the same
 * rules): "Prozzi" and "pro zee", "Jon" and "John", "GitHub" and "git hub" match.
 */
export function phoneticKey(word) {
  let w = String(word)
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

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Could speech-to-text have written one for the other? Short words must sound the same ("Tom" and
 * "Sam" don't); longer ones may differ by about a third ("Kubernetes" and "cooper nettie's").
 */
export function soundsAlike(a, b) {
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  if (ka.length < 2 || kb.length < 2) return false;
  const longest = Math.max(ka.length, kb.length);
  const d = editDistance(ka, kb);
  return longest <= 4 ? d === 0 : d <= Math.floor(longest / 3);
}

/**
 * What to learn from a fix made where the words were typed (no list to accept: it's learned on
 * its own, so only clear cases, and at most three):
 *  - a word speech-to-text got wrong, replaced by one that sounds like it: "pro zee" → "Prozzi";
 *  - a word that's spelled its own way, fixed: "github" → "GitHub".
 * Never added or removed words, an everyday word swapped, a different name, the same word changed
 * ("Prozzi" → "Prozzi's"), or a rewrite.
 * @param {string} before  what was typed
 * @param {string} after   what it reads now
 * @param {string[]} [known]  words already in the dictionary (a word they taught is never unlearned)
 * @returns {Array<{ text: string, heard: string[] }>}
 */
export function learnFromFix(before, after, known = []) {
  const a = String(before).match(WORD) ?? [];
  const b = String(after).match(WORD) ?? [];
  const have = new Set(known.map(norm));
  const out = [];
  for (const c of changes(a, b)) {
    // A replacement, short enough to be a fix rather than a rewrite.
    if (!c.from.length || !c.to.length || c.to.length > 3 || c.from.length > 4) continue;
    const text = c.to.join(" ");
    const heard = c.from.join(" ");
    if (text.length > 80 || heard.length > 80) continue;
    const nt = norm(text);
    const nh = norm(heard);
    if (out.some((o) => norm(o.text) === nt)) continue;
    if (nt === nh) {
      // Only how it's written changed: worth it for "GitHub", not for "Today".
      if (distinctive(text) && !have.has(nt)) out.push({ text, heard: [] });
    } else {
      // The same word changed ("Prozzi" → "Prozzi's", "lab" → "laboratory"), not misheard.
      if (nt.startsWith(nh) || nh.startsWith(nt)) continue;
      // Names and odd spellings; never an everyday word.
      if (!c.to.some((w) => distinctive(w) || (/^\p{Lu}/u.test(w) && !COMMON.has(norm(w))))) continue;
      // What it wrote can't be everyday words, or every "the cafe" would change later.
      if (c.from.every((w) => COMMON.has(norm(w)))) continue;
      if (c.from.length === 1 && COMMON.has(nh)) continue;
      // A word they taught it is never turned into something else.
      if (have.has(nh)) continue;
      // "Mark" → "Sarah" is a different name, not a word it misheard.
      if (!soundsAlike(heard, text)) continue;
      out.push({ text, heard: [heard] });
    }
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * The words from learnFromFix the dictionary doesn't already settle: a word it already spells that
 * way isn't added again, and a word they taught is never turned into another ("heard as" can't be
 * one of their words).
 * @param {Array<{ text: string, heard: string[] }>} words
 * @param {string[]} known  the dictionary's words
 */
export function stillToLearn(words, known) {
  const have = new Set(known.map(norm));
  return words.filter((w) => (w.heard.length ? !w.heard.some((h) => have.has(norm(h))) : !have.has(norm(w.text))));
}
