/**
 * This computer's link to the owner's Build-a-bot account: pairing (the same
 * pairing codes as the Bridge), the device token (encrypted, in TokenStore), the
 * desktop session (/api/desktop/session) and which bot takes notes.
 */
import { EventEmitter } from "node:events";
import os from "node:os";
import { ApiError } from "./api.mjs";
import { normalizeServer } from "./store.mjs";

/**
 * `subscription`: the bot thinks with its owner's own plan, on their computer (the Bridge): with
 * Claude Code ("claude") or Codex ("codex"). Older servers don't say.
 * @typedef {{ id: string, name: string, avatar: string, color: string, paused: boolean, meetingsOn: boolean, notesNeedCredit?: boolean, subscription?: 'claude' | 'codex' | null }} SessionBot
 */
/**
 * `meetings.local`: the server takes the lines this computer heard (NVIDIA Parakeet), which is how
 * notes are taken; `meetings.available`: it also turns a piece's audio into text itself.
 * @typedef {{ device: { id: string, name: string }, owner: { name: string | null, plan?: string }, credit?: { balanceMicros: number }, bots: SessionBot[], meetings: { available: boolean, local?: boolean, credit?: boolean, minutesLeft: number, chunkMs: number }, appUrl: string, demo: boolean }} DesktopSession
 */

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
   */
  constructor(o) {
    super();
    this.api = o.api;
    this.tokens = o.tokens;
    this.settings = o.settings;
    this.log = o.log ?? (() => {});
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
      if (e.status === 404) return { ok: false, error: "That code is wrong or expired. Get a new one on the Bridge (your computer) page in Build-a-bot." };
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
        this.session = s;
        this.sessionAt = Date.now();
        this.status = "ready";
        this.pickDefaultBot();
      } catch (err) {
        const e = /** @type {ApiError} */ (err);
        if (e.status === 401) {
          this.signOut("This computer was unpaired. Pair it again to take notes.");
        } else {
          this.status = this.session ? "ready" : "offline";
          if (!this.session) this.status = "offline";
          this.log(`account: session failed (${e.status ?? "?"} ${e.code ?? ""})`);
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
    await Promise.race([this.refresh(), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  /**
   * Unpair: revoke the token on the server first (best effort; a 401 means it's already
   * gone), then forget it here. Offline, it's forgotten locally and the owner can revoke
   * it from Bridge (your computer) in the app.
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
