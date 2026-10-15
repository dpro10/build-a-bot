/**
 * Voice typing's window (bab-app://voice): setting it up (microphone, Accessibility on a Mac, a
 * place to try it), the shortcut, the cleanup options, the dictionary, this computer's history
 * and stats. It never sees the device token: it gets a summary and asks the main process to act.
 */
import { BrowserWindow, session } from "electron";
import { fileURLToPath } from "node:url";
import { isPage, pageUrl, serveLocalPages } from "../local-pages.mjs";

const PRELOAD = fileURLToPath(new URL("../../preload/voice.cjs", import.meta.url));
const ICON = fileURLToPath(new URL("../../../assets/icon.png", import.meta.url));
export const VOICE_PARTITION = "bab-voice";

export class VoiceSettingsWindow {
  /** @param {{ log?: (m: string) => void, onClosed?: () => void }} [o] */
  constructor(o = {}) {
    this.o = o;
    this.log = o.log ?? (() => {});
    /** @type {BrowserWindow | null} */
    this.win = null;
    this.sessionReady = false;
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  isOpen() {
    return Boolean(this.webContents);
  }

  isSender(event) {
    const wc = this.webContents;
    return Boolean(wc && event.sender === wc && event.senderFrame && isPage(event.senderFrame.url, "voice"));
  }

  /** @param {string} [section]  "setup" | "dictionary" | "history" */
  async show(section) {
    if (this.webContents) {
      const w = /** @type {BrowserWindow} */ (this.win);
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
      if (section) w.webContents.send("voice:section", section);
      return;
    }
    if (!this.sessionReady) {
      const ses = session.fromPartition(VOICE_PARTITION);
      serveLocalPages(ses, ["voice"]);
      // The page needs no permissions: the try-it box gets the words pasted in like any app.
      ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
      ses.setPermissionCheckHandler(() => false);
      this.sessionReady = true;
    }
    const win = new BrowserWindow({
      width: 560,
      height: 760,
      minWidth: 420,
      minHeight: 520,
      show: false,
      title: "Voice typing · Build-a-bot",
      icon: ICON,
      autoHideMenuBar: true,
      backgroundColor: "#fbf9f6",
      fullscreenable: false,
      webPreferences: {
        preload: PRELOAD,
        partition: VOICE_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: true,
        devTools: !process.env.BAB_PACKAGED,
      },
    });
    this.win = win;
    win.removeMenu();
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (e, url) => {
      if (!isPage(url, "voice")) e.preventDefault();
    });
    win.once("ready-to-show", () => {
      win.show();
      // A menu-bar app isn't active on its own: bring the window to the front, ready to type in.
      win.focus();
    });
    win.on("closed", () => {
      if (this.win === win) this.win = null;
      this.o.onClosed?.();
    });
    await win.loadURL(pageUrl("voice") + (section ? `#${encodeURIComponent(section)}` : ""));
  }

  send(state) {
    this.webContents?.send("voice:state", state);
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.close();
  }
}
