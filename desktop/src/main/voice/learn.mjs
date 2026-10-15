/**
 * Learning from a fix: when the owner corrects a dictation in the history ("pro zee" → "Prozzi"),
 * the words they changed become dictionary suggestions, with what speech-to-text wrote as
 * "heard as". Ordinary edits ("there" → "their", a reworded sentence) aren't suggested.
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
