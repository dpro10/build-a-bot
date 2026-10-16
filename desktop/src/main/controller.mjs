/**
 * The meeting controller: runs the call state machine (call-machine.mjs) and carries
 * out its effects — the bot at the bottom of the screen, capture, uploads, the
 * server's meeting, and the "notes are ready" notification.
 *
 * Safety rules enforced here (docs/research/meetings-2026-10-14.md §6.10):
 *  - nothing is captured until the owner taps "Take notes" (or "Take notes now");
 *  - capture starts only after the bot is on screen, and stops (and finishes the
 *    meeting) if the bot can't stay on screen, the screen locks, the computer sleeps
 *    or the app quits; checked every second and on window events;
 *  - Stop is one click; "Stop and delete" deletes everything captured so far;
 *  - audio goes to the upload queue only (memory, or the spool while it waits). NVIDIA Parakeet
 *    hears each piece on this computer and only the lines are sent (meeting-speech.mjs); the
 *    notes are written once every piece has been heard.
 */
import { EventEmitter } from "node:events";
import { appName, consentNote } from "./apps.mjs";
import { ASK_TIMEOUT_MS, NOT_NOW_COOLDOWN_MS, buddyPhase, elapsed, initialState, isRecording, mustBeVisible, reduce } from "./call-machine.mjs";

export const DEFAULT_LIMITS = Object.freeze({
  askTimeoutMs: ASK_TIMEOUT_MS,
  /** No new prompt for this long after "Not now". */
  notNowCooldownMs: NOT_NOW_COOLDOWN_MS,
  /** Auto-stop after this much continuous silence on every track. */
  silenceStopMs: 15 * 60_000,
  /** The server refuses audio past 4 hours. */
  maxMeetingMs: 4 * 3600_000,
  /** How long Stop waits for uploads before finishing anyway. */
  drainMs: 90_000,
  /** Tuck the bot away if the notes take longer than this (notify when ready). */
  slowNotesMs: 120_000,
  /** How long Pause waits for the last chunk to upload before telling the server it's paused. */
  pauseDrainMs: 30_000,
  /** First wait before retrying a pause/resume the server didn't get. */
  retryBaseMs: 1000,
  /** Deletes and finishes that failed (offline) are retried this often, not just at launch. */
  pendingRetryMs: 60_000,
  /** While pieces wait to be heard (NVIDIA Parakeet is on its way), the server hears this often that the meeting isn't abandoned. */
  hearingPingMs: 5 * 60_000,
  /** A piece waiting this long means pieces are stuck: tell the server the meeting is still being heard. */
  hearingStuckMs: 2 * 60_000,
  /** After the call, wait at most this long for the last pieces to be heard; then the notes are written from what arrived. */
  hearingWaitMs: 12 * 3600_000,
  /** While pieces wait for NVIDIA Parakeet there are no captions: the bot says why this often. */
  waitNoteMs: 2 * 60_000,
});

const STOP_NOTES = {
  silence: (bot) => `${bot} stopped taking notes because it's been quiet for 15 minutes.`,
  max_length: (bot) => `${bot} stopped at 4 hours, the longest one meeting can be.`,
  limit: (bot) => `You're out of credit, so ${bot} stopped. Notes for what it heard are on the way.`,
  hidden: (bot) => `${bot} stopped taking notes because it couldn't stay on your screen.`,
  "lock-screen": (bot) => `${bot} stopped taking notes when your screen locked.`,
  suspend: (bot) => `${bot} stopped taking notes when your computer went to sleep.`,
  not_recording: (bot) => `${bot} stopped: this meeting was ended somewhere else.`,
  gone: (bot) => `${bot} stopped: this meeting was ended somewhere else.`,
  mic_lost: (bot) => `${bot} stopped because it lost your microphone.`,
};

/** A start error → words for the bubble, and what "Open" should open. */
export function startError(err, botName) {
  const e = /** @type {any} */ (err) ?? {};
  const server = typeof e.message === "string" && e.status > 0 ? e.message : null;
  switch (e.code) {
    case "meetings_off":
      return { message: server ?? `Turn on Meeting notes for ${botName} first.`, openTarget: "apps" };
    case "no_credit":
    case "limit":
      return { message: server ?? "You're out of credit. Add some to take notes.", openTarget: "billing" };
    case "paused":
      return { message: server ?? `${botName} is paused. Resume it to take notes.`, openTarget: "bot" };
    case "already_recording":
      return { message: server ?? `${botName} is already taking notes in another meeting.`, openTarget: "app" };
    case "unavailable":
      return { message: "Meeting notes aren't set up on this server yet.", openTarget: "app" };
    case "network":
      return { message: "I can't reach Build-a-bot right now. Check your internet and try again.", openTarget: "app" };
    default:
      break;
  }
  if (e.status === 401) return { message: "This computer was unpaired. Pair it again to take notes.", openTarget: "pair" };
  return { message: server ?? "Something went wrong. Try again in a moment.", openTarget: "app" };
}

export const SYSTEM_AUDIO_NOTICES = {
  /** macOS: Screen & System Audio Recording isn't allowed for the app. */
  denied: "I can only hear your mic. Allow system audio in Privacy & Security to hear everyone.",
  unavailable: "I can only hear your mic here, so the notes will have your side of the call.",
  ended: "I lost the call's audio. I can still hear your mic.",
};

/** What to tell the owner when the call's audio isn't available. On a Mac it's almost always the permission. */
export function systemNotice(status, platform = process.platform) {
  if (status === "ended") return SYSTEM_AUDIO_NOTICES.ended;
  if (platform === "darwin") return SYSTEM_AUDIO_NOTICES.denied;
  return SYSTEM_AUDIO_NOTICES.unavailable;
}

export class Controller extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('./account.mjs').Account} o.account
   * @param {import('./store.mjs').Settings} o.settings
   * @param {ReturnType<typeof import('./api.mjs').createApi>} o.api
   * @param {import('./buddy-window.mjs').BuddyWindow} o.buddy
   * @param {import('./capture-window.mjs').CaptureWindow} o.capture
   * @param {import('./upload-queue.mjs').UploadQueue} o.uploads
   * @param {import('./spool.mjs').Spool} o.spool
   * @param {(n: { title: string, body: string, onClick?: () => void }) => void} o.notify
   * @param {(url: string) => void} o.openUrl
   * @param {(target: string) => void} o.openSpecial  'pair' | 'permissions'
   * @param {(text: string) => void} o.writeClipboard
   * @param {() => 'loopback'|'off'} [o.systemAudioMode]
   * @param {() => Promise<boolean>} [o.ensureMicAccess]  macOS: ask for the microphone the first time
   * @param {{ way(): string, waitNote(): string | null, ensure(): void, warm(): void }} [o.hearing]  NVIDIA Parakeet for meetings (voice/index.mjs)
   * @param {Partial<typeof DEFAULT_LIMITS>} [o.limits]
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    super();
    this.o = o;
    this.account = o.account;
    this.settings = o.settings;
    this.api = o.api;
    this.buddy = o.buddy;
    this.capture = o.capture;
    this.uploads = o.uploads;
    const given = Object.fromEntries(Object.entries(o.limits ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
    this.limits = { ...DEFAULT_LIMITS, ...given };
    this.log = o.log ?? (() => {});
    this.state = initialState();
    /** @type {null | { meetingId: string, botId: string, server: string, chunkMs: number, lastVoiceMs: number, timelineMs: number, system: string | null, inPerson?: boolean }} */
    this.rec = null;
    /** Meetings whose last pieces are still being heard before their notes are written. @type {Set<string>} */
    this.finishing = new Set();
    /** When the server last heard that a meeting is still being heard here. @type {Map<string, number>} */
    this.hearingPings = new Map();
    /** Meetings whose notes are being waited for (one wait each, so "ready" is said once). @type {Set<string>} */
    this.polling = new Set();
    this.lastRec = null;
    /** The bot shown at the bottom (fixed for one recording). */
    this.recBot = null;
    this.level = 0;
    this.caption = null;
    this.notice = null;
    this.noticeAt = 0;
    /** What the bot last said about waiting for NVIDIA Parakeet, and when. */
    this.waiting = { note: /** @type {string | null} */ (null), at: 0 };
    this.hovering = false;
    this.askDeadline = 0;
    this.buddyPending = false;
    this.lastLevelPush = 0;
    this.ticks = 0;
    /** When failed deletes/finishes were last retried. */
    this.pendingRetryAt = Date.now();
    this.retryingPending = false;
    this.stats = { chunks: 0, uploaded: 0, captions: 0, notices: [], notifications: [], stops: [], chunkLog: [] };
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
  }

  dispose() {
    clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- the machine

  machineCtx() {
    const s = this.settings.get();
    return { canAsk: this.account.canTakeNotes(), neverApps: s.neverApps, detectionPausedUntil: s.detectionPausedUntil, notNowCooldownMs: this.limits.notNowCooldownMs };
  }

  /** @param {{ type: string, [k: string]: any }} event */
  dispatch(event) {
    const before = this.state.phase;
    const { state, effects } = reduce(this.state, { now: Date.now(), ...event }, this.machineCtx());
    this.state = state;
    if (before !== state.phase) this.log(`call: ${before} → ${state.phase} (${event.type}${event.reason ? `: ${event.reason}` : ""})`);
    if (state.phase === "idle" || state.phase === "asking") this.recBot = null;
    for (const fx of effects) {
      Promise.resolve()
        .then(() => this.run(fx))
        .catch((err) => this.log(`effect ${fx.type} failed: ${err?.stack ?? err}`));
    }
    this.render();
    this.emit("change");
  }

  /** @param {{ type: string, [k: string]: any }} fx */
  async run(fx) {
    switch (fx.type) {
      case "ask":
        return this.showAsk();
      case "hide":
        this.buddy.hide();
        this.hovering = false;
        return;
      case "never": {
        const never = new Set(this.settings.get().neverApps);
        never.add(fx.app);
        this.settings.update({ neverApps: [...never] });
        this.emit("change");
        return;
      }
      case "start":
        return this.startRecording(fx);
      case "pause": {
        await this.capture.pause();
        this.level = 0;
        this.render();
        const rec = this.rec;
        if (!rec) return;
        // The audio from just before the pause goes up first. Arriving after the "paused" mark,
        // it reads as recording again, and since nothing is sent while paused, the server would
        // wrap a pause longer than 20 minutes up as an abandoned meeting.
        await this.uploads.drain(rec.meetingId, this.limits.pauseDrainMs);
        if (this.rec === rec && this.state.phase === "paused") await this.markPaused(rec, true);
        return;
      }
      case "resume": {
        const r = await this.capture.resume();
        if (!r.ok) this.dispatch({ type: "stop", reason: "mic_lost" });
        else if (this.rec) await this.markPaused(this.rec, false);
        return;
      }
      case "stop":
        return this.stopRecording(fx.reason);
      case "discard":
        return this.discardRecording();
      case "poll":
        return this.pollNotes(fx.meetingId);
      case "notify_ready":
        return this.notifyReady(fx.meetingId, fx.title);
      case "mark_notice": {
        const botId = this.rec?.botId;
        if (botId && fx.meetingId) await this.api.markNoticeCopied(botId, fx.meetingId).catch((e) => this.log(`notice: ${e.status ?? e}`));
        return;
      }
      default:
        return;
    }
  }

  /** Tell the server the recording is paused (or not), retrying a network blip or two. */
  async markPaused(rec, paused) {
    if (!this.api.setPaused) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.api.setPaused(rec.botId, rec.meetingId, paused);
        return;
      } catch (err) {
        const status = /** @type {any} */ (err)?.status ?? 0;
        this.log(`${paused ? "pause" : "resume"}: ${status || err}`);
        if (status && status < 500 && status !== 429) return; // the meeting ended or moved: nothing to retry
        await new Promise((r) => setTimeout(r, this.limits.retryBaseMs * 2 ** attempt));
        if (this.rec !== rec || this.state.phase !== (paused ? "paused" : "listening")) return;
      }
    }
  }

  // ---------------------------------------------------------------- the bot on screen

  displayBot() {
    return this.recBot ?? this.account.bot() ?? this.account.anyBot();
  }

  buddyState() {
    const phase = buddyPhase(this.state.phase);
    const bot = this.displayBot();
    if (!phase || !bot) return null;
    const app = this.state.call?.app ?? "other";
    const listening = this.state.phase === "listening";
    return {
      phase,
      bot: { name: bot.name, avatar: bot.avatar, color: bot.color },
      app: { id: app, name: appName(app) },
      elapsedMs: Math.round(this.state.elapsedMs),
      runningSince: listening ? this.state.runningSince : null,
      level: listening ? this.level : 0,
      caption: listening ? this.caption : null,
      message: this.state.message ?? undefined,
      minutesLeft: this.account.session?.meetings?.minutesLeft ?? null,
      consentNote: consentNote(bot.name),
    };
  }

  render() {
    const st = this.buddyState();
    if (!st) return;
    if (this.buddy.isShowing() || this.buddyPending) this.buddy.update(st);
    else void this.buddy.show(st);
  }

  async showAsk() {
    this.askDeadline = Date.now() + this.limits.askTimeoutMs + 5000;
    const st = this.buddyState();
    const ok = st ? await this.buddy.show(st) : false;
    if (this.state.phase !== "asking") return;
    if (!ok) {
      this.log("ask: couldn't show the bot; not asking this time");
      this.dispatch({ type: "ask_timeout" });
      return;
    }
    this.askDeadline = Date.now() + this.limits.askTimeoutMs;
  }

  // ---------------------------------------------------------------- recording

  systemAudioMode() {
    return this.o.systemAudioMode?.() ?? "loopback";
  }

  /** @param {{ app: string, consentNotice: boolean, inPerson?: boolean }} fx */
  async startRecording(fx) {
    const bot = this.account.bot();
    const server = this.account.server();
    if (!bot || !server) {
      this.dispatch({ type: "start_failed", message: `${this.account.whyNot() ?? "Pick a bot to take notes"}.`, openTarget: this.account.device ? "apps" : "pair" });
      return;
    }
    this.recBot = bot;
    this.caption = null;
    this.notice = null;
    this.level = 0;

    // 1. The bot goes on screen first. If it can't, nothing is recorded.
    this.buddyPending = true;
    const st = this.buddyState();
    const shown = st ? await this.buddy.show(st) : false;
    this.buddyPending = false;
    if (!shown) {
      this.log("safety: the bot couldn't be shown, so recording didn't start");
      this.notifyOwner(`${bot.name} didn't start`, "I couldn't show myself on your screen, so I didn't take notes.");
      this.dispatch({ type: "start_failed", message: null });
      return;
    }
    if (this.o.ensureMicAccess && !(await this.o.ensureMicAccess())) {
      this.dispatch({ type: "start_failed", message: "I can't hear your microphone. Let Build-a-bot use it in your system settings, then try again.", openTarget: "permissions" });
      return;
    }

    // NVIDIA Parakeet will hear it: make sure it's here (or on its way), and loaded.
    this.o.hearing?.ensure();
    this.o.hearing?.warm();

    // 2. The meeting on the server (with the consent record).
    const inPerson = fx.inPerson === true;
    let res;
    try {
      res = await this.api.startMeeting(bot.id, { app: fx.app, consentNotice: fx.consentNotice, inPerson });
    } catch (err) {
      const e = /** @type {any} */ (err);
      this.log(`start: server said ${e.status} ${e.code ?? ""}`);
      this.dispatch({ type: "start_failed", ...startError(e, bot.name) });
      if (e.status === 401) this.account.signOut("This computer was unpaired. Pair it again to take notes.");
      return;
    }
    const meetingId = res.meeting.id;
    const chunkMs = Number(res.chunkMs) || this.account.session?.meetings?.chunkMs || 20_000;
    this.rec = { meetingId, botId: bot.id, server, chunkMs, lastVoiceMs: 0, timelineMs: 0, system: null, inPerson };

    // 3. Capture. In the room, there's no call to hear: the mic only.
    const cap = await this.capture.start({ chunkMs, system: inPerson ? "off" : this.systemAudioMode() });
    if (!cap.ok) {
      this.log(`start: capture failed (${cap.error ?? "?"})`);
      // Nothing was captured: the empty meeting goes (retried if offline, so it isn't later
      // wrapped up on the server as an abandoned meeting with "notes" to send).
      await this.api.deleteMeeting(bot.id, meetingId).catch((err) => {
        if (/** @type {any} */ (err)?.status !== 404) this.addPending({ kind: "delete", botId: bot.id, meetingId, server });
      });
      this.rec = null;
      this.dispatch({ type: "start_failed", message: "I can't hear your microphone. Let Build-a-bot use it in your system settings, then try again.", openTarget: "permissions" });
      return;
    }
    this.rec.system = cap.system;
    this.log(`start: recording ${meetingId} (mic, system audio: ${cap.system}, ${chunkMs} ms chunks${inPerson ? ", in the room" : ""}; heard: ${this.o.hearing?.way() ?? "server"})`);
    this.dispatch({ type: "started", meetingId });
    this.waiting = { note: null, at: 0 };
    if (cap.system !== "ok" && cap.system !== "off") this.showNotice(systemNotice(cap.system));
    else this.remindWaiting();
  }

  /**
   * While a meeting's pieces wait for NVIDIA Parakeet (it's still downloading), there are no
   * captions: the bot says why, and again every `waitNoteMs`; once it can hear, that it's
   * catching up.
   */
  remindWaiting() {
    if (!this.rec || this.state.phase !== "listening") return;
    const note = this.o.hearing?.waitNote() ?? null;
    const now = Date.now();
    if (note) {
      if (this.waiting.note && now - this.waiting.at < this.limits.waitNoteMs) return;
      if (this.notice && now - this.noticeAt < 12_000) return; // let the last notice be read
      this.waiting = { note, at: now };
      this.showNotice(note);
    } else if (this.waiting.note) {
      this.waiting = { note: null, at: 0 };
      this.showNotice(this.o.hearing?.way() === "local" ? "NVIDIA Parakeet is ready. Catching up on the call so far." : "Catching up on the call so far.");
    }
  }

  async stopRecording(reason) {
    const rec = this.rec;
    this.stats.stops.push(reason);
    if (!rec) {
      this.dispatch({ type: "stopped" });
      return;
    }
    await this.capture.stop();
    this.level = 0;
    // Pieces waiting for NVIDIA Parakeet can't go yet: Stop doesn't wait on them (they're finished below).
    const drained = await this.uploads.drain(rec.meetingId, this.o.hearing?.way() === "wait" ? Math.min(this.limits.drainMs, 3000) : this.limits.drainMs);
    if (!["not_recording", "gone", "unpaired"].includes(reason)) {
      if (drained.ok) await this.finishMeeting(rec);
      else {
        // Pieces still to be heard (NVIDIA Parakeet is on its way) or sent (offline): the notes
        // are written once they're in, not from part of the meeting.
        this.log(`stop: ${drained.left} piece(s) still to be heard or sent; the notes are written once they're in`);
        void this.finishWhenHeard(rec);
      }
    }
    this.lastRec = rec;
    this.rec = null;
    this.caption = null;
    const note = STOP_NOTES[/** @type {keyof typeof STOP_NOTES} */ (reason)];
    if (note) this.notifyOwner(`${this.recBot?.name ?? "Your bot"} stopped taking notes`, note(this.recBot?.name ?? "Your bot"));
    this.dispatch({ type: "stopped" });
  }

  async discardRecording() {
    const rec = this.rec;
    await this.capture.stop({ discard: true });
    this.level = 0;
    if (rec) {
      this.uploads.drop(rec.meetingId);
      try {
        await this.api.deleteMeeting(rec.botId, rec.meetingId);
        this.log(`discard: deleted ${rec.meetingId}`);
      } catch (err) {
        const e = /** @type {any} */ (err);
        if (e?.status !== 404) {
          this.log(`discard: delete failed (${e?.status ?? e}); will retry`);
          this.addPending({ kind: "delete", botId: rec.botId, meetingId: rec.meetingId, server: rec.server });
        }
      }
    }
    this.rec = null;
    this.caption = null;
    this.dispatch({ type: "discarded" });
  }

  /** Tell the server the meeting is over, so the notes get written (retried later if it can't be reached). */
  async finishMeeting(rec) {
    try {
      await this.api.finish(rec.botId, rec.meetingId, rec.server);
    } catch (err) {
      this.log(`stop: finish failed (${/** @type {any} */ (err)?.status ?? err}); will retry`);
      this.addPending({ kind: "finish", botId: rec.botId, meetingId: rec.meetingId, server: rec.server });
    }
  }

  /**
   * Finish a meeting once every piece of it has been heard and sent. That can take a while (NVIDIA
   * Parakeet was still downloading when the call began, it's catching up, or the network is down):
   * meanwhile the server hears that this computer is still on it, so it doesn't wrap the meeting up
   * early. After `hearingWaitMs` it stops waiting and the notes are written from what arrived.
   * @param {{ botId: string, meetingId: string, server: string }} rec
   */
  async finishWhenHeard(rec) {
    if (this.finishing.has(rec.meetingId)) return;
    this.finishing.add(rec.meetingId);
    const t0 = Date.now();
    try {
      while (this.uploads.size(rec.meetingId) > 0) {
        if (Date.now() - t0 > this.limits.hearingWaitMs) {
          this.log(`finish: gave up waiting for ${this.uploads.size(rec.meetingId)} piece(s) of ${rec.meetingId}`);
          this.uploads.drop(rec.meetingId);
          break;
        }
        await this.keepHearing(rec, true);
        await this.uploads.drain(rec.meetingId, this.limits.hearingPingMs);
      }
      // The server stopped it, or it was deleted or unpaired meanwhile: nothing to finish.
      if (this.uploads.isDropped(rec.meetingId) && Date.now() - t0 <= this.limits.hearingWaitMs) return;
      await this.finishMeeting(rec);
      this.log(`finish: ${rec.meetingId} was heard in full after the call (${Math.round((Date.now() - t0) / 1000)} s)`);
      // The bubble may be long gone: say when the notes are ready.
      if (this.lastRec?.meetingId !== rec.meetingId || this.state.phase !== "saving") void this.pollNotes(rec.meetingId, rec);
    } finally {
      this.finishing.delete(rec.meetingId);
      this.hearingPings.delete(rec.meetingId);
    }
  }

  /**
   * The server hears that this computer is still hearing the meeting (at most every `hearingPingMs`).
   * @param {{ botId: string, meetingId: string }} rec
   * @param {boolean} [now]  without waiting for pieces to look stuck
   */
  async keepHearing(rec, now = false) {
    if (!this.api.keepHearing) return;
    const last = this.hearingPings.get(rec.meetingId) ?? 0;
    if (Date.now() - last < this.limits.hearingPingMs) return;
    if (!now && this.uploads.oldestAge(rec.meetingId) < this.limits.hearingStuckMs) return;
    this.hearingPings.set(rec.meetingId, Date.now());
    await this.api.keepHearing(rec.botId, rec.meetingId).catch((err) => this.log(`keep hearing: ${/** @type {any} */ (err)?.status ?? err}`));
  }

  async pollNotes(meetingId, rec = this.lastRec) {
    if (!rec || rec.meetingId !== meetingId) return;
    // One wait per meeting: Stop starts one, and a meeting heard in full later can start another.
    if (this.polling.has(meetingId)) return;
    this.polling.add(meetingId);
    try {
      await this.waitForNotes(meetingId, rec);
    } finally {
      this.polling.delete(meetingId);
    }
  }

  /** @param {string} meetingId @param {{ botId: string, meetingId: string, server: string }} rec */
  async waitForNotes(meetingId, rec) {
    const t0 = Date.now();
    let delay = 1500;
    let slow = false;
    let refinished = false;
    for (;;) {
      try {
        const { meeting } = await this.api.getMeeting(rec.botId, meetingId, rec.server);
        if (meeting.status === "ready" && !meeting.notes && meeting.error) {
          // Finished without notes (nothing heard, the bot was paused, the brain failed): say so
          // instead of "your notes are ready".
          this.removePending(meetingId);
          this.dispatch({ type: "notes_failed", meetingId, message: String(meeting.error).slice(0, 200) });
          return;
        }
        if (meeting.status === "ready") {
          this.removePending(meetingId);
          this.dispatch({ type: "notes_ready", meetingId, title: meeting.title });
          return;
        }
        if (meeting.status === "failed") {
          this.dispatch({ type: "notes_failed", meetingId });
          return;
        }
        // Still recording after Stop: finish again (not while its last pieces are still being heard).
        if (meeting.status === "recording" && !refinished && Date.now() - t0 > 15_000 && !this.finishing.has(meetingId) && this.uploads.size(meetingId) === 0) {
          refinished = true;
          await this.api.finish(rec.botId, meetingId, rec.server).catch(() => {});
        }
      } catch (err) {
        const e = /** @type {any} */ (err);
        if (e?.status === 404 || e?.status === 401) {
          this.dispatch({ type: "notes_failed", meetingId, message: "I couldn't find these notes anymore." });
          return;
        }
      }
      const waited = Date.now() - t0;
      if (!slow && waited > this.limits.slowNotesMs) {
        slow = true;
        this.dispatch({ type: "notes_slow", meetingId });
      }
      if (waited > 30 * 60_000) return;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(Math.round(delay * 1.4), slow ? 30_000 : 5000);
    }
  }

  notifyReady(meetingId, title) {
    const rec = this.lastRec;
    const bot = this.recBot ?? this.displayBot();
    const url = this.urlFor("meeting", { meetingId, botId: rec?.botId ?? bot?.id });
    this.notifyOwner(`Notes from “${title ?? "your meeting"}” are ready`, `${bot?.name ?? "Your bot"} wrote them up. Click to open them.`, () => this.o.openUrl(url));
  }

  notifyOwner(title, body, onClick) {
    this.stats.notifications.push(title);
    this.o.notify({ title, body, onClick });
  }

  /** A short message from the bot, shown above it (the contract has no separate notice field). */
  showNotice(text) {
    const bot = this.displayBot();
    this.notice = text;
    this.noticeAt = Date.now();
    this.stats.notices.push(text);
    // Shown ~15 s (the page hides captions 7 s after `at`).
    this.caption = { speaker: bot?.name ?? "Build-a-bot", text, at: Date.now() + 8000 };
    this.render();
  }

  // ---------------------------------------------------------------- inputs

  /** Detection saw a call start. */
  async onCallStart(ev) {
    if (ev.bounds) this.buddy.setCallBounds(ev.bounds);
    await this.account.refreshIfStale(60_000, 4000);
    this.dispatch({ type: "call_start", key: ev.key, app: ev.app });
  }

  onCallEnd(ev) {
    this.dispatch({ type: "call_end", key: ev.key });
  }

  onCallUpdate(ev) {
    this.dispatch({ type: "call_update", key: ev.key, app: ev.app });
  }

  /**
   * A click in the bot's bubble. Each action only counts in the phase whose bubble
   * shows it (a hidden or stale page can't start anything).
   */
  onBuddyAction(action) {
    const phase = this.state.phase;
    const recording = phase === "listening" || phase === "paused" || phase === "starting";
    if (!this.buddy.isShowing() && action !== "stop" && action !== "discard") return;
    switch (action) {
      case "take":
      case "dismiss":
      case "never":
        if (phase === "asking") this.dispatch({ type: action });
        return;
      case "pause":
      case "resume":
      case "discard":
        if (recording) this.dispatch({ type: action });
        return;
      case "stop":
        if (recording) this.dispatch({ type: "stop", reason: "owner" });
        return;
      case "hide":
        if (phase === "done" || phase === "error" || phase === "asking") this.dispatch({ type: "hide" });
        return;
      case "open":
        if (phase !== "asking") this.openForPhase();
        return;
      default:
        return;
    }
  }

  onInteractive(on) {
    this.hovering = Boolean(on);
    if (!on && this.state.phase === "asking") this.askDeadline = Math.max(this.askDeadline, Date.now() + 5000);
  }

  /** The owner copied the heads-up (from the bubble or the tray). */
  onCopy(text) {
    this.o.writeClipboard(text);
    this.dispatch({ type: "notice_copied" });
  }

  copyHeadsUp() {
    const bot = this.displayBot();
    this.onCopy(consentNote(bot?.name ?? ""));
  }

  /** @param {{ track: string, chunk: number, startMs: number, durationMs: number, silent: boolean, mime: string, data: any }} c */
  onChunk(c) {
    const rec = this.rec;
    if (!rec || this.state.phase === "discarding") return;
    const track = c?.track === "system" ? "system" : c?.track === "mic" ? "mic" : null;
    const ok = track && Number.isInteger(c.chunk) && c.chunk >= 0 && c.chunk <= 5000 && Number.isFinite(c.startMs) && Number.isFinite(c.durationMs) && c.durationMs > 0 && c.data;
    if (!ok) return;
    const bytes = Buffer.from(c.data.buffer ? new Uint8Array(c.data.buffer, c.data.byteOffset ?? 0, c.data.byteLength) : c.data);
    if (bytes.byteLength > 8 * 1024 * 1024) return;
    this.uploads.push({
      server: rec.server,
      botId: rec.botId,
      meetingId: rec.meetingId,
      track,
      chunk: c.chunk,
      startMs: Math.round(c.startMs),
      durationMs: Math.round(c.durationMs),
      silent: Boolean(c.silent),
      mime: c.mime === "audio/ogg" ? "audio/ogg" : "audio/webm",
      bytes,
    });
    this.stats.chunks++;
    // Metadata only (never audio), for the e2e test: each chunk should be a complete webm file.
    // `cut`: whether it ended at a pause in the talking, at the longest a chunk waits for one, or at pause/stop.
    const cut = ["pause", "time", "stop"].includes(c.cut) ? c.cut : null;
    this.stats.chunkLog.push({ track, chunk: c.chunk, startMs: Math.round(c.startMs), durationMs: Math.round(c.durationMs), silent: Boolean(c.silent), cut, bytes: bytes.byteLength, head: bytes.subarray(0, 4).toString("hex") });
    if (this.stats.chunkLog.length > 40) this.stats.chunkLog.shift();
    const end = c.startMs + c.durationMs;
    rec.timelineMs = Math.max(rec.timelineMs, end);
    if (!c.silent) rec.lastVoiceMs = Math.max(rec.lastVoiceMs, end);
    if (this.state.phase === "listening" && rec.timelineMs - rec.lastVoiceMs >= this.limits.silenceStopMs) {
      this.log(`auto-stop: ${Math.round((rec.timelineMs - rec.lastVoiceMs) / 60000)} min of silence`);
      this.dispatch({ type: "stop", reason: "silence" });
    }
  }

  onLevel(level) {
    if (this.state.phase !== "listening") return;
    this.level = Math.max(0, Math.min(1, Number(level) || 0));
    const now = Date.now();
    if (now - this.lastLevelPush >= 140) {
      this.lastLevelPush = now;
      this.render();
    }
  }

  onTrackEnded(info) {
    if (!this.rec || !["listening", "paused", "starting"].includes(this.state.phase)) return;
    if (info?.track === "system") {
      this.rec.system = "ended";
      this.showNotice(SYSTEM_AUDIO_NOTICES.ended);
    } else {
      this.dispatch({ type: "stop", reason: "mic_lost" });
    }
    this.emit("change");
  }

  /** An upload finished: show the newest line as a live caption. */
  onUploaded(item, body) {
    this.stats.uploaded++;
    if (!this.rec || item.meetingId !== this.rec.meetingId) return;
    const lines = Array.isArray(body?.segments) ? body.segments.filter((s) => typeof s?.text === "string" && s.text.trim()) : [];
    const last = lines[lines.length - 1];
    if (!last || !this.settings.get().captions) return;
    if (this.notice && Date.now() - this.noticeAt < 12_000) return; // let the notice be read
    this.caption = { speaker: String(last.speaker || (item.track === "mic" ? "You" : "Others")).slice(0, 40), text: String(last.text).trim().slice(0, 300), at: Date.now() };
    this.stats.captions++;
    this.render();
  }

  /** The server told the uploader to stop (402, 409, 401, …). */
  onUploadStop(reason, item) {
    if (!this.rec || item.meetingId !== this.rec.meetingId) return;
    const why = reason === "too_long" ? "max_length" : reason;
    this.dispatch({ type: "stop", reason: why });
    if (reason === "unpaired") this.account.signOut("This computer was unpaired. Pair it again to take notes.");
  }

  /** The buddy window was hidden, minimized, closed or crashed. */
  onBuddyGone() {
    if (!mustBeVisible(this.state.phase) || this.buddyPending) return;
    setTimeout(() => this.checkVisible(), 0);
  }

  /** Screen locked or computer going to sleep. */
  onPower(kind) {
    if (mustBeVisible(this.state.phase)) this.dispatch({ type: "stop", reason: kind });
    else if (this.state.phase === "asking") this.dispatch({ type: "ask_timeout" });
  }

  /** From the tray: "Take notes now", or `inPerson` "Take notes in the room" (the mic only). */
  takeNow({ inPerson = false } = {}) {
    this.dispatch({ type: "take", ...(inPerson ? { inPerson: true } : {}) });
  }

  stopNow() {
    this.dispatch({ type: "stop", reason: "owner" });
  }

  // ---------------------------------------------------------------- the 1-second check

  checkVisible() {
    if (!mustBeVisible(this.state.phase) || this.buddyPending) return true;
    if (this.buddy.isShowing()) return true;
    if (this.buddy.reassert()) {
      this.log("safety: the bot was off screen; put it back");
      return true;
    }
    this.log("safety: the bot isn't on screen; stopping");
    this.dispatch({ type: "stop", reason: "hidden" });
    return false;
  }

  tick() {
    const now = Date.now();
    const phase = this.state.phase;
    this.ticks++;
    if (now - this.pendingRetryAt >= this.limits.pendingRetryMs && this.settings.get().pending.length) {
      this.pendingRetryAt = now;
      void this.retryPending().catch((err) => this.log(`pending: ${err}`));
    }
    // Pieces of this meeting are waiting (NVIDIA Parakeet is on its way): it isn't abandoned, and
    // the owner hears why there are no captions yet.
    if (this.rec && this.ticks % 15 === 0) {
      void this.keepHearing(this.rec);
      this.remindWaiting();
    }
    if (phase === "asking" && !this.hovering && this.askDeadline && now >= this.askDeadline) {
      this.dispatch({ type: "ask_timeout" });
      return;
    }
    if (!mustBeVisible(phase) || this.buddyPending) return;
    if (!this.checkVisible()) return;
    if (this.ticks % 5 === 0) this.buddy.reassert(); // stay on top of other always-on-top windows
    if (phase !== "starting" && elapsed(this.state, now) >= this.limits.maxMeetingMs) this.dispatch({ type: "stop", reason: "max_length" });
  }

  // ---------------------------------------------------------------- links

  openForPhase() {
    const phase = this.state.phase;
    if (phase === "error") {
      const target = this.state.openTarget ?? "app";
      if (target === "pair" || target === "permissions") return this.o.openSpecial(target);
      return this.o.openUrl(this.urlFor(target, { meetingId: this.state.lastMeetingId }));
    }
    const meetingId = this.rec?.meetingId ?? this.state.meetingId ?? this.state.lastMeetingId;
    this.o.openUrl(this.urlFor(meetingId ? "meeting" : "app", { meetingId, botId: this.rec?.botId ?? this.lastRec?.botId }));
  }

  /** @param {string} target @param {{ meetingId?: string | null, botId?: string | null }} [ids] */
  urlFor(target, ids = {}) {
    const base = String(this.account.appUrl() ?? "").replace(/\/+$/, "");
    const botId = ids.botId ?? this.displayBot()?.id ?? null;
    const enc = encodeURIComponent;
    switch (target) {
      case "meeting":
        return ids.meetingId && botId ? `${base}/app/bots/${enc(botId)}/meetings/${enc(ids.meetingId)}` : `${base}/app`;
      case "apps":
        return botId ? `${base}/app/bots/${enc(botId)}/tools#meetings` : `${base}/app`;
      case "billing":
        return `${base}/app/billing`;
      case "bot":
        return botId ? `${base}/app/bots/${enc(botId)}` : `${base}/app`;
      case "bridge":
        return `${base}/app/bridge#desktop`;
      default:
        return `${base}/app`;
    }
  }

  // ---------------------------------------------------------------- leftovers, quitting

  addPending(p) {
    const pending = this.settings.get().pending.filter((x) => x.meetingId !== p.meetingId);
    pending.push({ ...p, at: Date.now() });
    this.settings.update({ pending: pending.slice(-20) });
  }

  removePending(meetingId) {
    const pending = this.settings.get().pending;
    if (pending.some((x) => x.meetingId === meetingId)) this.settings.update({ pending: pending.filter((x) => x.meetingId !== meetingId) });
  }

  /** On start: send audio left from a crash or a quit while offline, then finish those meetings; retry deletes. */
  async resumeLeftovers(spool) {
    const server = this.account.server();
    const groups = new Map();
    for (const item of spool.list()) {
      if (item.server !== server) {
        spool.removeMeeting(item.meetingId);
        continue;
      }
      if (!groups.has(item.meetingId)) groups.set(item.meetingId, []);
      groups.get(item.meetingId).push(item);
    }
    for (const [meetingId, items] of groups) {
      this.log(`leftovers: ${items.length} piece(s) for ${meetingId}`);
      for (const it of items) this.uploads.push(it);
      // Heard and sent (NVIDIA Parakeet may still be on its way), then the notes are written.
      void this.finishWhenHeard({ botId: items[0].botId, meetingId, server });
    }
    await this.retryPending();
  }

  /**
   * Deletes and finishes the server didn't get (offline). Retried every minute while the app
   * runs, not only at the next launch: a "Stop and delete" that didn't reach the server would
   * otherwise be wrapped up there as an abandoned meeting, and its notes sent to the owner.
   */
  async retryPending() {
    if (this.retryingPending) return;
    const server = this.account.server();
    const pending = this.settings.get().pending.filter((p) => p.server === server);
    if (!server || !pending.length) return;
    this.retryingPending = true;
    try {
      for (const p of pending) {
        try {
          if (p.kind === "delete") await this.api.deleteMeeting(p.botId, p.meetingId);
          else await this.api.finish(p.botId, p.meetingId, p.server);
          this.removePending(p.meetingId);
        } catch (err) {
          if ([404, 409].includes(/** @type {any} */ (err)?.status)) this.removePending(p.meetingId);
        }
      }
    } finally {
      this.retryingPending = false;
    }
  }

  isRecording() {
    return isRecording(this.state.phase);
  }

  /** Quitting: stop and finish the meeting first (bounded), keep unsent audio for next time. */
  async shutdown(timeoutMs = 25_000) {
    if (this.state.phase === "listening" || this.state.phase === "paused" || this.state.phase === "starting") this.dispatch({ type: "stop", reason: "quit" });
    const t0 = Date.now();
    while (isRecording(this.state.phase) && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 100));
    this.uploads.persist();
    this.uploads.dispose();
    this.dispose();
  }

  /** One line for the tray. */
  statusText() {
    switch (this.state.phase) {
      case "asking":
        return "Asking about this call";
      case "starting":
        return "Starting…";
      case "listening":
        if (this.o.hearing?.way() === "wait") return "Taking notes (getting NVIDIA Parakeet…)";
        if (this.rec?.inPerson) return "Taking notes in the room";
        return this.rec && this.rec.system !== "ok" && this.rec.system !== null ? "Taking notes (your mic only)" : "Taking notes";
      case "paused":
        return "Paused";
      case "stopping":
      case "saving":
        return "Writing your notes…";
      case "discarding":
        return "Deleting…";
      default:
        break;
    }
    if (!this.account.device) return "Signed out";
    const why = this.account.whyNot();
    if (why) return why;
    const until = this.settings.get().detectionPausedUntil;
    if (until > Date.now()) return `Call detection paused until ${new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    return "Watching for calls";
  }
}
