/**
 * The small local window for pairing this computer and choosing which bot takes
 * notes (bab-app://pairing). It never sees the device token: it gets a summary of
 * the account and sends back the server address and the pairing code.
 */
import { BrowserWindow, session } from "electron";
import { fileURLToPath } from "node:url";
import { isPage, pageUrl, serveLocalPages } from "./local-pages.mjs";

const PRELOAD = fileURLToPath(new URL("../preload/pairing.cjs", import.meta.url));
const ICON = fileURLToPath(new URL("../../assets/icon.png", import.meta.url));
export const PAIRING_PARTITION = "bab-pairing";

export class PairingWindow {
  /** @param {{ log?: (m: string) => void }} [o] */
  constructor(o = {}) {
    this.log = o.log ?? (() => {});
    /** @type {BrowserWindow | null} */
    this.win = null;
    this.sessionReady = false;
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  isSender(event) {
    const wc = this.webContents;
    return Boolean(wc && event.sender === wc && event.senderFrame && isPage(event.senderFrame.url, "pairing"));
  }

  async show() {
    if (this.webContents) {
      const w = /** @type {BrowserWindow} */ (this.win);
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
      return;
    }
    if (!this.sessionReady) {
      const ses = session.fromPartition(PAIRING_PARTITION);
      serveLocalPages(ses, ["pairing"]);
      ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
      ses.setPermissionCheckHandler(() => false);
      this.sessionReady = true;
    }
    const win = new BrowserWindow({
      width: 460,
      height: 700,
      minWidth: 380,
      minHeight: 480,
      show: false,
      title: "Build-a-bot",
      icon: ICON,
      autoHideMenuBar: true,
      backgroundColor: "#fbf9f6",
      fullscreenable: false,
      maximizable: false,
      webPreferences: {
        preload: PRELOAD,
        partition: PAIRING_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        devTools: !process.env.BAB_PACKAGED,
      },
    });
    this.win = win;
    win.removeMenu();
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (e, url) => {
      if (!isPage(url, "pairing")) e.preventDefault();
    });
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
      if (this.win === win) this.win = null;
    });
    await win.loadURL(pageUrl("pairing"));
  }

  /** Push fresh account info to the page. */
  send(state) {
    this.webContents?.send("pairing:state", state);
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.close();
  }
}
