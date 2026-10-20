/**
 * Learning from a fix, and spacing a dictation, on a real computer (CI's windows-latest and
 * macos-latest), against real apps and real key presses:
 *
 *  - an Electron app's text box (Chromium: how Slack, Discord, Teams, VS Code and Chrome are read)
 *    and the system's own editor (Notepad on Windows, TextEdit on macOS): the reader finds the
 *    text and the caret;
 *  - a fix typed there with real keys ("pro zee" → "Prozzi"), seen by FixWatcher with the real
 *    reader, and learned; a different name typed over one ("Mark" → "Sarah") isn't;
 *  - what's right next to the cursor, and dictations pasted with the real paste keys, spaced
 *    against it (Paster with the real reader): "…the lab." + "Bring the slides." → "…the lab.
 *    Bring the slides.", and a word typed right before another gets a space after it;
 *  - a password box, which is never read.
 *
 * Windows: UI Automation, from the PowerShell the app runs; keys with SendInput (winkey.py).
 * macOS: the app's Swift helper (BAB_MAC_HELPER, default native/macos/build/bab-audio-helper);
 * keys with Quartz events (mackey.swift, built here unless BAB_E2E_MACKEY is given). Both need
 * Accessibility for the process running them (CI allows it, as an owner does for the app).
 *
 *   [BAB_MAC_HELPER=…/bab-audio-helper] node --test --test-timeout=300000 e2e/text-reader.e2e.mjs
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FixWatcher, normalizeText, normalizedIndex } from "../src/main/voice/fix-watch.mjs";
import { Paster } from "../src/main/voice/paste.mjs";
import { TextReader } from "../src/main/voice/text-reader.mjs";

const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const electronBin = () => createRequire(path.join(APP_DIR, "package.json"))("electron");
const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";
const MAC_HELPER = process.env.BAB_MAC_HELPER || path.join(APP_DIR, "native", "macos", "build", "bab-audio-helper");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 20_000, everyMs = 200) {
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
    await sleep(everyMs);
  }
}

function run(file, args) {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 60_000 }, (err, stdout, stderr) => (err ? reject(new Error(`${path.basename(file)} ${args.join(" ").slice(0, 120)}: ${stderr || err.message}`)) : resolve(String(stdout).trim()))),
  );
}

// ---- real keys --------------------------------------------------------------------------------

/** Windows: SendInput (e2e/fixtures/winkey.py). */
const winkey = (...args) => run("python", [path.join(FIXTURES, "winkey.py"), ...args.map(String)]);

/** Windows, when a box isn't read: what UI Automation sees around the focus (for the log). */
const UIA_DUMP = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$f = [System.Windows.Automation.AutomationElement]::FocusedElement
$w = [System.Windows.Automation.TreeWalker]::ControlViewWalker
function Show($e, $depth) {
  $c = $e.Current
  $p = $null
  $text = $e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$p)
  $value = $e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)
  ('  ' * $depth) + $c.ControlType.ProgrammaticName + ' class=' + $c.ClassName + ' keyboardFocus=' + $c.HasKeyboardFocus + ' text=' + $text + ' value=' + $value
}
'focused:'
Show $f 0
'its window, down three levels:'
$top = $f
while ($true) { $up = $w.GetParent($top); if ($up -eq $null -or $up -eq [System.Windows.Automation.AutomationElement]::RootElement) { break }; $top = $up }
function Walk($e, $depth) { Show $e $depth; if ($depth -ge 3) { return }; $k = $w.GetFirstChild($e); while ($k -ne $null) { Walk $k ($depth + 1); $k = $w.GetNextSibling($k) } }
Walk $top 0
`;
const uiaDump = () => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", UIA_DUMP]).catch((err) => `couldn't look: ${err.message}`);

/** macOS, when a box isn't read: which app the system says is in front (for the log). */
async function macFront() {
  try {
    const asn = await run("lsappinfo", ["front"]);
    return `front app: ${await run("lsappinfo", ["info", "-only", "name", asn])} (${asn})`;
  } catch (err) {
    return `couldn't look: ${/** @type {Error} */ (err).message}`;
  }
}
/** What the platform sees, when a box isn't read. */
const whatItSees = () => (WIN ? uiaDump() : macFront());

/** macOS: Quartz key events (e2e/fixtures/mackey.swift), built once. */
let mackeyBin = process.env.BAB_E2E_MACKEY || null;
async function mackey(...args) {
  if (!mackeyBin) {
    mackeyBin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bab-mackey-")), "mackey");
    await run("xcrun", ["swiftc", "-O", "-o", mackeyBin, path.join(FIXTURES, "mackey.swift")]);
  }
  return run(mackeyBin, args.map(String));
}

const keys = {
  /** Type text, a key at a time. */
  async type(text) {
    if (WIN) await winkey("type", text);
    else await mackey("type", text);
  },
  /** To the start of the line, then `n` characters right, then select the next `len`. */
  async selectFromLineStart(n, len) {
    const times = (k, args) => Array.from({ length: k }, () => args).flat();
    if (WIN) await winkey("tap", "Home", ...times(n, ["tap", "Right"]), "down", "LShift", ...times(len, ["tap", "Right"]), "up", "LShift");
    else await mackey("tap", "left", "cmd", ...times(n, ["tap", "right", "-"]), ...times(len, ["tap", "right", "shift"]));
  },
};

// ---- the other app ----------------------------------------------------------------------------

const work = fs.mkdtempSync(path.join(os.tmpdir(), "bab-text-reader-"));
const outFile = path.join(work, "target.txt");
const cmdFile = path.join(work, "target-cmd.json");
let target = null;
let cmdN = 0;
/** @type {TextReader | null} */
let reader = null;
const extra = [];

after(async () => {
  reader?.dispose();
  target?.kill();
  for (const stop of extra) await stop().catch(() => {});
});

/** The other app in front, as if clicked on. */
async function targetFront() {
  if (WIN) await winkey("focus", "Target app");
  else await targetDo({ cmd: "front" });
  await sleep(300);
}

async function startTarget() {
  target = spawn(electronBin(), [path.join(FIXTURES, "target-app.cjs")], {
    env: { ...process.env, TARGET_OUT: outFile, TARGET_CMD: cmdFile, TARGET_PASSWORD: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let failed = null;
  let pid = null;
  target.on("error", (err) => (failed = err));
  target.stdout.on("data", (d) => {
    const m = /target ready (\d+)/.exec(String(d));
    if (m) pid = Number(m[1]);
  });
  await until("the Electron app", () => {
    if (failed) throw failed;
    return pid;
  }, 60_000);
  return pid;
}

/** Do what a person does with the mouse in the other app (select words, click into a box). */
async function targetDo(c) {
  const n = ++cmdN;
  fs.writeFileSync(cmdFile, JSON.stringify({ n, ...c }));
  const done = await until(`the other app to ${c.cmd}`, () => fs.existsSync(`${cmdFile}.done`) && fs.readFileSync(`${cmdFile}.done`, "utf8").split(" ")[0] === String(n) && fs.readFileSync(`${cmdFile}.done`, "utf8"));
  if (done.includes("failed")) throw new Error(done);
  await sleep(150);
}

/** What's around the cursor, as the app asks right before typing (null when it can't tell). */
async function aroundCursor() {
  const r = await /** @type {TextReader} */ (reader).around();
  return r.ok ? { before: r.before, after: r.after } : null;
}

/**
 * Pasting the way the app does (paste.mjs), spaced with the real reader: the words go on the
 * clipboard (copied by the other app, as any app copies) and the real paste keys are pressed in
 * `front`'s window.
 * @param {() => Promise<unknown>} front  brings the app typed into to the front
 */
function realPaster(front) {
  const logs = [];
  const paster = new Paster({
    clipboard: /** @type {any} */ ({ writeText: (text) => targetDo({ cmd: "clip", text }), readText: async () => "", read: async () => [], write: async () => {}, clear() {} }),
    makeItem: (d) => d,
    press: async () => {
      await front();
      if (WIN) await winkey("down", "LControl", "tap", "V", "up", "LControl");
      else await mackey("tap", "v", "cmd");
      return true;
    },
    canPress: () => true,
    around: aroundCursor,
    log: (m) => logs.push(m),
  });
  /** Type `text` as a dictation into the app typed into. */
  const dictate = (text) => paster.insert(text, { space: true, restore: false, app: "Target app" });
  return { paster, dictate, logs };
}

/** Watch for a fix the way the app does after typing, with the real reader. */
function watchFor(text, app) {
  const fixes = [];
  const logs = [];
  const w = new FixWatcher({ reader: /** @type {TextReader} */ (reader), enabled: () => true, onFix: (f) => fixes.push(f), log: (m) => logs.push(m) });
  w.watch({ text, app });
  return { w, fixes, logs };
}

const ready = WIN || MAC;
const skip = ready ? false : "the readers run on Windows and macOS";

test("the reader answers (macOS: Accessibility is allowed)", { skip }, async () => {
  if (MAC) {
    assert.ok(fs.existsSync(MAC_HELPER), `no helper at ${MAC_HELPER}: run native/macos/build.sh, or set BAB_MAC_HELPER`);
    assert.equal(await mackey("trusted"), "true", "this process may not press keys (Accessibility)");
  }
  reader = new TextReader({ macHelper: MAC ? MAC_HELPER : null, log: (m) => console.log(m) });
  assert.equal(reader.supported, true);
  const r = await reader.ping();
  assert.equal(r.ok, true, JSON.stringify(r));
  if (MAC) assert.equal(r.trusted, true, "the helper isn't allowed to use Accessibility here (CI should allow it, as an owner does for the app)");
});

test("an Electron app's text box: the text in it, and where the caret is", { skip }, async () => {
  await startTarget();
  await targetFront();
  await targetDo({ cmd: "set", value: "Dear team,\nMeet pro zee at the lab." });
  // While the owner talks, the app in front is asked to get its accessibility tree ready.
  assert.equal((await reader.warm()).ok, true);
  let r;
  await until("the text box to be read", async () => {
    r = await reader.focus();
    return r.ok && normalizeText(r.value).text.includes("Meet pro zee");
  }, 15_000, 400).catch(async (err) => {
    throw new Error(`${err.message}; last answer: ${JSON.stringify({ ...r, value: r?.value === undefined ? undefined : `${r.value.length} characters` })}\n${await whatItSees()}`);
  });
  const text = normalizeText(r.value);
  assert.equal(text.text, "Dear team,\nMeet pro zee at the lab.");
  assert.ok(r.selection, `no caret in ${JSON.stringify({ ...r, value: undefined })}`);
  assert.equal(normalizedIndex(text.map, r.selection.location + r.selection.length), text.text.length, "the caret is at the end");
  console.log(`text reader: Electron box read (${r.role ?? "no role"}${r.detail ? `; ${r.detail}` : ""})`);
  await reader.forget();
});

test("a fix typed with real keys in an Electron app is learned; another name typed over one isn't", { skip }, async () => {
  await targetDo({ cmd: "set", value: "Dear team,\nMeet pro zee at the lab." });
  await targetFront();
  const { w, fixes, logs } = watchFor("Meet pro zee at the lab.", "Target app");
  await until("the typed words found", () => logs.some((m) => /watching/.test(m)) && w.found, 10_000, 100).catch((err) => {
    throw new Error(`${err.message}; log: ${logs.join(" | ")}`);
  });
  await targetDo({ cmd: "select", text: "pro zee" });
  await keys.type("Prozzi");
  await until("the fix in the box", () => fs.readFileSync(outFile, "utf8") === "Dear team,\nMeet Prozzi at the lab.", 10_000);
  await until("the fix learned", () => fixes.length > 0, 15_000).catch((err) => {
    throw new Error(`${err.message}; log: ${logs.join(" | ")}`);
  });
  assert.deepEqual(fixes[0].words, [{ text: "Prozzi", heard: ["pro zee"] }]);
  assert.equal(w.watching, true, "still watching for another fix");
  w.stop("off");
  for (const line of logs) assert.doesNotMatch(line, /Prozzi|pro zee|Meet|Dear/, "nothing read is logged");

  // "Mark" → "Sarah" is a different person, not a word it misheard.
  await targetDo({ cmd: "set", value: "Call Mark tomorrow about the lab." });
  const other = watchFor("Call Mark tomorrow about the lab.", "Target app");
  await until("the typed words found", () => other.w.found, 10_000, 100);
  await targetDo({ cmd: "select", text: "Mark" });
  await keys.type("Sarah");
  await until("the edit in the box", () => fs.readFileSync(outFile, "utf8") === "Call Sarah tomorrow about the lab.", 10_000);
  await sleep(5000);
  assert.equal(other.fixes.length, 0, "nothing learned from an edit");
  assert.equal(other.w.watching, true);
  other.w.stop("off");
});

test("what's next to the cursor, for spacing: a few characters on each side of it, or of the selection", { skip }, async () => {
  await targetFront();
  /**
   * The box set to `value`, with the caret at `place` (a number), the words `place` selected (a
   * string), or the caret at the end (null): what's read ends with `want.before` and starts with
   * `want.after` (exactly "" when there's nothing), a few characters at most.
   */
  const expect = async (value, place, want) => {
    await targetDo({ cmd: "set", value });
    if (typeof place === "number") await targetDo({ cmd: "caret", at: place });
    else if (typeof place === "string") await targetDo({ cmd: "select", text: place });
    // Chromium on Windows shows an empty box as an object character (U+FFFC): not text.
    const fits = (got, w, end) => {
      const text = got.replace(/\uFFFC/g, "");
      return w === "" ? text === "" : end ? text.endsWith(w) : text.startsWith(w);
    };
    let r;
    await until(`what's around the cursor in ${JSON.stringify(value)} (${JSON.stringify(place)})`, async () => {
      r = await /** @type {TextReader} */ (reader).ask("around");
      return r.ok && r.before.length <= 8 && r.after.length <= 4 && fits(normalizeText(r.before).text, want.before, true) && fits(normalizeText(r.after).text, want.after, false);
    }, 10_000, 300).catch(async (err) => {
      throw new Error(`${err.message}; last answer: ${JSON.stringify(r)}\n${await whatItSees()}`);
    });
    return r;
  };
  const r = await expect("Meet at the lab.", null, { before: "lab.", after: "" });
  console.log(`text reader: around the cursor in an Electron box (${r.role ?? "no role"}, via ${r.via ?? "?"})`);
  await expect("Hello world", "Hello ".length, { before: "llo ", after: "wo" });
  await expect("Hello there.", "there", { before: "llo ", after: "." });
  await expect("Dear team,\nThanks", "Dear team,\n".length, { before: "am,\n", after: "Th" });
  await expect("", null, { before: "", after: "" });
  await expect("Hi", 0, { before: "", after: "Hi" });
});

test("dictations pasted with the real keys into an Electron app's box: spaced against the words there", { skip }, async () => {
  const { dictate, logs } = realPaster(targetFront);
  const typed = () => fs.readFileSync(outFile, "utf8");
  await targetFront();
  await targetDo({ cmd: "set", value: "" });
  // Two in a row, as an owner dictates a sentence, then the next.
  await dictate("Meet at the lab.");
  await dictate("Bring the slides.");
  await until("both in the box", () => typed() === "Meet at the lab. Bring the slides.", 10_000).catch((err) => {
    throw new Error(`${err.message}; the box: ${JSON.stringify(typed())}; log: ${logs.join(" | ")}`);
  });
  // Right before a word: a space after it.
  await targetDo({ cmd: "set", value: "Thanks for the notes." });
  await targetDo({ cmd: "caret", at: "Thanks for the ".length });
  await dictate("great");
  await until("the word in the box", () => typed() === "Thanks for the great notes.", 10_000).catch((err) => {
    throw new Error(`${err.message}; the box: ${JSON.stringify(typed())}; log: ${logs.join(" | ")}`);
  });
  // After a line break, or in an empty box: as it is.
  await targetDo({ cmd: "set", value: "Dear Sam,\n" });
  await dictate("Thanks for the notes.");
  await until("the line in the box", () => typed() === "Dear Sam,\nThanks for the notes.", 10_000);
  await targetDo({ cmd: "set", value: "" });
  await dictate("Hi.");
  await until("the empty box typed into", () => typed() === "Hi.", 10_000);
  assert.deepEqual(logs, ["voice: spaced it (before; from the box)", "voice: spaced it (after; from the box)"], "what it did, never the words");
});

test("a password box is never read", { skip }, async () => {
  await targetFront();
  await targetDo({ cmd: "focus", id: "p" });
  await keys.type("hunter2 pro zee");
  const r = await reader.focus();
  assert.deepEqual(r, { ok: false, error: "secure" });
  assert.deepEqual(await reader.around(), { ok: false, error: "secure" }, "not even what's next to the cursor");
  // And a watch started there ends without reading anything.
  const { w, logs } = watchFor("hunter2 pro zee", "Target app");
  await until("the watch to end", () => !w.watching, 10_000, 100);
  assert.ok(logs.some((m) => /stopped watching \(secure\)/.test(m)), logs.join(" | "));
  await targetDo({ cmd: "focus", id: "t" });
});

test("the system's own editor (Notepad, TextEdit): read, and a fix typed there learned", { skip }, async () => {
  const typed = "Meet pro zee at the lab.";
  let ed;
  if (WIN) {
    ed = spawn("notepad.exe", [], { stdio: "ignore" });
    extra.push(async () => ed.kill());
    await until("Notepad", () => winkey("focus", "Notepad").then(() => true, () => false), 30_000, 500);
  } else {
    // A plain-text document, as it opens for anyone (no open panel, no rich text, no autocorrect).
    for (const [key, type, value] of [
      ["RichText", "-int", "0"],
      ["NSShowAppCentricOpenPanelInsteadOfUntitledFile", "-bool", "false"],
      ["CorrectSpellingAutomatically", "-bool", "false"],
      ["NSAutomaticSpellingCorrectionEnabled", "-bool", "false"],
      ["SmartQuotes", "-bool", "false"],
      ["TextReplacement", "-bool", "false"],
    ])
      await run("defaults", ["write", "com.apple.TextEdit", key, type, value]);
    await run("open", ["-a", "TextEdit"]);
    extra.push(() => run("pkill", ["-x", "TextEdit"]));
    // Its document's text view has the focus once it's open (else: File › New).
    let last;
    await until("TextEdit with a document", async () => {
      await run("open", ["-a", "TextEdit"]);
      last = await reader.focus();
      if (last.ok && last.role === "AXTextArea") return true;
      await mackey("tap", "n", "cmd");
      return false;
    }, 45_000, 1500).catch(async (err) => {
      throw new Error(`${err.message}; last answer: ${JSON.stringify({ ...last, value: last?.value === undefined ? undefined : `${last.value.length} characters` })}\n${await whatItSees()}`);
    });
    await reader.forget();
  }
  // An empty document (an editor may reopen the last one).
  if (WIN) await winkey("down", "LControl", "tap", "A", "up", "LControl", "tap", "Delete");
  else await mackey("tap", "a", "cmd", "tap", "delete", "-");
  await keys.type(typed);
  let r;
  await until(`${WIN ? "Notepad" : "TextEdit"}'s text read`, async () => {
    r = await reader.focus();
    return r.ok && normalizeText(r.value).text.trim() === typed;
  }, 10_000, 500).catch(async (err) => {
    const seen = JSON.stringify({ ...r, value: r?.value === undefined ? undefined : `${r.value.length} characters` });
    throw new Error(`${err.message}; last answer: ${seen}\n${await whatItSees()}`);
  });
  console.log(`text reader: ${WIN ? "Notepad" : "TextEdit"} read (${r.role ?? "no role"}, caret ${JSON.stringify(r.selection ?? null)}${r.detail ? `; ${r.detail}` : ""})`);
  await reader.forget();

  const { fixes, logs, w } = watchFor(typed, WIN ? "Notepad" : "TextEdit");
  await until("the typed words found", () => w.found, 10_000, 100).catch((err) => {
    throw new Error(`${err.message}; log: ${logs.join(" | ")}`);
  });
  await keys.selectFromLineStart("Meet ".length, "pro zee".length);
  await keys.type("Prozzi");
  await until("the fix learned", () => fixes.length > 0, 15_000).catch((err) => {
    throw new Error(`${err.message}; log: ${logs.join(" | ")}`);
  });
  assert.deepEqual(fixes[0].words, [{ text: "Prozzi", heard: ["pro zee"] }]);
  w.stop("off");

  // Spacing there: the caret to the end of the line, then a dictation pasted with the real keys.
  if (WIN) await winkey("focus", "Notepad", "tap", "End");
  else await mackey("tap", "right", "cmd");
  let a;
  await until("what's before the cursor", async () => {
    a = await reader.ask("around");
    return a.ok && a.before === "lab." && a.after === "";
  }, 10_000, 300).catch(async (err) => {
    throw new Error(`${err.message}; last answer: ${JSON.stringify(a)}\n${await whatItSees()}`);
  });
  console.log(`text reader: around the cursor in ${WIN ? "Notepad" : "TextEdit"} (${a.role ?? "no role"}, via ${a.via ?? "?"})`);
  const { dictate, logs: spaced } = realPaster(() => (WIN ? winkey("focus", "Notepad") : run("open", ["-a", "TextEdit"])));
  await dictate("See you there.");
  let r2;
  await until(`the dictation in ${WIN ? "Notepad" : "TextEdit"}`, async () => {
    r2 = await reader.focus();
    return r2.ok && normalizeText(r2.value).text.trim() === "Meet Prozzi at the lab. See you there.";
  }, 10_000, 500).catch((err) => {
    throw new Error(`${err.message}; last answer: ${JSON.stringify(r2?.ok ? normalizeText(r2.value).text : r2)}; log: ${spaced.join(" | ")}`);
  });
  await reader.forget();
});
