/**
 * Typing the words where the cursor is: put them on the clipboard, press paste for the owner
 * (⌘V, Ctrl+V; Ctrl+Shift+V in Linux terminals), then put back what was on the clipboard before,
 * unless they copied something new in the meantime. One paste at a time, in order.
 *
 * Pressing the keys needs the keyboard hook (macOS: Accessibility) or, on Linux, XTest; without
 * them the words stay on the clipboard and the pill says to paste.
 */
import { execFile } from "node:child_process";
import { KEY } from "./keys.mjs";

/**
 * Electron's clipboard (async and browser-like since Electron 44), as far as it's used here.
 * @typedef {{ read(): Promise<Array<{ types: string[], getType(type: string): Promise<any> }>>, readText(): Promise<string>, write(items: any[]): Promise<void>, writeText(text: string): Promise<void>, clear(): void }} ClipboardLike
 */

/**
 * What's on the clipboard, every format of it (text, HTML, images, the OS's own formats), read
 * out now: the items `read()` returns may read the clipboard lazily, after it has changed.
 * @param {ClipboardLike} cb
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function snapshotClipboard(cb) {
  try {
    const saved = [];
    for (const item of await cb.read()) {
      /** @type {Record<string, unknown>} */
      const data = {};
      for (const type of item.types) {
        try {
          data[type] = await item.getType(type);
        } catch {
          /* a format that can't be read back: skip it */
        }
      }
      if (Object.keys(data).length) saved.push(data);
    }
    return saved;
  } catch {
    return [];
  }
}

/**
 * Linux: press paste with XTest, like a real keyboard (the hook's own key taps are synthetic
 * events that many apps ignore). xdotool if it's there, else python3 talking to libXtst, which
 * every X11 desktop has (the keyboard hook needs it too).
 */
const XTEST_PASTE = [
  "import ctypes, sys",
  'x = ctypes.cdll.LoadLibrary("libX11.so.6"); t = ctypes.cdll.LoadLibrary("libXtst.so.6")',
  "x.XOpenDisplay.restype = ctypes.c_void_p",
  "x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]; x.XKeysymToKeycode.restype = ctypes.c_ubyte",
  "t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]",
  "x.XFlush.argtypes = [ctypes.c_void_p]; x.XCloseDisplay.argtypes = [ctypes.c_void_p]",
  "d = x.XOpenDisplay(None)",
  "if not d: sys.exit(2)",
  'keys = [0xffe3] + ([0xffe1] if "shift" in sys.argv else []) + [0x76]',
  "codes = [x.XKeysymToKeycode(d, k) for k in keys]",
  "for c in codes: t.XTestFakeKeyEvent(d, c, 1, 0)",
  "for c in reversed(codes): t.XTestFakeKeyEvent(d, c, 0, 0)",
  "x.XFlush(d); x.XCloseDisplay(d)",
].join("\n");

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 3000, windowsHide: true }, (err) => resolve(!err));
  });
}

/** @param {boolean} terminal */
export async function linuxPaste(terminal) {
  if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) return false;
  if (await run("xdotool", ["key", "--clearmodifiers", terminal ? "ctrl+shift+v" : "ctrl+v"])) return true;
  return run("python3", ["-c", XTEST_PASTE, ...(terminal ? ["shift"] : [])]);
}

/**
 * The key press that pastes, per platform.
 * @param {{ platform: string, hook: () => import('./hotkey.mjs').HookLike | null, expectSynthetic?: (code: number) => void }} o
 * @returns {(category: string) => Promise<boolean>}
 */
export function pressPaste(o) {
  return async (category) => {
    if (o.platform === "linux") return linuxPaste(category === "terminal");
    const hook = o.hook();
    if (!hook) return false;
    const mod = o.platform === "darwin" ? KEY.Meta : KEY.Ctrl;
    o.expectSynthetic?.(mod);
    o.expectSynthetic?.(KEY.V);
    try {
      hook.keyTap(KEY.V, [mod]);
      return true;
    } catch {
      return false;
    }
  };
}

export class Paster {
  /**
   * @param {object} o
   * @param {ClipboardLike} o.clipboard
   * @param {(data: Record<string, unknown>) => any} o.makeItem  Electron's ClipboardItem
   * @param {(category: string) => Promise<boolean>} o.press  presses paste; false when it can't
   * @param {() => boolean} o.canPress  pressing keys is allowed now (macOS: Accessibility)
   * @param {() => Promise<void>} [o.waitForRelease]  until the shortcut's keys are let go
   * @param {number} [o.restoreAfterMs]  how long the app gets to read the clipboard
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    this.o = o;
    this.log = o.log ?? (() => {});
    this.restoreAfterMs = o.restoreAfterMs ?? 450;
    /** @type {Promise<unknown>} */
    this.queue = Promise.resolve();
    /** @type {Promise<void> | null} the clipboard put back (tests wait on it) */
    this.restoring = null;
  }

  /**
   * Type `text` at the cursor.
   * @param {string} text
   * @param {{ category?: string, restore?: boolean }} [opts]
   * @returns {Promise<{ pasted: boolean, copied: boolean }>}
   */
  insert(text, opts = {}) {
    const job = this.queue.then(() => this.insertNow(text, opts));
    // The next paste waits until this one's clipboard is put back.
    this.queue = job.then(() => this.restoring).catch(() => {});
    return job;
  }

  /** Only put it on the clipboard (when pasting isn't possible, or the owner asked to copy). */
  copy(text) {
    return this.o.clipboard.writeText(text).catch(() => {});
  }

  async insertNow(text, { category = "other", restore = true } = {}) {
    const cb = this.o.clipboard;
    if (!this.o.canPress()) {
      await this.copy(text);
      return { pasted: false, copied: true };
    }
    const before = restore ? await snapshotClipboard(cb) : [];
    await cb.writeText(text);
    await this.o.waitForRelease?.();
    let pasted = false;
    try {
      pasted = await this.o.press(category);
    } catch (err) {
      this.log(`voice: paste failed (${/** @type {any} */ (err)?.message ?? err})`);
    }
    this.restoring = null;
    if (!pasted) return { pasted: false, copied: true };
    if (restore) {
      this.restoring = new Promise((resolve) => {
        setTimeout(async () => {
          try {
            // Put it back only if the clipboard still holds our words (they may have copied since).
            if ((await cb.readText()) === text) {
              if (before.length) await cb.write(before.map((d) => this.o.makeItem(d)));
              else cb.clear();
            }
          } catch (err) {
            this.log(`voice: couldn't put the clipboard back (${/** @type {any} */ (err)?.message ?? err})`);
          }
          resolve();
        }, this.restoreAfterMs);
      });
    }
    return { pasted: true, copied: !restore };
  }
}
