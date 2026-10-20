/**
 * Where the buddy window goes: bottom-center of the work area (the part of the
 * screen the Dock, menu bar and taskbar leave free) of the display the call is on,
 * or the primary display. Pure math, so it can be tested without a screen.
 */

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/** @typedef {{ id: number, bounds: Rect, workArea: Rect }} DisplayLike */

/**
 * Window sizes per buddy phase (from the web app's desktop-api.ts contract). The pill with
 * Pause, Hide, Stop and "Stop and delete" grows to the right of the centered bot, so the
 * listening/paused windows are 840 wide. The extra area is transparent and lets clicks through.
 */
export const BUDDY_SIZES = Object.freeze({
  asking: Object.freeze({ width: 440, height: 330 }),
  listening: Object.freeze({ width: 840, height: 200 }),
  paused: Object.freeze({ width: 840, height: 200 }),
  saving: Object.freeze({ width: 420, height: 230 }),
  done: Object.freeze({ width: 420, height: 230 }),
  error: Object.freeze({ width: 420, height: 230 }),
});

/** @param {string} phase */
export function sizeFor(phase) {
  return BUDDY_SIZES[/** @type {keyof typeof BUDDY_SIZES} */ (phase)] ?? BUDDY_SIZES.listening;
}

/**
 * Bottom-center of `workArea`, never outside it. `offsetX` lets the owner slide the
 * bot along the bottom; it snaps back inside the work area.
 * @param {Rect} workArea
 * @param {{ width: number, height: number }} size
 * @param {{ offsetX?: number }} [opts]
 * @returns {Rect}
 */
export function buddyBounds(workArea, size, opts = {}) {
  const width = Math.min(Math.round(size.width), Math.max(1, Math.floor(workArea.width)));
  const height = Math.min(Math.round(size.height), Math.max(1, Math.floor(workArea.height)));
  const centered = workArea.x + Math.round((workArea.width - width) / 2) + Math.round(opts.offsetX ?? 0);
  const x = clamp(centered, workArea.x, workArea.x + workArea.width - width);
  const y = workArea.y + workArea.height - height;
  return { x, y, width, height };
}

/**
 * The display a call is on: the one its window overlaps most, else the primary.
 * @param {DisplayLike[]} displays
 * @param {DisplayLike} primary
 * @param {Rect | null | undefined} callBounds
 */
export function pickDisplay(displays, primary, callBounds) {
  if (!callBounds || !displays.length) return primary;
  let best = primary;
  let bestArea = 0;
  for (const d of displays) {
    const a = overlapArea(d.bounds, callBounds);
    if (a > bestArea) {
      best = d;
      bestArea = a;
    }
  }
  return best;
}

/**
 * Is enough of the window on some display for the owner to see the bot?
 * (The bot sits in the bottom-center of the window, so check that part.)
 * @param {Rect} win
 * @param {DisplayLike[]} displays
 */
export function isOnScreen(win, displays) {
  const bot = { x: win.x + win.width / 2 - 40, y: win.y + win.height - 80, width: 80, height: 80 };
  return displays.some((d) => overlapArea(d.bounds, bot) >= bot.width * bot.height * 0.5);
}

/** @param {Rect} a @param {Rect} b */
export function overlapArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** @param {{ x: number, y: number }} p @param {Rect[]} rects */
export function pointInRects(p, rects) {
  return rects.some((r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
