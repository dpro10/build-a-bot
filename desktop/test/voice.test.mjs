/**
 * Voice typing in the desktop app, without a real keyboard, screen or server:
 * the shortcut's timing (hold, double tap, Esc, key combinations), the key listener, pasting and
 * putting the clipboard back, which app is in front, the local history and stats, learning from
 * fixes, and the whole flow in the controller.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { KEY, checkCustom, defaultShortcut, inShortcut, presetsFor, resolveShortcut, shortcutDown } from "../src/main/voice/keys.mjs";
import { hotkeyStep, initialHotkey } from "../src/main/voice/hotkey-machine.mjs";
import { Hotkey, ToggleHotkey } from "../src/main/voice/hotkey.mjs";
import { Paster, snapshotClipboard } from "../src/main/voice/paste.mjs";
import { categorize, parseActiveWindow, parseAsn, parseLsappinfo, parseWinForeground, parseXpropWindow, permissionApp } from "../src/main/voice/front-app.mjs";
import { VoiceHistory, addToStats, minutesSaved, wordsPerMinute, wordsThisWeek } from "../src/main/voice/history.mjs";
import { suggestWords } from "../src/main/voice/learn.mjs";
import { VoiceTyping, copiedNote, plain, voiceError } from "../src/main/voice/controller.mjs";
import { pillBounds, pillInteractive } from "../src/main/voice/pill-layout.mjs";
import { trayItems } from "../src/main/tray-menu.mjs";

const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 2));
};

// ---------------------------------------------------------------------------
// The shortcut
// ---------------------------------------------------------------------------

test("each platform's default shortcut is a key that types nothing on its own", () => {
  assert.equal(defaultShortcut("darwin").label, "Right Option (⌥)");
  assert.equal(defaultShortcut("win32").label, "Ctrl + Windows");
  assert.equal(defaultShortcut("linux").label, "Right Ctrl");
  const ctrlWin = defaultShortcut("win32");
  assert.equal(shortcutDown(ctrlWin, new Set([KEY.Ctrl])), false);
  assert.equal(shortcutDown(ctrlWin, new Set([KEY.CtrlRight, KEY.Meta])), true);
  assert.equal(inShortcut(defaultShortcut("darwin"), KEY.Alt), false, "only the right Option key");
  assert.equal(resolveShortcut({ shortcut: "meta-right" }, "darwin").label, "Right Command (⌘)");
  assert.equal(resolveShortcut({ shortcut: "nope" }, "darwin").id, "alt-right");
  assert.equal(resolveShortcut({ shortcut: "custom", customKeys: [KEY.CtrlRight, KEY.ShiftRight] }, "linux").label, "Right Ctrl + Right Shift");
  assert.ok(presetsFor("freebsd").length > 0);
});

test("a custom shortcut can't be a key that types", () => {
  assert.equal(checkCustom([KEY.AltRight]), null);
  assert.equal(checkCustom([KEY.F13]), null);
  assert.match(checkCustom([KEY.V]), /don't type/);
  assert.match(checkCustom([KEY.Shift]), /capitals/);
  assert.match(checkCustom([KEY.Escape]), /Esc cancels/);
  assert.match(checkCustom([KEY.Ctrl, KEY.Alt, KEY.Shift, KEY.Meta]), /three/);
});

/** Feed events to the machine; returns all effects in order. */
function run(events, timing) {
  let s = initialHotkey();
  const out = [];
  for (const ev of events) {
    const r = hotkeyStep(s, ev, timing);
    s = r.state;
    out.push(...r.effects);
  }
  return { effects: out, state: s };
}

test("hold to talk: recording starts once the hold is confirmed, and the release sends it", () => {
  const confirmed = run([
    { type: "down", at: 0 },
    { type: "tick", at: 100 },
  ]);
  assert.deepEqual(confirmed.effects, [], "not yet: it might be a key combination");
  const { effects, state } = run([
    { type: "down", at: 0 },
    { type: "tick", at: 200 },
    { type: "up", at: 1800 },
  ]);
  assert.deepEqual(effects, ["start", "stop"]);
  assert.equal(state.mode, "idle");
  // A tick that ran late counts as if on time.
  assert.deepEqual(run([{ type: "down", at: 0 }, { type: "up", at: 1800 }]).effects, ["start", "stop"]);
});

test("tap twice for hands-free, tap again to finish; a single quick tap does nothing at all", () => {
  assert.deepEqual(
    run([
      { type: "down", at: 0 },
      { type: "up", at: 120 },
      { type: "down", at: 300 },
      { type: "up", at: 380 },
      { type: "other", at: 2000, modifier: false },
      { type: "down", at: 9000 },
      { type: "up", at: 9100 },
    ]).effects,
    ["start", "handsfree", "stop"],
    "typing while it listens hands-free doesn't stop it",
  );
  const single = run([
    { type: "down", at: 0 },
    { type: "up", at: 100 },
    { type: "tick", at: 600 },
  ]);
  assert.deepEqual(single.effects, [], "no mic, no chime, nothing to cancel");
  assert.equal(single.state.mode, "idle");
  // A tap long enough to open the mic, and no second one: cancelled.
  assert.deepEqual(run([{ type: "down", at: 0 }, { type: "tick", at: 200 }, { type: "up", at: 230 }, { type: "tick", at: 700 }]).effects, ["start", "cancel"]);
  // Too slow for a double tap: the second press is a new hold.
  assert.deepEqual(
    run([
      { type: "down", at: 0 },
      { type: "up", at: 100 },
      { type: "tick", at: 500 },
      { type: "down", at: 900 },
      { type: "up", at: 2000 },
    ]).effects,
    ["start", "stop"],
  );
});

test("Esc cancels, and a key combination (⌥E, Ctrl+Win+→) isn't voice typing: before the mic opens, silently", () => {
  assert.deepEqual(
    run([
      { type: "down", at: 0 },
      { type: "escape", at: 900 },
      { type: "up", at: 1200 },
      { type: "down", at: 2000 },
      { type: "up", at: 3000 },
    ]).effects,
    ["start", "cancel", "start", "stop"],
    "after Esc it waits for the keys to be let go",
  );
  // Another key before the hold is confirmed: a key combination, left to the app. Nothing at all.
  const chord = run([{ type: "down", at: 0 }, { type: "other", at: 150, modifier: false }, { type: "tick", at: 250 }, { type: "up", at: 400 }]);
  assert.deepEqual(chord.effects, []);
  assert.equal(chord.state.mode, "idle");
  assert.deepEqual(run([{ type: "down", at: 0 }, { type: "other", at: 120, modifier: true }]).effects, [], "a modifier too");
  assert.deepEqual(run([{ type: "down", at: 0 }, { type: "escape", at: 100 }, { type: "up", at: 150 }]).effects, []);
  // After it's confirmed: a key soon after (or a modifier soon after) still cancels; long after, it's a resting finger.
  assert.deepEqual(run([{ type: "down", at: 0 }, { type: "tick", at: 200 }, { type: "other", at: 260, modifier: false }, { type: "up", at: 400 }]).effects, ["start", "cancel"]);
  assert.deepEqual(run([{ type: "down", at: 0 }, { type: "tick", at: 200 }, { type: "other", at: 300, modifier: true }]).effects, ["start", "cancel"]);
  assert.deepEqual(run([{ type: "down", at: 0 }, { type: "other", at: 3000, modifier: true }, { type: "up", at: 4000 }]).effects, ["start", "stop"]);
  // The pill's Done button and the time limit finish it like a press would.
  assert.deepEqual(run([{ type: "down", at: 0 }, { type: "up", at: 100 }, { type: "down", at: 200 }, { type: "up", at: 260 }, { type: "finish", at: 5000 }]).effects, ["start", "handsfree", "stop"]);
});

/** A fake uiohook: a test presses keys with press()/release(). */
function fakeHook() {
  const h = new EventEmitter();
  h.started = 0;
  h.taps = [];
  h.start = () => {
    h.started++;
  };
  h.stop = () => {};
  h.keyTap = (key, mods = []) => h.taps.push([key, ...mods]);
  h.press = (keycode, flags = {}) => h.emit("keydown", { keycode, ...flags });
  h.release = (keycode) => h.emit("keyup", { keycode });
  return h;
}

test("the key listener turns real key presses into start, stop and cancel", async () => {
  const hook = fakeHook();
  let now = 0;
  const hk = new Hotkey({ loadHook: async () => hook, shortcut: defaultShortcut("win32"), platform: "linux", now: () => now });
  const seen = [];
  for (const ev of ["start", "stop", "cancel", "handsfree"]) hk.on(ev, () => seen.push(ev));
  assert.deepEqual(await hk.enable(), { ok: true });
  // Ctrl, then Win: the shortcut is down only when both are, and the mic opens once it's held a moment.
  hook.press(KEY.Ctrl);
  assert.deepEqual(seen, []);
  hook.press(KEY.Meta, { ctrlKey: true });
  assert.deepEqual(seen, []);
  now = 300;
  // Key repeat while held changes nothing (the moment has passed by then: it's recording).
  hook.press(KEY.Meta, { ctrlKey: true });
  assert.deepEqual(seen, ["start"]);
  now = 2000;
  assert.equal(hk.modifiersHeld(), true);
  hook.release(KEY.Meta);
  assert.deepEqual(seen, ["start", "stop"]);
  hook.release(KEY.Ctrl);
  assert.equal(hk.modifiersHeld(), false);
  // Its own paste keys aren't the owner's.
  hk.expectSynthetic(KEY.Ctrl);
  hk.expectSynthetic(KEY.V);
  hook.press(KEY.Ctrl);
  hook.press(KEY.V);
  hook.release(KEY.V);
  hook.release(KEY.Ctrl);
  assert.equal(hk.modifiersHeld(), false);
  assert.deepEqual(seen, ["start", "stop"]);
});

test("a key combination that starts with the shortcut (⌥E, Ctrl+Win+→) never opens the mic; held on its own, it does, a moment later", async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timing = { confirmMs: 60, holdMs: 100 };
  const mac = fakeHook();
  const hk = new Hotkey({ loadHook: async () => mac, shortcut: defaultShortcut("darwin"), platform: "darwin", timing });
  const seen = [];
  for (const ev of ["start", "stop", "cancel", "handsfree"]) hk.on(ev, () => seen.push(ev));
  await hk.enable();
  // Right Option + E, typing an accented letter: nothing, then or later.
  mac.press(KEY.AltRight);
  mac.press(18, { altKey: true });
  mac.release(18);
  mac.release(KEY.AltRight);
  await sleep(150);
  assert.deepEqual(seen, []);
  assert.equal(hk.isRecording(), false);
  // Held on its own: recording starts after the moment, with no other key pressed.
  mac.press(KEY.AltRight);
  assert.deepEqual(seen, []);
  await sleep(150);
  assert.deepEqual(seen, ["start"]);
  mac.release(KEY.AltRight);
  assert.deepEqual(seen, ["start", "stop"]);

  // Windows: Ctrl + Win + → switches desktops. The Start-menu guard still taps F24, and nothing else happens.
  const win = fakeHook();
  const wk = new Hotkey({ loadHook: async () => win, shortcut: defaultShortcut("win32"), platform: "win32", timing });
  const wseen = [];
  for (const ev of ["start", "stop", "cancel", "handsfree"]) wk.on(ev, () => wseen.push(ev));
  await wk.enable();
  win.press(KEY.Ctrl);
  win.press(KEY.Meta, { ctrlKey: true });
  win.press(57421, { ctrlKey: true, metaKey: true });
  win.release(57421);
  win.release(KEY.Meta);
  win.release(KEY.Ctrl);
  await sleep(150);
  assert.deepEqual(wseen, []);
  assert.deepEqual(win.taps, [[KEY.F24]]);
});

test("a key let go while the hook wasn't looking doesn't stay stuck", async () => {
  const hook = fakeHook();
  const hk = new Hotkey({ loadHook: async () => hook, shortcut: defaultShortcut("linux"), platform: "linux" });
  await hk.enable();
  hook.press(KEY.CtrlRight);
  // The release was missed (the screen locked); the next key says Ctrl isn't held.
  hook.press(KEY.Space, { ctrlKey: false });
  assert.equal(hk.pressed.has(KEY.CtrlRight), false);
});

test("the key listener notes when Enter was pressed (when, not what was typed), for spacing the next dictation", async () => {
  const hook = fakeHook();
  let now = 5;
  const hk = new Hotkey({ loadHook: async () => hook, shortcut: defaultShortcut("linux"), platform: "linux", now: () => now });
  await hk.enable();
  assert.equal(hk.enterAt, 0);
  now = 1000;
  hook.press(KEY.Enter);
  hook.release(KEY.Enter);
  assert.equal(hk.enterAt, 1000);
  now = 2000;
  hook.press(KEY.NumpadEnter);
  assert.equal(hk.enterAt, 2000);
  now = 3000;
  hook.press(30);
  assert.equal(hk.enterAt, 2000, "other keys don't count");
});

test("Windows: pressing Ctrl+Win taps F24 so letting go doesn't open the Start menu", async () => {
  const hook = fakeHook();
  const hk = new Hotkey({ loadHook: async () => hook, shortcut: defaultShortcut("win32"), platform: "win32" });
  await hk.enable();
  hook.press(KEY.Ctrl);
  hook.press(KEY.Meta, { ctrlKey: true });
  assert.deepEqual(hook.taps, [[KEY.F24]]);
  // The F24 tap comes back through the hook and is ignored (it would otherwise cancel).
  const seen = [];
  hk.on("cancel", () => seen.push("cancel"));
  hook.press(KEY.F24, { ctrlKey: true, metaKey: true });
  hook.release(KEY.F24);
  assert.deepEqual(seen, []);
});

test("Shift with the shortcut asks to edit by voice, and never counts as a key combination", async () => {
  const hook = fakeHook();
  let now = 0;
  const hk = new Hotkey({ loadHook: async () => hook, shortcut: defaultShortcut("darwin"), platform: "darwin", now: () => now });
  const seen = [];
  hk.on("start", (o) => seen.push(`start:${o?.edit ? "edit" : "type"}`));
  for (const ev of ["stop", "cancel", "edit"]) hk.on(ev, () => seen.push(ev));
  await hk.enable();
  // Shift first, then Right Option.
  hook.press(KEY.Shift);
  hook.press(KEY.AltRight, { shiftKey: true });
  now = 1500;
  hook.release(KEY.AltRight);
  hook.release(KEY.Shift);
  assert.deepEqual(seen, ["start:edit", "stop"]);
  // Shift pressed right after the shortcut, before the mic opens: an edit from the start, no cancel.
  seen.length = 0;
  now = 5000;
  hook.press(KEY.AltRight);
  now = 5100;
  hook.press(KEY.ShiftRight, { altKey: true });
  now = 6000;
  hook.release(KEY.ShiftRight);
  hook.release(KEY.AltRight);
  assert.deepEqual(seen, ["start:edit", "stop"]);
  // Shift once it's listening (inside the key-combination window) switches to editing, no cancel.
  seen.length = 0;
  now = 8000;
  hook.press(KEY.AltRight);
  now = 8300;
  hook.press(KEY.ShiftRight, { altKey: true });
  now = 9000;
  hook.release(KEY.ShiftRight);
  hook.release(KEY.AltRight);
  assert.deepEqual(seen, ["start:type", "edit", "stop"]);
  // Shift when nothing is recording does nothing.
  seen.length = 0;
  hook.press(KEY.Shift);
  hook.release(KEY.Shift);
  assert.deepEqual(seen, []);
});

test("a shortcut that includes Shift can't also mean edit", async () => {
  const hook = fakeHook();
  const shortcut = resolveShortcut({ shortcut: "custom", customKeys: [KEY.CtrlRight, KEY.ShiftRight] }, "linux");
  let now = 0;
  const hk = new Hotkey({ loadHook: async () => hook, shortcut, platform: "linux", now: () => now });
  const seen = [];
  hk.on("start", (o) => seen.push(`start:${o?.edit ? "edit" : "type"}`));
  hk.on("edit", () => seen.push("edit"));
  await hk.enable();
  hook.press(KEY.CtrlRight);
  hook.press(KEY.ShiftRight, { ctrlKey: true });
  now = 300;
  hook.press(KEY.ShiftRight, { ctrlKey: true });
  assert.deepEqual(seen, ["start:type"]);
  assert.equal(hk.editHeld(), false);
});

test("a new shortcut is recorded from the keys pressed together", async () => {
  const hook = fakeHook();
  const hk = new Hotkey({ loadHook: async () => hook, shortcut: defaultShortcut("linux"), platform: "linux" });
  await hk.enable();
  const p = hk.recordShortcut(1000);
  hook.press(KEY.CtrlRight);
  hook.press(KEY.ShiftRight);
  hook.release(KEY.ShiftRight);
  hook.release(KEY.CtrlRight);
  assert.deepEqual(await p, [KEY.CtrlRight, KEY.ShiftRight]);
  const esc = hk.recordShortcut(1000);
  hook.press(KEY.Escape);
  assert.equal(await esc, null);
});

test("when the hook can't start, it says why", async () => {
  const hook = fakeHook();
  hook.start = () => {
    throw Object.assign(new Error("Failed to enable access for assistive devices."), { code: "UIOHOOK_ERROR_AXAPI_DISABLED" });
  };
  const hk = new Hotkey({ loadHook: async () => hook, shortcut: defaultShortcut("darwin"), platform: "darwin" });
  const r = await hk.enable();
  assert.equal(r.ok, false);
  assert.equal(r.code, "UIOHOOK_ERROR_AXAPI_DISABLED");
  assert.equal(hk.running, false);
});

test("the toggle shortcut (no hook): press to start, press to finish, Esc cancels", async () => {
  const handlers = {};
  const gs = {
    register: (acc, cb) => {
      handlers[acc] = cb;
      return true;
    },
    unregister: (acc) => delete handlers[acc],
  };
  const t = new ToggleHotkey({ globalShortcut: gs });
  const seen = [];
  for (const ev of ["start", "stop", "cancel", "handsfree"]) t.on(ev, () => seen.push(ev));
  assert.deepEqual(await t.enable(), { ok: true });
  handlers["CommandOrControl+Shift+Space"]();
  assert.ok(handlers.Escape, "Esc is taken only while it listens");
  handlers["CommandOrControl+Shift+Space"]();
  assert.equal(handlers.Escape, undefined);
  handlers["CommandOrControl+Shift+Space"]();
  handlers.Escape();
  assert.deepEqual(seen, ["start", "handsfree", "stop", "start", "handsfree", "cancel"]);
  const taken = new ToggleHotkey({ globalShortcut: { register: () => false, unregister() {} } });
  assert.equal((await taken.enable()).ok, false);
});

// ---------------------------------------------------------------------------
// Pasting
// ---------------------------------------------------------------------------

/** Electron 44's async clipboard, faked: one item with its formats ({ "text/plain": …, "text/html": … }). */
function fakeClipboard(initial = {}) {
  let data = { ...initial };
  return {
    writes: [],
    async read() {
      const d = data;
      return Object.keys(d).length ? [{ types: Object.keys(d), getType: async (t) => d[t] }] : [];
    },
    async readText() {
      return data["text/plain"] ?? "";
    },
    async writeText(text) {
      this.writes.push(text);
      data = { "text/plain": text };
    },
    async write(items) {
      data = Object.assign({}, ...items.map((i) => i.data));
    },
    clear() {
      data = {};
    },
    get data() {
      return data;
    },
    set(d) {
      data = { ...d };
    },
  };
}

const makeItem = (d) => ({ data: d });

test("pasting puts the words at the cursor, then puts the clipboard back", async () => {
  const before = { "text/plain": "what I had copied", "text/html": "<b>what I had copied</b>", "image/png": "PNG" };
  const cb = fakeClipboard(before);
  const pressed = [];
  const p = new Paster({ clipboard: cb, makeItem, press: async (cat) => (pressed.push(cat), cb.data["text/plain"]), canPress: () => true, restoreAfterMs: 5 });
  const r = await p.insert("Hello there.", { category: "chat" });
  assert.deepEqual(r, { pasted: true, copied: false });
  assert.deepEqual(pressed, ["chat"]);
  assert.deepEqual(cb.writes, ["Hello there."]);
  await p.restoring;
  assert.deepEqual(cb.data, before, "every format comes back, the image too");
});

test("the clipboard isn't put back over something copied in the meantime", async () => {
  const cb = fakeClipboard({ "text/plain": "old" });
  const p = new Paster({ clipboard: cb, makeItem, press: async () => true, canPress: () => true, restoreAfterMs: 20 });
  await p.insert("Dictated.");
  cb.set({ "text/plain": "copied just now" });
  await p.restoring;
  assert.equal(cb.data["text/plain"], "copied just now");
});

test("pastes happen one at a time, in order", async () => {
  const cb = fakeClipboard({ "text/plain": "old" });
  const seen = [];
  const p = new Paster({
    clipboard: cb,
    makeItem,
    press: async () => {
      seen.push(cb.data["text/plain"]);
      return true;
    },
    canPress: () => true,
    restoreAfterMs: 5,
  });
  await Promise.all([p.insert("First."), p.insert("Second.")]);
  await p.restoring;
  assert.deepEqual(seen, ["First.", "Second."]);
  assert.equal(cb.data["text/plain"], "old");
});

test("when it can't press keys, the words stay on the clipboard", async () => {
  const cb = fakeClipboard({ "text/plain": "old" });
  const p = new Paster({ clipboard: cb, makeItem, press: async () => true, canPress: () => false });
  assert.deepEqual(await p.insert("Hi."), { pasted: false, copied: true });
  assert.equal(cb.data["text/plain"], "Hi.");
  const failing = new Paster({ clipboard: cb, makeItem, press: async () => false, canPress: () => true });
  assert.deepEqual(await failing.insert("Again."), { pasted: false, copied: true });
  assert.equal(cb.data["text/plain"], "Again.");
  assert.deepEqual(await snapshotClipboard(fakeClipboard({ "image/png": "PNG" })), [{ "image/png": "PNG" }]);
  assert.deepEqual(await snapshotClipboard({ read: async () => Promise.reject(new Error("no clipboard")) }), []);
});

test("reading the selection: copy with a marker on the clipboard, then put the clipboard back", async () => {
  const before = { "text/plain": "what I had copied", "image/png": "PNG" };
  const cb = fakeClipboard(before);
  const pressed = [];
  // The app puts its selection on the clipboard a little after the key press.
  const pressCopy = async (cat) => {
    pressed.push(cat);
    setTimeout(() => cb.set({ "text/plain": "the selected words" }), 30);
    return true;
  };
  const p = new Paster({ clipboard: cb, makeItem, press: async () => true, pressCopy, canPress: () => true, copyWaitMs: 300 });
  assert.equal(await p.copySelection("chat"), "the selected words");
  assert.deepEqual(pressed, ["chat"]);
  assert.deepEqual(cb.data, before, "the clipboard is as it was, the image too");
  assert.match(cb.writes[0], /^\u2063bab-/, "a marker, so an unchanged clipboard means nothing was selected");
});

test("nothing selected, a terminal, no keys, or an editor copying a whole line: no selection", async () => {
  const cb = fakeClipboard({ "text/plain": "old" });
  let presses = 0;
  const p = new Paster({ clipboard: cb, makeItem, press: async () => true, pressCopy: async () => (presses++, true), canPress: () => true, copyWaitMs: 40 });
  // The app ignored the copy: the marker is still there.
  assert.equal(await p.copySelection("docs"), null);
  assert.equal(cb.data["text/plain"], "old");
  // A terminal: Ctrl+C there would stop the running program, so no key is pressed at all.
  presses = 0;
  assert.equal(await p.copySelection("terminal"), null);
  assert.equal(presses, 0);
  // Keys can't be pressed (no Accessibility yet).
  const noKeys = new Paster({ clipboard: cb, makeItem, press: async () => true, pressCopy: async () => true, canPress: () => false });
  assert.equal(await noKeys.copySelection("chat"), null);
  // Code editors copy the current line when nothing is selected.
  const lineCopy = new Paster({ clipboard: cb, makeItem, press: async () => true, pressCopy: async () => (cb.set({ "text/plain": "const a = 1;\n" }), true), canPress: () => true, copyWaitMs: 40 });
  assert.equal(await lineCopy.copySelection("code"), null);
  assert.equal(cb.data["text/plain"], "old");
  // …but a real multi-line selection in an editor is a selection.
  const block = new Paster({ clipboard: cb, makeItem, press: async () => true, pressCopy: async () => (cb.set({ "text/plain": "a = 1\nb = 2\n" }), true), canPress: () => true, copyWaitMs: 40 });
  assert.equal(await block.copySelection("code"), "a = 1\nb = 2\n");
});

// ---------------------------------------------------------------------------
// Which app is in front
// ---------------------------------------------------------------------------

test("the app in front, from each platform's answer", () => {
  assert.equal(parseAsn('"ASN:0x0-0x1d01d:"\n'), "ASN:0x0-0x1d01d:");
  assert.deepEqual(parseLsappinfo('"CFBundleIdentifier"="com.tinyspeck.slackmacgap"\n"LSDisplayName"="Slack"\n'), { id: "com.tinyspeck.slackmacgap", name: "Slack" });
  assert.equal(parseActiveWindow("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3a00007"), "0x3a00007");
  assert.equal(parseActiveWindow("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0"), null);
  assert.deepEqual(parseXpropWindow('WM_CLASS(STRING) = "slack", "Slack"\n_NET_WM_NAME(UTF8_STRING) = "general - Slack"'), { id: "slack", name: "Slack", title: "general - Slack" });
  assert.deepEqual(parseWinForeground("chrome|Inbox (3) - dana@gmail.com - Gmail - Google Chrome"), { id: "chrome", name: "chrome", title: "Inbox (3) - dana@gmail.com - Gmail - Google Chrome" });
});

test("apps sort into chat, email, code, terminal and docs; browser tabs by their title", () => {
  assert.deepEqual(categorize({ id: "com.tinyspeck.slackmacgap" }), { name: "Slack", category: "chat" });
  assert.deepEqual(categorize({ id: "OUTLOOK.EXE" }), { name: "Outlook", category: "email" });
  assert.deepEqual(categorize({ id: "com.todesktop.230313mzl4w4u92" }), { name: "Cursor", category: "code" });
  assert.deepEqual(categorize({ id: "WindowsTerminal" }), { name: "Windows Terminal", category: "terminal" });
  assert.deepEqual(categorize({ id: "com.jetbrains.goland", name: "GoLand" }), { name: "GoLand", category: "code" });
  assert.deepEqual(categorize({ id: "chrome", title: "Inbox (3) - dana@gmail.com - Gmail - Google Chrome" }), { name: "Gmail", category: "email" });
  assert.deepEqual(categorize({ id: "firefox", title: "general | Acme - Slack — Mozilla Firefox" }), { name: "Slack", category: "chat" });
  assert.deepEqual(categorize({ id: "com.google.chrome", title: null }), { name: "Chrome", category: "browser" });
  assert.deepEqual(categorize({ id: "com.example.unknown", name: "Unknown App" }), { name: "Unknown App", category: "other" });
});

test("macOS asks for the app that started it: Build-a-bot when installed, the terminal when run from source", () => {
  assert.equal(permissionApp({ platform: "darwin", packaged: true, env: { __CFBundleIdentifier: "com.apple.Terminal" } }), "Build-a-bot");
  assert.equal(permissionApp({ platform: "darwin", packaged: false, env: { __CFBundleIdentifier: "com.apple.Terminal", TERM_PROGRAM: "Apple_Terminal" } }), "Terminal");
  assert.equal(permissionApp({ platform: "darwin", packaged: false, env: { __CFBundleIdentifier: "com.microsoft.VSCode", TERM_PROGRAM: "vscode" } }), "VS Code");
  assert.equal(permissionApp({ platform: "darwin", packaged: false, env: { __CFBundleIdentifier: "com.todesktop.230313mzl4w4u92", TERM_PROGRAM: "vscode" } }), "Cursor");
  assert.equal(permissionApp({ platform: "darwin", packaged: false, env: { __CFBundleIdentifier: "com.googlecode.iterm2" } }), "iTerm");
  assert.equal(permissionApp({ platform: "darwin", packaged: false, env: { TERM_PROGRAM: "iTerm.app" } }), "iTerm");
  assert.equal(permissionApp({ platform: "darwin", packaged: false, env: {} }), "the app you started it from");
  // Windows and Linux don't ask per app.
  assert.equal(permissionApp({ platform: "win32", packaged: false, env: { TERM_PROGRAM: "vscode" } }), "Build-a-bot");
});

// ---------------------------------------------------------------------------
// History, stats, learning
// ---------------------------------------------------------------------------

const fakeSafe = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString("base64")}`),
  decryptString: (b) => Buffer.from(b.toString().slice(4), "base64").toString(),
};

test("history is encrypted on disk, capped, and gone without a keychain", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bab-voice-"));
  const file = path.join(dir, "voice-history.json");
  let now = Date.UTC(2026, 9, 15);
  const h = new VoiceHistory({ file, safeStorage: fakeSafe, secure: () => true, now: () => now });
  h.add({ kind: "text", text: "Secret plans for Friday.", words: 4 });
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("Secret plans"), "not in plain text");
  const again = new VoiceHistory({ file, safeStorage: fakeSafe, secure: () => true, now: () => now });
  assert.equal(again.list()[0].text, "Secret plans for Friday.");
  for (let i = 0; i < 120; i++) again.add({ kind: "text", text: `Line ${i}` });
  assert.equal(again.list().length, 100);
  assert.equal(again.lastText().text, "Line 119");
  now += 31 * 24 * 3600_000;
  assert.equal(again.list().length, 0, "nothing older than 30 days");
  again.clear();
  assert.equal(fs.existsSync(file), false);

  const noKeychain = new VoiceHistory({ file, safeStorage: fakeSafe, secure: () => false });
  noKeychain.add({ kind: "text", text: "Only in memory." });
  assert.equal(fs.existsSync(file), false);
  assert.equal(noKeychain.list().length, 1);
});

test("stats are numbers only: words this week, time saved, speed", () => {
  const day = Date.UTC(2026, 9, 15, 12);
  let s = addToStats(null, { words: 120, spokenMs: 50_000, at: day });
  s = addToStats(s, { words: 80, spokenMs: 30_000, at: day - 2 * 86_400_000 });
  s = addToStats(s, { words: 500, spokenMs: 200_000, at: day - 9 * 86_400_000 });
  assert.equal(wordsThisWeek(s, day), 200);
  assert.equal(s.total, 700);
  assert.equal(s.dictations, 3);
  assert.equal(minutesSaved(700, 280_000), 13);
  assert.equal(wordsPerMinute(s), 150);
  assert.equal(wordsPerMinute(addToStats(null, { words: 10, spokenMs: 5000, at: day })), null);
});

test("fixing a dictation suggests the names that were misheard", () => {
  assert.deepEqual(suggestWords("I talked to pro zee about it.", "I talked to Prozzi about it."), [{ text: "Prozzi", heard: ["pro zee"] }]);
  assert.deepEqual(suggestWords("Push it to github.", "Push it to GitHub."), [{ text: "GitHub", heard: [] }]);
  assert.deepEqual(suggestWords("Their going home.", "They're going home."), []);
  assert.deepEqual(suggestWords("Meet at the cafe.", "Meet at Cafe Lola."), [{ text: "Cafe Lola", heard: [] }]);
  assert.deepEqual(suggestWords("Ask pro zee.", "Ask Prozzi.", ["Prozzi"]), [{ text: "Prozzi", heard: ["pro zee"] }], "a new way it's misheard is still worth adding");
  assert.deepEqual(suggestWords("Ask Prozzi.", "Ask Prozzi."), []);
});

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

function settingsStub(voice = {}) {
  let data = {
    voiceStats: null,
    voice: { enabled: true, polish: true, styles: true, commands: true, sounds: false, language: "auto", micId: "default", history: true, restoreClipboard: true, ...voice },
  };
  return {
    get: () => data,
    update(p) {
      data = { ...data, ...p };
      return data;
    },
    updateVoice(p) {
      data = { ...data, voice: { ...data.voice, ...p } };
      return data;
    },
  };
}

function setupVoice(opts = {}) {
  const calls = [];
  const states = [];
  const starts = [];
  const pill = {
    async show(s) {
      states.push(s);
      return true;
    },
    update(s) {
      states.push(s);
    },
    hide() {
      calls.push("pill.hide");
    },
    async start(o) {
      starts.push(o);
      calls.push(`mic.start:${o.micId}`);
      return opts.micError ? { ok: false, error: opts.micError } : { ok: true };
    },
    async stop() {
      calls.push("mic.stop");
      return { bytes: new Uint8Array(3000), mime: "audio/webm", durationMs: opts.durationMs ?? 2400, speechMs: 1900 };
    },
    async cancel() {
      calls.push("mic.cancel");
    },
  };
  const results = [...(opts.results ?? [{ kind: "text", text: "Let's meet at 3.", heard: "um let's meet at two no three", words: 4, polished: true, usage: { words: 4, limit: 8000 } }])];
  const api = {
    async dictate(rec, p) {
      calls.push(`api.dictate:${p.category ?? "-"}:${p.app ?? "-"}:polish=${p.polish}:commands=${p.commands}`);
      const r = results.shift();
      if (r instanceof Error) throw r;
      return r;
    },
    async edit(p) {
      calls.push(`api.edit:${p.instruction}:${p.selection ?? "-"}:${p.category}:${p.app ?? "-"}`);
      const r = (opts.editResults ?? [{ kind: "replace", text: "Hi! Let's meet at 3. Thanks so much!", words: 8, usage: { words: 12, limit: 8000 }, ms: 420 }]).shift();
      if (r instanceof Error) throw r;
      return r;
    },
    async ask(botId, text, onEvent, o) {
      calls.push(`api.ask:${botId}:${text}`);
      if (o?.selection) calls.push(`api.ask.selection:${o.selection}`);
      if (opts.askError) throw opts.askError;
      onEvent({ type: "tool", state: "running", title: "Setting a reminder" });
      onEvent({ type: "text", delta: "**Done!** I'll remind you" });
      onEvent({ type: "done", text: "**Done!** I'll remind you to call Mom tomorrow at 5 PM.", status: "ok" });
    },
  };
  const pasted = [];
  const inserts = [];
  const paster = {
    async insert(text, o) {
      pasted.push(text);
      inserts.push(o ?? {});
      calls.push(`paste:${o?.category ?? "-"}`);
      return opts.canPaste === false ? { pasted: false, copied: true } : { pasted: true, copied: false };
    },
    copy(text) {
      calls.push(`copy:${text}`);
    },
    async copySelection(category) {
      calls.push(`copySelection:${category}`);
      return opts.selection === undefined ? "lets meet at 3" : opts.selection;
    },
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bab-voice-c-"));
  const history = new VoiceHistory({ file: path.join(dir, "h.json"), safeStorage: fakeSafe, secure: () => true });
  const bots = [{ id: "bot_1", name: "Otto", color: "grape", avatar: "otto" }];
  const account = { device: opts.unpaired ? null : { server: "https://x" }, session: { voice: { available: opts.serverHears !== false, edit: opts.serverEdit ?? true } }, appUrl: () => "https://x", refresh: async () => {}, bots: () => bots };
  const hotkey = new EventEmitter();
  hotkey.finish = () => hotkey.emit("stop");
  hotkey.abort = () => calls.push("hotkey.abort");
  hotkey.isRecording = () => false;
  hotkey.startHandsfree = () => calls.push("hotkey.handsfree");
  const opened = [];
  const v = new VoiceTyping({
    settings: settingsStub(opts.voice),
    account,
    api,
    hotkey,
    pill,
    paster,
    frontApp: { detect: async () => opts.app ?? { name: "Slack", category: "chat" } },
    history,
    canPaste: () => opts.canPaste !== false,
    ensureMic: async () => opts.micAllowed !== false,
    localReady: () => Boolean(opts.localReady),
    ...(opts.wantWav !== undefined ? { wantWav: () => Boolean(opts.wantWav) } : {}),
    cantHear: opts.cantHear,
    open: (t, x) => opened.push([t, x]),
    platform: opts.platform ?? "darwin",
    limits: { doneMs: 30, noteMs: 30, errorMs: 30, replyMs: 60_000 },
  });
  return { v, hotkey, calls, states, starts, pasted, inserts, history, opened, phases: () => states.map((s) => s.phase) };
}

test("hold, talk, let go: it's typed where the cursor is, in the app's style", async () => {
  const env = setupVoice();
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  assert.deepEqual(env.calls.slice(0, 5), ["mic.start:default", "mic.stop", "api.dictate:chat:Slack:polish=true:commands=true", "paste:chat", "pill.hide"].slice(0, 4).concat(env.calls[4] ? [env.calls[4]] : []));
  assert.deepEqual(env.pasted, ["Let's meet at 3."]);
  assert.deepEqual(env.phases().slice(0, 3), ["listening", "working", "done"]);
  const h = env.history.list()[0];
  assert.equal(h.text, "Let's meet at 3.");
  assert.equal(h.app, "Slack");
  assert.equal(env.v.settings.get().voiceStats.total, 4);
  assert.deepEqual(env.v.usage, { words: 4, limit: 8000 });
});

test("a dictation is spaced against the words next to the cursor (in the app it went to), unless spacing is off", async () => {
  const env = setupVoice();
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  assert.deepEqual(env.inserts, [{ category: "chat", restore: true, space: true, app: "Slack" }]);
  // What's kept is what was said, without the spacing.
  assert.equal(env.history.list()[0].text, "Let's meet at 3.");

  const off = setupVoice({ voice: { spacing: false } });
  off.hotkey.emit("start");
  await flush();
  off.hotkey.emit("stop");
  await flush(20);
  assert.equal(off.inserts[0].space, false);

  // Over a selection, the edit replaces exactly what was selected; written at the cursor, it's spaced.
  const edit = setupVoice({ results: [{ kind: "text", text: "Make it friendlier.", words: 3 }] });
  edit.hotkey.emit("start", { edit: true });
  await flush();
  edit.hotkey.emit("stop");
  await flush(30);
  assert.deepEqual(edit.inserts, [{ category: "chat", restore: true, space: false, app: "Slack" }]);
  const write = setupVoice({ selection: null, results: [{ kind: "text", text: "Write a short thank-you note.", words: 5 }], editResults: [{ kind: "replace", text: "Thank you so much for your help!", words: 6, ms: 300 }] });
  write.hotkey.emit("start", { edit: true });
  await flush();
  write.hotkey.emit("stop");
  await flush(30);
  assert.deepEqual(write.inserts, [{ category: "chat", restore: true, space: true, app: "Slack" }]);
});

test("a server that doesn't hear recordings, and Parakeet not ready yet: the pill says why, and nothing is recorded, sent or typed", async () => {
  const why = { code: "on-device", message: "Getting NVIDIA Parakeet: 45%. Voice typing works as soon as it's done.", actions: ["settings"] };
  const env = setupVoice({ serverHears: false, cantHear: () => why });
  env.hotkey.emit("start");
  await flush(20);
  assert.ok(!env.calls.some((c) => c.startsWith("mic.") || c.startsWith("api.")), env.calls.join("\n"));
  assert.ok(env.calls.includes("hotkey.abort"));
  const shown = env.states.at(-1);
  assert.equal(shown.phase, "error");
  assert.equal(shown.message, why.message);
  assert.deepEqual(shown.actions, ["settings"]);
  assert.deepEqual(env.pasted, []);

  // Once Parakeet is ready, it hears on this computer as usual.
  const ready = setupVoice({ serverHears: false, cantHear: () => null, localReady: true });
  ready.hotkey.emit("start");
  await flush();
  ready.hotkey.emit("stop");
  await flush(20);
  assert.deepEqual(ready.pasted, ["Let's meet at 3."]);

  // The reasons the app gives keep their own words and buttons.
  assert.deepEqual(voiceError(why), { message: why.message, actions: ["settings"] });
});

test("started offline: the pill says it can't reach Build-a-bot, and Try again sends the same recording (with its WAV for Parakeet) once it can", async () => {
  const offline = Object.assign(new Error("Can't reach Build-a-bot"), { code: "network", actions: ["retry"] });
  const env = setupVoice({ wantWav: true, localReady: false, results: [offline, { kind: "text", text: "Back online.", words: 2 }] });
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  assert.equal(env.starts[0].wav, true, "WAV for Parakeet, before the session says the server takes words");
  const shown = env.states.at(-1);
  assert.equal(shown.phase, "error");
  assert.equal(shown.message, "I can't reach Build-a-bot. Check your internet.");
  assert.deepEqual(shown.actions, ["retry"]);
  assert.deepEqual(env.pasted, []);
  await env.v.action("retry");
  await flush(20);
  assert.deepEqual(env.pasted, ["Back online."]);
  // Without Parakeet here, no WAV is made.
  const plain = setupVoice({ wantWav: false });
  plain.hotkey.emit("start");
  await flush();
  assert.equal(plain.starts[0].wav, false);
});

test("an app it doesn't recognize is sent as 'other', without its name (kept only in local history)", async () => {
  const env = setupVoice({ app: { name: "Acme Payroll Admin", category: "other" } });
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  assert.ok(env.calls.includes("api.dictate:other:-:polish=true:commands=true"), env.calls.join("\n"));
  assert.equal(env.history.list()[0].app, "Acme Payroll Admin");
});

test("letting go while the mic is still opening still sends it", async () => {
  const env = setupVoice();
  env.hotkey.emit("start");
  env.hotkey.emit("stop");
  await flush(20);
  assert.ok(env.calls.includes("mic.stop"));
  assert.deepEqual(env.pasted, ["Let's meet at 3."]);
});

test("Esc throws the recording away and sends nothing", async () => {
  const env = setupVoice();
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("cancel");
  await flush();
  assert.ok(env.calls.includes("mic.cancel"));
  assert.ok(!env.calls.some((c) => c.startsWith("api.")));
  assert.equal(env.v.isRecording(), false);
});

test("\"Hey Otto, …\" asks the bot and shows its answer, with Paste, Copy and Reply", async () => {
  const env = setupVoice({ results: [{ kind: "command", bot: { id: "bot_1", name: "Otto" }, command: "Remind me to call Mom tomorrow at 5.", text: "Hey Otto, remind me to call Mom tomorrow at 5.", heard: "" }] });
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  assert.ok(env.calls.includes("api.ask:bot_1:Remind me to call Mom tomorrow at 5."));
  assert.deepEqual(env.pasted, [], "nothing typed");
  const reply = env.states.at(-1);
  assert.equal(reply.phase, "reply");
  assert.equal(reply.message, "Done! I'll remind you to call Mom tomorrow at 5 PM.");
  assert.deepEqual(reply.actions, ["paste", "copy", "reply", "chat"]);
  assert.ok(env.states.some((s) => s.label === "Setting a reminder…"), "shows what it's doing");
  await env.v.action("paste");
  assert.deepEqual(env.pasted, ["Done! I'll remind you to call Mom tomorrow at 5 PM."]);
  assert.equal(env.history.list()[0].kind, "command");
});

test("\"Type it instead\" types the whole dictation when it wasn't meant for the bot", async () => {
  const env = setupVoice({ results: [{ kind: "command", bot: { id: "bot_1", name: "Otto" }, command: "Are you free tonight?", text: "Hey Otto, are you free tonight?", heard: "" }] });
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  await env.v.action("type-instead");
  assert.deepEqual(env.pasted, ["Hey Otto, are you free tonight?"]);
});

test("Reply records hands-free for the bot, whatever it starts with", async () => {
  const env = setupVoice({
    results: [
      { kind: "command", bot: { id: "bot_1", name: "Otto" }, command: "What's on my calendar?", text: "Hey Otto, what's on my calendar?", heard: "" },
      { kind: "text", text: "Move the 3 PM to Friday.", heard: "", words: 5 },
    ],
  });
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  await env.v.action("reply");
  await flush();
  assert.ok(env.calls.includes("hotkey.handsfree"));
  assert.equal(env.states.at(-1).replying, true);
  env.hotkey.emit("stop");
  await flush(20);
  assert.ok(env.calls.includes("api.dictate:chat:Slack:polish=true:commands=false"), "a reply never becomes another command");
  assert.ok(env.calls.includes("api.ask:bot_1:Move the 3 PM to Friday."));
});

test("a failed send can be tried again with the same recording (kept in memory only)", async () => {
  const env = setupVoice({ results: [Object.assign(new Error("Can't reach Build-a-bot"), { status: 0, code: "network" }), { kind: "text", text: "Second try.", heard: "", words: 2 }] });
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  const err = env.states.at(-1);
  assert.equal(err.phase, "error");
  assert.deepEqual(err.actions, ["retry"]);
  await env.v.action("retry");
  await flush(20);
  assert.deepEqual(env.pasted, ["Second try."]);
  assert.equal(env.v.failed, null);
});

test("errors say what to do: out of credit, unpaired, the microphone", async () => {
  assert.deepEqual(voiceError({ status: 402, code: "no_credit", message: "You're out of credit. Add credit in Credit & usage to keep going." }), {
    message: "You're out of credit. Add credit in Credit & usage to keep going.",
    actions: ["upgrade"],
  });
  assert.equal(voiceError({ status: 402 }).message, "You're out of credit. Add some to keep going.");
  assert.deepEqual(voiceError({ status: 401 }).actions, ["pair"]);
  assert.deepEqual(voiceError({ code: "mic-denied" }).actions, ["mic-settings"]);
  assert.match(copiedNote("darwin", false), /Accessibility/);
  assert.match(copiedNote("win32", true), /Ctrl\+V/);

  const unpaired = setupVoice({ unpaired: true });
  unpaired.hotkey.emit("start");
  await flush();
  assert.equal(unpaired.states.at(-1).phase, "error");
  assert.ok(!unpaired.calls.some((c) => c.startsWith("mic.")), "the mic never opens");

  const noMic = setupVoice({ micError: "NotAllowedError: Permission denied" });
  noMic.hotkey.emit("start");
  await flush();
  assert.deepEqual(noMic.states.at(-1).actions, ["mic-settings"]);
  assert.ok(noMic.calls.includes("hotkey.abort"));
});

test("without Accessibility on a Mac, the words are copied and the pill says so", async () => {
  const env = setupVoice({ canPaste: false });
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  const note = env.states.at(-1);
  assert.equal(note.phase, "note");
  assert.match(note.message, /Copied/);
  assert.deepEqual(note.actions, ["accessibility"]);
});

test("with history off, nothing is kept; unpairing forgets it all", async () => {
  const env = setupVoice({ voice: { history: false } });
  env.hotkey.emit("start");
  await flush();
  env.hotkey.emit("stop");
  await flush(20);
  assert.equal(env.history.list().length, 0);
  assert.deepEqual(env.pasted, ["Let's meet at 3."]);

  const other = setupVoice();
  other.hotkey.emit("start");
  await flush();
  other.hotkey.emit("stop");
  await flush(20);
  assert.equal(other.history.list().length, 1);
  other.v.forget();
  assert.equal(other.history.list().length, 0);
  assert.equal(other.v.last, null);
});

test("Shift + shortcut: the selection is changed the way they said, and pasted over it", async () => {
  const env = setupVoice({ results: [{ kind: "text", text: "Make it friendlier.", words: 3, usage: { words: 3, limit: 8000 } }] });
  env.hotkey.emit("start", { edit: true });
  await flush();
  assert.equal(env.states[0].edit, true, "the pill shows it's an edit");
  env.hotkey.emit("stop");
  await flush(30);
  assert.deepEqual(
    env.calls.filter((c) => !c.startsWith("pill.")),
    ["mic.start:default", "mic.stop", "copySelection:chat", "api.dictate:chat:-:polish=false:commands=true", "api.edit:Make it friendlier.:lets meet at 3:chat:Slack", "paste:chat"],
  );
  assert.deepEqual(env.pasted, ["Hi! Let's meet at 3. Thanks so much!"]);
  const done = env.states.find((st) => st.phase === "done");
  assert.equal(done.edit, true);
  assert.equal(done.hint, "⌘Z undoes it");
  assert.ok(env.states.some((st) => st.phase === "working" && st.label === "Changing it…"));
  const h = env.history.list()[0];
  assert.deepEqual([h.kind, h.instruction, h.text], ["edit", "Make it friendlier.", "Hi! Let's meet at 3. Thanks so much!"]);
  // "Paste last dictation" pastes the edit.
  assert.equal(env.history.lastText().text, "Hi! Let's meet at 3. Thanks so much!");
});

test("with nothing selected it writes at the cursor; a question gets an answer in the pill", async () => {
  const write = setupVoice({ selection: null, results: [{ kind: "text", text: "Write a short thank-you note.", words: 5 }], editResults: [{ kind: "replace", text: "Thank you so much for your help!", words: 6, ms: 300 }] });
  write.hotkey.emit("start", { edit: true });
  await flush();
  write.hotkey.emit("stop");
  await flush(30);
  assert.ok(write.calls.includes("api.edit:Write a short thank-you note.:-:chat:Slack"));
  assert.deepEqual(write.pasted, ["Thank you so much for your help!"]);
  assert.ok(write.states.some((st) => st.phase === "working" && st.label === "Writing…"));
  assert.equal(write.states.find((st) => st.phase === "done").hint, null, "nothing to undo but the typing");

  const ask = setupVoice({ results: [{ kind: "text", text: "Is this clear?", words: 3 }], editResults: [{ kind: "answer", text: "Yes, it's clear.", words: 0, ms: 200 }] });
  ask.hotkey.emit("start", { edit: true });
  await flush();
  ask.hotkey.emit("stop");
  await flush(30);
  const answer = ask.states.find((st) => st.phase === "answer");
  assert.equal(answer.message, "Yes, it's clear.");
  // About a selection, Paste would type over it: Copy only.
  assert.deepEqual(answer.actions, ["copy"]);
  assert.deepEqual(ask.pasted, []);
  await ask.v.action("copy");
  assert.ok(ask.calls.includes("copy:Yes, it's clear."));
});

test("editing says what's wrong: nothing selected, a terminal, a failure (with Try again)", async () => {
  const none = setupVoice({ selection: null, results: [{ kind: "text", text: "Make this shorter.", words: 3 }], editResults: [Object.assign(new Error("Select the text you want to change first."), { status: 422, code: "no-selection" })] });
  none.hotkey.emit("start", { edit: true });
  await flush();
  none.hotkey.emit("stop");
  await flush(30);
  assert.equal(none.states.at(-1).message, "Select the text you want to change first.");

  const term = setupVoice({ app: { name: "Terminal", category: "terminal" } });
  term.hotkey.emit("start", { edit: true });
  await flush();
  term.hotkey.emit("stop");
  await flush(30);
  assert.equal(term.states.at(-1).message, "Editing by voice doesn't work in a terminal.");
  assert.ok(!term.calls.some((c) => c.startsWith("copySelection") || c.startsWith("api.")), "no copy (Ctrl+C would stop the program), nothing sent");

  const failed = setupVoice({
    results: [{ kind: "text", text: "Make it friendlier.", words: 3 }],
    editResults: [Object.assign(new Error("I couldn't do that one. Try saying it another way."), { status: 502, code: "failed" }), { kind: "replace", text: "Hi there!", words: 2, ms: 100 }],
  });
  failed.hotkey.emit("start", { edit: true });
  await flush();
  failed.hotkey.emit("stop");
  await flush(30);
  const err = failed.states.at(-1);
  assert.equal(err.phase, "error");
  assert.deepEqual(err.actions, ["retry"]);
  // Try again: the same selection and instruction, without copying or listening again.
  await failed.v.action("retry");
  await flush(30);
  assert.equal(failed.calls.filter((c) => c.startsWith("copySelection")).length, 1);
  assert.equal(failed.calls.filter((c) => c.startsWith("api.dictate")).length, 1);
  assert.equal(failed.calls.filter((c) => c.startsWith("api.edit")).length, 2);
  assert.deepEqual(failed.pasted, ["Hi there!"]);
});

test("Shift + \"Hey Otto, …\": the bot gets the request with the selected text, and nothing is typed over it", async () => {
  const env = setupVoice({
    selection: "Lunch with Sam, Friday 12:30 at Tartine",
    results: [{ kind: "command", bot: { id: "bot_1", name: "Otto", paused: false }, command: "Add this to my calendar.", text: "Hey Otto, add this to my calendar." }],
  });
  env.hotkey.emit("start", { edit: true });
  await flush();
  env.hotkey.emit("stop");
  await flush(30);
  assert.ok(env.calls.includes("api.dictate:chat:-:polish=false:commands=true"), "commands are heard in edit mode");
  assert.ok(env.calls.includes("api.ask:bot_1:Add this to my calendar."));
  assert.ok(env.calls.includes("api.ask.selection:Lunch with Sam, Friday 12:30 at Tartine"));
  assert.ok(!env.calls.some((c) => c.startsWith("api.edit")), "a request for the bot isn't an edit");
  const asking = env.states.find((st) => st.phase === "asking");
  assert.equal(asking.selection, true);
  assert.deepEqual(asking.actions, [], "no Type it instead over the selection");
  const reply = env.states.find((st) => st.phase === "reply");
  assert.equal(reply.selection, true);
  assert.deepEqual(reply.actions, ["copy", "reply", "chat"], "no Paste over the selection");
  assert.deepEqual(env.pasted, []);
});

test("Shift while talking switches to editing; with editing off (or not on the server) it's plain typing", async () => {
  const late = setupVoice({ results: [{ kind: "text", text: "Translate it to Spanish.", words: 4 }] });
  late.hotkey.emit("start", { edit: false });
  await flush();
  late.hotkey.emit("edit");
  await flush();
  assert.equal(late.states.at(-1).edit, true);
  late.hotkey.emit("stop");
  await flush(30);
  assert.ok(late.calls.some((c) => c.startsWith("api.edit:Translate it to Spanish.")));

  for (const env of [setupVoice({ voice: { edit: false } }), setupVoice({ serverEdit: false })]) {
    env.hotkey.emit("start", { edit: true });
    await flush();
    env.hotkey.emit("stop");
    await flush(30);
    assert.ok(!env.calls.some((c) => c.startsWith("copySelection") || c.startsWith("api.edit")));
    assert.deepEqual(env.pasted, ["Let's meet at 3."]);
  }
});

test("the pill: placed above the Dock, buttons only when it has them, plain bot replies", () => {
  assert.deepEqual(pillBounds({ x: 0, y: 25, width: 1440, height: 875 }, { width: 240, height: 60 }), { x: 600, y: 826, width: 240, height: 60 });
  assert.deepEqual(pillBounds({ x: 0, y: 25, width: 1440, height: 875 }, { width: 240, height: 60 }, 180).y, 646);
  assert.equal(pillInteractive({ phase: "listening", handsfree: false }), false);
  assert.equal(pillInteractive({ phase: "listening", handsfree: true }), true);
  assert.equal(pillInteractive({ phase: "done" }), false);
  assert.equal(pillInteractive({ phase: "reply" }), true);
  assert.equal(pillInteractive({ phase: "note", actions: ["accessibility"] }), true);
  assert.equal(plain("# Hi\n**Bold** and *soft* [link](https://x)\n- one"), "Hi\nBold and soft link\n• one");
});

test("the tray shows voice typing: set it up, or the shortcut and Paste last dictation", () => {
  const base = { status: "Watching for calls", icon: "watching", signedIn: true, phase: "idle", canTake: true, detectionPaused: false, captions: true, openAtLogin: false, macTabs: false, platform: "darwin", bots: [], botId: null, neverApps: [] };
  const labels = (items) => items.map((i) => i.label).filter(Boolean);
  assert.ok(labels(trayItems({ ...base, voice: { enabled: false, mode: "off", hint: null, canPasteLast: false } })).includes("Set up voice typing…"));
  const on = trayItems({ ...base, voice: { enabled: true, mode: "hold", hint: "Hold Right Option (⌥) to talk", canPasteLast: true } });
  assert.ok(labels(on).includes("Voice typing: Hold Right Option (⌥) to talk"));
  assert.ok(labels(on).includes("Paste last dictation"));
  assert.ok(!labels(trayItems({ ...base, signedIn: false, voice: { enabled: true, mode: "hold", hint: "x", canPasteLast: true } })).includes("Paste last dictation"));
});
