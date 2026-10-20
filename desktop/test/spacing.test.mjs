/**
 * Spacing a dictation against the words next to the cursor (src/main/voice/spacing.mjs), what the
 * paster reads right before typing (paste.mjs › spaced), and the reader's `around` (text-reader.mjs).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spaceOut } from "../src/main/voice/spacing.mjs";
import { Paster } from "../src/main/voice/paste.mjs";
import { parseReply, TextReader, WIN_TEXT_SCRIPT } from "../src/main/voice/text-reader.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/** [what was dictated, before the cursor, after it, what goes in] */
const CASES = [
  // Right after a sentence or a word: a space before.
  ["Bring the slides.", "lab.", "", " Bring the slides."],
  ["and the notes.", "ides", "", " and the notes."],
  ["Bring the slides.", "e at the lab!", "", " Bring the slides."],
  ["Thanks for the notes.", "Sam,", "", " Thanks for the notes."],
  ["The meeting moved.", "ote:", "", " The meeting moved."],
  ["is free.", " 101", "", " is free."],
  ["next week", "(sic)", "", " next week"],
  ["she said.", "“Hi”", "", " she said."],
  ["she said.", 'd "hi"', "", " she said."],
  ["work is done.", "ents'", "", " work is done."],
  ["Next item.", "🎉", "", " Next item."],
  ["Next item.", "❤️", "", " Next item."],
  ["Bring the slides.", "lab.\u200B", "", " Bring the slides."],
  ["Prochain point.", "été.", "", " Prochain point."],
  // Nothing before it, or already a space, a line break, an opening bracket or quote: as it is.
  ["Bring the slides.", "", "", "Bring the slides."],
  ["Bring the slides.", "lab. ", "", "Bring the slides."],
  ["Bring the slides.", "lab.\n", "", "Bring the slides."],
  ["Bring the slides.", "lab.\r\n", "", "Bring the slides."],
  ["Bring the slides.", "lab.\t", "", "Bring the slides."],
  ["Bring the slides.", "lab.\u00A0", "", "Bring the slides."],
  ["thing", "the (", "", "thing"],
  ["quote", "said “", "", "quote"],
  ["hi", 'said "', "", "hi"],
  ["hi", '("', "", "hi"],
  ["hi", '"', "", "hi"],
  // An object in the text (an image, a chip, or how Chromium shows an empty box): nothing known.
  ["can you check?", "\uFFFC", "", "can you check?"],
  ["Hi.", "", "\uFFFC", "Hi."],
  // Joined on purpose: mentions, hashtags, amounts, paths, hyphens and dashes.
  ["Sarah", " @", "", "Sarah"],
  ["general", " #", "", "general"],
  ["5", " $", "", "5"],
  ["or", "and/", "", "or"],
  ["known", "well-", "", "known"],
  ["another", "word—", "", "another"],
  ["name", "user_", "", "name"],
  // The words start with punctuation or a space: no space before them.
  [", and then", "word", "", ", and then"],
  [". Then", "word", "", ". Then"],
  ["%", "50", "", "%"],
  [" already spaced", "word", "", " already spaced"],
  ["\nNew line", "word.", "", "\nNew line"],
  // Right before a word: a space after.
  ["big", "llo ", "wo", "big "],
  ["great", "the ", "notes", "great "],
  ["New words.", "", "Then", "New words. "],
  ["Hi", "", "42", "Hi "],
  // Before a space, punctuation, a line break, or nothing: as it is.
  ["there", "llo ", ".", "there"],
  ["big", "llo ", " world", "big"],
  ["big", "llo ", "\nworld", "big"],
  ["big", "llo ", "", "big"],
  ["big", "llo ", "(note)", "big"],
  ["text\n", "lab.", "Next", " text\n"],
  ["(see", "", "below", "(see "],
  ["see (", "", "below", "see ("],
  // Both sides.
  ["xyz", "Hel", "lo", " xyz "],
  ["big", "the", "dog", " big "],
  // Chinese, Japanese, Thai: no spaces between words.
  ["世界", "你好", "", "世界"],
  ["world", "你好", "", "world"],
  ["世界", "hello", "", "世界"],
  ["です", "これ", "", "です"],
  ["ครับ", "สวัสดี", "", "ครับ"],
  ["hello", "。", "", "hello"],
  ["你好", "", "world", "你好"],
];

test("a space before the words after a word or a sentence's end, after them before a word, and none where it doesn't belong", () => {
  for (const [text, before, after, want] of CASES) {
    const got = spaceOut(text, { before, after });
    assert.equal(got.text, want, `${JSON.stringify(before)} + ${JSON.stringify(text)} + ${JSON.stringify(after)}`);
    assert.equal(got.before, want.startsWith(" ") && !text.startsWith(" "), `before: ${JSON.stringify(text)}`);
    assert.equal(got.after, want.endsWith(" ") && !text.endsWith(" "), `after: ${JSON.stringify(text)}`);
  }
});

test("nothing known about the box, or nothing dictated: the words go in as they are", () => {
  assert.deepEqual(spaceOut("Hello.", null), { text: "Hello.", before: false, after: false });
  assert.deepEqual(spaceOut("Hello.", undefined), { text: "Hello.", before: false, after: false });
  assert.deepEqual(spaceOut("Hello.", {}), { text: "Hello.", before: false, after: false });
  assert.deepEqual(spaceOut("", { before: "lab.", after: "Next" }), { text: "", before: false, after: false });
  assert.deepEqual(spaceOut("\u200B", { before: "lab.", after: "Next" }), { text: "\u200B", before: false, after: false });
});

// ---------------------------------------------------------------------------
// The paster: what's next to the cursor, right before typing
// ---------------------------------------------------------------------------

/** Electron's clipboard, as far as pasting uses it. */
function fakeClipboard(text = "old") {
  let data = { "text/plain": text };
  return {
    writes: [],
    async read() {
      const d = data;
      return [{ types: Object.keys(d), getType: async (t) => d[t] }];
    },
    async readText() {
      return data["text/plain"] ?? "";
    },
    async writeText(t) {
      this.writes.push(t);
      data = { "text/plain": t };
    },
    async write(items) {
      data = Object.assign({}, ...items.map((i) => i.data));
    },
    clear() {
      data = {};
    },
    get text() {
      return data["text/plain"];
    },
  };
}

/** A box the paste goes into: what's in it and where the cursor is, as an app keeps them. */
function fakeBox(value = "", caret = value.length) {
  const box = { value, caret, reads: 0 };
  box.around = async () => {
    box.reads++;
    return { before: box.value.slice(Math.max(0, box.caret - 4), box.caret), after: box.value.slice(box.caret, box.caret + 2) };
  };
  box.paste = (text) => {
    box.value = box.value.slice(0, box.caret) + text + box.value.slice(box.caret);
    box.caret += text.length;
  };
  return box;
}

function paster(cb, box, o = {}) {
  const logs = [];
  const p = new Paster({
    clipboard: cb,
    makeItem: (d) => ({ data: d }),
    press: async () => {
      box?.paste(cb.text);
      return true;
    },
    canPress: () => true,
    restoreAfterMs: 5,
    settleMs: 0,
    around: box ? box.around : undefined,
    log: (m) => logs.push(m),
    ...o,
  });
  return { p, logs };
}

test("two dictations in a row: a space between them, read from the box right before typing", async () => {
  const cb = fakeClipboard();
  const box = fakeBox();
  const { p, logs } = paster(cb, box);
  assert.deepEqual(await p.insert("Meet at the lab.", { category: "chat", space: true, app: "Slack" }), { pasted: true, copied: false });
  await p.insert("Bring the slides.", { category: "chat", space: true, app: "Slack" });
  await p.restoring;
  assert.equal(box.value, "Meet at the lab. Bring the slides.");
  assert.deepEqual(cb.writes, ["Meet at the lab.", " Bring the slides."]);
  assert.equal(cb.text, "old", "the clipboard is put back after a spaced paste too");
  assert.equal(box.reads, 2);
  assert.deepEqual(logs, ["voice: spaced it (before; from the box)"], "what it did, never the words");
});

test("typed right before a word: a space after; after a space, a line break or nothing: none", async () => {
  const cb = fakeClipboard();
  const box = fakeBox("Hello world", "Hello ".length);
  const { p } = paster(cb, box);
  await p.insert("big", { space: true, app: "Notes" });
  assert.equal(box.value, "Hello big world");

  const lines = fakeBox("Dear Sam,\n");
  await paster(cb, lines).p.insert("Thanks for the notes.", { space: true, app: "Mail" });
  assert.equal(lines.value, "Dear Sam,\nThanks for the notes.");

  const empty = fakeBox("");
  await paster(cb, empty).p.insert("Hi.", { space: true, app: "Mail" });
  assert.equal(empty.value, "Hi.");
});

test("only dictations are spaced: a reply pasted from the pill goes in as it is, and nothing is read for it", async () => {
  const cb = fakeClipboard();
  const box = fakeBox("Meet at the lab.");
  const { p } = paster(cb, box);
  await p.insert("Done.", { category: "chat" });
  assert.equal(box.value, "Meet at the lab.Done.");
  assert.equal(box.reads, 0);
});

test("a box that can't be read: the last dictation stands in for it, if it went to the same app a moment ago", async () => {
  const cb = fakeClipboard();
  const box = fakeBox();
  let now = 1_000_000;
  const { p, logs } = paster(cb, box, { around: async () => null, now: () => now });
  await p.insert("Meet at the lab.", { space: true, app: "Terminal-ish" });
  now += 5_000;
  await p.insert("Bring the slides.", { space: true, app: "Terminal-ish" });
  assert.equal(box.value, "Meet at the lab. Bring the slides.");
  assert.deepEqual(logs, ["voice: spaced it (before; from the last dictation)"]);

  // Another app: nothing known about where the cursor is there.
  now += 1_000;
  await p.insert("Hello.", { space: true, app: "Other app" });
  assert.equal(box.value, "Meet at the lab. Bring the slides.Hello.");

  // The same app, but long after: a new message, most likely.
  now += 1_000;
  await p.insert("One.", { space: true, app: "Other app" });
  assert.equal(box.value.endsWith("Hello. One."), true, box.value);
  now += 61_000;
  await p.insert("Two.", { space: true, app: "Other app" });
  assert.equal(box.value.endsWith("One.Two."), true, box.value);

  // Something else pasted in between (a reply from the pill): the last dictation says nothing then.
  now += 1_000;
  await p.insert("Three.", { space: true, app: "Other app" });
  await p.insert("Reply.", {});
  await p.insert("Four.", { space: true, app: "Other app" });
  assert.equal(box.value.endsWith("Two. Three.Reply.Four."), true, box.value);

  // No app name: nothing to match.
  const anon = fakeBox();
  const q = paster(cb, anon, { around: async () => null }).p;
  await q.insert("A.", { space: true, app: null });
  await q.insert("B.", { space: true, app: null });
  assert.equal(anon.value, "A.B.");
});

test("a box read slowly, or a reader that fails, doesn't hold the words up: they go in anyway", async () => {
  const cb = fakeClipboard();
  const box = fakeBox("Meet at the lab.");
  const slow = paster(cb, box, { aroundMs: 40, around: () => new Promise(() => {}) }).p;
  const t0 = Date.now();
  await slow.insert("Bring the slides.", { space: true, app: "Slack" });
  assert.ok(Date.now() - t0 < 1_000, `waited ${Date.now() - t0} ms`);
  assert.equal(box.value, "Meet at the lab.Bring the slides.", "nothing known: as it is");

  const failing = fakeBox("Meet at the lab.");
  const f = paster(cb, failing, {
    around: () => {
      throw new Error("no reader");
    },
  }).p;
  await f.insert("Next.", { space: true, app: "Slack" });
  assert.equal(failing.value, "Meet at the lab.Next.");
  const rejecting = fakeBox("Meet at the lab.");
  await paster(cb, rejecting, { around: async () => Promise.reject(new Error("gone")) }).p.insert("Next.", { space: true, app: "Slack" });
  assert.equal(rejecting.value, "Meet at the lab.Next.");
});

test("in a terminal the box isn't read (its caret isn't the shell's): only the last dictation counts", async () => {
  const cb = fakeClipboard();
  const box = fakeBox();
  const { p } = paster(cb, box);
  await p.insert("git status", { category: "terminal", space: true, app: "Terminal" });
  await p.insert("and then", { category: "terminal", space: true, app: "Terminal" });
  assert.equal(box.reads, 0);
  assert.equal(box.value, "git status and then");
});

test("the box is read only once the last paste has had a moment to show in it", async () => {
  const cb = fakeClipboard();
  let pressedAt = 0;
  const box = fakeBox();
  const readAt = [];
  const { p } = paster(cb, box, {
    settleMs: 120,
    press: async () => {
      // The app shows the paste a little later, as apps do.
      const text = cb.text;
      pressedAt = Date.now();
      setTimeout(() => box.paste(text), 60);
      return true;
    },
    around: async () => {
      readAt.push(Date.now() - pressedAt);
      return box.around();
    },
  });
  await p.insert("Meet at the lab.", { space: true, app: "Slack", restore: false });
  await p.insert("Bring the slides.", { space: true, app: "Slack", restore: false });
  await sleep(100);
  assert.ok(readAt[1] >= 115, `read ${readAt[1]} ms after the paste`);
  assert.equal(box.value, "Meet at the lab. Bring the slides.");
});

test("when it can't press keys, the words go on the clipboard as they are, and nothing is read", async () => {
  const cb = fakeClipboard();
  const box = fakeBox("Meet at the lab.");
  const { p } = paster(cb, box, { canPress: () => false });
  assert.deepEqual(await p.insert("Bring the slides.", { space: true, app: "Slack" }), { pasted: false, copied: true });
  assert.equal(cb.text, "Bring the slides.");
  assert.equal(box.reads, 0);
});

// ---------------------------------------------------------------------------
// The reader's `around`
// ---------------------------------------------------------------------------

/** A pretend helper process: answers each command with `answer(cmd)`. */
function fakeSpawn(answer) {
  const commands = [];
  const spawned = [];
  const spawn = () => {
    const child = new EventEmitter();
    const stdout = new EventEmitter();
    stdout.setEncoding = () => {};
    child.stdout = stdout;
    child.stdin = Object.assign(new EventEmitter(), {
      write(line) {
        const cmd = String(line).trim();
        commands.push(cmd);
        const reply = answer(cmd);
        if (reply !== undefined) setImmediate(() => stdout.emit("data", typeof reply === "string" ? reply : `${JSON.stringify(reply)}\n`));
        return true;
      },
    });
    child.kill = () => setImmediate(() => child.emit("exit", null));
    spawned.push(child);
    return child;
  };
  return { spawn, commands, spawned };
}

test("the reader's around: the characters next to the cursor, a few at most, or why it can't tell", async () => {
  const f = fakeSpawn((cmd) => (cmd === "around" ? { ok: true, before: "e lab.", after: "Ne", role: "AXTextArea", via: "range" } : { ok: true }));
  const r = new TextReader({ platform: "darwin", macHelper: "/Applications/Build-a-bot.app/Contents/Resources/bin/bab-audio-helper", spawn: f.spawn });
  assert.deepEqual(await r.around(), { ok: true, before: "e lab.", after: "Ne" });
  assert.deepEqual(f.commands, ["around"]);
  r.dispose();

  const long = fakeSpawn(() => ({ ok: true, before: "0123456789abcdef", after: "0123456789abcdef" }));
  const w = new TextReader({ platform: "win32", spawn: long.spawn });
  assert.deepEqual(await w.around(), { ok: true, before: "89abcdef", after: "01234567" }, "never more than a few characters");
  w.dispose();

  const secure = fakeSpawn(() => ({ ok: false, error: "secure" }));
  const s = new TextReader({ platform: "win32", spawn: secure.spawn });
  assert.deepEqual(await s.around(), { ok: false, error: "secure" });
  s.dispose();

  const odd = fakeSpawn(() => ({ ok: true, before: 42 }));
  const o = new TextReader({ platform: "win32", spawn: odd.spawn });
  assert.deepEqual(await o.around(), { ok: false, error: "unreadable" });
  o.dispose();

  assert.deepEqual(await new TextReader({ platform: "linux" }).around(), { ok: false, error: "unsupported" });
});

test("replies with what's next to the cursor are checked like any other", () => {
  assert.deepEqual(parseReply('{"ok":true,"before":"lab.","after":""}'), { ok: true, before: "lab.", after: "" });
  assert.deepEqual(parseReply('{"ok":true,"before":"lab.","after":7}'), { ok: false, error: "unreadable" });
  assert.deepEqual(parseReply('{"ok":true,"before":null}'), { ok: false, error: "unreadable" });
});

test("Windows: around reads a few characters on each side of the selection, never a password box", () => {
  assert.match(WIN_TEXT_SCRIPT, /elseif \(\$cmd -eq 'around'\)/);
  const fn = WIN_TEXT_SCRIPT.slice(WIN_TEXT_SCRIPT.indexOf("function Get-Around"));
  assert.match(fn, /if \(\$c\.IsPassword\) \{ return @\{ ok = \$false; error = 'secure' \} \}/);
  assert.match(fn, /if \(\[BabEditBox\]::IsPassword\(\$h\)\) \{ return @\{ ok = \$false; error = 'secure' \} \}/);
  assert.match(fn, /MoveEndpointByUnit\(\$startPoint, \$char, -4\)/);
  assert.match(fn, /MoveEndpointByUnit\(\$endPoint, \$char, 2\)/);
  // Kept to the box's own text (Chromium's ranges run on into the page around the box).
  assert.match(fn, /if \(\$pre\.CompareEndpoints\(\$startPoint, \$doc, \$startPoint\) -lt 0\) \{ \$pre\.MoveEndpointByRange\(\$startPoint, \$doc, \$startPoint\) \}/);
  assert.match(fn, /if \(\$post\.CompareEndpoints\(\$endPoint, \$doc, \$endPoint\) -gt 0\) \{ \$post\.MoveEndpointByRange\(\$endPoint, \$doc, \$endPoint\) \}/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("\nwhile")), /GetText\(-1\)|DocumentRange\.GetText/, "never the whole document's text");
});
