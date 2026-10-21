/**
 * Quitting always quits: the watchdog that ends an app stuck on its way out (Windows), and the log
 * that shows how far the shutdown got (each line on disk as it's written).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startQuitWatchdog, watchdogScript } from "../src/main/quit-watchdog.mjs";
import { createLogger } from "../src/main/log.mjs";

function fakeSpawn() {
  const calls = [];
  const spawnImpl = (file, args, opts) => {
    const child = { unrefs: 0, on() {}, unref() { this.unrefs++; } };
    calls.push({ file, args, opts, child });
    return child;
  };
  return { calls, spawnImpl };
}

const decode = (/** @type {string[]} */ args) => Buffer.from(args[args.indexOf("-EncodedCommand") + 1], "base64").toString("utf16le");

test("Windows: a watchdog outside the app ends it if it's still there after a while, and only it", () => {
  const { calls, spawnImpl } = fakeSpawn();
  const child = startQuitWatchdog({ ms: 40_000, pid: 4242, exe: "C:\\Users\\sam\\AppData\\Local\\Programs\\build-a-bot-desktop\\Build-a-bot.exe", platform: "win32", spawnImpl });
  assert.ok(child);
  assert.equal(calls.length, 1);
  const [{ file, args, opts }] = calls;
  assert.equal(file, "powershell.exe");
  assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]);
  // Not tied to the app: it outlives a stuck app, hidden, and doesn't keep it open.
  assert.deepEqual(opts, { detached: true, stdio: "ignore", windowsHide: true });
  assert.equal(calls[0].child.unrefs, 1);
  const script = decode(args);
  assert.equal(script, watchdogScript(4242, "Build-a-bot", 40_000));
  // It holds the app's process while it waits (so its id can't go to another program), checks
  // it's this app, and ends it with the processes it started, only if it didn't quit in time.
  assert.match(script, /^\$p = Get-Process -Id 4242 -ErrorAction SilentlyContinue$/m);
  assert.match(script, /\$p\.ProcessName -eq 'Build-a-bot'/);
  assert.match(script, /-not \$p\.WaitForExit\(40000\)\) \{ taskkill\.exe \/F \/T \/PID 4242 \| Out-Null \}/);
});

test("the watchdog: none on a Mac (the app's own timer is enough there), and nothing odd gets into its script", () => {
  const { calls, spawnImpl } = fakeSpawn();
  assert.equal(startQuitWatchdog({ ms: 40_000, pid: 4242, exe: "/Applications/Build-a-bot.app/Contents/MacOS/Build-a-bot", platform: "darwin", spawnImpl }), null);
  assert.equal(startQuitWatchdog({ ms: 40_000, pid: 4242, exe: "C:\\x\\it's'; Stop-Computer.exe", platform: "win32", spawnImpl }), null);
  assert.equal(startQuitWatchdog({ ms: 40_000, pid: 0, exe: "Build-a-bot.exe", platform: "win32", spawnImpl }), null);
  assert.equal(calls.length, 0);
  // A watchdog that can't start doesn't stop the quit.
  const logs = [];
  const failing = () => {
    throw Object.assign(new Error("nope"), { code: "ENOENT" });
  };
  assert.equal(startQuitWatchdog({ ms: 40_000, pid: 4242, exe: "Build-a-bot.exe", platform: "win32", spawnImpl: /** @type {any} */ (failing), log: (m) => logs.push(m) }), null);
  assert.deepEqual(logs, ["shutdown: the watchdog didn't start (ENOENT)"]);
});

test("the log: each line is on disk as soon as it's written, tokens hidden", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bab-log-"));
  try {
    const file = path.join(dir, "logs", "main.log");
    const log = createLogger({ file, echo: false });
    log("shutdown: started");
    assert.match(fs.readFileSync(file, "utf8"), /^\[[^\]]+\] shutdown: started\n$/);
    log("paired", { token: "bab_dev_AbC-123_x" });
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[1], /paired \{"token":"bab_dev_\[hidden\]"\}$/);
    // Another run adds to it.
    createLogger({ file, echo: false })("again");
    assert.equal(fs.readFileSync(file, "utf8").trim().split("\n").length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
