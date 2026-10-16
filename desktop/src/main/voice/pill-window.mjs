/**
 * The voice typing pill: a small bar at the bottom of the screen, on top of everything, that
 * never takes focus (the words must land in the app the owner is typing in). Its page
 * (bab-app://dictation) also records: it's the only page allowed to use the microphone for voice
 * typing, and only while the pill is on screen.
 *
 * The window is exactly as big as what it shows (the page reports its size), anchored to the
 * bottom center of the screen the pointer is on, above the meeting bot when that's showing. It
 * lets clicks through except while it has buttons.
 */
import { BrowserWindow, screen, session } from "electron";
import { fileURLToPath } from "node:url";
import { isPage, pageUrl, serveLocalPages } from "../local-pages.mjs";
import { pillBounds, pillInteractive } from "./pill-layout.mjs";

const PRELOAD = fileURLToPath(new URL("../../preload/dictation.cjs", import.meta.url));
export const DICTATION_PARTITION = "bab-dictation";
const ORIGIN = "bab-app://dictation";
export class PillWindow {
  /**
   * @param {object} o
   * @param {(action: string) => void} o.onAction  a button on the pill
   * @param {(over: boolean) => void} [o.onHover]
   * @param {() => number} [o.lift]  how far up to sit (the meeting bot's height when it shows)
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    this.o = o;
    this.log = o.log ?? (() => {});
    /** @type {BrowserWindow | null} */
    this.win = null;
    this.ready = null;
    this.sessionReady = false;
    this.state = null;
    this.size = { width: 236, height: 60 };
    /** The display the pill is on for this dictation (where the pointer was when it started). */
    this.workArea = null;
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  /** Is this IPC message from the pill's page? */
  isSender(event) {
    const wc = this.webContents;
    return Boolean(wc && event.sender === wc && event.senderFrame && isPage(event.senderFrame.url, "dictation"));
  }

  setupSession() {
    if (this.sessionReady) return;
    const ses = session.fromPartition(DICTATION_PARTITION);
    serveLocalPages(ses, ["dictation"]);
    // Only this page, and only the microphone (never the camera or the screen).
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      const fromPill = wc === this.webContents && String(details?.requestingUrl ?? "").startsWith(ORIGIN);
      const types = /** @type {any} */ (details)?.mediaTypes ?? [];
      cb(permission === "media" && fromPill && types.every((t) => t === "audio"));
    });
    ses.setPermissionCheckHandler((wc, permission, origin) => permission === "media" && origin === ORIGIN && wc === this.webContents);
    ses.setDisplayMediaRequestHandler((_req, cb) => cb(null));
    this.sessionReady = true;
  }

  /** Load the page ahead of time, so the first press records at once. */
  ensure() {
    if (this.webContents) return this.ready ?? Promise.resolve(true);
    this.setupSession();
    const win = new BrowserWindow({
      width: this.size.width,
      height: this.size.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      roundedCorners: false,
      title: "Build-a-bot voice typing",
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: {
        preload: PRELOAD,
        partition: DICTATION_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        // The recorder's timers and the waveform keep running while the pill is up.
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
        devTools: !process.env.BAB_PACKAGED,
      },
    });
    this.win = win;
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (e) => e.preventDefault());
    wc.on("render-process-gone", (_e, d) => {
      this.log(`voice: pill page gone (${d.reason})`);
      this.destroy();
    });
    wc.on("console-message", (details) => {
      const level = /** @type {any} */ (details)?.level;
      if (level === "error" || level === "warning") this.log(`pill page: ${/** @type {any} */ (details)?.message}`);
    });
    win.on("closed", () => {
      if (this.win === win) {
        this.win = null;
        this.ready = null;
      }
    });
    this.ready = win
      .loadURL(pageUrl("dictation"))
      .then(() => true)
      .catch((err) => {
        this.log(`voice: pill page didn't load (${err?.code ?? err})`);
        this.destroy();
        return false;
      });
    return this.ready;
  }

  /** Show (or update) the pill. */
  async show(state) {
    this.state = state;
    if (!(await this.ensure()) || !this.win || this.win.isDestroyed()) return false;
    const win = this.win;
    if (!win.isVisible()) {
      // Where the owner is working: the screen the pointer is on.
      this.workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    }
    this.place();
    win.webContents.send("dictation:state", state);
    win.setIgnoreMouseEvents(!pillInteractive(state), { forward: true });
    if (!win.isVisible()) {
      win.showInactive();
      win.setAlwaysOnTop(true, "screen-saver");
    }
    return true;
  }

  update(state) {
    return this.show(state);
  }

  hide() {
    this.state = null;
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    w.webContents.send("dictation:state", null);
    w.hide();
    w.setIgnoreMouseEvents(true, { forward: true });
  }

  /** The page says how big the pill is now. */
  resize(size) {
    const width = Math.round(Number(size?.width) || 0);
    const height = Math.round(Number(size?.height) || 0);
    if (width < 40 || height < 30 || width > 640 || height > 520) return;
    this.size = { width, height };
    this.place();
  }

  place() {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const area = this.workArea ?? screen.getPrimaryDisplay().workArea;
    const b = pillBounds(area, this.size, this.o.lift?.() ?? 0);
    const cur = w.getBounds();
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) w.setBounds(b, false);
  }

  // The recorder, on the page --------------------------------------------------

  async call(fn, arg) {
    const wc = this.webContents;
    if (!wc) throw new Error("the pill is gone");
    return wc.executeJavaScript(`window.__babDictation.${fn}(${JSON.stringify(arg ?? {})})`, true);
  }

  /** Open the mic and start recording. @returns {Promise<{ ok: boolean, error?: string }>} */
  async start(opts) {
    try {
      if (!(await this.ensure())) return { ok: false, error: "the pill didn't load" };
      return await this.call("start", opts);
    } catch (err) {
      return { ok: false, error: String(/** @type {any} */ (err)?.message ?? err) };
    }
  }

  /** Stop, release the mic, and hand over the recording (and its WAV, when asked for at start). */
  async stop() {
    const r = await this.call("stop");
    if (!r?.ok || !r.data) return null;
    const view = (b64) => {
      const b = Buffer.from(b64, "base64");
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    };
    return { bytes: view(r.data), mime: r.mime, durationMs: r.durationMs, speechMs: r.speechMs, ...(typeof r.wav === "string" ? { wav: view(r.wav) } : {}) };
  }

  /** Stop, release the mic, throw the recording away. */
  async cancel() {
    await this.call("cancel").catch(() => {});
  }

  /** The microphones the page can see (labels once the mic was allowed). */
  async microphones() {
    try {
      if (!(await this.ensure())) return [];
      const list = await this.call("microphones");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  destroy() {
    const w = this.win;
    this.win = null;
    this.ready = null;
    if (w && !w.isDestroyed()) {
      w.removeAllListeners("closed");
      w.destroy();
    }
  }
}
