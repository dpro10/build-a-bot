import { test } from "node:test";
import assert from "node:assert/strict";
import { Controller, startError, systemNotice } from "../src/main/controller.mjs";
import { trayIcon, trayItems } from "../src/main/tray-menu.mjs";

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 5));
};

/** A controller wired to fakes that record what happened, in order. */
function setup(opts = {}) {
  const calls = [];
  const bot = { id: "bot_1", name: "Inky", avatar: "otto", color: "grape", meetingsOn: true, paused: false };
  const settingsData = { captions: true, neverApps: [], detectionPausedUntil: 0, pending: [], ...(opts.settings ?? {}) };
  const buddy = {
    visible: false,
    canShow: opts.canShow ?? true,
    canReassert: opts.canReassert ?? true,
    states: [],
    async show(st) {
      calls.push("buddy.show");
      this.states.push(st);
      this.visible = this.canShow;
      return this.canShow;
    },
    update(st) {
      this.states.push(st);
    },
    hide() {
      calls.push("buddy.hide");
      this.visible = false;
    },
    isShowing() {
      return this.visible;
    },
    reassert() {
      calls.push("buddy.reassert");
      this.visible = this.canReassert;
      return this.canReassert;
    },
    setCallBounds() {},
  };
  const capture = {
    async start(o) {
      calls.push(`capture.start:${o.system}`);
      return opts.capture ?? { ok: true, mic: true, system: "ok" };
    },
    async pause() {
      calls.push("capture.pause");
    },
    async resume() {
      calls.push("capture.resume");
      return { ok: true };
    },
    async stop(o = {}) {
      calls.push(o.discard ? "capture.stop:discard" : "capture.stop");
    },
  };
  const api = {
    async startMeeting(botId, body) {
      calls.push(`api.start:${body.app}:${body.consentNotice}`);
      if (opts.startError) throw opts.startError;
      return { meeting: { id: "mtg_1", title: "Zoom meeting" }, chunkMs: 6000 };
    },
    async finish() {
      calls.push("api.finish");
      return {};
    },
    async getMeeting() {
      calls.push("api.get");
      return { meeting: { status: "ready", title: "Launch plan" }, segments: [] };
    },
    async deleteMeeting() {
      calls.push("api.delete");
      return { ok: true };
    },
    async markNoticeCopied() {
      calls.push("api.notice");
      return {};
    },
  };
  const uploads = {
    pushed: [],
    push(i) {
      this.pushed.push(i);
    },
    async drain() {
      calls.push("uploads.drain");
      return { ok: true, left: 0 };
    },
    drop() {
      calls.push("uploads.drop");
    },
    persist() {},
    dispose() {},
  };
  const account = {
    device: { server: "http://x" },
    session: { meetings: { minutesLeft: 100, chunkMs: 6000 } },
    bot: () => bot,
    anyBot: () => bot,
    server: () => "http://x",
    appUrl: () => "https://app.example",
    canTakeNotes: () => opts.canTakeNotes ?? true,
    whyNot: () => null,
    refreshIfStale: async () => {},
    signOut: () => calls.push("signOut"),
  };
  const notes = [];
  const opened = [];
  const c = new Controller({
    account,
    settings: { get: () => settingsData, update: (p) => Object.assign(settingsData, p) },
    api,
    buddy,
    capture,
    uploads,
    spool: { list: () => [], removeMeeting() {} },
    notify: (n) => notes.push(n.title + " | " + n.body),
    openUrl: (u) => opened.push(u),
    openSpecial: (t) => opened.push(`special:${t}`),
    writeClipboard: (t) => calls.push(`clipboard:${t.slice(0, 20)}`),
    limits: { silenceStopMs: 12_000, slowNotesMs: 60_000, ...(opts.limits ?? {}) },
  });
  return { c, calls, buddy, uploads, notes, opened, settingsData };
}

async function listening(env) {
  await env.c.onCallStart({ key: "fake:zoom", app: "zoom" });
  await flush();
  env.c.onBuddyAction("take");
  await flush();
  assert.equal(env.c.state.phase, "listening");
}

test("the bot is on screen before the meeting or the mic start", async () => {
  const env = setup();
  await env.c.onCallStart({ key: "fake:zoom", app: "zoom" });
  await flush();
  assert.equal(env.c.state.phase, "asking");
  assert.ok(!env.calls.some((x) => x.startsWith("capture") || x.startsWith("api.start")), "nothing before the yes");
  env.c.onBuddyAction("take");
  await flush();
  const order = env.calls.filter((x) => ["buddy.show", "api.start:zoom:false", "capture.start:loopback"].includes(x));
  assert.deepEqual(order.slice(-3), ["buddy.show", "api.start:zoom:false", "capture.start:loopback"]);
  assert.equal(env.c.state.phase, "listening");
  const st = env.buddy.states.at(-1);
  assert.equal(st.phase, "listening");
  assert.equal(st.bot.name, "Inky");
  assert.equal(st.app.name, "Zoom");
  assert.match(st.consentNote, /my AI assistant Inky/);
  env.c.dispose();
});

test("if the bot can't be shown, nothing is recorded", async () => {
  const env = setup({ canShow: false });
  env.c.takeNow();
  await flush();
  assert.ok(!env.calls.some((x) => x.startsWith("api.start") || x.startsWith("capture.start")));
  assert.equal(env.c.state.phase, "idle");
  assert.match(env.notes[0], /couldn't show myself on your screen/);
  env.c.dispose();
});

test("losing the bot mid-recording stops, flushes and finishes the meeting", async () => {
  const env = setup({ canReassert: false });
  await listening(env);
  env.buddy.visible = false; // e.g. the window was closed or moved off screen
  env.c.tick();
  await flush(10);
  assert.ok(env.calls.includes("capture.stop"));
  assert.ok(env.calls.indexOf("uploads.drain") < env.calls.indexOf("api.finish"), "uploads drain before finish");
  assert.deepEqual(env.c.stats.stops, ["hidden"]);
  assert.ok(env.notes.some((n) => /couldn't stay on your screen/.test(n)));
  env.c.dispose();
});

test("a bot that was only covered is put back, and recording goes on", async () => {
  const env = setup({ canReassert: true });
  await listening(env);
  env.buddy.visible = false;
  env.c.tick();
  await flush();
  assert.equal(env.c.state.phase, "listening");
  assert.ok(env.calls.includes("buddy.reassert"));
  env.c.dispose();
});

test("screen lock and sleep stop the notes", async () => {
  for (const kind of ["lock-screen", "suspend"]) {
    const env = setup();
    await listening(env);
    env.c.onPower(kind);
    await flush(10);
    assert.deepEqual(env.c.stats.stops, [kind]);
    assert.ok(env.calls.includes("api.finish"));
    env.c.dispose();
  }
});

test("Stop → saving → done with a 'notes are ready' notification that opens the meeting", async () => {
  const env = setup();
  await listening(env);
  env.c.onBuddyAction("stop");
  await flush(12);
  assert.equal(env.c.state.phase, "done");
  assert.equal(env.c.state.message, "Launch plan");
  assert.ok(env.notes.some((n) => n.startsWith("Notes from “Launch plan” are ready")));
  env.c.onBuddyAction("open");
  assert.deepEqual(env.opened, ["https://app.example/app/bots/bot_1/meetings/mtg_1"]);
  env.c.dispose();
});

test("Stop and delete: drops the audio, deletes the meeting, and shows nothing more", async () => {
  const env = setup();
  await listening(env);
  env.c.onBuddyAction("discard");
  await flush(10);
  assert.ok(env.calls.includes("capture.stop:discard"));
  assert.ok(env.calls.includes("uploads.drop"));
  assert.ok(env.calls.includes("api.delete"));
  assert.ok(!env.calls.includes("api.finish"));
  assert.equal(env.c.state.phase, "idle");
  assert.equal(env.calls.at(-1), "buddy.hide");
  env.c.dispose();
});

test("15 minutes of silence (here 15 s) stops on its own; voice resets the clock", async () => {
  const env = setup({ limits: { silenceStopMs: 15_000 } });
  await listening(env);
  const chunk = (n, silent) => ({ track: "mic", chunk: n, startMs: n * 6000, durationMs: 6000, silent, mime: "audio/webm", data: new Uint8Array(10) });
  env.c.onChunk(chunk(0, false));
  env.c.onChunk(chunk(1, true));
  env.c.onChunk(chunk(2, true));
  assert.equal(env.c.state.phase, "listening", "12 s of quiet after the voice ended at 6 s is not enough yet");
  env.c.onChunk(chunk(3, true));
  await flush(10);
  assert.deepEqual(env.c.stats.stops, ["silence"]);
  assert.equal(env.uploads.pushed.length, 4, "every chunk was still uploaded");
  env.c.dispose();
});

test("no system audio: keeps recording the mic and says so above the bot", async () => {
  const env = setup({ capture: { ok: true, mic: true, system: "unavailable" } });
  await listening(env);
  assert.equal(env.c.caption.speaker, "Inky");
  assert.match(env.c.caption.text, /only hear your mic/);
  assert.equal(env.c.statusText(), "Taking notes (your mic only)");
  assert.equal(systemNotice("denied", "darwin"), "I can only hear your mic. Allow system audio in Privacy & Security to hear everyone.");
  assert.equal(systemNotice("unavailable", "darwin"), systemNotice("denied", "darwin"), "on a Mac, point to the permission");
  assert.match(systemNotice("denied", "linux"), /your side of the call/);
  assert.match(systemNotice("ended", "win32"), /lost the call's audio/);
  env.c.dispose();
});

test("no mic: the empty meeting is deleted and the owner is told how to fix it", async () => {
  const env = setup({ capture: { ok: false, mic: false, system: "off", error: "NotAllowedError" } });
  env.c.takeNow();
  await flush(10);
  assert.ok(env.calls.includes("api.delete"));
  assert.equal(env.c.state.phase, "error");
  assert.match(env.c.state.message, /can't hear your microphone/);
  env.c.onBuddyAction("open");
  assert.deepEqual(env.opened, ["special:permissions"]);
  env.c.dispose();
});

test("server refusals become plain words with the right place to fix them", async () => {
  const env = setup({ startError: Object.assign(new Error("Turn on Meeting notes for Inky first."), { status: 409, code: "meetings_off" }) });
  env.c.takeNow();
  await flush(10);
  assert.equal(env.c.state.phase, "error");
  assert.equal(env.c.state.message, "Turn on Meeting notes for Inky first.");
  env.c.onBuddyAction("open");
  assert.deepEqual(env.opened, ["https://app.example/app/bots/bot_1/tools#meetings"]);
  assert.equal(startError({ status: 0, code: "network" }, "Inky").message, "I can't reach Build-a-bot right now. Check your internet and try again.");
  assert.equal(startError({ status: 402, code: "limit" }, "Inky").openTarget, "billing");
  assert.equal(startError({ status: 401 }, "Inky").openTarget, "pair");
  env.c.dispose();
});

test("bubble actions only count when their bubble is showing", async () => {
  const env = setup();
  env.c.onBuddyAction("take"); // idle, nothing showing
  await flush();
  assert.equal(env.c.state.phase, "idle");
  await listening(env);
  env.c.onBuddyAction("never"); // not offered while listening
  env.c.onBuddyAction("take");
  await flush();
  assert.equal(env.c.state.phase, "listening");
  assert.deepEqual(env.settingsData.neverApps, []);
  env.c.dispose();
});

test("copying the heads-up before starting is recorded with the start; captions follow the setting", async () => {
  const env = setup({ settings: { captions: false } });
  await env.c.onCallStart({ key: "fake:zoom", app: "zoom" });
  await flush();
  env.c.onCopy("Heads-up: I'm using my AI assistant Inky…");
  env.c.onBuddyAction("take");
  await flush();
  assert.ok(env.calls.includes("api.start:zoom:true"));
  env.c.onUploaded({ meetingId: "mtg_1", track: "mic" }, { segments: [{ speaker: "You", text: "Okay, thanks everyone for joining." }] });
  assert.equal(env.c.caption, null, "captions are off");
  env.settingsData.captions = true;
  env.c.onUploaded({ meetingId: "mtg_1", track: "mic" }, { segments: [{ speaker: "You", text: "Okay, thanks everyone for joining." }] });
  assert.equal(env.c.caption.text, "Okay, thanks everyone for joining.");
  env.c.dispose();
});

test("asking times out after 15 s without an answer (not while the pointer is on it)", async () => {
  const env = setup({ limits: { askTimeoutMs: 30 } });
  await env.c.onCallStart({ key: "fake:zoom", app: "zoom" });
  await flush();
  env.c.onInteractive(true);
  await new Promise((r) => setTimeout(r, 60));
  env.c.tick();
  assert.equal(env.c.state.phase, "asking", "hovering keeps it open");
  env.c.onInteractive(false);
  env.c.askDeadline = Date.now() - 1;
  env.c.tick();
  await flush();
  assert.equal(env.c.state.phase, "idle");
  env.c.dispose();
});

test("tray menu: no auto-record option; Stop when recording; bots with notes off can't be picked", () => {
  const base = { status: "Watching for calls", signedIn: true, phase: "idle", canTake: true, detectionPaused: false, captions: true, openAtLogin: false, macTabs: false, platform: "linux", bots: [{ id: "a", name: "Inky", meetingsOn: true, paused: false }, { id: "b", name: "Blip", meetingsOn: false, paused: false }], botId: "a", neverApps: ["zoom"] };
  const labels = (items) => items.flatMap((i) => [i.label, ...(i.submenu ?? []).map((s) => s.label)]).filter(Boolean);
  const idle = trayItems(base);
  assert.ok(labels(idle).includes("Take notes now"));
  assert.ok(labels(idle).includes("Pause call detection for 1 hour"));
  assert.ok(labels(idle).includes("Ask in Zoom again"));
  assert.ok(labels(idle).includes("Blip: meeting notes are off"));
  assert.ok(labels(idle).includes("Turn on meeting notes for Blip…"));
  assert.ok(!labels(idle).some((l) => /on its own|automatic/i.test(l)), "no auto-record setting");
  const rec = trayItems({ ...base, phase: "listening", status: "Taking notes" });
  assert.equal(rec[2].label, "Stop and write notes");
  assert.equal(rec.at(-1).label, "Stop and quit Build-a-bot");
  assert.equal(trayIcon({ ...base, phase: "listening" }), "recording");
  assert.equal(trayIcon({ ...base, signedIn: false }), "off");
  const out = trayItems({ ...base, signedIn: false, bots: [] });
  assert.ok(labels(out).includes("Pair this computer…"));
  assert.ok(!labels(out).includes("Show live captions"));
});
