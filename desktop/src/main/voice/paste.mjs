/**
 * Typing the words where the cursor is: put them on the clipboard, press paste for the owner
 * (⌘V, Ctrl+V; Ctrl+Shift+V in Linux terminals), then put back what was on the clipboard before,
 * unless they copied something new in the meantime. One paste at a time, in order.
 *
 * Editing by voice reads the selection the same way: a marker on the clipboard, press copy, see
 * what replaced the marker, then put the clipboard back. Never in a terminal, where Ctrl+C stops
 * the program that's running.
 *
 * Pressing the keys needs the keyboard hook (macOS: Accessibility) or, on Linux, XTest; without
 * them the words stay on the clipboard and the pill says to paste.
 *
 * A dictation is spaced against what's next to the cursor (spacing.mjs), so it doesn't run into
 * the words already there: right before pasting, the few characters around the cursor are read
 * from the box (`around`), or, when that can't be done in a moment, the last dictation stands in
 * for them if it went to the same app shortly before.
 */
import { execFile } from "node:child_process";
import { KEY } from "./keys.mjs";
import { spaceOut } from "./spacing.mjs";

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
 * Formats that mark what's on the clipboard as passing through: the words are put there only to be
 * pasted, and the clipboard is put back a moment later. Windows leaves it out of its clipboard
 * history (Win+V) and doesn't sync it to the owner's other devices; clipboard managers on a Mac
 * skip it (nspasteboard.org's transient type; Universal Clipboard isn't told, Electron can't);
 * KDE's Klipper skips it on Linux. Raw formats through Electron's clipboard, next to the text. Not
 * ExcludeClipboardContentFromMonitorProcessing on Windows: remote desktop clients are clipboard
 * monitors too, and the words have to reach them.
 * @param {string} platform
 * @returns {Record<string, Blob> | null}
 */
export function passingTypes(platform) {
  const raw = (name) => `electron application/osclipboard;format="${name}"`;
  /** A DWORD 0: "no". */
  const no = () => new Blob([new Uint8Array(4)]);
  if (platform === "win32") return { [raw("CanIncludeInClipboardHistory")]: no(), [raw("CanUploadToCloudClipboard")]: no() };
  if (platform === "darwin") return { [raw("org.nspasteboard.TransientType")]: new Blob([]) };
  if (platform === "linux") return { [raw("x-kde-passwordManagerHint")]: new Blob(["secret"]) };
  return null;
}

/**
 * Linux: press Ctrl+V or Ctrl+C with XTest, like a real keyboard (the hook's own key taps are
 * synthetic events that many apps ignore). xdotool if it's there, else python3 talking to libXtst,
 * which every X11 desktop has (the keyboard hook needs it too).
 */
const XTEST_KEYS = [
  "import ctypes, sys",
  'x = ctypes.cdll.LoadLibrary("libX11.so.6"); t = ctypes.cdll.LoadLibrary("libXtst.so.6")',
  "x.XOpenDisplay.restype = ctypes.c_void_p",
  "x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]; x.XKeysymToKeycode.restype = ctypes.c_ubyte",
  "t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]",
  "x.XFlush.argtypes = [ctypes.c_void_p]; x.XCloseDisplay.argtypes = [ctypes.c_void_p]",
  "d = x.XOpenDisplay(None)",
  "if not d: sys.exit(2)",
  'keys = [0xffe3] + ([0xffe1] if "shift" in sys.argv[2:] else []) + [{"v": 0x76, "c": 0x63}[sys.argv[1]]]',
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

/** @param {'v'|'c'} key @param {boolean} shift */
async function linuxKeys(key, shift) {
  if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) return false;
  if (await run("xdotool", ["key", "--clearmodifiers", `ctrl+${shift ? "shift+" : ""}${key}`])) return true;
  return run("python3", ["-c", XTEST_KEYS, key, ...(shift ? ["shift"] : [])]);
}

/** @param {boolean} terminal */
export function linuxPaste(terminal) {
  return linuxKeys("v", terminal);
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

/**
 * The key press that copies the selection, per platform. Never in a terminal: Ctrl+C there stops
 * the program that's running.
 * @param {{ platform: string, hook: () => import('./hotkey.mjs').HookLike | null, expectSynthetic?: (code: number) => void }} o
 * @returns {(category: string) => Promise<boolean>}
 */
export function pressCopy(o) {
  return async (category) => {
    if (category === "terminal") return false;
    if (o.platform === "linux") return linuxKeys("c", false);
    const hook = o.hook();
    if (!hook) return false;
    const mod = o.platform === "darwin" ? KEY.Meta : KEY.Ctrl;
    o.expectSynthetic?.(mod);
    o.expectSynthetic?.(KEY.C);
    try {
      hook.keyTap(KEY.C, [mod]);
      return true;
    } catch {
      return false;
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How often a box that doesn't show the last paste yet is read again. */
const REREAD_MS = 80;

/**
 * The box shows `typed` right before the cursor (`before`: a few characters there): the last
 * few characters of each, spaces at the end and zero-width ones aside.
 */
function showsEnd(before, typed) {
  const trim = (s) => String(s ?? "").replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "").replace(/\s+$/u, "");
  const want = Array.from(trim(typed)).slice(-3).join("");
  return trim(before).endsWith(want);
}

/** `p`'s answer, or null if it takes longer than `ms`. */
function within(p, ms) {
  let timer;
  return Promise.race([p.catch(() => null), new Promise((r) => (timer = setTimeout(() => r(null), ms)))]).finally(() => clearTimeout(timer));
}

export class Paster {
  /**
   * @param {object} o
   * @param {ClipboardLike} o.clipboard
   * @param {(data: Record<string, unknown>) => any} o.makeItem  Electron's ClipboardItem
   * @param {(category: string) => Promise<boolean>} o.press  presses paste; false when it can't
   * @param {(category: string) => Promise<boolean>} [o.pressCopy]  presses copy; false when it can't
   * @param {() => boolean} o.canPress  pressing keys is allowed now (macOS: Accessibility)
   * @param {() => Promise<void>} [o.waitForRelease]  until the shortcut's keys are let go
   * @param {() => Record<string, unknown> | null} [o.passing]  formats that mark words put on the
   *   clipboard only to paste them as passing through (passingTypes), or null
   * @param {number} [o.restoreAfterMs]  how long the app gets to read the clipboard
   * @param {number} [o.remoteRestoreMs]  …when it's a remote desktop, which reads it over the network
   * @param {number} [o.copyWaitMs]  how long an app gets to put its selection on the clipboard
   * @param {() => Promise<{ before: string, after: string } | null>} [o.around]  what's right
   *   before and after the cursor in the box in front (null when it can't be read)
   * @param {number} [o.aroundMs]  how long reading it may take before the words go in anyway
   * @param {number} [o.settleMs]  how long after a paste the box is read (it shows the paste by then)
   * @param {number} [o.catchUpMs]  how long after a paste the box may not show it yet (a box that
   *   doesn't is read again until it does, for that long)
   * @param {number} [o.lastMs]  how long the last dictation stands in for a box that can't be read
   * @param {() => number} [o.enterAt]  when Enter was last pressed (0: not known): after it, the
   *   cursor is at the start of a line, not after the last dictation
   * @param {() => number} [o.now]
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    this.o = o;
    this.log = o.log ?? (() => {});
    this.now = o.now ?? (() => Date.now());
    this.restoreAfterMs = o.restoreAfterMs ?? 450;
    this.remoteRestoreMs = o.remoteRestoreMs ?? 2500;
    this.copyWaitMs = o.copyWaitMs ?? 600;
    this.aroundMs = o.aroundMs ?? 600;
    this.settleMs = o.settleMs ?? 250;
    this.catchUpMs = o.catchUpMs ?? 1500;
    this.lastMs = o.lastMs ?? 60_000;
    /** @type {Promise<unknown>} */
    this.queue = Promise.resolve();
    /** @type {Promise<void> | null} the clipboard put back (tests wait on it) */
    this.restoring = null;
    /** When paste was last pressed. */
    this.pressedAt = 0;
    /** The last dictation typed (with its spacing), and the app it went to. @type {{ text: string, app: string, at: number } | null} */
    this.lastTyped = null;
    /** Marking the clipboard as passing through failed once (said once in the log). */
    this.passingFailed = false;
  }

  /**
   * Type `text` at the cursor.
   * @param {string} text
   * @param {{ category?: string, restore?: boolean, space?: boolean, app?: string | null, remote?: boolean }} [opts]
   *   `space`: a dictation, spaced against what's next to the cursor; `app`: the app in front;
   *   `remote`: it's a remote desktop (or a virtual machine), which gets the clipboard over the network
   * @returns {Promise<{ pasted: boolean, copied: boolean }>}
   */
  insert(text, opts = {}) {
    const job = this.queue.then(() => this.insertNow(text, opts));
    // The next paste waits until this one's clipboard is put back.
    this.queue = job.then(() => this.restoring).catch(() => {});
    return job;
  }

  /**
   * The text selected in the app in front, or null: nothing selected, a terminal, or keys can't be
   * pressed. The clipboard is put back as it was either way. In line with pastes.
   * @param {string} [category]
   * @returns {Promise<string | null>}
   */
  copySelection(category = "other") {
    const job = this.queue.then(() => this.copySelectionNow(category));
    this.queue = job.catch(() => {});
    return job;
  }

  async copySelectionNow(category) {
    if (category === "terminal" || !this.o.pressCopy || !this.o.canPress()) return null;
    const cb = this.o.clipboard;
    const before = await snapshotClipboard(cb);
    // Whatever replaces the marker is the selection; the marker still there means nothing was copied.
    const marker = `\u2063bab-${Math.random().toString(36).slice(2)}`;
    let text = null;
    try {
      await this.writePassing(marker);
      await this.o.waitForRelease?.();
      if (await this.o.pressCopy(category)) {
        const until = Date.now() + this.copyWaitMs;
        for (;;) {
          const now = await cb.readText().catch(() => marker);
          if (now !== marker) {
            text = now;
            break;
          }
          if (Date.now() >= until) break;
          await sleep(20);
        }
      }
    } catch (err) {
      this.log(`voice: couldn't read the selection (${/** @type {any} */ (err)?.message ?? err})`);
    } finally {
      try {
        if (before.length) await cb.write(before.map((d) => this.o.makeItem(d)));
        else cb.clear();
      } catch (err) {
        this.log(`voice: couldn't put the clipboard back (${/** @type {any} */ (err)?.message ?? err})`);
      }
    }
    if (!text || !text.trim()) return null;
    // Code editors copy the whole line when nothing is selected: that's not a selection.
    if (category === "code" && /^[^\n]*\n$/.test(text)) return null;
    return text;
  }

  /** Only put it on the clipboard (when pasting isn't possible, or the owner asked to copy). */
  copy(text) {
    return this.o.clipboard.writeText(text).catch(() => {});
  }

  /**
   * Put `text` on the clipboard only to paste it, marked as passing through where the system has a
   * way to say so (passingTypes), so clipboard history leaves it out. If that can't be written, or
   * doesn't read back as the text, the text goes on as plain text, as before.
   * @param {string} text
   */
  async writePassing(text) {
    const cb = this.o.clipboard;
    let marks = null;
    try {
      marks = this.o.passing?.() ?? null;
    } catch {
      marks = null;
    }
    if (marks && Object.keys(marks).length) {
      try {
        await cb.write([this.o.makeItem({ "text/plain": text, ...marks })]);
        if ((await cb.readText()) === text) return;
      } catch (err) {
        if (!this.passingFailed) this.log(`voice: couldn't mark the clipboard as passing through (${/** @type {any} */ (err)?.message ?? err}); plain text instead`);
        this.passingFailed = true;
      }
    }
    await cb.writeText(text);
  }

  /**
   * The words spaced against what's next to the cursor (spacing.mjs): read from the box, else
   * (it can't be read, or not in a moment) the last dictation's end, if it went to this app
   * shortly before. In a terminal the box's caret isn't the shell's: only the last dictation
   * counts there. Logs what it did, never the words.
   * @param {string} text @param {string} category @param {string | null} app
   */
  async spaced(text, category, app) {
    let around = null;
    let from = "";
    const last = this.lastTyped;
    if (this.o.around && category !== "terminal") {
      // The last paste has had a moment to show in the box.
      const wait = this.pressedAt + this.settleMs - this.now();
      if (wait > 0) await sleep(wait);
      const read = this.o.around;
      const readNow = (ms) => within(Promise.resolve().then(() => read()), ms);
      around = await readNow(this.aroundMs);
      // Said back to back, a dictation goes in right after the last one, and a slow app may not
      // show that one yet: the box is read again until it does, for a moment after that paste
      // (then it's what the box says: the owner may have moved the cursor).
      if (around && last && app && last.app === app) {
        const until = Date.now() + (last.at + this.catchUpMs - this.now());
        while (!showsEnd(around.before, last.text) && Date.now() + REREAD_MS < until) {
          await sleep(REREAD_MS);
          const got = await readNow(Math.max(1, Math.min(this.aroundMs, until - Date.now())));
          if (!got) break;
          around = got;
        }
      }
      if (around) from = "the box";
    }
    if (!around && last && app && last.app === app && this.now() - last.at < this.lastMs) {
      // Enter since then (a command run in a terminal, a message sent, a new line): the words start
      // a line, with no space before them (a shell leaves a command that starts with one out of its history).
      const newLine = (Number(this.o.enterAt?.()) || 0) > last.at;
      around = { before: newLine ? "\n" : last.text.slice(-4), after: "" };
      from = newLine ? "a new line" : "the last dictation";
    }
    const out = spaceOut(text, around);
    if (out.before || out.after) this.log(`voice: spaced it (${[out.before ? "before" : "", out.after ? "after" : ""].filter(Boolean).join(" and ")}; from ${from})`);
    return out.text;
  }

  async insertNow(text, { category = "other", restore = true, space = false, app = null, remote = false } = {}) {
    const cb = this.o.clipboard;
    if (!this.o.canPress()) {
      this.lastTyped = null;
      await this.copy(text);
      return { pasted: false, copied: true };
    }
    const typed = space ? await this.spaced(text, category, app) : text;
    const before = restore ? await snapshotClipboard(cb) : [];
    // There only to be pasted, then put back: passing through (not in clipboard history). Not for a
    // remote desktop, whose client might skip it; nor when it stays (the owner turned restoring off).
    if (restore && !remote) await this.writePassing(typed);
    else await cb.writeText(typed);
    await this.o.waitForRelease?.();
    let pasted = false;
    try {
      pasted = await this.o.press(category);
    } catch (err) {
      this.log(`voice: paste failed (${/** @type {any} */ (err)?.message ?? err})`);
    }
    this.restoring = null;
    // What went in last, for the next dictation when its box can't be read (anything else pasted: unknown).
    this.lastTyped = pasted && space && app ? { text: typed, app, at: this.now() } : null;
    if (!pasted) return { pasted: false, copied: true };
    this.pressedAt = this.now();
    if (restore) {
      this.restoring = new Promise((resolve) => {
        setTimeout(async () => {
          try {
            // Put it back only if the clipboard still holds our words (they may have copied since).
            if ((await cb.readText()) === typed) {
              if (before.length) await cb.write(before.map((d) => this.o.makeItem(d)));
              else cb.clear();
            }
          } catch (err) {
            this.log(`voice: couldn't put the clipboard back (${/** @type {any} */ (err)?.message ?? err})`);
          }
          resolve();
          // A remote desktop's client fetches the clipboard over the network after the paste key reaches it.
        }, remote ? this.remoteRestoreMs : this.restoreAfterMs);
      });
    }
    return { pasted: true, copied: !restore };
  }
}
