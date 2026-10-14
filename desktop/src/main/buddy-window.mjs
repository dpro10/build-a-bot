/**
 * The bot at the bottom of the screen: a transparent, frameless, always-on-top window
 * showing <server>/desktop/buddy. It never takes focus, shows on every desktop and
 * over full-screen apps, and lets clicks through except over the bot and its bubble.
 *
 * Safety: the page gets only window.babDesktop (preload/buddy.cjs) — no Node, no
 * token. It can't navigate away from the server, open windows, or use the mic.
 * Never setContentProtection(true): the bot should show in screen shares too.
 */
import { BrowserWindow, screen, session } from "electron";
import { fileURLToPath } from "node:url";
import { buddyUrl } from "./buddy-url.mjs";
import { buddyBounds, isOnScreen, pickDisplay, pointInRects, sizeFor } from "./placement.mjs";

const PRELOAD = fileURLToPath(new URL("../preload/buddy.cjs", import.meta.url));
export const BUDDY_PARTITION = "bab-buddy";
const LOAD_TIMEOUT_MS = 20_000;

/** The Next.js dev-mode badge would sit in the corner of the transparent window. */
const HIDE_DEV_OVERLAY = "nextjs-portal{display:none!important}";

/** Hit-testing for Linux, where click-through can't forward mouse moves: the page's clickable parts. */
const RECTS_JS = `(() => Array.from(document.querySelectorAll('[data-buddy-interactive], .pointer-events-auto')).map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }).filter((r) => r[2] > 0 && r[3] > 0))()`;

export class BuddyWindow {
  /**
   * @param {object} o
   * @param {() => string | null} o.server  the paired server's origin
   * @param {(url: string) => void} o.openExternal  opens allowed links in the browser
   * @param {() => void} o.onGone  the window died or was closed by something else
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    this.o = o;
    this.log = o.log ?? (() => {});
    /** @type {BrowserWindow | null} */
    this.win = null;
    /** @type {any} */
    this.state = null;
    this.phase = null;
    /** @type {{ x: number, y: number, width: number, height: number } | null} the call's window, to pick a display */
    this.callBounds = null;
    this.interactive = false;
    this.rects = [];
    this.hitTimer = null;
    this.destroyTimer = null;
    this.creating = null;
    this.sessionReady = false;
    this.offsetX = 0;
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  setupSession() {
    if (this.sessionReady) return;
    const ses = session.fromPartition(BUDDY_PARTITION);
    // The page needs no permissions at all (no mic, camera, notifications, clipboard…).
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDisplayMediaRequestHandler((_req, cb) => cb(null));
    this.sessionReady = true;
  }

  /**
   * Show the bot (creating the window if needed) and wait until it's on screen.
   * @returns {Promise<boolean>} whether it's visible now
   */
  async show(state) {
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
    this.state = state;
    if (!this.creating && !this.webContents) this.creating = this.create(state).finally(() => (this.creating = null));
    // Everyone waits for the page to load: "visible" means the bot is painted, not an empty window.
    if (this.creating) {
      const ok = await this.creating;
      if (!ok || !this.webContents) return false;
    }
    if (!this.state) return false; // hidden again while loading
    state = this.state;
    const win = /** @type {BrowserWindow} */ (this.win);
    this.place(state.phase);
    this.push();
    if (!win.isVisible()) {
      // Let the page repaint with the new state first, so an old bubble never flashes.
      await new Promise((r) => setTimeout(r, 80));
      if (!this.state || win.isDestroyed()) return false;
      win.showInactive();
    }
    win.setAlwaysOnTop(true, "screen-saver");
    this.startHitTesting();
    return this.isShowing();
  }

  /** New state for the page (resizes the window when the phase changes). */
  update(state) {
    this.state = state;
    if (!this.webContents) return;
    if (state.phase !== this.phase) this.place(state.phase);
    this.push();
  }

  /** Tuck the bot away. The window is kept for a minute in case it's needed again. */
  hide() {
    this.state = null;
    this.phase = null;
    this.stopHitTesting();
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
    this.setInteractive(false);
    if (this.destroyTimer) clearTimeout(this.destroyTimer);
    this.destroyTimer = setTimeout(() => this.destroy(), 60_000);
  }

  destroy() {
    this.stopHitTesting();
    const w = this.win;
    this.win = null;
    if (w && !w.isDestroyed()) {
      w.removeAllListeners("closed");
      w.destroy();
    }
  }

  /** Is the bot really on screen right now? */
  isShowing() {
    const w = this.win;
    if (this.creating || !w || w.isDestroyed() || !w.isVisible() || w.isMinimized()) return false;
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea }));
    return isOnScreen(w.getBounds(), displays);
  }

  /** Put it back where it belongs and on top (it may have been covered or moved). */
  reassert() {
    const w = this.win;
    if (!w || w.isDestroyed() || !this.phase) return false;
    if (w.isMinimized()) w.restore();
    this.place(this.phase);
    if (!w.isVisible()) w.showInactive();
    w.setAlwaysOnTop(true, "screen-saver");
    w.moveTop();
    return this.isShowing();
  }

  /** The page says the pointer is over the bot or its bubble. */
  setInteractive(on) {
    this.interactive = Boolean(on);
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (process.platform === "linux") return; // Linux uses hit-testing (below)
    w.setIgnoreMouseEvents(!this.interactive, { forward: true });
  }

  /** The display the call is on (its window bounds), or the primary. */
  setCallBounds(bounds) {
    this.callBounds = bounds ?? null;
  }

  place(phase) {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    this.phase = phase;
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea }));
    const p = screen.getPrimaryDisplay();
    const display = pickDisplay(displays, { id: p.id, bounds: p.bounds, workArea: p.workArea }, this.callBounds);
    const b = buddyBounds(display.workArea, sizeFor(phase), { offsetX: this.offsetX });
    const cur = w.getBounds();
    if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) w.setBounds(b, false);
  }

  push() {
    const wc = this.webContents;
    if (!wc || !this.state) return;
    wc.send("buddy:state", this.state);
    if (process.platform === "linux") this.refreshRects();
  }

  /** @returns {Promise<boolean>} */
  async create(state) {
    const server = this.o.server();
    if (!server) return false;
    this.setupSession();
    const size = sizeFor(state.phase);
    const win = new BrowserWindow({
      width: size.width,
      height: size.height,
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
      title: "Build-a-bot",
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: {
        preload: PRELOAD,
        partition: BUDDY_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        spellcheck: false,
        backgroundThrottling: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        devTools: !process.env.BAB_PACKAGED,
      },
    });
    this.win = win;
    this.phase = state.phase;
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setIgnoreMouseEvents(true, { forward: true });

    const wc = win.webContents;
    const origin = new URL(server).origin;
    const sameOrigin = (url) => {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    };
    wc.setWindowOpenHandler(({ url }) => {
      this.o.openExternal(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (e, url) => {
      if (!sameOrigin(url) || !new URL(url).pathname.startsWith("/desktop/buddy")) e.preventDefault();
    });
    wc.on("will-redirect", (e, url) => {
      if (!sameOrigin(url)) e.preventDefault();
    });
    wc.on("will-attach-webview", (e) => e.preventDefault());
    wc.on("did-finish-load", () => {
      wc.insertCSS(HIDE_DEV_OVERLAY).catch(() => {});
      this.push();
    });
    wc.on("render-process-gone", (_e, d) => {
      this.log(`buddy: page process gone (${d.reason})`);
      this.destroy();
      this.o.onGone();
    });
    win.on("closed", () => {
      if (this.win === win) {
        this.win = null;
        this.o.onGone();
      }
    });
    win.on("hide", () => this.o.onGone());
    win.on("minimize", () => this.o.onGone());

    this.place(state.phase);
    try {
      await withTimeout(win.loadURL(buddyUrl(server, state)), LOAD_TIMEOUT_MS);
    } catch (err) {
      this.log(`buddy: couldn't load the page (${/** @type {any} */ (err)?.code ?? err})`);
      this.destroy();
      return false;
    }
    return true;
  }

  startHitTesting() {
    if (process.platform !== "linux" || this.hitTimer) return;
    let rectsAt = 0;
    this.hitTimer = setInterval(() => {
      const w = this.win;
      if (!w || w.isDestroyed() || !w.isVisible()) return;
      if (Date.now() - rectsAt > 400) {
        rectsAt = Date.now();
        this.refreshRects();
      }
      const b = w.getBounds();
      const c = screen.getCursorScreenPoint();
      const over = pointInRects({ x: c.x - b.x, y: c.y - b.y }, this.rects);
      if (over !== this.linuxOver) {
        this.linuxOver = over;
        w.setIgnoreMouseEvents(!over);
      }
    }, 60);
  }

  stopHitTesting() {
    if (this.hitTimer) clearInterval(this.hitTimer);
    this.hitTimer = null;
    this.linuxOver = undefined;
  }

  refreshRects() {
    const wc = this.webContents;
    if (!wc) return;
    wc.executeJavaScript(RECTS_JS)
      .then((rects) => {
        if (Array.isArray(rects)) this.rects = rects.map(([x, y, width, height]) => ({ x: x - 4, y: y - 4, width: width + 8, height: height + 8 }));
      })
      .catch(() => {});
  }
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "TIMEOUT" })), ms))]);
}
