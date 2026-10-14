import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { linuxSightings, parseSourceOutputs, parseSourceOutputsJson } from "../src/main/detect/linux.mjs";
import { consentStoreEntries, filetimeToMs, parseCsvLine, parseRegQuery, parseTasklistCsv, windowsSightings } from "../src/main/detect/windows.mjs";
import { appFromTabs, macHelperSightings, macProcessSightings, macTabSightings, parseHelperOutput, parsePs, parseTabLines } from "../src/main/detect/macos.mjs";
import { appFromBundleId, appFromTitle, appFromUrl } from "../src/main/detect/catalog.mjs";
import { Detector, parseFakeMeeting } from "../src/main/detect/index.mjs";
import { createTracker } from "../src/main/detect/tracker.mjs";

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("linux: parses pactl text output and finds Zoom, skipping level meters, corked streams and our own app", () => {
  const outputs = parseSourceOutputs(fixture("pactl-source-outputs.txt"));
  assert.equal(outputs.length, 4);
  assert.deepEqual(
    outputs.map((o) => [o.index, o.corked]),
    [
      [42, false],
      [43, false],
      [47, false],
      [51, true],
    ],
  );
  assert.equal(outputs[0].props["application.name"], "ZOOM VoiceEngine");
  assert.equal(outputs[0].props["module-stream-restore.id"], "source-output-by-application-name:ZOOM VoiceEngine");

  const found = linuxSightings(outputs, { ownPids: new Set([51022]), ownBinaries: ["build-a-bot"] });
  assert.deepEqual(
    found.map((f) => [f.key, f.app, f.kind, f.pid]),
    [["linux:zoom", "zoom", "native", 48211]],
  );
});

test("linux: parses pactl JSON (PipeWire) and finds a browser call and Discord", () => {
  const outputs = parseSourceOutputsJson(fixture("pactl-source-outputs.json"));
  assert.ok(outputs);
  const found = linuxSightings(outputs, { ownPids: new Set() });
  assert.deepEqual(
    found.map((f) => [f.key, f.app, f.kind, f.label]),
    [
      ["linux:chrome", "browser", "browser", "Chrome"],
      ["linux:discord", "discord", "native", "WEBRTC VoiceEngine"],
    ],
  );
  assert.equal(parseSourceOutputsJson("pactl: unrecognized option '--format=json'"), null);
});

test("windows: reads the ConsentStore and keeps only apps that are really running", () => {
  const keys = parseRegQuery(fixture("reg-consentstore.txt"));
  const entries = consentStoreEntries(keys);
  const inUse = entries.filter((e) => e.inUse).map((e) => e.exe ?? e.id);
  assert.deepEqual(inUse, ["MSTeams_8wekyb3d8bbwe", "5319275A.WhatsAppDesktop_cv1g1gvanyjgm", "zoom.exe", "chrome.exe", "build-a-bot.exe"]);
  const zoom = entries.find((e) => e.exe === "zoom.exe");
  assert.equal(zoom.exePath, "C:\\Users\\dana\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe");
  assert.ok(zoom.startedAt > Date.UTC(2024, 0, 1), "FILETIME converts to a recent date");

  const procs = parseTasklistCsv(fixture("tasklist.csv"));
  assert.equal(procs.find((p) => p.image === "System").pid, 4);
  const titles = parseTasklistCsv(fixture("tasklist-chrome-v.csv"));
  assert.equal(titles[0].title, "Meet - abc-defg-hij - Google Chrome");

  const found = windowsSightings(entries, procs, { ownExe: "C:\\Users\\dana\\AppData\\Local\\Programs\\build-a-bot\\Build-a-bot.exe", titles });
  assert.deepEqual(
    found.map((f) => [f.key, f.app, f.kind, f.pid]),
    [
      ["win:MSTeams_", "teams", "native", 14432],
      ["win:zoom.exe", "zoom", "native", 11284],
      ["win:chrome.exe", "meet", "browser", 9120],
    ],
  );
  // WhatsApp's "in use" value is stuck (it isn't running), Discord stopped, and our own app is skipped.
  assert.ok(!found.some((f) => f.app === "whatsapp" || f.app === "discord"));
});

test("windows: a browser without a meeting title is 'a call in Chrome'; FILETIME and CSV helpers", () => {
  const entries = consentStoreEntries(parseRegQuery(fixture("reg-consentstore.txt")));
  const found = windowsSightings(entries, parseTasklistCsv(fixture("tasklist.csv")), { titles: [] });
  assert.equal(found.find((f) => f.key === "win:chrome.exe").app, "browser");
  assert.equal(filetimeToMs(116444736000000000n), 0);
  assert.deepEqual(parseCsvLine('"a, b","c""d",e'), ["a, b", 'c"d', "e"]);
  assert.deepEqual(parseRegQuery("ERROR: The system was unable to find the specified registry key or value."), []);
});

test("macos: the helper's per-process mic list → Zoom (with its window) and a Meet tab in Chrome", () => {
  const out = parseHelperOutput(fixture("mac-helper.json"));
  assert.equal(out.ok, true);
  assert.equal(out.processes.length, 5);
  const tabs = parseTabLines(fixture("mac-tabs.txt"));
  assert.equal(tabs.length, 3);
  const found = macHelperSightings(out, { ownPids: new Set([7777]), tabs });
  assert.deepEqual(
    found.map((f) => [f.key, f.app, f.kind, f.pid]),
    [
      ["mac:us.zoom.xos", "zoom", "native", 4410],
      ["mac:com.google.Chrome", "meet", "browser", 5120],
    ],
  );
  assert.deepEqual(found[0].bounds, { x: 0, y: 25, width: 1440, height: 875 }, "the biggest window places the bot");
  // Without tab access, Chrome on the mic is just "a call in your browser".
  assert.equal(macHelperSightings(out, { ownPids: new Set([7777]) })[1].app, "browser");
  assert.equal(parseHelperOutput("not json").ok, false);
});

test("macos: without the helper, Zoom's in-meeting process and meeting tabs still count", () => {
  const rows = parsePs(fixture("mac-ps.txt"));
  assert.equal(rows.length, 6);
  const found = macProcessSightings(rows, { ownPids: new Set() });
  assert.deepEqual(
    found.map((f) => [f.key, f.app, f.pid]),
    [["mac:proc:zoom", "zoom", 4502]],
    "only the CptHost inside zoom.us.app counts",
  );
  const tabs = macTabSightings(parseTabLines(fixture("mac-tabs.txt")));
  assert.deepEqual(
    tabs.map((t) => [t.app, t.kind]),
    [
      ["meet", "browser"],
      ["teams", "browser"],
    ],
  );
  assert.equal(appFromTabs(parseTabLines(fixture("mac-tabs.txt")), "com.apple.Safari"), "teams");
});

test("catalog: bundle IDs, URLs and titles", () => {
  assert.deepEqual(appFromBundleId("com.microsoft.teams2"), { app: "teams", kind: "native", bundle: "com.microsoft.teams2" });
  assert.equal(appFromBundleId("com.google.Chrome.helper.renderer").kind, "browser");
  assert.equal(appFromBundleId("com.apple.FaceTime"), null, "FaceTime and phone calls are left out in v1");
  assert.equal(appFromBundleId("com.spotify.client"), null);
  assert.equal(appFromUrl("https://meet.google.com/abc-defg-hij"), "meet");
  assert.equal(appFromUrl("https://us02web.zoom.us/wc/123/join"), "zoom");
  assert.equal(appFromUrl("https://evilzoom.us.example.com/"), null);
  assert.equal(appFromTitle("Weekly sync | Microsoft Teams"), "teams");
  assert.equal(appFromTitle("Inbox - Gmail"), null);
});

test("tracker: needs 2 checks and 5 s for apps, 15 s for browsers; ends after 15 s without the mic", () => {
  const t = createTracker();
  const zoom = { key: "mac:us.zoom.xos", app: "zoom", kind: "native" };
  assert.deepEqual(t.update(0, [zoom]), []);
  assert.deepEqual(t.update(3000, [zoom]), [], "2 checks but only 3 s");
  assert.deepEqual(
    t.update(6000, [zoom]).map((e) => [e.type, e.app]),
    [["start", "zoom"]],
  );
  assert.deepEqual(t.update(9000, [zoom]), [], "one start per call");
  assert.deepEqual(t.update(12000, []), [], "a gap shorter than 15 s is not the end");
  assert.deepEqual(t.update(15000, [zoom]), []);
  assert.deepEqual(t.update(24000, []), []);
  assert.deepEqual(
    t.update(30000, []).map((e) => [e.type, e.app]),
    [["end", "zoom"]],
  );

  const chrome = { key: "linux:chrome", app: "browser", kind: "browser" };
  const b = createTracker();
  for (const now of [0, 3000, 6000, 9000, 12000]) assert.deepEqual(b.update(now, [chrome]), []);
  assert.deepEqual(
    b.update(15000, [{ ...chrome, app: "meet" }]).map((e) => [e.type, e.app]),
    [["start", "meet"]],
  );

  // Sightings must be consecutive.
  const c = createTracker({ sustainMs: { native: 0 } });
  c.update(0, [zoom]);
  c.update(3000, []);
  assert.deepEqual(c.update(6000, [zoom]), [], "restarted counting after a miss");
  assert.equal(c.update(9000, [zoom])[0].type, "start");
});

test("fake meetings (BAB_FAKE_MEETING / BAB_FAKE_MEETING_FILE) drive the same detector", async () => {
  assert.deepEqual(
    parseFakeMeeting("zoom\n").map((s) => [s.key, s.app, s.kind]),
    [["fake:zoom", "zoom", "native"]],
  );
  assert.deepEqual(parseFakeMeeting("nonsense"), []);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bab-fake-")), "call.txt");
  let now = 0;
  const d = new Detector({ fakeFile: file, now: () => now, tracker: createTracker({ sustainMs: { native: 0 }, endGraceMs: 2000 }) });
  const events = [];
  d.on("call-start", (e) => events.push(["start", e.app]));
  d.on("call-end", (e) => events.push(["end", e.app]));
  fs.writeFileSync(file, "zoom");
  await d.check();
  now = 1000;
  await d.check();
  assert.deepEqual(events, [["start", "zoom"]]);
  assert.equal(d.status.mode, "fake");
  fs.writeFileSync(file, "");
  now = 2000;
  await d.check();
  now = 4500;
  await d.check();
  assert.deepEqual(events, [
    ["start", "zoom"],
    ["end", "zoom"],
  ]);
});

test("detector: a failed OS check doesn't end a call", async () => {
  let now = 0;
  let fail = false;
  const exec = async (file) => {
    if (fail) throw Object.assign(new Error("pactl: connection refused"), { code: 1 });
    if (file === "pactl") return fixture("pactl-source-outputs.json");
    return "";
  };
  const d = new Detector({ platform: "linux", exec, now: () => now, tracker: createTracker({ sustainMs: { native: 0, browser: 0 }, endGraceMs: 1000 }) });
  const events = [];
  d.on("call-start", (e) => events.push(["start", e.app]));
  d.on("call-end", (e) => events.push(["end", e.app]));
  await d.check();
  now = 1000;
  await d.check();
  assert.deepEqual(events.map((e) => e[1]).sort(), ["browser", "discord"]);
  fail = true;
  now = 10_000;
  await d.check();
  assert.equal(d.status.mode, "unavailable");
  assert.equal(events.filter((e) => e[0] === "end").length, 0);
});
