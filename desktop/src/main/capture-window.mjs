/**
 * Audio capture runs in a hidden window (bab-app://capture) so it can use the web
 * audio stack: the mic through getUserMedia, the call's audio through getDisplayMedia
 * with Electron's system-audio loopback, and one MediaRecorder per track, restarted
 * every chunk so each chunk is a complete, standalone webm/opus file.
 *
 * Nothing here runs before the owner says "Take notes": the window is created at the
 * start of a recording and destroyed (releasing the mic) when it stops.
 */
import { BrowserWindow, desktopCapturer, session } from "electron";
import { fileURLToPath } from "node:url";
import { isPage, pageUrl, serveLocalPages } from "./local-pages.mjs";

const PRELOAD = fileURLToPath(new URL("../preload/capture.cjs", import.meta.url));
export const CAPTURE_PARTITION = "bab-capture";
const CAPTURE_ORIGIN = "bab-app://capture";

export class CaptureWindow {
  /**
   * @param {object} o
   * @param {(chunk: { track: 'mic'|'system', chunk: number, startMs: number, durationMs: number, silent: boolean, mime: string, data: Uint8Array }) => void} o.onChunk
   * @param {(level: number) => void} o.onLevel
   * @param {(info: { track: string, reason: string }) => void} o.onTrackEnded
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    this.o = o;
    this.log = o.log ?? (() => {});
    /** @type {BrowserWindow | null} */
    this.win = null;
    this.sessionReady = false;
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  /** Is this IPC message from our capture page? */
  isSender(event) {
    const wc = this.webContents;
    return Boolean(wc && event.sender === wc && event.senderFrame && isPage(event.senderFrame.url, "capture"));
  }

  setupSession() {
    if (this.sessionReady) return;
    const ses = session.fromPartition(CAPTURE_PARTITION);
    serveLocalPages(ses, ["capture"]);
    // Only our own capture page may use the microphone (audio only, never the camera).
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      const fromCapture = wc === this.webContents && String(details?.requestingUrl ?? "").startsWith(CAPTURE_ORIGIN);
      const types = /** @type {any} */ (details)?.mediaTypes ?? [];
      cb(permission === "media" && fromCapture && types.every((t) => t === "audio"));
    });
    ses.setPermissionCheckHandler((wc, permission, origin) => permission === "media" && origin === CAPTURE_ORIGIN && wc === this.webContents);
    // The call's audio: system loopback. getDisplayMedia needs a video source, which
    // the page drops right away. Never 'loopbackWithMute' (it would mute the call).
    ses.setDisplayMediaRequestHandler(
      (request, callback) => {
        if (request.securityOrigin !== CAPTURE_ORIGIN && !String(request.frame?.url ?? "").startsWith(CAPTURE_ORIGIN)) {
          callback(null);
          return;
        }
        if (process.env.BAB_TEST_DENY_SYSTEM_AUDIO === "1") {
          callback(null); // tests: behave like a computer that won't share system audio
          return;
        }
        desktopCapturer
          .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
          .then((sources) => {
            if (!sources.length) {
              this.log("capture: no screen source for system audio");
              callback(null);
              return;
            }
            callback({ video: sources[0], audio: "loopback" });
          })
          .catch((err) => {
            this.log(`capture: screen sources failed: ${err?.message ?? err}`);
            callback(null);
          });
      },
      { useSystemPicker: false },
    );
    this.sessionReady = true;
  }

  async ensure() {
    if (this.webContents) return;
    this.setupSession();
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      skipTaskbar: true,
      focusable: false,
      title: "Build-a-bot capture",
      webPreferences: {
        preload: PRELOAD,
        partition: CAPTURE_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        // Timers must keep running in a hidden window (chunk rotation, levels).
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
        devTools: !process.env.BAB_PACKAGED,
      },
    });
    this.win = win;
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (e) => e.preventDefault());
    wc.on("render-process-gone", (_e, d) => {
      this.log(`capture: page process gone (${d.reason})`);
      this.o.onTrackEnded({ track: "all", reason: "crashed" });
    });
    wc.on("console-message", (details) => {
      const level = /** @type {any} */ (details)?.level;
      const message = /** @type {any} */ (details)?.message;
      if (level === "error" || level === "warning") this.log(`capture page: ${message}`);
    });
    await win.loadURL(pageUrl("capture"));
  }

  /** Call a function the capture page exposes (as if the owner clicked: getDisplayMedia needs that). */
  async call(fn, arg) {
    const wc = this.webContents;
    if (!wc) throw new Error("capture window is gone");
    return wc.executeJavaScript(`window.__babCapture.${fn}(${JSON.stringify(arg ?? {})})`, true);
  }

  /**
   * @param {{ chunkMs: number, system: 'loopback'|'off', silenceRms?: number }} opts
   * @returns {Promise<{ ok: boolean, mic: boolean, system: 'ok'|'denied'|'ended'|'unavailable'|'off', error?: string }>}
   */
  async start(opts) {
    try {
      await this.ensure();
      return await this.call("start", opts);
    } catch (err) {
      this.log(`capture: start failed: ${/** @type {any} */ (err)?.message ?? err}`);
      this.destroy();
      return { ok: false, mic: false, system: "off", error: String(/** @type {any} */ (err)?.message ?? err) };
    }
  }

  async pause() {
    if (this.webContents) await this.call("pause").catch((e) => this.log(`capture: pause failed ${e}`));
  }

  /** @returns {Promise<{ ok: boolean, system?: string }>} */
  async resume() {
    if (!this.webContents) return { ok: false };
    try {
      return await this.call("resume");
    } catch (err) {
      this.log(`capture: resume failed ${err}`);
      return { ok: false };
    }
  }

  /**
   * Stop and flush the last chunks (or drop them, for "Stop and delete"), then release
   * the mic. Resolves after the page's "flushed" message, which travels on the same IPC
   * channel as the chunks, so every chunk has arrived by then.
   */
  async stop({ discard = false } = {}) {
    if (!this.webContents) return;
    const flushed = new Promise((resolve) => (this.flushWaiter = resolve));
    try {
      await this.call("stop", { discard });
      await Promise.race([flushed, new Promise((r) => setTimeout(r, 8000))]);
    } catch (err) {
      this.log(`capture: stop failed ${err}`);
    }
    this.flushWaiter = null;
    this.destroy();
  }

  /** The page sent its last chunk. */
  flushed() {
    this.flushWaiter?.();
  }

  destroy() {
    const w = this.win;
    this.win = null;
    if (w && !w.isDestroyed()) w.destroy();
  }
}
