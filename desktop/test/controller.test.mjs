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
    /** How long the window takes to come up (tests set it). */
    delayMs: 0,
    async show(st) {
      calls.push("buddy.show");
      this.states.push(st);
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
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
      calls.push(`api.start:${body.app}:${body.consentNotice}${body.inPerson ? ":room" : ""}`);
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
    async keepHearing(botId, meetingId) {
      calls.push(`api.keepHearing:${meetingId}`);
      return {};
    },
    ...(opts.api ?? {}),
  };
  const uploads = {
    pushed: [],
    /** Pieces still to be heard or sent (tests set it). */
    left: 0,
    age: 0,
    dropped: false,
    push(i) {
      this.pushed.push(i);
    },
    async drain() {
      calls.push("uploads.drain");
      if (opts.drain) return opts.drain(this);
      return { ok: true, left: 0 };
    },
    drop() {
      calls.push("uploads.drop");
      this.dropped = true;
    },
    size() {
      return this.left;
    },
    oldestAge() {
      return this.age;
    },
    isDropped() {
      return this.dropped;
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
    ...(opts.hearing ? { hearing: opts.hearing } : {}),
    ...(opts.canTuck !== undefined ? { canTuck: () => opts.canTuck } : {}),
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
  const broke = startError({ status: 402, code: "no_credit", message: "You're out of credit. Add credit in Credit & usage, or switch me to your own AI key in Settings → Brain (that's free here)." }, "Inky");
  assert.deepEqual(broke, { message: "You're out of credit. Add credit in Credit & usage, or switch me to your own AI key in Settings → Brain (that's free here).", openTarget: "billing" });
  assert.equal(startError({ status: 0, code: "no_credit" }, "Inky").message, "You're out of credit. Add some to take notes.");
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

test("hiding the bot for a screen share: the notes go on, the 1-second check leaves it hidden, and the tray brings it back", async () => {
  const env = setup({ canTuck: true });
  await listening(env);
  assert.equal(env.buddy.states.at(-1).canHide, true, "the pill offers Hide");
  env.c.onBuddyAction("tuck");
  await flush();
  assert.equal(env.c.state.phase, "listening");
  assert.equal(env.c.state.tucked, true);
  assert.equal(env.buddy.visible, false);
  env.calls.length = 0;
  for (let i = 0; i < 6; i++) env.c.tick();
  env.c.onUploaded({ meetingId: "mtg_1", track: "mic" }, { segments: [{ speaker: "You", text: "Next slide, please." }] });
  env.c.dispatch({ type: "pause" });
  env.c.dispatch({ type: "resume" });
  await flush();
  assert.equal(env.c.state.phase, "listening", "hidden on purpose isn't lost");
  assert.deepEqual(env.c.stats.stops, []);
  assert.ok(!env.calls.includes("buddy.show") && !env.calls.includes("buddy.reassert"), "captions, pause and the check don't bring it back");
  assert.equal(env.c.statusText(), "Taking notes (hidden)");

  await env.c.untuck();
  assert.equal(env.c.state.tucked, false);
  assert.equal(env.buddy.visible, true);
  env.c.tick();
  assert.equal(env.c.state.phase, "listening");
  assert.equal(env.c.statusText(), "Taking notes");
  env.c.dispose();
});

test("the bot coming back from hiding: the check waits for its window instead of stopping", async () => {
  const env = setup({ canTuck: true, canReassert: false });
  await listening(env);
  env.buddy.delayMs = 40;
  env.c.tuck();
  await flush();
  const back = env.c.untuck();
  env.c.tick(); // the window is still on its way
  assert.deepEqual(env.c.stats.stops, []);
  await back;
  assert.equal(env.buddy.visible, true);
  env.c.tick();
  assert.equal(env.c.state.phase, "listening");
  env.c.dispose();
});

test("where no tray icon would show it's listening, the bot can't be hidden", async () => {
  const env = setup({ canTuck: false });
  await listening(env);
  assert.equal(env.buddy.states.at(-1).canHide, false, "no Hide on the pill");
  env.c.onBuddyAction("tuck");
  env.c.tuck();
  await flush();
  assert.equal(env.c.state.tucked, false);
  assert.equal(env.buddy.visible, true);
  env.c.dispose();
});

test("Stop while hidden: the bot doesn't pop up mid-share; the notification says the notes are ready", async () => {
  const env = setup({ canTuck: true });
  await listening(env);
  env.c.tuck();
  await flush();
  env.calls.length = 0;
  env.c.stopNow();
  await flush(12);
  assert.equal(env.c.state.phase, "idle");
  assert.ok(!env.calls.includes("buddy.show"), "it stays hidden");
  assert.ok(env.calls.includes("api.finish"));
  assert.ok(env.notes.some((n) => n.startsWith("Notes from “Launch plan” are ready")));
  // The next meeting starts with the bot on screen again.
  await env.c.onCallStart({ key: "fake:meet", app: "meet" });
  await flush();
  assert.equal(env.c.state.phase, "asking");
  assert.ok(env.calls.includes("buddy.show"));
  env.c.dispose();
});

test("tray menu: Hide the bot while taking notes where the icon shows it; Show the bot once hidden", () => {
  const base = { status: "Taking notes", signedIn: true, phase: "listening", canTake: true, detectionPaused: false, captions: true, openAtLogin: false, macTabs: false, platform: "darwin", bots: [{ id: "a", name: "Inky", meetingsOn: true, paused: false }], botId: "a", neverApps: [] };
  const labels = (items) => items.map((i) => i.label).filter(Boolean);
  assert.ok(labels(trayItems({ ...base, canTuck: true })).includes("Hide the bot (keeps taking notes)"));
  assert.ok(labels(trayItems({ ...base, phase: "paused", canTuck: true, tucked: true })).includes("Show the bot"));
  assert.ok(!labels(trayItems({ ...base, canTuck: false })).some((l) => /the bot/.test(l)), "Linux: no tray icon to rely on");
  assert.ok(!labels(trayItems({ ...base, phase: "idle", canTuck: true })).some((l) => /Hide the bot|Show the bot/.test(l)));
  assert.equal(trayIcon({ ...base, tucked: true }), "recording", "the icon says it's listening");
});

test("pause: the last chunk uploads before the server hears 'paused' (a long pause isn't wrapped up as abandoned)", async () => {
  const env = setup();
  const order = [];
  env.c.api.setPaused = async (_b, _m, paused) => {
    order.push(`setPaused:${paused}`);
    return {};
  };
  let drained;
  env.uploads.drain = (meetingId) => {
    order.push(`drain:${meetingId}`);
    return new Promise((r) => (drained = r));
  };
  await listening(env);
  env.c.onBuddyAction("pause");
  await flush();
  assert.deepEqual(order, ["drain:mtg_1"], "nothing tells the server before the audio is up");
  drained({ ok: true, left: 0 });
  await flush();
  assert.deepEqual(order, ["drain:mtg_1", "setPaused:true"]);
  env.c.onBuddyAction("resume");
  await flush();
  assert.deepEqual(order.at(-1), "setPaused:false");
  env.c.dispose();
});

test("pause: a failed 'paused' call is retried", async () => {
  const env = setup({ limits: { retryBaseMs: 5 } });
  let calls = 0;
  env.c.api.setPaused = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("offline"), { status: 0 });
    return {};
  };
  await listening(env);
  env.c.onBuddyAction("pause");
  await flush(10);
  assert.equal(calls, 2);
  env.c.dispose();
});

test("Stop and delete offline: the delete is retried while the app runs, not only at the next launch", async () => {
  const env = setup({ limits: { pendingRetryMs: 0 } });
  let fail = true;
  env.c.api.deleteMeeting = async () => {
    env.calls.push("api.delete");
    if (fail) throw Object.assign(new Error("offline"), { status: 0 });
    return { ok: true };
  };
  await listening(env);
  env.c.onBuddyAction("discard");
  await flush(10);
  assert.equal(env.settingsData.pending.length, 1);
  assert.equal(env.settingsData.pending[0].kind, "delete");
  fail = false;
  env.c.tick();
  await flush(10);
  assert.equal(env.calls.filter((x) => x === "api.delete").length, 2);
  assert.equal(env.settingsData.pending.length, 0);
  env.c.dispose();
});

test("a meeting that ended without notes says why, not 'your notes are ready'", async () => {
  const env = setup();
  env.c.api.getMeeting = async () => ({ meeting: { status: "ready", title: "Zoom meeting", notes: null, error: "I didn't catch any speech in this one. Was the microphone muted?" }, segments: [] });
  await listening(env);
  env.c.onBuddyAction("stop");
  await flush(12);
  assert.equal(env.c.state.phase, "error");
  assert.match(env.c.state.message, /didn't catch any speech/);
  assert.ok(!env.notes.some((n) => /are ready/.test(n)));
  env.c.dispose();
});

// ---------------------------------------------------------------------------
// Meeting notes heard on this computer (NVIDIA Parakeet)
// ---------------------------------------------------------------------------

/** NVIDIA Parakeet as the controller sees it (voice/index.mjs): how pieces are heard, and what to say meanwhile. */
function parakeet(calls, way = "local", note = null) {
  return {
    way: () => way,
    waitNote: () => note,
    ensure: () => calls.push("hearing.ensure"),
    warm: () => calls.push("hearing.warm"),
  };
}

test("Take notes in the room: the mic only, and the server knows it's in the room", async () => {
  const calls = [];
  const env = setup({ hearing: parakeet(calls) });
  env.c.takeNow({ inPerson: true });
  await flush();
  assert.equal(env.c.state.phase, "listening");
  assert.ok(env.calls.includes("api.start:other:false:room"), env.calls.join(", "));
  assert.ok(env.calls.includes("capture.start:off"), "no call audio in the room");
  assert.equal(env.c.statusText(), "Taking notes in the room");
  assert.deepEqual(calls, ["hearing.ensure", "hearing.warm"], "Parakeet is made ready before the first piece");
  // The tray offers it next to "Take notes now".
  const items = trayItems({ status: "", signedIn: true, phase: "idle", canTake: true, detectionPaused: false, captions: true, openAtLogin: false, macTabs: false, platform: "linux", bots: [], botId: null, neverApps: [] });
  assert.ok(items.some((i) => i.id === "take-room" && i.label === "Take notes in the room" && i.enabled !== false));
  env.c.dispose();
});

test("a call before NVIDIA Parakeet is here: it listens, says so, and makes sure it's on its way", async () => {
  const calls = [];
  const env = setup({ hearing: parakeet(calls, "wait", "Getting NVIDIA Parakeet (45%). I'm listening, and I'll write your notes once it's here.") });
  await listening(env);
  assert.ok(calls.includes("hearing.ensure"));
  assert.match(env.buddy.states.at(-1).caption?.text ?? "", /Getting NVIDIA Parakeet \(45%\)/);
  assert.equal(env.c.statusText(), "Taking notes (getting NVIDIA Parakeet…)");
  env.c.dispose();
});

test("while NVIDIA Parakeet downloads there are no captions: the bot says why now and then, and when it's caught up", async () => {
  let way = "wait";
  let note = "Getting NVIDIA Parakeet (10%). I'm listening, and I'll write your notes once it's here.";
  const env = setup({ hearing: { way: () => way, waitNote: () => note, ensure() {}, warm() {} }, limits: { waitNoteMs: 120_000 } });
  await listening(env);
  const said = () => env.c.stats.notices.filter((n) => /NVIDIA Parakeet|Catching up/.test(n));
  assert.deepEqual(said(), [note]);
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => fake;
  const seconds = (n) => {
    for (let i = 0; i < n; i++) {
      fake += 1000;
      env.c.tick();
    }
  };
  try {
    seconds(60);
    assert.equal(said().length, 1, "not every few seconds");
    note = "Getting NVIDIA Parakeet (60%). I'm listening, and I'll write your notes once it's here.";
    seconds(75);
    assert.equal(said().at(-1), note, "again after a couple of minutes, with the progress");
    way = "local";
    note = null;
    seconds(15);
    assert.equal(said().at(-1), "NVIDIA Parakeet is ready. Catching up on the call so far.");
    const count = said().length;
    seconds(300);
    assert.equal(said().length, count, "said once");
  } finally {
    Date.now = realNow;
  }
  env.c.dispose();
});

test("Stop: the notes wait until the last pieces are heard, and the server hears they're still coming", async () => {
  let heard = false;
  const env = setup({
    hearing: parakeet([]),
    limits: { hearingPingMs: 20 },
    // Pieces wait for Parakeet (each drain runs out of time) until they've been heard.
    drain: (u) => {
      if (heard) {
        u.left = 0;
        return { ok: true, left: 0 };
      }
      return new Promise((r) => setTimeout(() => r({ ok: false, left: u.left }), 10));
    },
    api: {
      // The server writes the notes once the meeting is finished.
      async getMeeting() {
        return { meeting: { status: env.calls.includes("api.finish") ? "ready" : "recording", title: "Zoom meeting" }, segments: [] };
      },
    },
  });
  await listening(env);
  env.uploads.left = 2;
  env.c.stopNow();
  await flush(16);
  assert.equal(env.c.state.phase, "saving", "the bubble moves on: it doesn't hang on Stop");
  assert.equal(env.calls.includes("api.finish"), false, "no notes from part of the meeting");
  assert.ok(env.c.finishing.has("mtg_1"));
  assert.ok(env.calls.filter((x) => x === "api.keepHearing:mtg_1").length >= 1, "the server hears the meeting is still being heard");
  heard = true;
  await flush(16);
  assert.ok(env.calls.indexOf("api.finish") > env.calls.lastIndexOf("api.keepHearing:mtg_1"), "finished once every piece was in");
  assert.equal(env.c.finishing.size, 0);
  env.c.dispose();
});

test("notes aren't asked for again while the last pieces are still being heard", async () => {
  let gets = 0;
  const env = setup({
    hearing: parakeet([]),
    limits: { hearingPingMs: 60_000 },
    drain: () => new Promise((r) => setTimeout(() => r({ ok: false, left: 1 }), 30)),
    api: {
      async getMeeting() {
        gets++;
        return { meeting: { status: gets <= 2 ? "recording" : "ready", title: "Zoom meeting" }, segments: [] };
      },
    },
  });
  await listening(env);
  env.uploads.left = 1;
  env.c.stopNow();
  await flush(14);
  assert.ok(env.c.finishing.has("mtg_1"));
  // A wait for the notes that has gone on well past Stop still sees "recording": normally it would
  // finish the meeting again, but not while its last pieces are still being heard.
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => (fake += 20_000);
  try {
    await env.c.waitForNotes("mtg_1", { botId: "bot_1", meetingId: "mtg_1", server: "http://x" });
  } finally {
    Date.now = realNow;
  }
  assert.ok(gets >= 2);
  assert.equal(env.calls.filter((x) => x === "api.finish").length, 0);
  // Once they're in, it finishes.
  env.uploads.left = 0;
  await flush(14);
  assert.equal(env.calls.filter((x) => x === "api.finish").length, 1);
  env.c.dispose();
});

test("notes that are ready are announced once, even when two waits for them overlap", async () => {
  let gets = 0;
  const env = setup({
    api: {
      async getMeeting() {
        gets++;
        return { meeting: { status: gets < 3 ? "recording" : "ready", title: "Launch plan", notes: "## Summary\nShip it." }, segments: [] };
      },
    },
  });
  const rec = { botId: "bot_1", meetingId: "mtg_1", server: "http://x" };
  // Stop started one; the last pieces being heard in full starts another.
  await Promise.all([env.c.pollNotes("mtg_1", rec), env.c.pollNotes("mtg_1", rec)]);
  assert.equal(env.notes.filter((n) => n.startsWith("Notes from “Launch plan” are ready")).length, 1);
  assert.equal(env.c.polling.size, 0);
  env.c.dispose();
});

test("a meeting the server stopped meanwhile isn't finished again", async () => {
  let drains = 0;
  const env = setup({
    hearing: parakeet([]),
    limits: { hearingPingMs: 10 },
    drain: (u) => {
      drains++;
      if (drains === 2) {
        // The server said the meeting is over (409): its pieces were dropped.
        u.left = 0;
        u.dropped = true;
        return { ok: true, left: 0 };
      }
      return new Promise((r) => setTimeout(() => r({ ok: false, left: u.left }), 15));
    },
  });
  await listening(env);
  env.uploads.left = 1;
  env.c.stopNow();
  await flush(20);
  assert.equal(env.calls.includes("api.finish"), false);
  env.c.dispose();
});
