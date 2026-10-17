/**
 * The Bridge in the app: bots whose brain is "Your Claude" or "Your ChatGPT" think on this
 * computer, with the owner's own Claude Code or Codex (runner.mjs, shared with the terminal Bridge).
 *
 *   off       turned off here ("Think with my Claude or ChatGPT plan here" unchecked), signed out,
 *             or neither CLI found: the server is told this computer has none, so no bot waits on it.
 *   ready     a CLI is found but no bot needs it yet: a heartbeat every 30 s says which (so a bot's
 *             Brain settings can say "Claude Code found"), and its answer says whether turns wait.
 *   listening a bot thinks with the owner's plan (or turns are waiting): long-polls for turns and
 *             runs them one at a time.
 *
 * It never logs or keeps what a turn says (the prompt, the transcript, the answer, its MCP token),
 * and never gives the CLI the device token: turns run with only their own short-lived MCP token.
 * Quitting mid-turn stops the CLI and tells the bot why there's no answer.
 */
import { EventEmitter } from "node:events";
import { cliVersion, prepareWorkdir, reportable, resolveCommand, runTurn } from "./runner.mjs";
import { programPath } from "./program-path.mjs";

const HEARTBEAT_MS = 30_000;
/** How often to look again for Claude Code and Codex (one may have been installed or updated). */
const DETECT_EVERY_MS = 5 * 60_000;
const CLI_NAME = { claude: "Claude Code", codex: "Codex" };
const PLAN_NAME = { claude: "Claude", codex: "ChatGPT" };
export const GET_CLI_URL = { claude: "https://code.claude.com", codex: "https://developers.openai.com/codex" };

/**
 * @typedef {{ claude: string | null, codex: string | null }} Clis  version lines, or null when not found
 * @typedef {{ commands: { claude: import('./runner.mjs').Command | null, codex: import('./runner.mjs').Command | null }, clis: Clis, env: Record<string, string> }} Found
 */

/**
 * The PATH that found a CLI, kept for an hour: asking the login shell runs the owner's profile,
 * so it isn't asked every few minutes. While nothing is found, it's asked each time (one may get installed).
 */
let lastPath = /** @type {{ value: string, at: number } | null} */ (null);
const PATH_KEEP_MS = 60 * 60_000;

/**
 * Finds Claude Code and Codex the way the owner's terminal would.
 * @param {{ env?: Record<string, string | undefined>, platform?: NodeJS.Platform, node?: import('./runner.mjs').Command | null }} [o]
 * @returns {Promise<Found>}
 */
export async function findClis(o = {}) {
  const base = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const key = Object.keys(base).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const kept = lastPath && Date.now() - lastPath.at < PATH_KEEP_MS ? lastPath.value : null;
  const programs = kept ?? (await programPath({ env: base, platform }));
  const env = /** @type {Record<string, string>} */ ({ ...base, [key]: programs });
  const commands = {
    claude: resolveCommand("claude", { env, platform, node: o.node ?? null }),
    codex: resolveCommand("codex", { env, platform, node: o.node ?? null }),
  };
  const [claude, codex] = await Promise.all([cliVersion(commands.claude, env), cliVersion(commands.codex, env)]);
  lastPath = claude || codex ? (kept ? lastPath : { value: programs, at: Date.now() }) : null;
  return { commands: { claude: claude ? commands.claude : null, codex: codex ? commands.codex : null }, clis: { claude, codex }, env };
}

export class Bridge extends EventEmitter {
  /**
   * @param {object} o
   * @param {ReturnType<typeof import('../api.mjs').createApi>} o.api
   * @param {import('../account.mjs').Account} o.account
   * @param {import('../store.mjs').Settings} o.settings
   * @param {string} o.workRoot  where turns run (emptied after each)
   * @param {() => Promise<Found>} [o.find]
   * @param {typeof runTurn} [o.run]
   * @param {(n: { title: string, body: string }) => void} [o.notify]
   * @param {NodeJS.Platform} [o.platform]
   * @param {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout, setInterval: typeof setInterval, clearInterval: typeof clearInterval }} [o.timers]
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    super();
    this.o = o;
    this.api = o.api;
    this.account = o.account;
    this.settings = o.settings;
    this.find = o.find ?? (() => findClis());
    this.run = o.run ?? runTurn;
    this.notify = o.notify ?? (() => {});
    this.platform = o.platform ?? process.platform;
    this.timers = o.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
    this.log = o.log ?? (() => {});
    /** @type {Found | null} */
    this.found = null;
    this.foundAt = 0;
    /** @type {Promise<Found | null> | null} */
    this.finding = null;
    /** @type {'off'|'ready'|'listening'} */
    this.mode = "off";
    /** @type {{ id: string, botId: string, cli: 'claude'|'codex' } | null} */
    this.turn = null;
    /** Why the last turn had no answer, when the owner can fix it ('signin' | 'limit' | 'missing'), with which CLI. */
    this.problem = /** @type {{ reason: string, cli: 'claude'|'codex' } | null} */ (null);
    this.offline = false;
    /** Turns were waiting at the last heartbeat. */
    this.queued = false;
    this.answered = 0;
    this.loop = null;
    this.pollAbort = null;
    this.turnAbort = null;
    this.beat = null;
    this.recheck = null;
    this.stopped = false;
    this.lastSent = /** @type {string | null} */ (null);
    this.signinNoticeAt = 0;
  }

  /** Start: decide now, then look for the CLIs again every few minutes (one may get installed). */
  start() {
    void this.apply();
    if (this.recheck) return;
    this.recheck = this.timers.setInterval(() => {
      if (this.account.device && this.enabled()) void this.detect(true).then(() => this.apply());
    }, DETECT_EVERY_MS);
    /** @type {any} */ (this.recheck)?.unref?.();
  }

  /** "Think with my Claude or ChatGPT plan here": on unless the owner turned it off on this computer. */
  enabled() {
    return this.settings.get().bridge?.enabled !== false;
  }

  /** @param {boolean} on */
  setEnabled(on) {
    this.settings.update({ bridge: { ...(this.settings.get().bridge ?? {}), enabled: on } });
    if (on) this.problem = null;
    void this.apply();
  }

  /** The CLIs the owner's plan bots need ('claude' | 'codex'). */
  needed() {
    const set = new Set();
    for (const b of this.account.bots()) if (b.subscription === "claude" || b.subscription === "codex") set.add(b.subscription);
    return /** @type {Array<'claude'|'codex'>} */ ([...set]);
  }

  /** Re-decide what to do: after pairing, a session refresh, a setting change, or now and then. */
  async apply() {
    if (this.stopped) return;
    const paired = Boolean(this.account.device);
    if (!paired) {
      this.halt();
      this.setMode("off");
      return;
    }
    if (!this.enabled()) {
      this.halt();
      this.setMode("off");
      await this.heartbeat(true);
      return;
    }
    const found = await this.detect();
    if (this.stopped || !this.account.device || !this.enabled()) return;
    const any = Boolean(found?.commands.claude || found?.commands.codex);
    if (!any) {
      this.halt();
      this.setMode("off");
      await this.heartbeat(true);
      return;
    }
    this.startHeartbeat();
    if (this.needed().length || this.queued) this.listen();
    else if (!this.turn) {
      // No bot needs this computer now: stop listening (a turn under way finishes first).
      this.pollAbort?.abort();
      this.setMode("ready");
    }
  }

  /** Look for the CLIs (again, when it's been a while or `force`). */
  async detect(force = false) {
    if (!force && this.found && Date.now() - this.foundAt < DETECT_EVERY_MS) return this.found;
    if (!this.finding) {
      this.finding = this.find()
        .then((f) => {
          const before = JSON.stringify(this.found?.clis ?? null);
          this.found = f;
          this.foundAt = Date.now();
          if (JSON.stringify(f.clis) !== before) this.log(`bridge: Claude Code ${f.clis.claude ?? "not found"} · Codex ${f.clis.codex ?? "not found"}`);
          return f;
        })
        .catch((err) => {
          this.log(`bridge: couldn't look for Claude Code and Codex (${err?.message ?? err})`);
          return this.found;
        })
        .finally(() => {
          this.finding = null;
          this.emit("change");
        });
    }
    return this.finding;
  }

  /** The CLIs to report: what's found while it's on here, none while it's off. */
  reported() {
    if (this.stopped || !this.enabled() || !this.found) return { claude: null, codex: null };
    return { claude: this.found.clis.claude, codex: this.found.clis.codex };
  }

  /**
   * Tell the server which CLIs this computer has. Its answer says whether turns are waiting.
   * `onlyIfChanged`: skip it when the server already heard the same (going quiet twice).
   */
  async heartbeat(onlyIfChanged = false) {
    if (!this.account.device) return;
    const clis = this.reported();
    const body = JSON.stringify(clis);
    if (onlyIfChanged && body === this.lastSent) return;
    const before = `${this.offline}/${this.queued}`;
    try {
      const r = await this.api.bridgeHeartbeat(clis);
      this.lastSent = body;
      this.offline = false;
      const queued = typeof r?.queued === "number" && r.queued > 0;
      if (queued !== this.queued) {
        this.queued = queued;
        // Turns are waiting for this computer: listen, and see which bot they're for.
        if (queued && this.mode === "ready") {
          void this.account.refresh();
          this.listen();
        }
      }
    } catch (err) {
      const e = /** @type {any} */ (err);
      if (e?.status === 401) void this.account.refresh();
      else if (e?.status === 0) this.offline = true;
    }
    if (`${this.offline}/${this.queued}` !== before) this.emit("change");
  }

  startHeartbeat() {
    if (this.beat) return;
    void this.heartbeat();
    this.beat = this.timers.setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    /** @type {any} */ (this.beat)?.unref?.();
  }

  listen() {
    if (this.loop) return;
    this.setMode("listening");
    this.loop = this.poll().finally(() => {
      this.loop = null;
    });
  }

  /** Stop listening and the heartbeat; a turn under way is stopped (its bot is told why). */
  halt() {
    this.pollAbort?.abort();
    this.turnAbort?.abort();
    if (this.beat) {
      this.timers.clearInterval(this.beat);
      this.beat = null;
    }
  }

  /** @param {'off'|'ready'|'listening'} mode */
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode !== "listening") this.turn = null;
    this.log(`bridge: ${mode}`);
    this.emit("change");
  }

  async poll() {
    let backoff = 5000;
    while (!this.stopped && this.mode === "listening" && this.account.device && this.enabled()) {
      this.pollAbort = new AbortController();
      let job = null;
      try {
        job = await this.api.bridgeJob({ signal: this.pollAbort.signal });
        if (this.offline) {
          this.offline = false;
          this.emit("change");
        }
        backoff = 5000;
      } catch (err) {
        const e = /** @type {any} */ (err);
        if (this.pollAbort.signal.aborted) break;
        if (e?.status === 401) {
          void this.account.refresh();
          break;
        }
        if (!this.offline) {
          this.offline = true;
          this.emit("change");
        }
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
        continue;
      }
      if (!job) {
        // Nothing waiting, and no bot needs this computer anymore (its brain changed): back to ready.
        if (!this.needed().length && !this.queued) {
          this.setMode("ready");
          break;
        }
        continue;
      }
      await this.think(job);
    }
    this.pollAbort = null;
  }

  /** @param {import('./runner.mjs').Job} job */
  async think(job) {
    const cli = job.input?.cli === "codex" ? "codex" : "claude";
    this.turn = { id: job.id, botId: job.botId, cli };
    this.emit("change");
    this.log(`bridge: turn ${job.id} for ${job.botId} with ${CLI_NAME[cli]}`);
    const t0 = Date.now();
    this.turnAbort = new AbortController();
    /** @type {import('./runner.mjs').TurnResult} */
    let result;
    try {
      const found = (await this.detect()) ?? { commands: { claude: null, codex: null }, env: /** @type {Record<string, string>} */ ({}) };
      const dir = prepareWorkdir(this.o.workRoot, job.botId);
      result = await this.run(job, { dir, commands: found.commands, env: found.env, signal: this.turnAbort.signal, platform: this.platform });
    } catch (err) {
      result = { ok: false, error: "Something went wrong on this computer while thinking.", reason: "error" };
      this.log(`bridge: turn ${job.id} crashed (${/** @type {any} */ (err)?.message ?? err})`);
    }
    this.turnAbort = null;
    // Only the outcome is logged: never the words.
    this.log(`bridge: turn ${job.id} ${result.ok ? `answered (${(result.text ?? "").length} chars)` : `had no answer (${result.reason ?? "error"})`} in ${Math.round((Date.now() - t0) / 100) / 10} s`);
    await this.report(job.id, result);
    if (result.ok) {
      this.answered += 1;
      this.problem = null;
    } else if (result.reason === "signin" || result.reason === "limit" || result.reason === "missing") {
      this.problem = { reason: result.reason, cli };
      if (result.reason === "missing") void this.detect(true);
      if (result.reason === "signin" && Date.now() - this.signinNoticeAt > 60 * 60_000) {
        this.signinNoticeAt = Date.now();
        this.notify({
          title: `${CLI_NAME[cli]} isn't signed in`,
          body:
            cli === "codex"
              ? "Open a terminal, type codex login and sign in with your ChatGPT account. Then message your bot again."
              : "Open a terminal, type claude and sign in with your Claude account. Then message your bot again.",
        });
      }
    }
    this.turn = null;
    this.emit("change");
  }

  /** Send a turn's result, trying a few times if the network blips. */
  async report(jobId, result) {
    const body = reportable(result);
    for (let i = 0; i < 3; i++) {
      try {
        await this.api.bridgeResult(jobId, body);
        return true;
      } catch (err) {
        const e = /** @type {any} */ (err);
        // 404/409: the turn is gone or already settled; 401: unpaired. Nothing to retry.
        if (e?.status && e.status !== 0 && e.status < 500) return false;
        if (this.stopped && i > 0) return false;
        await this.sleep(1000 * (i + 1));
      }
    }
    this.log(`bridge: couldn't report turn ${jobId}`);
    return false;
  }

  /** @param {number} ms */
  sleep(ms) {
    return new Promise((r) => {
      const t = this.timers.setTimeout(r, ms);
      /** @type {any} */ (t)?.unref?.();
    });
  }

  /** Signed out: stop at once (the token is gone, so nothing is sent). */
  forget() {
    this.halt();
    this.lastSent = null;
    this.problem = null;
    this.queued = false;
    this.setMode("off");
  }

  /**
   * Quitting: a running turn is stopped and its bot told why; then the server hears this computer
   * has no CLIs, so nothing waits on it. Bounded, so quitting never hangs.
   */
  async shutdown(timeoutMs = 4000) {
    if (this.stopped) return;
    this.stopped = true;
    const loop = this.loop;
    this.halt();
    if (this.recheck) this.timers.clearInterval(this.recheck);
    const wasOn = this.mode !== "off";
    this.mode = "off";
    const work = (async () => {
      if (loop) await loop;
      if (wasOn && this.account.device) await this.api.bridgeHeartbeat({ claude: null, codex: null }).catch(() => {});
    })();
    await Promise.race([work, this.sleep(timeoutMs)]);
  }

  /** For the tray and the pairing window. */
  info() {
    const found = this.found?.clis ?? { claude: null, codex: null };
    const needed = this.needed();
    const has = (cli) => Boolean(found[cli]);
    const enabled = this.enabled();
    const plans = needed.length ? needed : /** @type {Array<'claude'|'codex'>} */ (["claude", "codex"]).filter(has);
    const planWords = plans.length ? plans.map((c) => PLAN_NAME[c]).join(" or ") : "Claude or ChatGPT";
    const missing = needed.find((c) => !has(c)) ?? null;
    const show = enabled ? needed.length > 0 || has("claude") || has("codex") || this.problem !== null : true;
    const shellWord = this.platform === "darwin" ? "Terminal" : "a terminal";
    let status;
    if (!enabled) status = `Your ${planWords} plan: off on this computer`;
    else if (this.turn) status = `Thinking for ${this.botName(this.turn.botId)} with ${CLI_NAME[this.turn.cli]}…`;
    else if (this.finding && !this.found) status = "Looking for Claude Code and Codex…";
    else if (this.problem?.reason === "signin") status = `${CLI_NAME[this.problem.cli]} isn't signed in: run ${this.problem.cli === "codex" ? "codex login" : "claude"} in ${shellWord}`;
    else if (missing) status = `${CLI_NAME[missing]} isn't on this computer`;
    else if (this.problem?.reason === "limit") status = `You've hit your ${PLAN_NAME[this.problem.cli]} plan's limit for now`;
    else if (this.offline) status = "Can't reach Build-a-bot to think for your bots";
    else if (this.mode === "listening") status = `Your bots think here with ${plans.filter(has).map((c) => CLI_NAME[c]).join(" and ") || "your plan"}`;
    else if (has("claude") || has("codex")) status = `Ready to think with ${(["claude", "codex"]).filter(has).map((c) => CLI_NAME[c]).join(" and ")}`;
    else status = "Claude Code and Codex aren't on this computer";
    return {
      show,
      enabled,
      status,
      toggleLabel: `Think with my ${planWords} plan here`,
      /** Offer to get the CLI a bot needs but this computer lacks. */
      getCli: enabled && missing ? { id: missing, name: CLI_NAME[missing] } : null,
      mode: this.mode,
      thinking: Boolean(this.turn),
      clis: found,
      answered: this.answered,
    };
  }

  /** @param {string} botId */
  botName(botId) {
    return this.account.bots().find((b) => b.id === botId)?.name ?? "your bot";
  }
}
