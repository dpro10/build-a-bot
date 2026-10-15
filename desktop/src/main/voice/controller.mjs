/**
 * Voice typing: hold the shortcut anywhere and talk, let go, and what you meant is typed where your
 * cursor is. "Hey {bot}, …" asks your bot instead, and its answer shows in the pill. With Shift
 * held too, what they say is an instruction for the selected text ("make this friendlier"): the
 * answer replaces the selection, or, with nothing selected, is written at the cursor.
 *
 *   shortcut (hotkey.mjs) → record (the pill's page, mic only while held) → /api/voice/dictate
 *   → paste at the cursor (paste.mjs), or → /api/voice/ask and show the reply
 *   Shift: copy the selection (paste.mjs) → /api/voice/dictate (the instruction) → /api/voice/edit
 *   → paste over the selection, or show the answer
 *
 * Privacy rules kept here:
 *  - the microphone is on only between the press and the release (or the hands-free taps), and the
 *    pill is on screen the whole time;
 *  - the recording lives in memory: sent once (and once more if the owner taps Try again), never
 *    written to disk;
 *  - what was typed is kept only in this computer's history (encrypted; can be turned off).
 */
import { EventEmitter } from "node:events";
import { addToStats } from "./history.mjs";

export const VOICE_LIMITS = Object.freeze({
  /** The longest dictation (the server's limit). */
  maxMs: 10 * 60_000,
  /** The pill counts down this long before the end. */
  warnMs: 30_000,
  /** Shorter than this, with no speech, is nothing. */
  minMs: 300,
  /** How long the "done" pill stays. */
  doneMs: 1400,
  /** How long "Copied" and short notes stay. */
  noteMs: 4000,
  /** How long an error stays (unless hovered). */
  errorMs: 7000,
  /** How long a reply from the bot stays (unless hovered). */
  replyMs: 25_000,
  /** How long to wait for the app-in-front check after the recording ends. */
  frontAppMs: 400,
});

/** A sentence for each way a dictation can fail, and what the pill offers. */
export function voiceError(err) {
  const e = /** @type {any} */ (err) ?? {};
  if (e.status === 401) return { message: "This computer was unpaired. Pair it again to use voice typing.", actions: ["pair"] };
  if (e.status === 402 || e.code === "limit") return { message: e.message || "You've used this month's voice typing.", actions: ["upgrade"] };
  if (e.code === "unavailable") return { message: "Voice typing isn't set up on this server yet.", actions: [] };
  if (e.code === "daily") return { message: e.message || "That's a lot of voice typing for one day. It resets tomorrow.", actions: [] };
  if (e.code === "busy" || e.status === 503) return { message: "Speech-to-text is busy right now.", actions: ["retry"] };
  if (e.code === "network" || e.status === 0) return { message: "I can't reach Build-a-bot. Check your internet.", actions: ["retry"] };
  if (e.status === 429) return { message: e.message || "That's a lot at once. Give it a moment.", actions: ["retry"] };
  if (e.code === "mic-denied") return { message: "I'm not allowed to use the microphone.", actions: ["mic-settings"] };
  if (e.code === "mic-missing") return { message: "I can't find a microphone.", actions: ["settings"] };
  if (e.code === "mic-busy") return { message: "Another app is using the microphone.", actions: [] };
  if (e.code === "edit-failed") return { message: e.message || "I couldn't do that one. Try saying it another way.", actions: ["retry"] };
  if (e.code === "unreadable" || e.status === 422 || e.status === 413) return { message: e.message || "I couldn't make out that recording.", actions: [] };
  return { message: "Something went wrong. Try again in a moment.", actions: ["retry"] };
}

/** "Allow Accessibility" on a Mac, otherwise just "press Ctrl+V". */
export function copiedNote(platform, canPaste) {
  if (platform === "darwin" && !canPaste) return "Copied. Press ⌘V to paste, or allow Accessibility so I can paste for you.";
  return `Copied. Press ${platform === "darwin" ? "⌘V" : "Ctrl+V"} to paste it.`;
}

export class VoiceTyping extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('../store.mjs').Settings} o.settings
   * @param {{ device: any, session: any, appUrl(): string, refresh(): Promise<any>, bots(): any[] }} o.account
   * @param {{ dictate: Function, ask: Function, edit?: Function }} o.api
   * @param {{ on: Function, finish(): void, abort(): void, isRecording(): boolean }} o.hotkey  set later with setHotkey
   * @param {{ show(s: any): Promise<boolean> | boolean, update(s: any): void, hide(): void, start(o: any): Promise<any>, stop(): Promise<any>, cancel(): Promise<void> | void }} o.pill
   * @param {import('./paste.mjs').Paster} o.paster
   * @param {{ detect(ms?: number): Promise<{ name: string, category: string } | null> }} o.frontApp
   * @param {import('./history.mjs').VoiceHistory} o.history
   * @param {() => boolean} o.canPaste
   * @param {() => Promise<boolean>} [o.ensureMic]
   * @param {() => void} [o.warmUp]
   * @param {(target: string, extra?: any) => void} [o.open]  'pair' | 'settings' | 'upgrade' | 'chat' | 'mic-settings' | 'accessibility'
   * @param {string} [o.platform]
   * @param {() => number} [o.now]
   * @param {Partial<typeof VOICE_LIMITS>} [o.limits]
   * @param {(m: string) => void} [o.log]
   * @param {() => string | null} [o.demoSample]  tests: which line the demo server hears
   */
  constructor(o) {
    super();
    this.o = o;
    this.settings = o.settings;
    this.account = o.account;
    this.api = o.api;
    this.pill = o.pill;
    this.paster = o.paster;
    this.history = o.history;
    this.platform = o.platform ?? process.platform;
    this.now = o.now ?? (() => Date.now());
    this.limits = { ...VOICE_LIMITS, ...(o.limits ?? {}) };
    this.log = o.log ?? (() => {});
    /** @type {any} */
    this.hotkey = null;
    /** The dictation being recorded: one at a time. */
    this.rec = null;
    /** Dictations waiting on the server, newest last: only the newest one updates the pill. */
    this.seq = 0;
    /** The last recording that failed, kept in memory so "Try again" can send it again. */
    this.failed = null;
    /** The bot a "Reply" talks to. */
    this.replyTo = null;
    /** The reply being shown, for its buttons. */
    this.reply = null;
    this.hideTimer = null;
    this.hovering = false;
    this.askAbort = null;
    /** @type {{ words: number, limit: number | null } | null} */
    this.usage = null;
    this.last = null;
    if (o.hotkey) this.setHotkey(o.hotkey);
  }

  voice() {
    return this.settings.get().voice;
  }

  /** Use this shortcut listener (the keyboard hook, or the toggle fallback). */
  setHotkey(hotkey) {
    if (this.hotkey) for (const ev of ["start", "stop", "cancel", "handsfree", "edit"]) this.hotkey.removeAllListeners?.(ev);
    this.hotkey = hotkey;
    hotkey.on("start", (/** @type {{ edit?: boolean } | undefined} */ opts) => void this.onStart(opts));
    hotkey.on("edit", () => this.onEdit());
    hotkey.on("handsfree", () => this.onHandsfree());
    hotkey.on("stop", () => void this.onStop());
    hotkey.on("cancel", () => void this.onCancel());
  }

  isRecording() {
    return Boolean(this.rec);
  }

  // -------------------------------------------------------------------------
  // The pill
  // -------------------------------------------------------------------------

  botInfo(bot) {
    if (!bot) return null;
    const full = this.account.bots().find((b) => b.id === bot.id) ?? bot;
    return { id: full.id, name: full.name, color: full.color ?? "grape", avatar: full.avatar ?? "otto" };
  }

  defaultBot() {
    return this.account.bots()[0] ?? null;
  }

  /** @param {any} state @param {number} [hideAfterMs] */
  async showPill(state, hideAfterMs) {
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.pillState = { sounds: this.voice().sounds, platform: this.platform, ...state };
    await this.pill.show(this.pillState);
    if (hideAfterMs) this.scheduleHide(hideAfterMs);
    this.emit("change");
  }

  scheduleHide(ms) {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      // Not while the pointer is on it (the owner is reading or about to click).
      if (this.hovering) return this.scheduleHide(1500);
      this.hidePill();
    }, ms);
    this.hideTimer.unref?.();
  }

  hidePill() {
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.pillState = null;
    this.reply = null;
    this.pill.hide();
    this.emit("change");
  }

  /** The pointer is over the pill (it waits to hide). */
  setHovering(on) {
    this.hovering = Boolean(on);
  }

  /** @param {any} err @param {number} [seq] */
  async showError(err, seq) {
    if (seq !== undefined && seq !== this.seq) return;
    const { message, actions } = voiceError(err);
    this.last = { kind: "error", message, at: this.now() };
    await this.showPill({ phase: "error", message, actions }, this.limits.errorMs);
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  /** Why voice typing can't start right now, as an error for the pill (or null). */
  blocker() {
    if (!this.account.device) return { status: 401 };
    const v = this.account.session?.voice;
    if (v && v.available === false) return { code: "unavailable" };
    return null;
  }

  /** Editing by voice is on (settings) and the server says it can do it (an older one can't). */
  editAvailable() {
    return this.voice().edit !== false && this.account.session?.voice?.edit === true && typeof this.api.edit === "function";
  }

  /** @param {{ edit?: boolean }} [opts]  Shift was held with the shortcut */
  async onStart(opts = {}) {
    if (this.rec) return;
    const blocked = this.blocker();
    if (blocked) {
      this.hotkey?.abort();
      await this.showError(blocked);
      return;
    }
    const rec = { startedAt: this.now(), stop: false, cancel: false, started: null, app: null, bot: this.replyTo, handsfree: Boolean(this.replyTo), edit: false };
    rec.edit = Boolean(opts?.edit) && !rec.bot && this.editAvailable();
    this.replyTo = null;
    this.rec = rec;
    this.seq++;
    this.failed = null;
    this.o.warmUp?.();
    rec.app = this.o.frontApp.detect(1500).catch(() => null);
    const bot = rec.bot ? this.botInfo(rec.bot) : null;
    await this.showPill({ phase: "listening", handsfree: rec.handsfree, startedAt: rec.startedAt, maxMs: this.limits.maxMs, bot, replying: Boolean(rec.bot), edit: rec.edit });
    if (this.o.ensureMic && !(await this.o.ensureMic())) {
      this.rec = null;
      this.hotkey?.abort();
      await this.showError({ code: "mic-denied" });
      return;
    }
    const v = this.voice();
    rec.started = this.pill.start({ micId: v.micId, sounds: v.sounds });
    const res = await rec.started;
    if (this.rec !== rec) return;
    if (!res?.ok) {
      this.rec = null;
      this.hotkey?.abort();
      const name = String(res?.error ?? "");
      await this.showError({ code: /NotAllowed|Permission|Security/i.test(name) ? "mic-denied" : /NotFound|Overconstrained/i.test(name) ? "mic-missing" : /NotReadable|Abort/i.test(name) ? "mic-busy" : "mic-missing" });
      return;
    }
    this.maxTimer = setTimeout(() => this.hotkey?.finish(), this.limits.maxMs);
    this.maxTimer.unref?.();
    // The owner let go (or cancelled) while the mic was still opening.
    if (rec.cancel) return this.onCancel();
    if (rec.stop) return this.onStop();
  }

  /** Shift pressed while talking: this one is an instruction for the selection. */
  onEdit() {
    const rec = this.rec;
    if (!rec || rec.edit || rec.bot || !this.editAvailable()) return;
    rec.edit = true;
    if (this.pillState?.phase === "listening") void this.showPill({ ...this.pillState, edit: true });
  }

  onHandsfree() {
    const rec = this.rec;
    if (!rec) return;
    rec.handsfree = true;
    if (this.pillState?.phase === "listening") void this.showPill({ ...this.pillState, handsfree: true });
  }

  async onCancel() {
    const rec = this.rec;
    if (!rec) return;
    if (!rec.started) {
      rec.cancel = true;
      return;
    }
    this.rec = null;
    clearTimeout(this.maxTimer);
    await this.pill.cancel();
    this.hidePill();
  }

  async onStop() {
    const rec = this.rec;
    if (!rec) return;
    if (!rec.started) {
      rec.stop = true;
      return;
    }
    this.rec = null;
    clearTimeout(this.maxTimer);
    const seq = this.seq;
    await this.showPill({ ...(this.pillState ?? {}), phase: "working", bot: rec.bot ? this.botInfo(rec.bot) : null, label: rec.edit ? "Working on it…" : undefined });
    const audio = await this.pill.stop().catch(() => null);
    if (!audio?.bytes?.length || audio.durationMs < this.limits.minMs) {
      if (seq === this.seq) await this.showPill({ phase: "note", message: "Didn't catch that." }, this.limits.doneMs);
      return;
    }
    const app = await Promise.race([rec.app, new Promise((r) => setTimeout(() => r(null), this.limits.frontAppMs))]);
    if (rec.edit) return this.sendEdit({ audio, app }, seq);
    await this.send({ audio, app, bot: rec.bot }, seq);
  }

  /**
   * Send a recording and act on the answer.
   * @param {{ audio: { bytes: Uint8Array, mime: string, durationMs: number, speechMs?: number }, app: any, bot: any }} job
   * @param {number} seq
   */
  async send(job, seq) {
    const v = this.voice();
    let res;
    try {
      res = await this.api.dictate(job.audio, {
        category: job.app?.category,
        // Only a well-known app's name ("Slack"); an app we don't recognize stays on this computer.
        app: job.app && job.app.category !== "other" ? job.app.name : null,
        lang: v.language,
        polish: v.polish,
        // A reply to the bot is for the bot, whatever it starts with.
        commands: job.bot ? false : v.commands,
        styles: v.styles,
        demo: this.o.demoSample?.() ?? null,
      });
    } catch (err) {
      const e = /** @type {any} */ (err);
      this.log(`voice: dictation failed (${e?.status ?? "?"} ${e?.code ?? ""})`);
      if (e?.status === 401) this.account.refresh?.();
      // Kept (in memory) for "Try again"; a newer dictation replaces it.
      if (voiceError(e).actions.includes("retry")) this.failed = { ...job, seq };
      await this.showError(e, seq);
      return;
    }
    if (res.usage) this.usage = res.usage;
    const spokenMs = job.audio.speechMs ?? job.audio.durationMs;
    // What happened, never what was said.
    this.log(`voice: ${res.kind}${res.words ? ` (${res.words} words${res.polished ? ", cleaned up" : ""})` : ""} in ${res.ms ? `${res.ms.stt} + ${res.ms.polish} ms` : "?"}, ${Math.round(job.audio.durationMs / 100) / 10} s recorded`);

    if (res.kind === "empty") {
      if (seq === this.seq) await this.showPill({ phase: "note", message: "Didn't catch that." }, this.limits.doneMs);
      return;
    }

    if (job.bot) return this.askBot(job.bot, res.text, seq, res.text);

    if (res.kind === "command") {
      if (!res.command) {
        if (seq !== this.seq) return;
        this.reply = { bot: res.bot, text: "", typed: res.text };
        await this.showPill({ phase: "reply", bot: this.botInfo(res.bot), message: `Hi! Tap Reply and tell me what you need.`, actions: ["reply", "type-instead"] }, this.limits.replyMs);
        return;
      }
      return this.askBot(res.bot, res.command, seq, res.text);
    }

    // Text: type it where the cursor is.
    const restore = v.restoreClipboard !== false;
    const out = await this.paster.insert(res.text, { category: job.app?.category, restore });
    if (!out.pasted) this.log("voice: couldn't paste; the words are on the clipboard");
    this.settings.update({ voiceStats: addToStats(this.settings.get().voiceStats, { words: res.words ?? 0, spokenMs, at: this.now() }) });
    if (v.history !== false) {
      this.history.add({ kind: "text", text: res.text, heard: res.heard, app: job.app?.name ?? null, words: res.words, polished: Boolean(res.polished), pasted: out.pasted });
    }
    this.last = { kind: "text", text: res.text, heard: res.heard, at: this.now(), pasted: out.pasted };
    this.emit("dictated", { text: res.text, pasted: out.pasted, words: res.words });
    if (seq !== this.seq || this.rec) return;
    if (out.pasted) await this.showPill({ phase: "done", text: res.text, simulated: Boolean(res.simulated) }, this.limits.doneMs);
    else await this.showPill({ phase: "note", message: copiedNote(this.platform, this.o.canPaste()), actions: this.platform === "darwin" && !this.o.canPaste() ? ["accessibility"] : [] }, this.limits.noteMs);
  }

  /**
   * Editing by voice: read the selection (while it's still selected), hear the instruction, ask
   * for the change, then paste it over the selection, or show the answer to a question. With
   * nothing selected, what they asked for is written at the cursor.
   * @param {{ audio: { bytes: Uint8Array, mime: string, durationMs: number, speechMs?: number }, app: any, selection?: string | null, instruction?: string }} job
   *   a retry brings the selection and instruction it already has
   * @param {number} seq
   */
  async sendEdit(job, seq) {
    const v = this.voice();
    const category = job.app?.category ?? "other";
    if (category === "terminal") {
      if (seq === this.seq) await this.showPill({ phase: "note", message: "Editing by voice doesn't work in a terminal." }, this.limits.noteMs);
      return;
    }
    const selection = job.selection !== undefined ? job.selection : await this.paster.copySelection(category);
    if (seq === this.seq) await this.showPill({ phase: "working", edit: true, label: selection ? "Changing it…" : "Writing…" });

    let instruction = job.instruction;
    if (!instruction) {
      let heard;
      try {
        // The instruction as said, with no AI cleanup. "Hey Otto, …" asks the bot about the selection.
        heard = await this.api.dictate(job.audio, { category, lang: v.language, polish: false, commands: v.commands, styles: false, demo: this.o.demoSample?.() ?? (selection ? "edit" : "write") });
      } catch (err) {
        const e = /** @type {any} */ (err);
        this.log(`voice: edit instruction failed (${e?.status ?? "?"} ${e?.code ?? ""})`);
        if (e?.status === 401) this.account.refresh?.();
        if (voiceError(e).actions.includes("retry")) this.failed = { ...job, selection, edit: true, seq };
        await this.showError(e, seq);
        return;
      }
      if (heard.usage) this.usage = heard.usage;
      if (heard.kind === "command") {
        if (!heard.command) {
          if (seq === this.seq) await this.showPill({ phase: "note", message: `Say what ${heard.bot?.name ?? "your bot"} should do, right after its name.` }, this.limits.noteMs);
          return;
        }
        // "Hey Otto, add this to my calendar": the bot gets the request and what was selected.
        return this.askBot(heard.bot, heard.command, seq, heard.text, { selection });
      }
      instruction = heard.kind === "text" ? String(heard.text ?? "").trim() : "";
      if (!instruction) {
        if (seq === this.seq) await this.showPill({ phase: "note", message: "Didn't catch that." }, this.limits.doneMs);
        return;
      }
    }

    let out;
    try {
      out = await /** @type {Function} */ (this.api.edit)({ instruction, selection, category, app: job.app && category !== "other" ? job.app.name : null, styles: v.styles });
    } catch (err) {
      const e = /** @type {any} */ (err);
      this.log(`voice: edit failed (${e?.status ?? "?"} ${e?.code ?? ""})`);
      if (e?.code === "no-selection") {
        if (seq === this.seq) await this.showPill({ phase: "note", message: "Select the text you want to change first." }, this.limits.noteMs);
        return;
      }
      if (e?.status === 401) this.account.refresh?.();
      if (voiceError(e).actions.includes("retry") || e?.status === 502 || e?.status === 504) this.failed = { ...job, selection, instruction, edit: true, seq };
      await this.showError(e?.status === 502 || e?.status === 504 ? { ...e, code: "edit-failed" } : e, seq);
      return;
    }
    if (out.usage) this.usage = out.usage;
    // What happened, never what was said or selected.
    this.log(`voice: edit (${out.kind}, ${selection ? "a selection" : "nothing selected"}${out.words ? `, ${out.words} words` : ""}) in ${out.ms ?? "?"} ms`);

    if (out.kind === "answer") {
      if (v.history !== false) this.history.add({ kind: "edit", text: out.text, instruction, answer: true, app: job.app?.name ?? null });
      this.last = { kind: "answer", text: out.text, at: this.now() };
      if (seq !== this.seq || this.rec) return;
      this.reply = { bot: null, text: out.text, typed: null, command: instruction };
      // About a selection, Paste would type over it: only Copy then.
      await this.showPill({ phase: "answer", command: instruction, message: out.text, actions: selection ? ["copy"] : ["paste", "copy"], simulated: Boolean(out.simulated) }, this.limits.replyMs);
      return;
    }

    const restore = v.restoreClipboard !== false;
    const pasted = await this.paster.insert(out.text, { category, restore });
    if (!pasted.pasted) this.log("voice: couldn't paste the edit; it's on the clipboard");
    if (v.history !== false) this.history.add({ kind: "edit", text: out.text, instruction, app: job.app?.name ?? null, words: out.words, pasted: pasted.pasted });
    this.last = { kind: "text", text: out.text, at: this.now(), pasted: pasted.pasted };
    this.emit("dictated", { text: out.text, pasted: pasted.pasted, words: out.words, edit: true });
    if (seq !== this.seq || this.rec) return;
    if (pasted.pasted) {
      const undo = selection ? `${this.platform === "darwin" ? "⌘Z" : "Ctrl+Z"} undoes it` : null;
      await this.showPill({ phase: "done", text: out.text, edit: true, hint: undo, simulated: Boolean(out.simulated) }, this.limits.doneMs + (undo ? 1200 : 0));
    } else {
      await this.showPill({ phase: "note", message: copiedNote(this.platform, this.o.canPaste()), actions: this.platform === "darwin" && !this.o.canPaste() ? ["accessibility"] : [] }, this.limits.noteMs);
    }
  }

  /**
   * "Hey {bot}, …": ask, show progress, then the reply with its buttons.
   * @param {{ id: string, name: string }} bot @param {string} command @param {number} seq @param {string} typed  the whole dictation, for "Type it instead"
   * @param {{ selection?: string | null }} [opts]  text the owner selected, sent with the request
   */
  async askBot(bot, command, seq, typed, opts = {}) {
    const info = this.botInfo(bot);
    const withSelection = Boolean(opts.selection);
    this.reply = { bot, text: "", typed, command };
    const ask = new AbortController();
    this.askAbort?.abort();
    this.askAbort = ask;
    // With a selection, "Type it instead" would type over it: no such button then.
    if (seq === this.seq) await this.showPill({ phase: "asking", bot: info, command, selection: withSelection, label: `${bot.name} is thinking…`, actions: withSelection ? [] : ["type-instead"] });
    let text = "";
    let status = "ok";
    let approvals = 0;
    try {
      await this.api.ask(
        bot.id,
        command,
        (ev) => {
          if (ev?.type === "text") text += ev.delta ?? "";
          else if (ev?.type === "tool" && ev.state === "running" && seq === this.seq && this.reply?.command === command) {
            void this.showPill({ ...this.pillState, label: ev.title ? `${ev.title}…` : `${bot.name} is working…` });
          } else if (ev?.type === "approval") approvals++;
          else if (ev?.type === "done") {
            text = ev.text || text;
            status = ev.status ?? "ok";
          } else if (ev?.type === "error") text = ev.message || text;
        },
        { signal: ask.signal, selection: opts.selection ?? null },
      );
    } catch (err) {
      if (ask.signal.aborted) return;
      await this.showError(err, seq);
      return;
    } finally {
      if (this.askAbort === ask) this.askAbort = null;
    }
    const reply = plain(text) || (status === "ok" ? "Done." : "I couldn't do that.");
    if (this.voice().history !== false) this.history.add({ kind: "command", text: command, bot: bot.name, reply });
    this.last = { kind: "command", text: command, reply, at: this.now() };
    this.emit("asked", { bot: bot.name, command, reply });
    if (seq !== this.seq || this.rec) return;
    this.reply = { bot, text: reply, typed, command };
    // About a selection, Paste would type over it: Copy instead.
    const actions = withSelection ? ["copy", "reply", "chat"] : ["paste", "copy", "reply", "chat"];
    await this.showPill({ phase: "reply", bot: info, command, selection: withSelection, message: reply, approvals, actions }, this.limits.replyMs);
  }

  // -------------------------------------------------------------------------
  // The pill's buttons, the tray, the settings window
  // -------------------------------------------------------------------------

  /** @param {string} action */
  async action(action) {
    switch (action) {
      case "done":
        return this.hotkey?.finish();
      case "cancel":
        if (this.rec) {
          this.hotkey?.abort();
          return this.onCancel();
        }
        this.askAbort?.abort();
        return this.hidePill();
      case "dismiss":
        this.askAbort?.abort();
        return this.hidePill();
      case "retry":
        return this.retry();
      case "paste": {
        const text = this.reply?.text;
        if (!text) return;
        this.hidePill();
        await this.paster.insert(text, { restore: this.voice().restoreClipboard !== false });
        return;
      }
      case "copy":
        if (!this.reply?.text) return;
        this.paster.copy(this.reply.text);
        return this.showPill({ phase: "note", message: "Copied." }, this.limits.doneMs);
      case "type-instead": {
        const typed = this.reply?.typed;
        this.askAbort?.abort();
        this.hidePill();
        if (typed) await this.paster.insert(typed, { restore: this.voice().restoreClipboard !== false });
        return;
      }
      case "reply": {
        const bot = this.reply?.bot ?? this.defaultBot();
        if (!bot || this.rec) return;
        this.replyTo = bot;
        // Hands-free, for the bot: tap the shortcut or Done to send it.
        this.hotkey?.startHandsfree?.();
        return this.onStart();
      }
      case "chat":
        this.o.open?.("chat", { botId: this.reply?.bot?.id ?? null });
        return this.hidePill();
      default:
        // pair, settings, upgrade, mic-settings, accessibility
        this.o.open?.(action);
        return this.hidePill();
    }
  }

  async retry() {
    const job = this.failed;
    if (!job) return this.hidePill();
    this.failed = null;
    const seq = ++this.seq;
    if (job.edit) {
      await this.showPill({ phase: "working", edit: true, label: job.selection ? "Changing it…" : "Writing…" });
      return this.sendEdit(job, seq);
    }
    await this.showPill({ phase: "working", bot: job.bot ? this.botInfo(job.bot) : null });
    await this.send(job, seq);
  }

  /** Tray: type the newest dictation again. */
  async pasteLast() {
    const last = this.history.lastText() ?? (this.last?.kind === "text" ? this.last : null);
    if (!last?.text) return false;
    await this.paster.insert(last.text, { restore: this.voice().restoreClipboard !== false });
    return true;
  }

  /** The screen locked, the computer is going to sleep, or the app is quitting. */
  async interrupt() {
    if (this.rec) {
      this.hotkey?.abort();
      await this.onCancel();
    }
    this.askAbort?.abort();
  }

  /** Unpaired: nothing from this account stays behind. */
  forget() {
    void this.interrupt();
    this.failed = null;
    this.reply = null;
    this.last = null;
    this.usage = null;
    this.history.clear();
    this.hidePill();
  }
}

/** Bot replies in a small bubble: plain text, no markdown. */
export function plain(markdown) {
  return String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
