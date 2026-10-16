/**
 * The call state machine. Pure: `reduce(state, event, ctx)` returns the next state and
 * a list of effects for the controller to run (show the bot, start capture, …).
 *
 *   idle ─call seen─▶ asking ─Take notes─▶ starting ─server ok─▶ listening ⇄ paused
 *                       │                                         │
 *                 Not now / 15 s / Don't ask                  Stop / call ended / auto-stop
 *                       ▼                                         ▼
 *                     idle                         stopping ─flushed─▶ saving ─ready─▶ done
 *
 *   listening/paused ─"Stop and delete"─▶ discarding ─deleted─▶ idle (nothing more is shown)
 *
 * Rules (owner's safety rules, docs/research/meetings-2026-10-14.md §6):
 *  - nothing is captured until the owner says yes (there is no auto-start);
 *  - one prompt per call; after "Not now" (or no answer in 15 s) no prompt for 5 minutes,
 *    and never again during that call;
 *  - "Don't ask in <app>" is remembered by the controller (effect "never").
 */
import { canNeverAsk } from "./apps.mjs";

export const NOT_NOW_COOLDOWN_MS = 5 * 60_000;
export const ASK_TIMEOUT_MS = 15_000;

/** @typedef {'idle'|'asking'|'starting'|'listening'|'paused'|'stopping'|'discarding'|'saving'|'done'|'error'} Phase */
/** @typedef {'meeting'|'apps'|'billing'|'pair'|'app'|'permissions'} OpenTarget */

/**
 * @typedef {object} CallState
 * @property {Phase} phase
 * @property {{ key: string|null, app: string } | null} call  the call we're asking about or recording
 * @property {Record<string, string>} calls  calls detection sees right now (key → app)
 * @property {Record<string, true>} snoozed  calls the owner said "Not now" to (until they end)
 * @property {number} cooldownUntil  no prompts before this time
 * @property {string|null} meetingId  the meeting being recorded or written up
 * @property {string|null} lastMeetingId  for "Open" on the done/error bubble
 * @property {number} elapsedMs  recording time before the current stretch
 * @property {number|null} runningSince  when the current stretch began
 * @property {boolean} noticeCopied  the owner copied the heads-up
 * @property {boolean} noticeSent  the server knows
 * @property {string|null} stopReason
 * @property {string|null} pendingStop  stop/discard asked for while starting
 * @property {string|null} message  done/error text
 * @property {OpenTarget|null} openTarget  what "Open" opens on the error bubble
 * @property {number|null} askedAt
 */

/** @returns {CallState} */
export function initialState() {
  return {
    phase: "idle",
    call: null,
    calls: {},
    snoozed: {},
    cooldownUntil: 0,
    meetingId: null,
    lastMeetingId: null,
    elapsedMs: 0,
    runningSince: null,
    noticeCopied: false,
    noticeSent: false,
    stopReason: null,
    pendingStop: null,
    message: null,
    openTarget: null,
    askedAt: null,
  };
}

/**
 * @typedef {object} Ctx
 * @property {boolean} [canAsk]  signed in, a bot with meeting notes on, minutes left
 * @property {string[]} [neverApps]
 * @property {number} [detectionPausedUntil]
 * @property {number} [notNowCooldownMs]  (tests use a shorter one)
 */

/**
 * @param {CallState} state
 * @param {{ type: string, now?: number, [k: string]: any }} event
 * @param {Ctx} [ctx]
 * @returns {{ state: CallState, effects: Array<{ type: string, [k: string]: any }> }}
 */
export function reduce(state, event, ctx = {}) {
  const s = structuredClone(state);
  /** @type {Array<{ type: string, [k: string]: any }>} */
  const fx = [];
  const now = event.now ?? Date.now();

  switch (event.type) {
    case "call_start": {
      s.calls[event.key] = event.app;
      if ((s.phase === "idle" || s.phase === "done" || s.phase === "error") && mayAsk(s, event.key, event.app, ctx, now)) {
        s.phase = "asking";
        s.call = { key: event.key, app: event.app };
        s.askedAt = now;
        s.noticeCopied = false;
        s.message = null;
        fx.push({ type: "ask", app: event.app });
      }
      break;
    }

    case "call_update": {
      // "A call in Chrome" turned out to be Google Meet.
      if (s.calls[event.key]) s.calls[event.key] = event.app;
      if (s.call && s.call.key === event.key) s.call.app = event.app;
      break;
    }

    case "call_end": {
      delete s.calls[event.key];
      delete s.snoozed[event.key];
      if (!s.call || s.call.key !== event.key) break;
      if (s.phase === "idle" || s.phase === "done" || s.phase === "error") {
        s.call = null;
      } else if (s.phase === "asking") {
        s.phase = "idle";
        s.call = null;
        fx.push({ type: "hide" });
      } else if (s.phase === "listening" || s.phase === "paused") {
        stop(s, fx, "call_ended", now);
      } else if (s.phase === "starting") {
        s.pendingStop = "call_ended";
      }
      break;
    }

    case "take": {
      if (s.phase === "asking" && s.call) {
        start(s, fx, s.call);
      } else if (s.phase === "idle" || s.phase === "done" || s.phase === "error") {
        // From the tray: the owner chose. "Take notes in the room": the mic only, no call.
        // "Take notes now": the call we can see, if any.
        const first = event.inPerson ? null : Object.entries(s.calls)[0];
        start(s, fx, first ? { key: first[0], app: first[1] } : { key: null, app: "other" }, Boolean(event.inPerson));
      }
      break;
    }

    case "notice_copied": {
      if (s.phase === "asking" || s.phase === "starting") {
        s.noticeCopied = true;
      } else if ((s.phase === "listening" || s.phase === "paused") && !s.noticeSent) {
        s.noticeCopied = true;
        s.noticeSent = true;
        fx.push({ type: "mark_notice", meetingId: s.meetingId });
      }
      break;
    }

    case "dismiss":
    case "ask_timeout": {
      if (s.phase !== "asking") break;
      if (s.call?.key) s.snoozed[s.call.key] = true;
      s.cooldownUntil = now + (ctx.notNowCooldownMs ?? NOT_NOW_COOLDOWN_MS);
      s.phase = "idle";
      s.call = null;
      fx.push({ type: "hide" });
      break;
    }

    case "never": {
      if (s.phase !== "asking") break;
      const app = s.call?.app;
      if (s.call?.key) s.snoozed[s.call.key] = true;
      s.phase = "idle";
      s.call = null;
      if (canNeverAsk(app)) fx.push({ type: "never", app });
      fx.push({ type: "hide" });
      break;
    }

    case "started": {
      if (s.phase !== "starting") break;
      s.meetingId = event.meetingId;
      s.lastMeetingId = event.meetingId;
      s.phase = "listening";
      s.elapsedMs = 0;
      s.runningSince = now;
      if (s.noticeCopied && !s.noticeSent) {
        s.noticeSent = true;
        fx.push({ type: "mark_notice", meetingId: s.meetingId });
      }
      if (s.pendingStop) {
        const reason = s.pendingStop;
        s.pendingStop = null;
        if (reason === "discard") discard(s, fx, now);
        else stop(s, fx, reason, now);
      }
      break;
    }

    case "start_failed": {
      if (s.phase !== "starting") break;
      const quiet = Boolean(s.pendingStop) || !event.message;
      s.pendingStop = null;
      s.meetingId = null;
      if (quiet) {
        s.phase = "idle";
        s.call = null;
        fx.push({ type: "hide" });
      } else {
        s.phase = "error";
        s.message = event.message;
        s.openTarget = event.openTarget ?? "app";
      }
      break;
    }

    case "pause": {
      if (s.phase !== "listening") break;
      s.elapsedMs += Math.max(0, now - (s.runningSince ?? now));
      s.runningSince = null;
      s.phase = "paused";
      fx.push({ type: "pause" });
      break;
    }

    case "resume": {
      if (s.phase !== "paused") break;
      s.runningSince = now;
      s.phase = "listening";
      fx.push({ type: "resume" });
      break;
    }

    case "stop": {
      const reason = event.reason ?? "owner";
      if (s.phase === "listening" || s.phase === "paused") stop(s, fx, reason, now);
      else if (s.phase === "starting") s.pendingStop = s.pendingStop === "discard" ? "discard" : reason;
      break;
    }

    case "discard": {
      if (s.phase === "listening" || s.phase === "paused") discard(s, fx, now);
      else if (s.phase === "starting") s.pendingStop = "discard";
      break;
    }

    case "stopped": {
      if (s.phase !== "stopping") break;
      s.phase = "saving";
      fx.push({ type: "poll", meetingId: s.meetingId });
      break;
    }

    case "discarded": {
      if (s.phase !== "discarding") break;
      s.phase = "idle";
      s.meetingId = null;
      s.lastMeetingId = null;
      s.call = null;
      fx.push({ type: "hide" });
      break;
    }

    case "notes_ready": {
      fx.push({ type: "notify_ready", meetingId: event.meetingId, title: event.title });
      if (s.phase !== "saving" || event.meetingId !== s.meetingId) break;
      s.phase = "done";
      s.message = event.title ?? null;
      s.lastMeetingId = event.meetingId;
      s.meetingId = null;
      break;
    }

    case "notes_failed": {
      if (s.phase !== "saving" || event.meetingId !== s.meetingId) break;
      s.phase = "error";
      s.message = event.message ?? "I couldn't write these notes. You can try again from the meeting page.";
      s.openTarget = "meeting";
      s.lastMeetingId = event.meetingId;
      s.meetingId = null;
      break;
    }

    case "notes_slow": {
      // Taking a while (e.g. written on the owner's own computer): tuck away, notify later.
      if (s.phase !== "saving" || event.meetingId !== s.meetingId) break;
      s.phase = "idle";
      s.meetingId = null;
      fx.push({ type: "hide" });
      break;
    }

    case "fail": {
      // Something outside the flow went wrong while idle (e.g. the computer was unpaired).
      if (s.phase === "idle" || s.phase === "done" || s.phase === "error") {
        s.phase = "error";
        s.message = event.message;
        s.openTarget = event.openTarget ?? "app";
      }
      break;
    }

    case "hide": {
      if (s.phase === "done" || s.phase === "error") {
        s.phase = "idle";
        s.message = null;
        if (s.call && !s.calls[s.call.key ?? ""]) s.call = null;
        fx.push({ type: "hide" });
      } else if (s.phase === "asking") {
        return reduce(state, { ...event, type: "dismiss" }, ctx);
      }
      break;
    }

    default:
      break;
  }
  return { state: s, effects: fx };
}

/** @param {CallState} s */
function mayAsk(s, key, app, ctx, now) {
  if (ctx.canAsk === false) return false;
  if ((ctx.neverApps ?? []).includes(app)) return false;
  if ((ctx.detectionPausedUntil ?? 0) > now) return false;
  if (now < s.cooldownUntil) return false;
  if (s.snoozed[key]) return false;
  return true;
}

/** @param {CallState} s @param {boolean} [inPerson]  a meeting in the room: the mic only */
function start(s, fx, call, inPerson = false) {
  s.phase = "starting";
  s.call = call;
  s.meetingId = null;
  s.elapsedMs = 0;
  s.runningSince = null;
  s.pendingStop = null;
  s.stopReason = null;
  s.message = null;
  s.noticeSent = s.noticeCopied;
  // One prompt per call: once the owner has answered for this call, don't ask again during it.
  if (call.key) s.snoozed[call.key] = true;
  fx.push({ type: "start", app: call.app, consentNotice: s.noticeCopied, ...(inPerson ? { inPerson: true } : {}) });
}

/** @param {CallState} s */
function stop(s, fx, reason, now) {
  if (s.runningSince != null) s.elapsedMs += Math.max(0, now - s.runningSince);
  s.runningSince = null;
  s.phase = "stopping";
  s.stopReason = reason;
  fx.push({ type: "stop", reason, meetingId: s.meetingId });
}

/** @param {CallState} s */
function discard(s, fx, now) {
  if (s.runningSince != null) s.elapsedMs += Math.max(0, now - s.runningSince);
  s.runningSince = null;
  s.phase = "discarding";
  fx.push({ type: "discard", meetingId: s.meetingId });
}

/** What the buddy page shows for a machine phase (null = hidden). */
export function buddyPhase(phase) {
  switch (phase) {
    case "asking":
      return "asking";
    case "starting":
    case "listening":
      return "listening";
    case "paused":
    case "discarding":
      return "paused";
    case "stopping":
    case "saving":
      return "saving";
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      return null;
  }
}

/** The bot must be on screen in these phases; if it can't be, recording stops. */
export function mustBeVisible(phase) {
  return phase === "starting" || phase === "listening" || phase === "paused";
}

/** A recording is in progress (capture running, paused, or flushing). */
export function isRecording(phase) {
  return phase === "starting" || phase === "listening" || phase === "paused" || phase === "stopping" || phase === "discarding";
}

/** Recording time so far. */
export function elapsed(state, now = Date.now()) {
  return state.elapsedMs + (state.runningSince != null ? Math.max(0, now - state.runningSince) : 0);
}
