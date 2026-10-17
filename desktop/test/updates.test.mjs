import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { CHECK_EVERY_MS, FIRST_CHECK_MS, Updates, updatesOn } from "../src/main/updates.mjs";
import { moveToApplications, shouldMoveToApplications } from "../src/main/install-location.mjs";
import { trayItems } from "../src/main/tray-menu.mjs";

/** electron-updater's autoUpdater, as far as updates.mjs uses it. */
function fakeUpdater({ check = async () => {} } = {}) {
  const u = new EventEmitter();
  u.checks = 0;
  u.installs = [];
  u.checkForUpdates = () => {
    u.checks++;
    return check();
  };
  u.quitAndInstall = (...args) => u.installs.push(args);
  return u;
}

function fakeTimers() {
  const t = { timeouts: [], intervals: [] };
  t.setTimeout = (fn, ms) => (t.timeouts.push({ fn, ms }), { unref() {} });
  t.setInterval = (fn, ms) => (t.intervals.push({ fn, ms }), { unref() {} });
  return t;
}

function setup({ enabled = true, busy = false, check } = {}) {
  const updater = fakeUpdater({ check });
  const timers = fakeTimers();
  const notes = [];
  const logs = [];
  let changes = 0;
  const state = { busy };
  const updates = new Updates({ updater, enabled, busy: () => state.busy, notify: (n) => notes.push(n), onChange: () => changes++, log: (m) => logs.push(m), timers });
  return { updates, updater, timers, notes, logs, state, changes: () => changes };
}

test("only a signed release build, packaged, on a Mac or Windows, updates itself", () => {
  const on = { packaged: true, platform: "darwin", flag: true, env: {} };
  assert.equal(updatesOn(on), true);
  assert.equal(updatesOn({ ...on, platform: "win32" }), true);
  assert.equal(updatesOn({ ...on, platform: "linux" }), false, "Linux packages update through the system");
  assert.equal(updatesOn({ ...on, packaged: false }), false, "not when run from the repository");
  assert.equal(updatesOn({ ...on, flag: undefined }), false, "not an unsigned or test build");
  assert.equal(updatesOn({ ...on, flag: "true" }), true, "as the command line may pass it");
  assert.equal(updatesOn({ ...on, flag: "false" }), false);
  assert.equal(updatesOn({ ...on, env: { BAB_UPDATES: "off" } }), false);
  assert.equal(updatesOn({ ...on, env: { BAB_SMOKE: "1" } }), false, "not while checking itself");
  assert.equal(updatesOn({ ...on, env: { BAB_TEST: "1" } }), false);
});

test("it looks a minute after starting, then every four hours, and downloads in the background", async () => {
  const env = setup();
  env.updates.start();
  assert.equal(env.updater.autoDownload, true);
  assert.equal(env.updater.autoInstallOnAppQuit, true, "installs when the app quits");
  assert.equal(env.updater.allowPrerelease, false);
  assert.equal(env.updater.allowDowngrade, false);
  assert.deepEqual(
    env.timers.timeouts.map((t) => t.ms),
    [FIRST_CHECK_MS],
  );
  assert.deepEqual(
    env.timers.intervals.map((t) => t.ms),
    [CHECK_EVERY_MS],
  );
  env.timers.timeouts[0].fn();
  env.timers.intervals[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(env.updater.checks, 2);
  env.updates.start();
  assert.equal(env.timers.intervals.length, 1, "starting twice doesn't double up");
});

test("a failed check is logged, not thrown, and the next one still runs", async () => {
  const env = setup({
    check: async () => {
      throw new Error("offline");
    },
  });
  env.updates.start();
  env.timers.timeouts[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.ok(env.logs.some((l) => l.includes("update check failed: offline")));
  env.updater.emit("error", new Error("bad signature"));
  assert.ok(env.logs.some((l) => l.includes("update failed: bad signature")));
});

test("once downloaded: one notice, a menu line, and a restart only when nothing is being recorded", () => {
  const env = setup();
  env.updates.start();
  assert.equal(env.updates.menu(), null, "nothing to offer yet");
  assert.equal(env.updates.installNow(), false);

  env.updater.emit("update-downloaded", { version: "0.1.42" });
  assert.equal(env.updates.ready, "0.1.42");
  assert.equal(env.notes.length, 1);
  assert.equal(env.notes[0].title, "Build-a-bot 0.1.42 is ready");
  assert.ok(env.changes() >= 1, "the menu redraws");
  env.updater.emit("update-downloaded", { version: "0.1.42" });
  assert.equal(env.notes.length, 1, "it says so once");

  env.state.busy = true;
  assert.deepEqual(env.updates.menu(), { version: "0.1.42", canRestart: false });
  assert.equal(env.updates.installNow(), false, "not in the middle of a call or a dictation");
  assert.deepEqual(env.updater.installs, []);

  env.state.busy = false;
  assert.deepEqual(env.updates.menu(), { version: "0.1.42", canRestart: true });
  assert.equal(env.updates.installNow(), true);
  assert.deepEqual(env.updater.installs, [[true, true]], "silently, and it opens again afterwards");
});

test("switched off, it does nothing at all", () => {
  const env = setup({ enabled: false });
  env.updates.start();
  assert.equal(env.timers.timeouts.length + env.timers.intervals.length, 0);
  assert.equal(env.updater.listenerCount("update-downloaded"), 0);
  assert.equal(env.updater.autoDownload, undefined);
});

test("the menu offers the restart at the top, greyed out while recording", () => {
  const base = { status: "Watching for calls", signedIn: true, phase: "idle", canTake: true, detectionPaused: false, captions: true, openAtLogin: false, macTabs: false, platform: "darwin", bots: [], botId: null, neverApps: [] };
  assert.ok(!trayItems(base).some((i) => i.id === "update"));
  const ready = trayItems({ ...base, update: { version: "0.1.42", canRestart: true } });
  assert.deepEqual(ready[1], { id: "update", label: "Restart to update to 0.1.42", enabled: true });
  const busy = trayItems({ ...base, phase: "listening", status: "Taking notes", update: { version: "0.1.42", canRestart: false } });
  assert.equal(busy[1].enabled, false);
  assert.equal(busy[3].label, "Stop and write notes", "recording controls still come first after it");
});

test("macOS: opened from Downloads or the disk image, it moves itself into Applications", () => {
  const mac = { platform: "darwin", packaged: true, inApplications: false, env: {} };
  assert.equal(shouldMoveToApplications(mac), true);
  assert.equal(shouldMoveToApplications({ ...mac, inApplications: true }), false);
  assert.equal(shouldMoveToApplications({ ...mac, platform: "win32" }), false);
  assert.equal(shouldMoveToApplications({ ...mac, packaged: false }), false, "not when run from the repository");
  for (const env of [{ BAB_SMOKE: "1" }, { BAB_TEST: "1" }, { BAB_STAY_PUT: "1" }, { BAB_USER_DATA: "/tmp/x" }]) {
    assert.equal(shouldMoveToApplications({ ...mac, env }), false, JSON.stringify(env));
  }

  const calls = [];
  const logs = [];
  const app = { isPackaged: true, isInApplicationsFolder: () => false, moveToApplicationsFolder: (o) => (calls.push(o), true) };
  assert.equal(moveToApplications({ app, log: (m) => logs.push(m), env: {}, platform: "darwin" }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].conflictHandler("exists"), true, "an older copy that isn't running is replaced");
  assert.equal(calls[0].conflictHandler("existsAndRunning"), false, "a running one is left alone");
  assert.ok(logs.some((l) => l.includes("moved into Applications")));

  const failing = { ...app, moveToApplicationsFolder: () => {
    throw new Error("Operation not permitted");
  } };
  assert.equal(moveToApplications({ app: failing, log: (m) => logs.push(m), env: {}, platform: "darwin" }), false, "it just runs from where it is");
  assert.ok(logs.some((l) => l.includes("couldn't move into Applications: Operation not permitted")));

  const installed = { ...app, isInApplicationsFolder: () => true, moveToApplicationsFolder: () => assert.fail("already there") };
  assert.equal(moveToApplications({ app: installed, log: () => {}, env: {}, platform: "darwin" }), false);
  const windows = { ...app, isInApplicationsFolder: () => assert.fail("macOS only"), moveToApplicationsFolder: () => assert.fail("macOS only") };
  assert.equal(moveToApplications({ app: windows, log: () => {}, env: {}, platform: "win32" }), false);
});
