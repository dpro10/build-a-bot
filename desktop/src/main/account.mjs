/**
 * This computer's link to the owner's Build-a-bot account: pairing (with a code
 * from the desktop app page), the device token (encrypted, in TokenStore), the
 * desktop session (/api/desktop/session) and which bot takes notes.
 */
import { EventEmitter } from "node:events";
import os from "node:os";
import { ApiError } from "./api.mjs";
import { normalizeServer } from "./store.mjs";

/**
 * @typedef {{ id: string, name: string, avatar: string, color: string, paused: boolean, meetingsOn: boolean, notesNeedCredit?: boolean }} SessionBot
 */
/**
 * `meetings.local`: the server takes the lines this computer heard (NVIDIA Parakeet), which is how
 * notes are taken; `meetings.available`: it also turns a piece's audio into text itself.
 * `library.available`: this server keeps files ("Give my bot a folder"); older servers don't say.
 * @typedef {{ device: { id: string, name: string }, owner: { name: string | null, plan?: string }, credit?: { balanceMicros: number }, bots: SessionBot[], meetings: { available: boolean, local?: boolean, credit?: boolean, minutesLeft: number, chunkMs: number }, library?: { available: boolean }, appUrl: string, demo: boolean }} DesktopSession
 */

/**
 * A session that couldn't be loaded (the app started before the Wi-Fi was up, behind a captive
 * portal, or during a server hiccup) is loaded again: first after this long, then twice as long
 * each time, up to the longest wait; at once when the computer comes back online.
 */
export const SESSION_RETRY = Object.freeze({ firstMs: 5000, maxMs: 5 * 60_000, onlineCheckMs: 3000 });

export function deviceName() {
  const host = os.hostname().replace(/\.(local|lan|home|localdomain)$/i, "").trim();
  return (host || "My computer").slice(0, 80);
}

export function platformTag() {
  return `desktop-${process.platform}-${process.arch}`.slice(0, 40);
}

/** "abcd1234" / "ABCD-1234" / " abcd 1234 " → "ABCD-1234" (or null). */
export function normalizeCode(input) {
  const raw = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 8) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export class Account extends EventEmitter {
  /**
   * @param {object} o
   * @param {ReturnType<typeof import('./api.mjs').createApi>} o.api
   * @param {import('./store.mjs').TokenStore} o.tokens
   * @param {import('./store.mjs').Settings} o.settings
   * @param {(msg: string) => void} [o.log]
   * @param {() => boolean} [o.isOnline]  whether the computer has a network connection (Electron's net.isOnline)
   * @param {Partial<typeof SESSION_RETRY>} [o.retry]  shorter waits for tests
   */
  constructor(o) {
    super();
    this.api = o.api;
    this.tokens = o.tokens;
    this.settings = o.settings;
    this.log = o.log ?? (() => {});
    this.isOnline = o.isOnline ?? null;
    this.retry = { ...SESSION_RETRY, ...(o.retry ?? {}) };
    /** The wait before the next try to load the session (0: it hasn't failed). */
    this.retryDelay = 0;
    this.retryTimer = null;
    /** @type {(import('./store.mjs').Device & { stored: string }) | null} */
    this.device = null;
    /** @type {DesktopSession | null} */
    this.session = null;
    this.sessionAt = 0;
    /** @type {'signed_out'|'loading'|'ready'|'offline'} */
    this.status = "signed_out";
    /** @type {string | null} why the owner was signed out, shown in the pairing window */
    this.signedOutReason = null;
    this.refreshing = null;
    /** Why this computer can't hear meetings (voice/index.mjs: NVIDIA Parakeet), or null. @type {() => string | null} */
    this.meetingProblem = () => null;
  }

  /** @param {() => string | null} fn */
  setMeetingCheck(fn) {
    this.meetingProblem = fn;
  }

  server() {
    return this.device?.server ?? null;
  }

  token() {
    return this.device?.token ?? null;
  }

  /** Where links open: the server's public URL. */
  appUrl() {
    return this.session?.appUrl || this.device?.server || this.settings.get().server;
  }

  load() {
    this.device = this.tokens.load();
    this.status = this.device ? "loading" : "signed_out";
    this.emit("change");
    if (this.device) void this.refresh();
  }

  /**
   * @param {string} serverInput @param {string} codeInput
   * @returns {Promise<{ ok: true, stored: string } | { ok: false, error: string }>}
   */
  async pair(serverInput, codeInput) {
    const server = normalizeServer(serverInput);
    if (!server) return { ok: false, error: "That server address doesn't look right. It should start with https://" };
    const code = normalizeCode(codeInput);
    if (!code) return { ok: false, error: "Type the 8-character code from the app, like ABCD-1234." };
    let res;
    try {
      res = await this.api.pair({ server, code, name: deviceName(), platform: platformTag() });
    } catch (err) {
      const e = /** @type {ApiError} */ (err);
      if (e.status === 0) return { ok: false, error: "I can't reach that server. Check the address and your internet, then try again." };
      if (e.status === 404) return { ok: false, error: "That code is wrong or expired. Get a new one on the desktop app page in Build-a-bot." };
      return { ok: false, error: e.message || "Pairing didn't work. Try again in a moment." };
    }
    if (!res?.token || !res?.deviceId) return { ok: false, error: "The server answered in a way I didn't expect. Try again." };
    const device = { server, deviceId: res.deviceId, token: res.token, deviceName: deviceName() };
    const { stored } = this.tokens.save(device);
    this.device = { ...device, stored };
    this.signedOutReason = null;
    this.settings.update({ server, botId: null });
    this.log(`account: paired as ${res.deviceId} (token ${stored})`);
    this.status = "loading";
    this.emit("change");
    await this.refresh();
    return { ok: true, stored };
  }

  /** Reload /api/desktop/session. */
  refresh() {
    if (!this.device) return Promise.resolve(null);
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const s = /** @type {DesktopSession} */ (await this.api.session());
        // Something that isn't a session (a page in its place): no better than no answer.
        if (!s || typeof s !== "object") throw new ApiError(0, "Not a session", "network", null);
        this.session = s;
        this.sessionAt = Date.now();
        this.status = "ready";
        this.stopRetrying();
        this.pickDefaultBot();
      } catch (err) {
        const e = /** @type {ApiError} */ (err);
        if (e.status === 401) {
          this.signOut("This computer was unpaired. Pair it again to take notes.");
        } else {
          this.status = this.session ? "ready" : "offline";
          this.log(`account: session failed (${e.status ?? "?"} ${e.code ?? ""})`);
          // Never loaded: without it nothing works (and nothing is sent), so it's tried again.
          if (!this.session) this.retryLater();
        }
      } finally {
        this.refreshing = null;
        this.emit("change");
      }
      return this.session;
    })();
    return this.refreshing;
  }

  /** Refresh if the session is older than `maxAgeMs` (bounded by `timeoutMs`). */
  async refreshIfStale(maxAgeMs = 60_000, timeoutMs = 5000) {
    if (!this.device || Date.now() - this.sessionAt < maxAgeMs) return;
    let timer;
    await Promise.race([this.refresh(), new Promise((r) => (timer = setTimeout(r, timeoutMs)))]);
    clearTimeout(timer);
  }

  /**
   * The session couldn't be loaded and there's none from before: try again after `retryDelay`
   * (5 s, then twice as long each time, up to 5 minutes), or at once when the computer comes back
   * online (checked every few seconds meanwhile).
   */
  retryLater() {
    if (!this.device || this.retryTimer) return;
    this.retryDelay = Math.min(this.retryDelay ? this.retryDelay * 2 : this.retry.firstMs, this.retry.maxMs);
    const due = Date.now() + this.retryDelay;
    let wasOnline = this.online();
    const check = () => {
      this.retryTimer = null;
      if (!this.device || this.session) return;
      const online = this.online();
      if (Date.now() >= due || (online === true && wasOnline === false)) {
        void this.refresh();
        return;
      }
      wasOnline = online;
      this.retryTimer = setTimeout(check, Math.max(1, Math.min(this.retry.onlineCheckMs, due - Date.now())));
      this.retryTimer.unref?.();
    };
    this.retryTimer = setTimeout(check, Math.min(this.retry.onlineCheckMs, this.retryDelay));
    this.retryTimer.unref?.();
  }

  stopRetrying() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDelay = 0;
  }

  /** Whether the computer has a network connection: true, false, or null when it can't tell. */
  online() {
    try {
      return this.isOnline ? Boolean(this.isOnline()) : null;
    } catch {
      return null;
    }
  }

  /** The computer woke up (or came back online): a session that never loaded is tried now, and soon again. */
  reconnect() {
    if (!this.device || this.session) return;
    this.stopRetrying();
    void this.refresh();
  }

  /**
   * Unpair: revoke the token on the server first (best effort; a 401 means it's already
   * gone), then forget it here. Offline, it's forgotten locally and the owner can revoke
   * it from the desktop app page in Build-a-bot.
   * @returns {Promise<{ revoked: boolean }>}
   */
  async unpair() {
    let revoked = false;
    if (this.device) {
      try {
        await this.api.revokeDevice();
        revoked = true;
      } catch (err) {
        revoked = /** @type {ApiError} */ (err).status === 401;
        if (!revoked) this.log(`account: couldn't revoke on the server (${/** @type {ApiError} */ (err).status ?? "?"})`);
      }
    }
    this.signOut(null);
    return { revoked };
  }

  /** @param {string | null} reason */
  signOut(reason = null) {
    this.stopRetrying();
    this.tokens.clear();
    this.device = null;
    this.session = null;
    this.sessionAt = 0;
    this.status = "signed_out";
    this.signedOutReason = reason;
    this.emit("change");
    this.emit("signed-out", reason);
  }

  /** @returns {SessionBot[]} */
  bots() {
    return this.session?.bots ?? [];
  }

  /** Bots with meeting notes turned on (and not paused). */
  noteBots() {
    return this.bots().filter((b) => b.meetingsOn);
  }

  pickDefaultBot() {
    const chosen = this.settings.get().botId;
    const on = this.noteBots();
    if (chosen && on.some((b) => b.id === chosen)) return;
    if (on.length) this.settings.update({ botId: on[0].id });
  }

  /** @param {string} botId */
  chooseBot(botId) {
    if (!this.noteBots().some((b) => b.id === botId)) return false;
    this.settings.update({ botId });
    this.emit("change");
    return true;
  }

  /** The bot that takes notes (meeting notes on), or null. */
  bot() {
    const id = this.settings.get().botId;
    return this.noteBots().find((b) => b.id === id) ?? null;
  }

  /** A bot to show (for messages), even if its notes are off. */
  anyBot() {
    return this.bot() ?? this.bots()[0] ?? null;
  }

  /** Can it offer to take notes right now? */
  canTakeNotes() {
    return this.whyNot() === null;
  }

  /** Why it can't take notes, in words for the tray (null = it can). */
  whyNot() {
    if (!this.device) return "Signed out";
    if (!this.session) return this.status === "offline" ? "Can't reach Build-a-bot" : "Connecting…";
    const m = this.session.meetings;
    // Notes are taken from what this computer hears (or, failing that, what the server hears).
    if (!m?.available && !m?.local) return "Meeting notes aren't set up on this server";
    const cantHear = this.meetingProblem();
    if (cantHear) return cantHear;
    const bot = this.bot();
    if (!bot) {
      const first = this.bots()[0];
      return first ? `Turn on meeting notes for ${first.name}` : "Make a bot first";
    }
    if (bot.paused) return `${bot.name} is paused`;
    // People pay for what they use: notes written by an included model need credit (their own AI is free).
    // An older server says minutesLeft instead.
    const outOfCredit =
      typeof this.session.meetings.credit === "boolean" ? !this.session.meetings.credit && bot.notesNeedCredit !== false : (this.session.meetings.minutesLeft ?? 1) <= 0;
    if (outOfCredit) return "Out of credit: add some to take notes";
    return null;
  }
}
