import { test } from "node:test";
import assert from "node:assert/strict";
import { NOT_NOW_COOLDOWN_MS, buddyPhase, elapsed, initialState, isRecording, mustBeVisible, reduce } from "../src/main/call-machine.mjs";

/** Run events through the machine, collecting effects. */
function run(events, ctx = { canAsk: true, neverApps: [] }, state = initialState()) {
  const effects = [];
  for (const e of events) {
    const r = reduce(state, e, ctx);
    state = r.state;
    effects.push(...r.effects.map((f) => f.type));
  }
  return { state, effects };
}

test("idle → asking → listening → paused → listening → saving → done", () => {
  let { state, effects } = run([
    { type: "call_start", key: "fake:zoom", app: "zoom", now: 0 },
    { type: "take", now: 1000 },
  ]);
  assert.equal(state.phase, "starting");
  assert.deepEqual(effects, ["ask", "start"]);
  assert.equal(buddyPhase(state.phase), "listening");

  ({ state, effects } = run(
    [
      { type: "started", meetingId: "mtg_1", now: 2000 },
      { type: "pause", now: 12_000 },
    ],
    undefined,
    state,
  ));
  assert.equal(state.phase, "paused");
  assert.equal(state.elapsedMs, 10_000);
  assert.equal(state.runningSince, null);
  assert.equal(elapsed(state, 99_000), 10_000, "time doesn't count while paused");
  assert.deepEqual(effects, ["pause"]);

  ({ state, effects } = run(
    [
      { type: "resume", now: 60_000 },
      { type: "stop", now: 65_000 },
    ],
    undefined,
    state,
  ));
  assert.equal(state.phase, "stopping");
  assert.equal(state.elapsedMs, 15_000);
  assert.equal(state.stopReason, "owner");
  assert.deepEqual(effects, ["resume", "stop"]);
  assert.equal(buddyPhase(state.phase), "saving");

  ({ state, effects } = run(
    [
      { type: "stopped", now: 66_000 },
      { type: "notes_ready", meetingId: "mtg_1", title: "Launch plan", now: 70_000 },
    ],
    undefined,
    state,
  ));
  assert.equal(state.phase, "done");
  assert.equal(state.message, "Launch plan");
  assert.equal(state.lastMeetingId, "mtg_1");
  assert.deepEqual(effects, ["poll", "notify_ready"]);

  ({ state, effects } = run([{ type: "hide", now: 80_000 }], undefined, state));
  assert.equal(state.phase, "idle");
  assert.deepEqual(effects, ["hide"]);
});

test("never records without a yes: a call only ever asks", () => {
  const { state, effects } = run([{ type: "call_start", key: "k", app: "zoom", now: 0 }]);
  assert.equal(state.phase, "asking");
  assert.ok(!effects.includes("start"));
  assert.equal(isRecording(state.phase), false);
});

test("Not now: hides, no prompt again during that call or for 5 minutes", () => {
  let { state, effects } = run([
    { type: "call_start", key: "a", app: "zoom", now: 0 },
    { type: "dismiss", now: 2000 },
  ]);
  assert.equal(state.phase, "idle");
  assert.deepEqual(effects, ["ask", "hide"]);
  assert.equal(state.cooldownUntil, 2000 + NOT_NOW_COOLDOWN_MS);

  // Another call within 5 minutes: quiet.
  ({ state, effects } = run([{ type: "call_start", key: "b", app: "meet", now: 60_000 }], undefined, state));
  assert.equal(state.phase, "idle");
  assert.deepEqual(effects, []);

  // The first call ends and a new one starts after the cooldown: asks again.
  ({ state, effects } = run(
    [
      { type: "call_end", key: "a", now: 100_000 },
      { type: "call_end", key: "b", now: 100_000 },
      { type: "call_start", key: "a", app: "zoom", now: 2000 + NOT_NOW_COOLDOWN_MS + 1 },
    ],
    undefined,
    state,
  ));
  assert.equal(state.phase, "asking");
});

test("no answer in 15 s counts as Not now", () => {
  const { state, effects } = run([
    { type: "call_start", key: "a", app: "zoom", now: 0 },
    { type: "ask_timeout", now: 15_000 },
  ]);
  assert.equal(state.phase, "idle");
  assert.ok(state.snoozed.a);
  assert.deepEqual(effects, ["ask", "hide"]);
});

test("Don't ask in Zoom: remembered via an effect; the controller stops asking for that app", () => {
  let { state, effects } = run([
    { type: "call_start", key: "a", app: "zoom", now: 0 },
    { type: "never", now: 1000 },
  ]);
  assert.deepEqual(effects, ["ask", "never", "hide"]);
  ({ state, effects } = run(
    [
      { type: "call_end", key: "a", now: 2000 },
      { type: "call_start", key: "a", app: "zoom", now: 10_000 },
    ],
    { canAsk: true, neverApps: ["zoom"] },
    state,
  ));
  assert.equal(state.phase, "idle");
  assert.deepEqual(effects, []);
  // A browser call can't be "never"-ed (the bubble doesn't offer it either).
  ({ effects } = run([
    { type: "call_start", key: "c", app: "browser", now: 0 },
    { type: "never", now: 10 },
  ]));
  assert.deepEqual(effects, ["ask", "hide"]);
});

test("the call ending stops the recording on its own; ending while asking just hides", () => {
  let { state, effects } = run([
    { type: "call_start", key: "a", app: "zoom", now: 0 },
    { type: "take", now: 1000 },
    { type: "started", meetingId: "m", now: 1500 },
    { type: "call_start", key: "b", app: "meet", now: 3000 },
    { type: "call_end", key: "b", now: 4000 },
  ]);
  assert.equal(state.phase, "listening", "another app's call ending doesn't matter");
  ({ state, effects } = run([{ type: "call_end", key: "a", now: 30_000 }], undefined, state));
  assert.equal(state.phase, "stopping");
  assert.equal(state.stopReason, "call_ended");
  assert.deepEqual(effects, ["stop"]);

  ({ state, effects } = run([
    { type: "call_start", key: "a", app: "zoom", now: 0 },
    { type: "call_end", key: "a", now: 5000 },
  ]));
  assert.equal(state.phase, "idle");
  assert.deepEqual(effects, ["ask", "hide"]);
});

test("one prompt per call: stopping mid-call doesn't bring the question back", () => {
  let { state } = run([
    { type: "call_start", key: "a", app: "zoom", now: 0 },
    { type: "take", now: 1 },
    { type: "started", meetingId: "m", now: 2 },
    { type: "stop", now: 10 },
    { type: "stopped", now: 11 },
    { type: "notes_ready", meetingId: "m", title: "T", now: 12 },
  ]);
  assert.equal(state.phase, "done");
  const r = reduce(state, { type: "call_start", key: "a", app: "zoom", now: 20 }, { canAsk: true });
  assert.equal(r.state.phase, "done");
});

test("Stop and delete: discards, then tucks the bot away", () => {
  let { state, effects } = run([
    { type: "call_start", key: "a", app: "zoom", now: 0 },
    { type: "take", now: 1 },
    { type: "started", meetingId: "m", now: 2 },
    { type: "discard", now: 5000 },
  ]);
  assert.equal(state.phase, "discarding");
  assert.equal(buddyPhase(state.phase), "paused", "no red dot while it's being thrown away");
  assert.deepEqual(effects, ["ask", "start", "discard"]);
  ({ state, effects } = run([{ type: "discarded", now: 5200 }], undefined, state));
  assert.equal(state.phase, "idle");
  assert.equal(state.lastMeetingId, null);
  assert.deepEqual(effects, ["hide"]);
});

test("stop or discard while the server is still starting the meeting is honored once it starts", () => {
  let { state, effects } = run([
    { type: "take", now: 0 },
    { type: "discard", now: 10 },
    { type: "started", meetingId: "m", now: 20 },
  ]);
  assert.equal(state.phase, "discarding");
  assert.deepEqual(effects, ["start", "discard"]);

  ({ state, effects } = run([
    { type: "take", now: 0 },
    { type: "stop", reason: "hidden", now: 10 },
    { type: "start_failed", message: "Nope", now: 20 },
  ]));
  assert.equal(state.phase, "idle", "nothing to show for a start that was already called off");
});

test("start failures show the server's message; the heads-up copy is recorded either way", () => {
  let { state, effects } = run([
    { type: "call_start", key: "a", app: "zoom", now: 0 },
    { type: "notice_copied", now: 100 },
    { type: "take", now: 200 },
  ]);
  assert.deepEqual(effects, ["ask", "start"]);
  ({ state } = run([{ type: "start_failed", message: "Turn on Meeting notes for Inky first.", openTarget: "apps", now: 300 }], undefined, state));
  assert.equal(state.phase, "error");
  assert.equal(state.openTarget, "apps");

  // consentNotice is sent with the start; copying later marks it on the meeting.
  const r1 = reduce(initialState(), { type: "call_start", key: "a", app: "zoom", now: 0 }, { canAsk: true });
  const r2 = reduce(r1.state, { type: "notice_copied", now: 1 });
  const r3 = reduce(r2.state, { type: "take", now: 2 });
  assert.equal(r3.effects[0].consentNotice, true);
  const r4 = reduce(reduce(r3.state, { type: "started", meetingId: "m", now: 3 }).state, { type: "notice_copied", now: 4 });
  assert.deepEqual(r4.effects, [], "already sent with the start");

  const s1 = run([{ type: "take", now: 0 }, { type: "started", meetingId: "m2", now: 1 }]).state;
  assert.deepEqual(reduce(s1, { type: "notice_copied", now: 2 }).effects, [{ type: "mark_notice", meetingId: "m2" }]);
});

test("no prompts while detection is paused, signed out, or out of minutes", () => {
  for (const ctx of [{ canAsk: false }, { canAsk: true, detectionPausedUntil: 10_000 }]) {
    const { state, effects } = run([{ type: "call_start", key: "a", app: "zoom", now: 0 }], ctx);
    assert.equal(state.phase, "idle");
    assert.deepEqual(effects, []);
  }
  // But "Take notes now" from the tray still works for a call it can see.
  const { state } = run([{ type: "call_start", key: "a", app: "zoom", now: 0 }, { type: "take", now: 1 }], { canAsk: true, detectionPausedUntil: 10_000 });
  assert.equal(state.phase, "starting");
  assert.equal(state.call.app, "zoom");
});

test("visibility rules and helpers", () => {
  for (const p of ["starting", "listening", "paused"]) assert.equal(mustBeVisible(p), true, p);
  for (const p of ["idle", "asking", "saving", "done"]) assert.equal(mustBeVisible(p), false, p);
  assert.equal(buddyPhase("idle"), null);
});

test("notes that are slow tuck the bot away; a late 'ready' still notifies", () => {
  let { state, effects } = run([
    { type: "take", now: 0 },
    { type: "started", meetingId: "m", now: 1 },
    { type: "stop", now: 2 },
    { type: "stopped", now: 3 },
    { type: "notes_slow", meetingId: "m", now: 200_000 },
  ]);
  assert.equal(state.phase, "idle");
  ({ state, effects } = run([{ type: "notes_ready", meetingId: "m", title: "T", now: 300_000 }], undefined, state));
  assert.equal(state.phase, "idle");
  assert.deepEqual(effects, ["notify_ready"]);
});

test("hiding the bot while it takes notes: only while recording, only where the tray shows it, for that meeting only", () => {
  const ctx = { canAsk: true, neverApps: [], canTuck: true };
  let { state, effects } = run(
    [
      { type: "call_start", key: "fake:zoom", app: "zoom", now: 0 },
      { type: "tuck", now: 500 }, // asking: there's nothing to hide yet
      { type: "take", now: 1000 },
      { type: "started", meetingId: "mtg_1", now: 2000 },
    ],
    ctx,
  );
  assert.equal(state.tucked, false);
  ({ state, effects } = run([{ type: "tuck", now: 3000 }], { ...ctx, canTuck: false }, state));
  assert.equal(state.tucked, false, "without a tray icon to show it's listening, it stays");
  assert.deepEqual(effects, []);

  ({ state, effects } = run([{ type: "tuck", now: 3000 }], ctx, state));
  assert.equal(state.tucked, true);
  assert.equal(state.phase, "listening", "it keeps taking notes");
  assert.deepEqual(effects, ["hide"]);
  assert.equal(mustBeVisible(state.phase), true, "the controller skips the check only because the owner hid it");

  ({ state } = run([{ type: "pause", now: 4000 }, { type: "resume", now: 5000 }], ctx, state));
  assert.equal(state.tucked, true, "pause and resume don't bring it back");
  ({ state } = run([{ type: "untuck", now: 6000 }], ctx, state));
  assert.equal(state.tucked, false);
  ({ state } = run([{ type: "tuck", now: 7000 }], ctx, state));

  // The meeting ends while it's hidden (maybe mid-share): no bubble; the notification says it.
  ({ state, effects } = run(
    [
      { type: "call_end", key: "fake:zoom", now: 8000 },
      { type: "stopped", now: 9000 },
      { type: "notes_ready", meetingId: "mtg_1", title: "Launch plan", now: 10_000 },
    ],
    ctx,
    state,
  ));
  assert.equal(state.phase, "idle");
  assert.equal(state.lastMeetingId, "mtg_1");
  assert.equal(state.call, null);
  assert.deepEqual(effects, ["stop", "poll", "notify_ready", "hide"]);
  assert.equal(state.tucked, false, "the next meeting starts with the bot on screen");
});

test("a hidden meeting whose notes fail shows the problem", () => {
  const ctx = { canAsk: true, neverApps: [], canTuck: true };
  const { state } = run(
    [
      { type: "take", now: 0 },
      { type: "started", meetingId: "mtg_1", now: 1000 },
      { type: "tuck", now: 2000 },
      { type: "stop", now: 3000 },
      { type: "stopped", now: 4000 },
      { type: "notes_failed", meetingId: "mtg_1", now: 5000 },
    ],
    ctx,
  );
  assert.equal(state.phase, "error");
  assert.equal(state.tucked, false);
});

test("Take notes in the room (from the tray): the mic only, even with a call going on", () => {
  let st = initialState();
  ({ state: st } = reduce(st, { type: "call_start", key: "fake:zoom", app: "zoom", now: 0 }, { canAsk: false }));
  const { state, effects } = reduce(st, { type: "take", inPerson: true, now: 1 }, {});
  assert.equal(state.phase, "starting");
  assert.deepEqual(state.call, { key: null, app: "other" });
  assert.deepEqual(effects, [{ type: "start", app: "other", consentNotice: false, inPerson: true }]);
  // "Take notes now" still uses the call it can see, and isn't in the room.
  const now = reduce(st, { type: "take", now: 1 }, {});
  assert.deepEqual(now.effects, [{ type: "start", app: "zoom", consentNotice: false }]);
});
