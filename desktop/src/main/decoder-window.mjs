/**
 * Turns a piece of a meeting (webm/opus, as the capture page records it) into 16 kHz mono WAV, the
 * format NVIDIA Parakeet reads, with the browser's own audio decoder. It runs in a hidden,
 * sandboxed page (bab-app://decode) that can do nothing else: no network, no microphone, no
 * preload. The page opens when a piece needs it and closes after a minute unused. Nothing is
 * written to disk: the audio goes in and the WAV comes back in memory.
 */
import { BrowserWindow, session } from "electron";
import { pageUrl, serveLocalPages } from "./local-pages.mjs";

const PARTITION = "bab-decode";
const IDLE_MS = 60_000;

export class Decoder {
  /** @param {{ log?: (m: string) => void }} [o] */
  constructor(o = {}) {
    this.log = o.log ?? (() => {});
    /** @type {BrowserWindow | null} */
    this.win = null;
    /** @type {Promise<void> | null} */
    this.opening = null;
    this.sessionReady = false;
    this.idleTimer = null;
    /** One piece at a time. @type {Promise<unknown>} */
    this.chain = Promise.resolve();
  }

  setupSession() {
    if (this.sessionReady) return;
    const ses = session.fromPartition(PARTITION);
    serveLocalPages(ses, ["decode"]);
    // It needs nothing from the system: no microphone, no camera, no notifications.
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    this.sessionReady = true;
  }

  open() {
    if (this.win && !this.win.isDestroyed()) return Promise.resolve();
    this.opening ??= (async () => {
      this.setupSession();
      const win = new BrowserWindow({
        show: false,
        width: 200,
        height: 100,
        skipTaskbar: true,
        focusable: false,
        title: "Build-a-bot decoder",
        webPreferences: {
          partition: PARTITION,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webviewTag: false,
          spellcheck: false,
          backgroundThrottling: false,
          devTools: !process.env.BAB_PACKAGED,
        },
      });
      const wc = win.webContents;
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      wc.on("will-navigate", (e) => e.preventDefault());
      wc.on("render-process-gone", (_e, d) => {
        this.log(`decoder: page process gone (${d.reason})`);
        if (this.win === win) this.win = null;
      });
      try {
        await win.loadURL(pageUrl("decode"));
        this.win = win;
      } catch (err) {
        if (!win.isDestroyed()) win.destroy();
        throw err;
      }
    })().finally(() => (this.opening = null));
    return this.opening;
  }

  /**
   * @param {Uint8Array} bytes  one piece (webm/ogg with opus)
   * @param {string} mime
   * @returns {Promise<Uint8Array>} 16 kHz mono 16-bit WAV
   */
  toWav16k(bytes, mime) {
    const turn = this.chain.then(async () => {
      clearTimeout(this.idleTimer);
      await this.open();
      const wc = this.win?.webContents;
      if (!wc) throw new Error("the decoder page is gone");
      const b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
      const out = await wc.executeJavaScript(`window.__babDecode.toWav16k(${JSON.stringify(b64)}, ${JSON.stringify(String(mime || ""))})`, true);
      if (typeof out !== "string" || !out) throw new Error("couldn't decode it");
      return new Uint8Array(Buffer.from(out, "base64"));
    });
    this.chain = turn
      .catch(() => {})
      .finally(() => {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.close(), IDLE_MS);
        this.idleTimer.unref?.();
      });
    return turn;
  }

  close() {
    clearTimeout(this.idleTimer);
    const w = this.win;
    this.win = null;
    if (w && !w.isDestroyed()) w.destroy();
  }
}
