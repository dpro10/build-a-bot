/**
 * Voice typing's shortcut: which keys to hold, per platform, in uiohook's key codes (libuiohook's
 * VC_ codes, the same on every OS). Pure data and helpers, no native code, so it can be tested.
 *
 * A shortcut is a list of slots; each slot is the key codes that count for it (left or right
 * Ctrl). It's down when every slot has a key down, and up as soon as one slot has none.
 */

export const KEY = Object.freeze({
  Escape: 1,
  Backspace: 14,
  Tab: 15,
  Enter: 28,
  Space: 57,
  CapsLock: 58,
  V: 47,
  C: 46,
  Ctrl: 29,
  CtrlRight: 3613,
  Shift: 42,
  ShiftRight: 54,
  Alt: 56,
  AltRight: 3640,
  Meta: 3675,
  MetaRight: 3676,
  F13: 91,
  F14: 92,
  F15: 93,
  F16: 99,
  F17: 100,
  F18: 101,
  F19: 102,
  F20: 103,
  F21: 104,
  F22: 105,
  F23: 106,
  F24: 107,
});

export const MODIFIERS = new Set([KEY.Ctrl, KEY.CtrlRight, KEY.Shift, KEY.ShiftRight, KEY.Alt, KEY.AltRight, KEY.Meta, KEY.MetaRight]);

const CTRL = [KEY.Ctrl, KEY.CtrlRight];
const META = [KEY.Meta, KEY.MetaRight];
const ALT = [KEY.Alt, KEY.AltRight];

/**
 * @typedef {{ id: string, label: string, slots: number[][], hint?: string }} Shortcut
 * Ready-made shortcuts. The first is the default on that platform. Keys that do nothing on their
 * own, so holding them never types or opens anything: Right Option on a Mac (Fn can't be seen by
 * apps), Ctrl + Windows on Windows (what most dictation apps use), Right Ctrl on Linux.
 */
export const PRESETS = Object.freeze({
  darwin: [
    { id: "alt-right", label: "Right Option (⌥)", slots: [[KEY.AltRight]] },
    { id: "meta-right", label: "Right Command (⌘)", slots: [[KEY.MetaRight]] },
    { id: "ctrl-alt", label: "Control + Option (⌃⌥)", slots: [CTRL, ALT] },
    { id: "ctrl-right", label: "Right Control (⌃)", slots: [[KEY.CtrlRight]], hint: "Only on keyboards that have one." },
  ],
  win32: [
    { id: "ctrl-meta", label: "Ctrl + Windows", slots: [CTRL, META] },
    { id: "ctrl-right", label: "Right Ctrl", slots: [[KEY.CtrlRight]] },
    { id: "ctrl-alt", label: "Ctrl + Alt", slots: [CTRL, ALT] },
    { id: "alt-right", label: "Right Alt", slots: [[KEY.AltRight]], hint: "Not on keyboards where Right Alt types accents (AltGr)." },
  ],
  linux: [
    { id: "ctrl-right", label: "Right Ctrl", slots: [[KEY.CtrlRight]] },
    { id: "ctrl-meta", label: "Ctrl + Super", slots: [CTRL, META] },
    { id: "ctrl-alt", label: "Ctrl + Alt", slots: [CTRL, ALT] },
    { id: "alt-right", label: "Right Alt", slots: [[KEY.AltRight]], hint: "Not on keyboards where Right Alt types accents (AltGr)." },
  ],
});

/** @param {string} platform @returns {Shortcut[]} */
export function presetsFor(platform) {
  return PRESETS[/** @type {keyof typeof PRESETS} */ (platform)] ?? PRESETS.linux;
}

/** @param {string} platform */
export function defaultShortcut(platform) {
  return presetsFor(platform)[0];
}

/** Key names people know, per platform. */
export function keyName(code, platform = process.platform) {
  const mac = platform === "darwin";
  const names = {
    [KEY.Ctrl]: mac ? "Left Control" : "Left Ctrl",
    [KEY.CtrlRight]: mac ? "Right Control" : "Right Ctrl",
    [KEY.Shift]: "Left Shift",
    [KEY.ShiftRight]: "Right Shift",
    [KEY.Alt]: mac ? "Left Option" : "Left Alt",
    [KEY.AltRight]: mac ? "Right Option" : "Right Alt",
    [KEY.Meta]: mac ? "Left Command" : platform === "win32" ? "Windows" : "Super",
    [KEY.MetaRight]: mac ? "Right Command" : platform === "win32" ? "Windows" : "Super",
    [KEY.Escape]: "Esc",
    [KEY.Space]: "Space",
    [KEY.CapsLock]: "Caps Lock",
    [KEY.Tab]: "Tab",
  };
  if (names[code]) return names[code];
  const f = Object.entries(KEY).find(([, v]) => v === code);
  return f ? f[0] : `Key ${code}`;
}

/**
 * The shortcut the owner chose: a preset id, or keys they pressed ("custom"), else the default.
 * @param {{ shortcut?: string | null, customKeys?: number[] | null }} voice
 * @param {string} platform
 * @returns {Shortcut}
 */
export function resolveShortcut(voice, platform) {
  if (voice?.shortcut === "custom" && Array.isArray(voice.customKeys) && checkCustom(voice.customKeys) === null) {
    return { id: "custom", label: voice.customKeys.map((k) => keyName(k, platform)).join(" + "), slots: voice.customKeys.map((k) => [k]) };
  }
  return presetsFor(platform).find((p) => p.id === voice?.shortcut) ?? defaultShortcut(platform);
}

/**
 * Keys pressed as a new shortcut: fine (null), or why not. Holding it must not type anything, so
 * it needs a modifier or an F13–F24 key, and no more than three keys.
 * @param {number[]} keys
 */
export function checkCustom(keys) {
  if (!Array.isArray(keys) || !keys.length) return "Press the keys you want to hold.";
  if (keys.length > 3) return "Use up to three keys.";
  if (keys.includes(KEY.Escape)) return "Esc cancels voice typing, so it can't be part of the shortcut.";
  const safe = keys.every((k) => MODIFIERS.has(k) || (k >= KEY.F13 && k <= KEY.F24));
  if (!safe) return "Use keys that don't type anything, like Option, Ctrl, Command or F13 to F24. Holding a letter or Space would type it.";
  if (keys.length === 1 && [KEY.Shift, KEY.ShiftRight].includes(keys[0])) return "Shift on its own is used for typing capitals. Pick another key, or add one.";
  return null;
}

/** Is this key part of the shortcut? */
export function inShortcut(shortcut, code) {
  return shortcut.slots.some((slot) => slot.includes(code));
}

/** Is the whole shortcut held, given the keys that are down? */
export function shortcutDown(shortcut, pressed) {
  return shortcut.slots.every((slot) => slot.some((k) => pressed.has(k)));
}
