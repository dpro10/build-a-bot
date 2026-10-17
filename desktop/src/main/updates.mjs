/**
 * Keeping the app up to date: a signed release build asks build-a-bot.site for a newer version now
 * and then, downloads it in the background, and installs it when the app quits, or right away from
 * the menu (never in the middle of a call it's taking notes on, or a dictation).
 *
 * Only signed release builds update themselves: CI sets `babUpdates` in the packaged package.json
 * when it signs a build. An unsigned Mac app can't replace itself, and test builds stay as they are.
 * The address (electron-builder.yml › publish) is the site's, which sends each request on to the
 * latest release's files, so where the files live can change without a new app.
 */

/** The first look, a minute after starting (not while everything else is starting up). */
export const FIRST_CHECK_MS = 60_000;
/** Then every four hours. */
export const CHECK_EVERY_MS = 4 * 60 * 60_000;

/**
 * Whether this build updates itself.
 * @param {{ packaged: boolean, platform: string, flag: unknown, env: Record<string, string | undefined> }} o
 */
export function updatesOn({ packaged, platform, flag, env }) {
  // electron-builder's -c.extraMetadata.babUpdates=true arrives as true (or "true").
  if (!packaged || (flag !== true && flag !== "true")) return false;
  if (platform !== "darwin" && platform !== "win32") return false;
  return env.BAB_UPDATES !== "off" && env.BAB_SMOKE !== "1" && env.BAB_TEST !== "1";
}

export class Updates {
  /**
   * @param {object} o
   * @param {any} o.updater                 electron-updater's autoUpdater (or a stand-in)
   * @param {boolean} o.enabled
   * @param {() => boolean} o.busy          taking notes or dictating: don't restart now
   * @param {(n: { title: string, body: string }) => void} o.notify
   * @param {() => void} [o.onChange]
   * @param {(m: string) => void} [o.log]
   * @param {{ setTimeout: typeof setTimeout, setInterval: typeof setInterval }} [o.timers]
   */
  constructor({ updater, enabled, busy, notify, onChange = () => {}, log = () => {}, timers = globalThis }) {
    this.updater = updater;
    this.enabled = enabled;
    this.busy = busy;
    this.notify = notify;
    this.onChange = onChange;
    this.log = log;
    this.timers = timers;
    /** @type {string | null} the version downloaded and waiting to be installed */
    this.ready = null;
    this.started = false;
  }

  start() {
    if (!this.enabled || this.started) return;
    this.started = true;
    const u = this.updater;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.allowPrerelease = false;
    u.allowDowngrade = false;
    u.logger = { info: (m) => this.log(`update: ${m}`), warn: (m) => this.log(`update: ${m}`), error: (m) => this.log(`update: ${m}`), debug: () => {} };
    u.on("update-downloaded", (info) => {
      const first = this.ready === null;
      this.ready = String(info?.version ?? "");
      this.onChange();
      if (first) this.notify({ title: `Build-a-bot ${this.ready} is ready`, body: "It installs when you quit. To restart with it now, choose Restart to update in the menu." });
    });
    u.on("error", (err) => this.log(`update failed: ${err?.message ?? err}`));
    const check = () => {
      Promise.resolve()
        .then(() => u.checkForUpdates())
        .catch((err) => this.log(`update check failed: ${err?.message ?? err}`));
    };
    this.timers.setTimeout(check, FIRST_CHECK_MS)?.unref?.();
    this.timers.setInterval(check, CHECK_EVERY_MS)?.unref?.();
  }

  /** The menu's line, when a new version is waiting. */
  menu() {
    return this.ready ? { version: this.ready, canRestart: !this.busy() } : null;
  }

  /** Restart with the new version now. Not while taking notes or dictating. */
  installNow() {
    if (!this.ready || this.busy()) return false;
    this.log(`update: restarting with ${this.ready}`);
    // Silently (the installer asks nothing anyway), and start again afterwards.
    this.updater.quitAndInstall(true, true);
    return true;
  }
}
