/**
 * Where voice typing's pill goes and when it takes clicks. Pure, so it's tested (pill-window.mjs
 * uses it with the real screen).
 */

/** Space under the pill, above the Dock or taskbar. */
const MARGIN = 14;
/** The pill phases that have buttons. */
const INTERACTIVE = new Set(["error", "reply", "asking"]);

/** Does the pill have buttons right now (so it takes clicks)? */
export function pillInteractive(state) {
  if (!state) return false;
  return INTERACTIVE.has(state.phase) || (state.phase === "listening" && Boolean(state.handsfree)) || (Array.isArray(state.actions) && state.actions.length > 0);
}

/**
 * Where the pill goes: bottom center of `workArea`, `lift` above the bottom (the meeting bot).
 * @param {{ x: number, y: number, width: number, height: number }} workArea
 * @param {{ width: number, height: number }} size
 * @param {number} [lift]
 */
export function pillBounds(workArea, size, lift = 0) {
  const width = Math.min(Math.max(1, Math.round(size.width)), workArea.width);
  const height = Math.min(Math.max(1, Math.round(size.height)), workArea.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - MARGIN - Math.max(0, Math.round(lift)),
    width,
    height,
  };
}
