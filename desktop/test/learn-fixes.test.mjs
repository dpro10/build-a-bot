/**
 * Learning from a fix made where the words were typed, without a real screen: what's worth
 * learning (learn.mjs), finding the typed words in a text box and following them
 * (fix-watch.mjs, with a pretend box and clock), and the text readers' protocol (text-reader.mjs,
 * with a pretend helper). The real readers run against real apps in e2e/text-reader.e2e.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { learnFromFix, phoneticKey, soundsAlike, stillToLearn } from "../src/main/voice/learn.mjs";
import { FixWatcher, changedRange, findAnchor, moveAnchor, normalizeText, normalizedIndex } from "../src/main/voice/fix-watch.mjs";
import { MAX_CHARS, TextReader, WIN_TEXT_SCRIPT, parseReply } from "../src/main/voice/text-reader.mjs";

// ---------------------------------------------------------------------------
// What's worth learning
// ---------------------------------------------------------------------------

test("a misheard word replaced by one that sounds like it is learned, with what it heard", () => {
  assert.deepEqual(learnFromFix("Meet pro zee at the lab.", "Meet Prozzi at the lab."), [{ text: "Prozzi", heard: ["pro zee"] }]);
  assert.deepEqual(learnFromFix("Deploy it on cooper nettie's.", "Deploy it on Kubernetes."), [{ text: "Kubernetes", heard: ["cooper nettie's"] }]);
  assert.deepEqual(learnFromFix("Ask Jon about it.", "Ask John about it."), [{ text: "John", heard: ["Jon"] }]);
  assert.deepEqual(learnFromFix("Welcome to build a bot.", "Welcome to Build-a-bot."), [{ text: "Build-a-bot", heard: ["build a bot"] }]);
  assert.deepEqual(learnFromFix("I use next js daily.", "I use Next.js daily."), [{ text: "Next.js", heard: ["next js"] }]);
});

test("a word spelled its own way is learned without a “heard as”; an everyday capital isn't", () => {
  assert.deepEqual(learnFromFix("Push it to github.", "Push it to GitHub."), [{ text: "GitHub", heard: [] }]);
  assert.deepEqual(learnFromFix("Lets meet in vienna.", "Lets meet in Vienna."), []);
  assert.deepEqual(learnFromFix("Push it to github.", "Push it to GitHub.", ["GitHub"]), [], "already in the dictionary");
});

test("edits aren't learned: another name, an everyday word, the same word changed, added words, a rewrite", () => {
  assert.deepEqual(learnFromFix("Call Mark tomorrow.", "Call Sarah tomorrow."), [], "a different name");
  assert.deepEqual(learnFromFix("Tom is here.", "Sam is here."), [], "short names must sound the same");
  assert.deepEqual(learnFromFix("See you Tuesday.", "See you Thursday."), [], "an everyday word");
  assert.deepEqual(learnFromFix("their going home", "they're going home"), []);
  assert.deepEqual(learnFromFix("Ask Prozzi about it.", "Ask Prozzi's team about it."), [], "the same word changed");
  assert.deepEqual(learnFromFix("Meet at the cafe.", "Meet at Cafe Lola."), [], "everyday words it wrote");
  assert.deepEqual(learnFromFix("Meet pro zee at the lab.", "Meet pro zee at the lab. Also bring Diego."), [], "words added after it");
  assert.deepEqual(learnFromFix("We should ship the new build today.", "Honestly the release can wait until Friday."), [], "a rewrite");
  assert.deepEqual(learnFromFix("Ask pro zee.", "Ask Prozzi.", ["pro zee"]), [], "a word they taught is never turned into another");
});

test("at most three words from one fix, each once", () => {
  const before = "pro zee and ku ber net ease and nemo tron and dee go and pro zee";
  const after = "Prozzi and Kubernetes and Nemotron and Diego and Prozzi";
  const words = learnFromFix(before, after);
  assert.ok(words.length <= 3);
  assert.equal(new Set(words.map((w) => w.text)).size, words.length);
});

test("sounding alike: the server's rules, with room for longer words", () => {
  assert.equal(phoneticKey("Prozzi"), phoneticKey("pro zee"));
  assert.equal(phoneticKey("GitHub"), phoneticKey("git hub"));
  assert.equal(soundsAlike("Jon", "John"), true);
  assert.equal(soundsAlike("cooper nettie's", "Kubernetes"), true);
  assert.equal(soundsAlike("Tom", "Sam"), false);
  assert.equal(soundsAlike("Mark", "Sarah"), false);
  assert.equal(soundsAlike("a", "I"), false, "too short to tell");
});

test("what the dictionary already settles isn't added again, and its words are never remapped", () => {
  const words = [
    { text: "Prozzi", heard: ["pro zee"] },
    { text: "GitHub", heard: [] },
    { text: "Kubernetes", heard: ["cooper"] },
  ];
  assert.deepEqual(stillToLearn(words, ["github", "Cooper"]), [{ text: "Prozzi", heard: ["pro zee"] }]);
  assert.deepEqual(stillToLearn(words, ["Prozzi"]).map((w) => w.text), ["Prozzi", "GitHub", "Kubernetes"], "a new way to mishear a known word is still worth adding");
});

// ---------------------------------------------------------------------------
// Finding the typed words in the box
// ---------------------------------------------------------------------------

test("text reads the same however the app stores it, and the caret follows", () => {
  const { text, map } = normalizeText("Hi\r\nit’s “Prozzi” ​now");
  assert.equal(text, "Hi\nit's \"Prozzi\" now");
  assert.equal(map.length, text.length + 1);
  // The caret after "Hi\r\n" (index 4 in the original) is index 3 in the normalized text.
  assert.equal(normalizedIndex(map, 4), 3);
  assert.equal(normalizedIndex(map, 999), text.length);
  assert.equal(normalizedIndex(map, -1), null);
});

test("the typed words are found where the caret is, else the last place they are", () => {
  const box = "Meet pro zee. Later: Meet pro zee.";
  assert.deepEqual(findAnchor(box, "Meet pro zee.", 13), { start: 0, end: 13 });
  assert.deepEqual(findAnchor(box, "Meet pro zee.", null), { start: 21, end: 34 });
  assert.deepEqual(findAnchor(box, "Meet pro zee.", box.length), { start: 21, end: 34 });
  assert.equal(findAnchor(box, "Not there"), null);
});

/** Follow the typed words through readings, one change at a time, as the watcher does. */
function follow(readings, typed) {
  let prev = readings[0];
  let anchor = findAnchor(prev, typed);
  for (const cur of readings.slice(1)) {
    const change = changedRange(prev, cur);
    anchor = anchor && moveAnchor(anchor, change, cur.slice(change.start, change.after));
    if (!anchor) return null;
    prev = cur;
  }
  return prev.slice(anchor.start, anchor.end);
}

test("one change between two readings: where it is, what it took out and put in", () => {
  assert.deepEqual(changedRange("Meet pro zee at", "Meet Prozzi at"), { start: 5, before: 12, after: 11 });
  assert.deepEqual(changedRange("abc", "abc"), { start: 3, before: 3, after: 3 });
  assert.deepEqual(changedRange("", "hello"), { start: 0, before: 0, after: 5 });
  assert.deepEqual(changedRange("hello", ""), { start: 0, before: 5, after: 0 });
});

test("following the typed words: a fix inside them, text added before or after, the box sent or rewritten", () => {
  const typed = "Meet pro zee at the lab.";
  const base = `Dear team,\n${typed}\nThanks`;
  assert.equal(follow([base, "Dear team,\nMeet Prozzi at the lab.\nThanks"], typed), "Meet Prozzi at the lab.");
  assert.equal(follow([base, `Hi all, and dear team,\n${typed}\nThanks`, "Hi all, and dear team,\nMeet Prozzi at the lab.\nThanks"], typed), "Meet Prozzi at the lab.", "a greeting typed above");
  assert.equal(follow([base, `Dear team,\n${typed}\nThanks so much`, "Dear team,\nMeet Prozzi at the lab.\nThanks so much"], typed), "Meet Prozzi at the lab.", "text changed after");
  assert.equal(follow([`Notes: ${typed}`, `Notes: ${typed} Then call Mark.`], typed), `${typed} Then call Mark.`, "another dictation right after it is part of what's followed (and added words teach nothing)");
  assert.equal(follow([base, ""], typed), null, "sent or cleared");
  assert.equal(follow([base, "Something else entirely"], typed), null, "rewritten, or another box");
  assert.equal(follow([base, "Dear team,\nMeet pro zee at the"], typed), null, "a change across its edge");
});

test("a word deleted and typed again, at the start or the end, is still part of the words", () => {
  const end = "Notes: Meet pro zee";
  const steps = [end];
  for (let i = 1; i <= "pro zee".length; i++) steps.push(end.slice(0, end.length - i));
  for (const ch of "Prozzi") steps.push(steps[steps.length - 1] + ch);
  assert.equal(follow(steps, "Meet pro zee"), "Meet Prozzi");

  const start = "pro zee said hi";
  const back = [start];
  for (let i = 1; i <= "pro zee".length; i++) back.push(start.slice(i));
  let typed = "";
  for (const ch of "Prozzi") {
    typed += ch;
    back.push(typed + start.slice("pro zee".length));
  }
  assert.equal(follow(back, "pro zee said hi"), "Prozzi said hi");
});

// ---------------------------------------------------------------------------
// Watching the box (a pretend box and clock)
// ---------------------------------------------------------------------------

const TYPED = "Meet pro zee at the lab.";

/** A clock and timers the test moves forward by hand. */
function clock() {
  let now = 1_000_000;
  /** @type {Array<{ at: number, fn: () => void, id: number }>} */
  let timers = [];
  let ids = 0;
  const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, id: ++ids };
      timers.push(t);
      return t.id;
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
    /** Move time forward, running what comes due (and what that schedules) in order. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await settle();
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.fn();
      }
      now = end;
      await settle();
    },
    pending: () => timers.length,
  };
}

/**
 * A pretend text box the "owner" edits: `value` is what it holds; reads see it as it is then.
 * `focusError` / `readError` make the next calls fail that way.
 */
function box(initial = `Dear team,\n${TYPED}`) {
  const b = {
    value: initial,
    focusError: /** @type {string | null} */ (null),
    readErrors: /** @type {string[]} */ ([]),
    calls: /** @type {string[]} */ ([]),
    supported: true,
    async focus() {
      b.calls.push("focus");
      if (b.focusError) return { ok: false, error: b.focusError };
      return { ok: true, value: b.value, selection: { location: b.value.length, length: 0 } };
    },
    async read() {
      b.calls.push("read");
      const e = b.readErrors.shift();
      if (e) return { ok: false, error: e };
      return { ok: true, value: b.value };
    },
    async forget() {
      b.calls.push("forget");
      return { ok: true };
    },
  };
  return b;
}

function watcher(reader, opts = {}) {
  const c = clock();
  const fixes = [];
  const logs = [];
  let on = true;
  const w = new FixWatcher({
    reader,
    enabled: () => on,
    onFix: (f) => fixes.push(f),
    log: (m) => logs.push(m),
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    ...opts,
  });
  return { w, c, fixes, logs, off: () => (on = false) };
}

test("a fix that holds still for a few seconds is learned right away, and the watch goes on", async () => {
  const b = box();
  const { w, c, fixes } = watcher(b);
  w.watch({ text: TYPED, app: "Slack" });
  await c.advance(1000);
  assert.deepEqual(b.calls.slice(0, 1), ["focus"]);
  b.value = `Dear team,\nMeet Prozzi at the lab.`;
  await c.advance(2000);
  assert.equal(fixes.length, 0, "not yet: it might still be typed");
  await c.advance(1500);
  assert.deepEqual(fixes, [{ words: [{ text: "Prozzi", heard: ["pro zee"] }], app: "Slack" }]);
  assert.equal(w.watching, true);
  await c.advance(10_000);
  assert.equal(fixes.length, 1, "learned once");
});

test("a second word fixed later in the same watch is learned on its own", async () => {
  const b = box(`Dear team,\nMeet pro zee and cooper nettie's at the lab.`);
  const { w, c, fixes } = watcher(b);
  w.watch({ text: "Meet pro zee and cooper nettie's at the lab." });
  await c.advance(1000);
  b.value = `Dear team,\nMeet Prozzi and cooper nettie's at the lab.`;
  await c.advance(4000);
  b.value = `Dear team,\nMeet Prozzi and Kubernetes at the lab.`;
  await c.advance(4000);
  assert.deepEqual(
    fixes.map((f) => f.words),
    [[{ text: "Prozzi", heard: ["pro zee"] }], [{ text: "Kubernetes", heard: ["cooper nettie's"] }]],
  );
});

test("a word still being typed isn't learned, even when it sounds right", async () => {
  const b = box();
  const { w, c, fixes } = watcher(b);
  w.watch({ text: TYPED });
  await c.advance(1000);
  for (const partial of ["P", "Pr", "Pro", "Proz", "Prozz", "Prozzi"]) {
    b.value = `Dear team,\nMeet ${partial} at the lab.`;
    // A pause mid-word, thinking how it's spelled.
    await c.advance(partial === "Proz" ? 1500 : 250);
  }
  assert.equal(fixes.length, 0);
  await c.advance(3500);
  assert.deepEqual(fixes[0].words, [{ text: "Prozzi", heard: ["pro zee"] }], "the finished word, once it held still");
});

test("sent right after the fix held still a moment: learned; sent mid-word: nothing", async () => {
  {
    const b = box();
    const { w, c, fixes } = watcher(b);
    w.watch({ text: TYPED });
    await c.advance(1000);
    b.value = `Dear team,\nMeet Prozzi at the lab.`;
    await c.advance(1000);
    b.value = "";
    await c.advance(1000);
    assert.equal(w.watching, false, "the box was sent: the watch ends");
    assert.deepEqual(fixes.map((f) => f.words), [[{ text: "Prozzi", heard: ["pro zee"] }]]);
  }
  {
    const b = box();
    const { w, c, fixes } = watcher(b);
    w.watch({ text: TYPED });
    await c.advance(1000);
    b.value = `Dear team,\nMeet Proz at the lab.`;
    await c.advance(300);
    b.value = "";
    await c.advance(1000);
    assert.equal(w.watching, false);
    assert.equal(fixes.length, 0, "“Proz” was still being typed");
  }
});

test("dictating again into the same box: both are followed, and a fix in either is learned", async () => {
  const b = box();
  const { w, c, fixes } = watcher(b);
  w.watch({ text: TYPED });
  await c.advance(1000);
  b.value = `Dear team,\n${TYPED} Then ask cooper nettie's.`;
  w.watch({ text: "Then ask cooper nettie's." });
  await c.advance(1000);
  assert.equal(w.watches.length, 2);
  assert.equal(w.found, true);
  b.value = `Dear team,\nMeet Prozzi at the lab. Then ask cooper nettie's.`;
  await c.advance(4000);
  b.value = `Dear team,\nMeet Prozzi at the lab. Then ask Kubernetes.`;
  await c.advance(4000);
  assert.deepEqual(
    fixes.map((f) => f.words),
    [[{ text: "Prozzi", heard: ["pro zee"] }], [{ text: "Kubernetes", heard: ["cooper nettie's"] }]],
  );
});

test("dictating into another box: the first one's fix, if it held still a moment, is learned, and it stops", async () => {
  const b = box();
  const { w, c, fixes } = watcher(b);
  w.watch({ text: TYPED });
  await c.advance(1000);
  b.value = `Dear team,\nMeet Prozzi at the lab.`;
  await c.advance(900);
  // The next dictation goes into another app's box: the reader now reads that one.
  b.value = "Ping me later.";
  w.watch({ text: "Ping me later." });
  await c.advance(2000);
  assert.deepEqual(fixes.map((f) => f.words), [[{ text: "Prozzi", heard: ["pro zee"] }]]);
  assert.equal(w.watches.length, 1, "only the new one is followed");
  assert.equal(w.stats.ended.changed, 1);

  const b2 = box();
  const x = watcher(b2);
  x.w.watch({ text: TYPED });
  await x.c.advance(1000);
  b2.value = `Dear team,\nMeet Proz at the lab.`;
  await x.c.advance(200);
  b2.value = "Ping me later.";
  x.w.watch({ text: "Ping me later." });
  await x.c.advance(2000);
  assert.equal(x.fixes.length, 0, "changed just before: too soon to tell");
});

test("at most the last three dictations are followed; a word fixed in two of them is learned once", async () => {
  const b = box("");
  const { w, c, fixes } = watcher(b);
  const lines = ["Ask pro zee first.", "Then ask pro zee again.", "And the lab.", "Last one here."];
  for (const line of lines) {
    b.value = b.value ? `${b.value} ${line}` : line;
    w.watch({ text: line });
    await c.advance(1000);
  }
  assert.equal(w.watches.length, 3);
  assert.equal(w.stats.ended.next, 1);
  b.value = "Ask pro zee first. Then ask Prozzi again. And the lab. Last one here.";
  await c.advance(4000);
  assert.deepEqual(fixes.map((f) => f.words), [[{ text: "Prozzi", heard: ["pro zee"] }]]);
});

test("turned off while watching: nothing more is read or learned", async () => {
  const b = box();
  const { w, c, fixes } = watcher(b);
  w.watch({ text: TYPED });
  await c.advance(1000);
  b.value = `Dear team,\nMeet Prozzi at the lab.`;
  await c.advance(2000);
  w.stop("off");
  const reads = b.calls.filter((x) => x === "read").length;
  await c.advance(10_000);
  assert.equal(b.calls.filter((x) => x === "read").length, reads);
  assert.equal(fixes.length, 0);
  assert.equal(c.pending(), 0, "no timers left");
  assert.ok(b.calls.includes("forget"), "the helper lets go of the box");
});

test("nothing is watched when learning is off, can't run here, or the words are too short", async () => {
  const b = box();
  const x = watcher(b);
  x.off();
  x.w.watch({ text: TYPED });
  assert.equal(x.w.watching, false);
  const unsupported = { ...box(), supported: false };
  const y = watcher(unsupported);
  y.w.watch({ text: TYPED });
  assert.equal(y.w.watching, false);
  const z = watcher(box());
  z.w.watch({ text: "ok" });
  assert.equal(z.w.watching, false);
  await x.c.advance(5000);
  assert.deepEqual(b.calls, []);
});

test("a password box is never read; a box without the typed words is let go", async () => {
  const b = box();
  b.focusError = "secure";
  const { w, c } = watcher(b);
  w.watch({ text: TYPED });
  await c.advance(5000);
  assert.deepEqual(b.calls, ["focus", "forget"], "asked once, refused, let go");
  assert.equal(w.stats.ended.secure, 1);

  const other = box("Something else entirely");
  const x = watcher(other);
  x.w.watch({ text: TYPED });
  await x.c.advance(5000);
  assert.equal(other.calls.filter((k) => k === "focus").length, 6, "tried a few times while the app catches up");
  assert.equal(other.calls.includes("read"), false);
  assert.equal(x.w.stats.ended["not-found"], 1);
});

test("the words showing up a moment late are still found", async () => {
  const b = box("Dear team,\n");
  const { w, c, fixes } = watcher(b);
  w.watch({ text: TYPED });
  await c.advance(400);
  b.value = `Dear team,\n${TYPED}`;
  await c.advance(1000);
  b.value = `Dear team,\nMeet Prozzi at the lab.`;
  await c.advance(4000);
  assert.equal(fixes.length, 1);
});

test("a box that's busy for a moment is still watched; one that goes away ends the watch", async () => {
  const b = box();
  const { w, c, fixes } = watcher(b);
  w.watch({ text: TYPED });
  await c.advance(1000);
  b.readErrors.push("busy", "busy");
  b.value = `Dear team,\nMeet Prozzi at the lab.`;
  await c.advance(4000);
  assert.equal(fixes.length, 1, "two hiccups didn't end it");
  b.readErrors.push("gone");
  await c.advance(1000);
  assert.equal(w.watching, false);
  assert.equal(w.stats.ended.gone, 1);
});

test("one odd reading (an app showing an empty box for a moment) doesn't end it", async () => {
  const b = box();
  const { w, c, fixes } = watcher(b);
  w.watch({ text: TYPED });
  await c.advance(1000);
  b.value = "";
  await c.advance(300);
  b.value = `Dear team,\nMeet Prozzi at the lab.`;
  await c.advance(4000);
  assert.equal(w.watching, true);
  assert.deepEqual(fixes.map((f) => f.words), [[{ text: "Prozzi", heard: ["pro zee"] }]]);
});

test("Windows line endings and curly quotes in the box don't hide the typed words", async () => {
  const typed = "Tell pro zee “it’s fine”\nsee you";
  const b = box(`Hi\r\nTell pro zee “it’s fine”\r\nsee you`);
  const { w, c, fixes } = watcher(b);
  w.watch({ text: typed });
  await c.advance(1000);
  b.value = `Hi\r\nTell Prozzi “it’s fine”\r\nsee you`;
  await c.advance(4000);
  assert.deepEqual(fixes[0]?.words, [{ text: "Prozzi", heard: ["pro zee"] }]);
});

test("it stops after two minutes", async () => {
  const b = box();
  const { w, c } = watcher(b);
  w.watch({ text: TYPED });
  await c.advance(119_000);
  assert.equal(w.watching, true);
  await c.advance(2000);
  assert.equal(w.watching, false);
  assert.equal(w.stats.ended.time, 1);
});

test("nothing it reads is ever logged", async () => {
  const b = box();
  const { w, c, logs } = watcher(b);
  w.watch({ text: TYPED, app: "Slack" });
  await c.advance(1000);
  b.value = `Dear team,\nMeet Prozzi at the lab.`;
  await c.advance(4000);
  b.value = "";
  await c.advance(2000);
  assert.ok(logs.length >= 3);
  for (const line of logs) assert.doesNotMatch(line, /Prozzi|pro zee|Meet|lab|Dear/);
});

// ---------------------------------------------------------------------------
// The readers' protocol (a pretend helper)
// ---------------------------------------------------------------------------

test("a helper's answer is read carefully", () => {
  assert.deepEqual(parseReply('﻿{"ok":true,"value":"hi","selection":{"location":2,"length":0}}'), { ok: true, value: "hi", selection: { location: 2, length: 0 } });
  assert.deepEqual(parseReply("not json"), { ok: false, error: "unreadable" });
  assert.deepEqual(parseReply('{"value":"no ok"}'), { ok: false, error: "unreadable" });
  assert.deepEqual(parseReply('{"ok":true,"value":42}'), { ok: false, error: "unreadable" });
  assert.deepEqual(parseReply(JSON.stringify({ ok: true, value: "x".repeat(MAX_CHARS + 1) })), { ok: false, error: "too-long" });
  assert.deepEqual(parseReply('{"ok":true,"value":"hi","selection":{"location":-1,"length":0}}'), { ok: true, value: "hi" });
  assert.deepEqual(parseReply('{"ok":false,"error":"secure"}'), { ok: false, error: "secure" });
});

/** A pretend helper process: answers each command with `answer(cmd)` (or nothing, for undefined). */
function fakeSpawn(answer) {
  const spawned = [];
  const commands = [];
  const spawn = (file, args, opts) => {
    const child = new EventEmitter();
    const stdout = new EventEmitter();
    stdout.setEncoding = () => {};
    child.stdout = stdout;
    child.killed = false;
    child.stdin = Object.assign(new EventEmitter(), {
      write(line) {
        const cmd = String(line).trim();
        commands.push(cmd);
        const reply = answer(cmd, child);
        if (reply !== undefined) setImmediate(() => !child.killed && stdout.emit("data", typeof reply === "string" ? reply : `${JSON.stringify(reply)}\n`));
        return true;
      },
    });
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit("exit", null));
    };
    spawned.push({ file, args, opts, child });
    return child;
  };
  return { spawn, spawned, commands };
}

test("Windows: one PowerShell kept running reads the box with UI Automation, never a password box", async () => {
  const f = fakeSpawn((cmd) => (cmd === "focus" ? { ok: true, value: "hello", selection: { location: 5, length: 0 } } : cmd === "read" ? { ok: true, value: "hello!" } : { ok: true }));
  const r = new TextReader({ platform: "win32", spawn: f.spawn });
  assert.equal(r.supported, true);
  assert.deepEqual(await r.focus(), { ok: true, value: "hello", selection: { location: 5, length: 0 } });
  assert.deepEqual(await r.read(), { ok: true, value: "hello!" });
  assert.equal(f.spawned.length, 1, "kept running");
  const { file, args, opts } = f.spawned[0];
  assert.equal(file, "powershell.exe");
  assert.equal(opts.windowsHide, true);
  const script = Buffer.from(args[args.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le");
  assert.equal(script, WIN_TEXT_SCRIPT);
  assert.match(script, /IsPassword\) \{ return @\{ ok = \$false; error = 'secure' \}/);
  assert.match(script, new RegExp(`\\$max = ${MAX_CHARS}`));
  r.dispose();
});

test("macOS: the app's own helper reads it (and says whether Accessibility is allowed); Linux: not yet", async () => {
  const f = fakeSpawn((cmd) => (cmd === "ping" ? { ok: true, trusted: true } : { ok: false, error: "no-focus" }));
  const mac = new TextReader({ platform: "darwin", macHelper: "/Applications/Build-a-bot.app/Contents/Resources/bin/bab-audio-helper", spawn: f.spawn });
  assert.deepEqual(await mac.ping(), { ok: true, trusted: true });
  assert.deepEqual(f.spawned[0].args, ["text"]);
  mac.dispose();
  assert.equal(new TextReader({ platform: "darwin", macHelper: null, spawn: f.spawn }).supported, false, "no helper, no reading");
  const linux = new TextReader({ platform: "linux", spawn: f.spawn });
  assert.equal(linux.supported, false);
  assert.deepEqual(await linux.focus(), { ok: false, error: "unsupported" });
  assert.equal(f.spawned.length, 1);
});

test("questions go one at a time, and answers split or bunched up still match", async () => {
  let n = 0;
  const f = fakeSpawn((cmd, child) => {
    n++;
    if (n === 1) {
      // The first answer in two pieces.
      setImmediate(() => child.stdout.emit("data", '{"ok":true,"val'));
      setImmediate(() => setImmediate(() => child.stdout.emit("data", 'ue":"one"}\r\n')));
      return undefined;
    }
    return { ok: true, value: `${cmd}-${n}` };
  });
  const r = new TextReader({ platform: "win32", spawn: f.spawn });
  const [a, b, c] = await Promise.all([r.focus(), r.read(), r.read()]);
  assert.deepEqual([a.value, b.value, c.value], ["one", "read-2", "read-3"]);
  r.dispose();
});

test("a helper that doesn't answer is stopped and started again; one that keeps dying is left alone", async () => {
  let silent = true;
  const f = fakeSpawn(() => (silent ? undefined : { ok: true, value: "back" }));
  const logs = [];
  const r = new TextReader({ platform: "win32", spawn: f.spawn, timeoutMs: 30, startMs: 30, log: (m) => logs.push(m) });
  assert.deepEqual(await r.read(), { ok: false, error: "timeout" });
  assert.equal(f.spawned[0].child.killed, true);
  silent = false;
  assert.deepEqual(await r.read(), { ok: true, value: "back" });
  assert.equal(f.spawned.length, 2);
  assert.ok(logs.some((m) => /didn't answer/.test(m)));
  r.dispose();

  const dying = fakeSpawn((cmd, child) => {
    setImmediate(() => child.emit("exit", 1));
    return undefined;
  });
  const d = new TextReader({ platform: "win32", spawn: dying.spawn, timeoutMs: 1000, startMs: 1000 });
  for (let i = 0; i < 3; i++) assert.deepEqual(await d.read(), { ok: false, error: "unavailable" });
  assert.equal(d.broken, true);
  assert.deepEqual(await d.read(), { ok: false, error: "unavailable" });
  assert.equal(dying.spawned.length, 3, "not started a fourth time");
});

test("an idle helper stops on its own; stopped, it starts again when asked; disposed, never", async () => {
  const f = fakeSpawn(() => ({ ok: true, value: "x" }));
  const r = new TextReader({ platform: "win32", spawn: f.spawn, idleMs: 20 });
  await r.read();
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(f.spawned[0].child.killed, true, "idle: stopped");
  await r.read();
  assert.equal(f.spawned.length, 2, "asked again: started again");
  r.stop();
  assert.equal(f.spawned[1].child.killed, true);
  await r.warm();
  assert.equal(f.spawned.length, 3, "warmed up for the next dictation");
  assert.deepEqual(f.commands.slice(-1), ["prime"], "and the app in front asked to get ready");
  r.dispose();
  assert.deepEqual(await r.read(), { ok: false, error: "unavailable" });
  await r.warm();
  assert.equal(f.spawned.length, 3);
});
