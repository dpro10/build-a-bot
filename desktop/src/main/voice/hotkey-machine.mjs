/**
 * The voice typing shortcut as a state machine: hold it and talk, let go to type; tap it twice
 * for hands-free (tap once more to finish); Esc cancels. Pure: events in (with their times),
 * effects out, so every timing is tested. hotkey.mjs feeds it real key events and calls "tick"
 * at `deadline`.
 *
 *   idle      ─down→ pressing   start (recording starts on the press: no first word is lost)
 *   pressing  ─up after holdMs→ idle        stop (type it)
 *             ─up sooner→ tapped            (maybe the first of two taps; still recording)
 *             ─a key while held→ blocked    cancel (it was a shortcut, like Ctrl+Win+D or ⌥E)
 *   tapped    ─down within doubleTapMs→ handsfree   handsfree
 *             ─deadline→ idle               cancel (a stray tap)
 *   handsfree ─down→ blocked                stop
 *   any       ─Esc→ blocked or idle         cancel
 *   blocked   ─up→ idle                     (waits for the keys to be let go)
 */

export const TIMING = Object.freeze({
  /** Shorter than this is a tap, not a hold. */
  holdMs: 250,
  /** The second tap must come this soon after the first is let go. */
  doubleTapMs: 400,
  /** A modifier pressed this soon after the shortcut means a key combination, not voice typing. */
  chordMs: 600,
});

/** @typedef {'idle'|'pressing'|'tapped'|'handsfree'|'blocked'} Mode */
/** @typedef {{ mode: Mode, since: number, deadline: number | null, down: boolean, latched: boolean }} HotkeyState */
/** @typedef {'start'|'stop'|'cancel'|'handsfree'} Effect */
/**
 * @typedef {{ type: 'down', at: number }
 *   | { type: 'up', at: number }
 *   | { type: 'other', at: number, modifier: boolean }
 *   | { type: 'escape', at: number }
 *   | { type: 'tick', at: number }
 *   | { type: 'finish', at: number }
 *   | { type: 'abort', at: number }} HotkeyEvent
 */

/** @returns {HotkeyState} */
export function initialHotkey() {
  return { mode: "idle", since: 0, deadline: null, down: false, latched: false };
}

/** Is a recording going on (started and not yet stopped or cancelled)? */
export function recording(s) {
  return s.mode === "pressing" || s.mode === "tapped" || s.mode === "handsfree";
}

/**
 * @param {HotkeyState} s
 * @param {HotkeyEvent} ev
 * @param {Partial<typeof TIMING>} [timing]
 * @returns {{ state: HotkeyState, effects: Effect[] }}
 */
export function hotkeyStep(s, ev, timing = {}) {
  const t = { ...TIMING, ...timing };
  const at = ev.at;
  /** @param {Partial<HotkeyState>} patch @param {Effect[]} effects */
  const go = (patch, effects = []) => ({ state: { ...s, deadline: null, ...patch }, effects });
  // After a cancel or a stop on a press, wait for the keys to be let go before anything new.
  const rest = (/** @type {Effect[]} */ effects) => go({ mode: s.down ? "blocked" : "idle", since: at, latched: false }, effects);

  switch (ev.type) {
    case "down": {
      if (s.down) return { state: s, effects: [] }; // key repeat
      const down = { ...s, down: true };
      if (s.mode === "idle") return { state: { ...down, mode: "pressing", since: at, deadline: at + t.holdMs, latched: false }, effects: ["start"] };
      if (s.mode === "tapped") return { state: { ...down, mode: "handsfree", since: at, deadline: null, latched: true }, effects: ["handsfree"] };
      if (s.mode === "handsfree") return { state: { ...down, mode: "blocked", since: at, deadline: null, latched: false }, effects: ["stop"] };
      return { state: down, effects: [] };
    }
    case "up": {
      if (!s.down) return { state: s, effects: [] };
      const up = { ...s, down: false };
      if (s.mode === "pressing") {
        if (at - s.since >= t.holdMs) return { state: { ...up, mode: "idle", since: at, deadline: null }, effects: ["stop"] };
        return { state: { ...up, mode: "tapped", since: at, deadline: at + t.doubleTapMs }, effects: [] };
      }
      if (s.mode === "handsfree") return { state: { ...up, latched: false }, effects: [] };
      if (s.mode === "blocked") return { state: { ...up, mode: "idle", since: at, deadline: null }, effects: [] };
      return { state: up, effects: [] };
    }
    case "other": {
      if (s.mode === "pressing" && (!ev.modifier || at - s.since < t.chordMs)) return rest(["cancel"]);
      if (s.mode === "tapped") return rest(["cancel"]);
      // Hands-free: typing a little while it listens is fine.
      return { state: s, effects: [] };
    }
    case "escape":
      return recording(s) ? rest(["cancel"]) : { state: s, effects: [] };
    case "tick": {
      if (s.deadline === null || at < s.deadline) return { state: s, effects: [] };
      if (s.mode === "tapped") return go({ mode: "idle", since: at }, ["cancel"]);
      // pressing: the hold is long enough now; nothing to do until it's let go.
      return go({});
    }
    case "finish":
      // The pill's Done button, or the longest dictation reached.
      return recording(s) ? rest(["stop"]) : { state: s, effects: [] };
    case "abort":
      // The app gave up (no mic, an error): no effects, just stop expecting anything.
      return recording(s) ? rest([]) : { state: s, effects: [] };
    default:
      return { state: s, effects: [] };
  }
}
