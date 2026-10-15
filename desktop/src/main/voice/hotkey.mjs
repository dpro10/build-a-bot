/**
 * Listens for the voice typing shortcut anywhere on the computer and turns key presses into
 * "start", "stop", "cancel" and "handsfree" (hotkey-machine.mjs decides which).
 *
 * The keyboard hook (uiohook-napi) sees key presses system-wide, like any app with a global
 * shortcut. Only key codes are looked at, to match the shortcut and Esc; keys are never stored,
 * logged or sent anywhere. macOS asks for Accessibility before the hook can run.
 *
 * When the hook can't run (no Accessibility yet, Wayland, a missing library), ToggleHotkey uses an
 * ordinary global shortcut instead: press it to start, press it again to finish.
 */
import { EventEmitter } from "node:events";
import { hotkeyStep, initialHotkey, recording } from "./hotkey-machine.mjs";
import { KEY, MODIFIERS, inShortcut, shortcutDown } from "./keys.mjs";

/**
 * The part of uiohook-napi used here (a fake in tests).
 * @typedef {{ on(ev: 'keydown'|'keyup', cb: (e: { keycode: number, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }) => void): any, removeAllListeners(ev?: string): any, start(): void, stop(): void, keyTap(key: number, modifiers?: number[]): void }} HookLike
 */

const GROUPS = [
  { flag: "ctrlKey", keys: [KEY.Ctrl, KEY.CtrlRight] },
  { flag: "altKey", keys: [KEY.Alt, KEY.AltRight] },
  { flag: "metaKey", keys: [KEY.Meta, KEY.MetaRight] },
  { flag: "shiftKey", keys: [KEY.Shift, KEY.ShiftRight] },
];

export class Hotkey extends EventEmitter {
  /**
   * @param {object} o
   * @param {() => Promise<HookLike>} o.loadHook
   * @param {import('./keys.mjs').Shortcut} o.shortcut
   * @param {string} [o.platform]
   * @param {() => number} [o.now]
   * @param {Partial<import('./hotkey-machine.mjs').TIMING>} [o.timing]
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    super();
    this.o = o;
    this.platform = o.platform ?? process.platform;
    this.now = o.now ?? (() => Date.now());
    this.log = o.log ?? (() => {});
    this.shortcut = o.shortcut;
    this.state = initialHotkey();
    /** @type {Set<number>} */
    this.pressed = new Set();
    /** @type {HookLike | null} */
    this.hook = null;
    this.running = false;
    this.timer = null;
    /** Key taps this app sends (paste, the Start-menu guard) aren't the owner's. */
    this.synthetic = new Map();
    /** @type {null | { keys: Set<number>, held: Set<number>, resolve: (keys: number[] | null) => void, timer: any }} */
    this.recordingShortcut = null;
  }

  /**
   * Start listening. Resolves with ok, or why it couldn't (the code from the hook).
   * @returns {Promise<{ ok: true } | { ok: false, code: string, message: string }>}
   */
  async enable() {
    if (this.running) return { ok: true };
    try {
      this.hook ??= await this.o.loadHook();
      this.hook.on("keydown", (e) => this.onKey(e, true));
      this.hook.on("keyup", (e) => this.onKey(e, false));
      this.hook.start();
      this.running = true;
      return { ok: true };
    } catch (err) {
      const e = /** @type {any} */ (err) ?? {};
      this.hook?.removeAllListeners("keydown");
      this.hook?.removeAllListeners("keyup");
      this.log(`voice: keyboard hook unavailable (${e.code ?? e.message ?? err})`);
      return { ok: false, code: String(e.code ?? "UIOHOOK_FAILURE"), message: String(e.message ?? err) };
    }
  }

  disable() {
    if (!this.running || !this.hook) return;
    try {
      this.hook.stop();
    } catch (err) {
      this.log(`voice: stopping the keyboard hook failed (${/** @type {any} */ (err)?.code ?? err})`);
    }
    this.hook.removeAllListeners("keydown");
    this.hook.removeAllListeners("keyup");
    this.running = false;
    this.pressed.clear();
    this.reset();
  }

  /** @param {import('./keys.mjs').Shortcut} shortcut */
  setShortcut(shortcut) {
    this.shortcut = shortcut;
    this.reset();
  }

  reset() {
    clearTimeout(this.timer);
    this.timer = null;
    this.state = { ...initialHotkey(), down: shortcutDown(this.shortcut, this.pressed) };
    if (this.state.down) this.state.mode = "blocked";
  }

  isRecording() {
    return recording(this.state);
  }

  /** A hands-free recording started from a button (the pill's Reply): the next press finishes it. */
  startHandsfree() {
    clearTimeout(this.timer);
    this.timer = null;
    this.state = { mode: "handsfree", since: this.now(), deadline: null, down: shortcutDown(this.shortcut, this.pressed), latched: false };
  }

  /** The pill's Done button, or the longest dictation: stop as if the shortcut was pressed. */
  finish() {
    this.dispatch({ type: "finish", at: this.now() });
  }

  /** The app gave up on this dictation (no mic, an error). */
  abort() {
    this.dispatch({ type: "abort", at: this.now() });
  }

  /** Any modifier still held (a paste sent now would pick it up: ⌥⌘V instead of ⌘V). */
  modifiersHeld() {
    return [...this.pressed].some((k) => MODIFIERS.has(k));
  }

  /** Wait until no modifier is held, up to `maxMs`. */
  async waitForRelease(maxMs = 800) {
    const t0 = this.now();
    while (this.running && this.modifiersHeld() && this.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 15));
  }

  /** Mark a key this app is about to tap, so it isn't taken for the owner's. */
  expectSynthetic(code, ms = 250) {
    this.synthetic.set(code, this.now() + ms);
  }

  /**
   * The next keys the owner presses together (for a custom shortcut): resolves once they're all
   * let go, or with null after `timeoutMs` or Esc.
   * @returns {Promise<number[] | null>}
   */
  recordShortcut(timeoutMs = 10_000) {
    this.cancelRecordShortcut();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finishRecordShortcut(null), timeoutMs);
      this.recordingShortcut = { keys: new Set(), held: new Set(), resolve, timer };
    });
  }

  cancelRecordShortcut() {
    if (this.recordingShortcut) this.finishRecordShortcut(null);
  }

  finishRecordShortcut(keys) {
    const r = this.recordingShortcut;
    if (!r) return;
    clearTimeout(r.timer);
    this.recordingShortcut = null;
    r.resolve(keys);
  }

  /** @param {{ keycode: number, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }} e @param {boolean} isDown */
  onKey(e, isDown) {
    const code = e.keycode;
    if (!code) return;
    const until = this.synthetic.get(code);
    if (until !== undefined) {
      if (this.now() <= until) {
        if (!isDown) this.synthetic.delete(code);
        return;
      }
      this.synthetic.delete(code);
    }
    // A key let go while the hook wasn't looking (the screen locked mid-press) would stay "down":
    // the modifier flags on each press say what's really held.
    if (isDown) {
      for (const g of GROUPS) {
        if (/** @type {any} */ (e)[g.flag] === false && !g.keys.includes(code)) for (const k of g.keys) this.pressed.delete(k);
      }
    }

    if (this.recordingShortcut) {
      const r = this.recordingShortcut;
      if (isDown && code === KEY.Escape) return this.finishRecordShortcut(null);
      if (isDown) {
        r.keys.add(code);
        r.held.add(code);
      } else {
        r.held.delete(code);
        if (!r.held.size) this.finishRecordShortcut([...r.keys]);
      }
      return;
    }

    const at = this.now();
    if (isDown) {
      const repeat = this.pressed.has(code);
      const wasDown = shortcutDown(this.shortcut, this.pressed);
      this.pressed.add(code);
      if (repeat) return;
      if (inShortcut(this.shortcut, code)) {
        if (!wasDown && shortcutDown(this.shortcut, this.pressed)) this.dispatch({ type: "down", at });
        return;
      }
      if (code === KEY.Escape) this.dispatch({ type: "escape", at });
      else this.dispatch({ type: "other", at, modifier: MODIFIERS.has(code) });
    } else {
      const wasDown = shortcutDown(this.shortcut, this.pressed);
      this.pressed.delete(code);
      if (wasDown && !shortcutDown(this.shortcut, this.pressed)) this.dispatch({ type: "up", at });
    }
  }

  /** @param {import('./hotkey-machine.mjs').HotkeyEvent} ev */
  dispatch(ev) {
    const { state, effects } = hotkeyStep(this.state, ev, this.o.timing);
    this.state = state;
    clearTimeout(this.timer);
    this.timer = null;
    if (state.deadline !== null) {
      this.timer = setTimeout(() => this.dispatch({ type: "tick", at: this.now() }), Math.max(0, state.deadline - this.now()) + 5);
    }
    for (const fx of effects) this.emit(fx);
    // Windows opens the Start menu when the Windows key is let go with nothing pressed in between.
    // A tap of an unused key (F24) while it's down tells Windows it was part of a combination.
    if (ev.type === "down" && effects.length && this.platform === "win32" && [KEY.Meta, KEY.MetaRight].some((k) => this.pressed.has(k))) {
      this.expectSynthetic(KEY.F24);
      try {
        this.hook?.keyTap(KEY.F24);
      } catch {
        /* best effort */
      }
    }
  }
}

/**
 * When the keyboard hook can't run: an ordinary global shortcut (Electron's globalShortcut).
 * Press it to start, press it again to finish; Esc cancels while it listens.
 */
export class ToggleHotkey extends EventEmitter {
  /**
   * @param {{ globalShortcut: { register(acc: string, cb: () => void): boolean, unregister(acc: string): void, isRegistered?(acc: string): boolean }, accelerator?: string, log?: (m: string) => void }} o
   */
  constructor(o) {
    super();
    this.o = o;
    this.accelerator = o.accelerator ?? "CommandOrControl+Shift+Space";
    this.log = o.log ?? (() => {});
    this.running = false;
    this.listening = false;
  }

  async enable() {
    if (this.running) return { ok: true };
    const ok = this.o.globalShortcut.register(this.accelerator, () => this.toggle());
    if (!ok) return { ok: false, code: "SHORTCUT_TAKEN", message: `${this.accelerator} is used by another app.` };
    this.running = true;
    return { ok: true };
  }

  disable() {
    if (!this.running) return;
    this.o.globalShortcut.unregister(this.accelerator);
    this.unregisterEscape();
    this.running = false;
    this.listening = false;
  }

  toggle() {
    if (!this.listening) {
      this.listening = true;
      this.registerEscape();
      this.emit("start");
      this.emit("handsfree");
    } else {
      this.listening = false;
      this.unregisterEscape();
      this.emit("stop");
    }
  }

  registerEscape() {
    try {
      this.o.globalShortcut.register("Escape", () => {
        if (!this.listening) return;
        this.listening = false;
        this.unregisterEscape();
        this.emit("cancel");
      });
    } catch {
      /* Esc stays the app's own */
    }
  }

  unregisterEscape() {
    try {
      this.o.globalShortcut.unregister("Escape");
    } catch {
      /* not registered */
    }
  }

  isRecording() {
    return this.listening;
  }

  startHandsfree() {
    this.listening = true;
    this.registerEscape();
  }

  finish() {
    if (this.listening) this.toggle();
  }

  abort() {
    this.listening = false;
    this.unregisterEscape();
  }

  modifiersHeld() {
    return false;
  }

  async waitForRelease() {
    // A global shortcut fires on the press; give the fingers a moment to come off the keys.
    await new Promise((r) => setTimeout(r, 120));
  }

  expectSynthetic() {}

  setShortcut() {}

  recordShortcut() {
    return Promise.resolve(null);
  }

  cancelRecordShortcut() {}
}
