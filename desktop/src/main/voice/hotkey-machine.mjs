/**
 * The voice typing shortcut as a state machine: hold it and talk, let go to type; tap it twice
 * for hands-free (tap once more to finish); Esc cancels. Pure: events in (with their times),
 * effects out, so every timing is tested. hotkey.mjs feeds it real key events and calls "tick"
 * at `deadline`; an event that comes after a deadline the tick missed handles that deadline first.
 *
 * The mic opens only once the hold is confirmed: the shortcut held for `confirmMs` with no other
 * key. A key combination that starts with the shortcut's keys (⌥ + a letter typing an accented
 * character, Ctrl + Windows + → switching desktops) is left to the app: no mic, no chime, no pill.
 *
 *   idle      ─down→ pressing (not live)
 *   pressing  ─confirmMs, no other key→ pressing (live)   start
 *     (not live) ─another key or Esc→ blocked             (nothing was started: nothing to cancel)
 *                ─up→ tapped (not live)                   (maybe the first of two taps)
 *     (live)  ─up after holdMs→ idle                      stop (type it)
 *             ─up sooner→ tapped (live)                   (maybe the first of two taps; still recording)
 *             ─a key while held→ blocked                  cancel (a combination after all)
 *   tapped    ─down within doubleTapMs→ handsfree         handsfree (start first, if not live yet)
 *             ─deadline→ idle                             cancel, if live (a stray tap)
 *   handsfree ─down→ blocked                              stop
 *   any       ─Esc→ blocked or idle                       cancel, if live
 *   blocked   ─up→ idle                                   (waits for the keys to be let go)
 */

export const TIMING = Object.freeze({
  /** The shortcut held this long with no other key is voice typing: the mic opens then, not on the press. */
  confirmMs: 200,
  /** Shorter than this is a tap, not a hold. */
  holdMs: 250,
  /** The second tap must come this soon after the first is let go. */
  doubleTapMs: 400,
  /** A modifier pressed this soon after the shortcut means a key combination, not voice typing. */
  chordMs: 600,
});

/** @typedef {'idle'|'pressing'|'tapped'|'handsfree'|'blocked'} Mode */
/** @typedef {{ mode: Mode, since: number, deadline: number | null, down: boolean, latched: boolean, live: boolean }} HotkeyState */
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
  return { mode: "idle", since: 0, deadline: null, down: false, latched: false, live: false };
}

/** Is a recording going on (started and not yet stopped or cancelled)? */
export function recording(s) {
  return s.live && (s.mode === "pressing" || s.mode === "tapped" || s.mode === "handsfree");
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
  // A deadline the tick missed (a busy moment): it's handled first, as it would have been.
  if (ev.type !== "tick" && s.deadline !== null && at >= s.deadline) {
    const first = hotkeyStep(s, { type: "tick", at }, timing);
    const then = hotkeyStep(first.state, ev, timing);
    return { state: then.state, effects: [...first.effects, ...then.effects] };
  }
  /** @param {Partial<HotkeyState>} patch @param {Effect[]} effects */
  const go = (patch, effects = []) => ({ state: { ...s, deadline: null, ...patch }, effects });
  // After a cancel or a stop on a press, wait for the keys to be let go before anything new.
  const rest = (/** @type {Effect[]} */ effects) => go({ mode: s.down ? "blocked" : "idle", since: at, latched: false, live: false }, effects);
  /** @type {Effect[]} */
  const cancelIfLive = s.live ? ["cancel"] : [];

  switch (ev.type) {
    case "down": {
      if (s.down) return { state: s, effects: [] }; // key repeat
      const down = { ...s, down: true };
      // Not yet: the mic opens once it's held a moment with no other key.
      if (s.mode === "idle") return { state: { ...down, mode: "pressing", since: at, deadline: at + t.confirmMs, latched: false, live: false }, effects: [] };
      if (s.mode === "tapped") return { state: { ...down, mode: "handsfree", since: at, deadline: null, latched: true, live: true }, effects: s.live ? ["handsfree"] : ["start", "handsfree"] };
      if (s.mode === "handsfree") return { state: { ...down, mode: "blocked", since: at, deadline: null, latched: false, live: false }, effects: ["stop"] };
      return { state: down, effects: [] };
    }
    case "up": {
      if (!s.down) return { state: s, effects: [] };
      const up = { ...s, down: false };
      if (s.mode === "pressing") {
        if (s.live && at - s.since >= t.holdMs) return { state: { ...up, mode: "idle", since: at, deadline: null, live: false }, effects: ["stop"] };
        return { state: { ...up, mode: "tapped", since: at, deadline: at + t.doubleTapMs }, effects: [] };
      }
      if (s.mode === "handsfree") return { state: { ...up, latched: false }, effects: [] };
      if (s.mode === "blocked") return { state: { ...up, mode: "idle", since: at, deadline: null }, effects: [] };
      return { state: up, effects: [] };
    }
    case "other": {
      // Before it's confirmed, any key makes it a key combination: left to the app, silently.
      if (s.mode === "pressing" && !s.live) return rest([]);
      if (s.mode === "pressing" && (!ev.modifier || at - s.since < t.chordMs)) return rest(["cancel"]);
      if (s.mode === "tapped") return rest(cancelIfLive);
      // Hands-free: typing a little while it listens is fine.
      return { state: s, effects: [] };
    }
    case "escape":
      return s.mode === "pressing" || s.mode === "tapped" || s.mode === "handsfree" ? rest(cancelIfLive) : { state: s, effects: [] };
    case "tick": {
      if (s.deadline === null || at < s.deadline) return { state: s, effects: [] };
      // Held a moment with no other key: it's voice typing. The mic opens now.
      if (s.mode === "pressing" && !s.live) return go({ live: true }, ["start"]);
      if (s.mode === "tapped") return go({ mode: "idle", since: at, live: false }, cancelIfLive);
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
