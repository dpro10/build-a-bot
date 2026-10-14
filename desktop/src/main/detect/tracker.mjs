/**
 * Debounces raw "this app has the mic" sightings into calls:
 *  - a call starts when an app is seen on at least `minChecks` checks in a row, for at
 *    least `sustainMs` (5 s for meeting apps, 15 s for browsers, which also use the mic
 *    for voice search and dictation);
 *  - a call ends when the app has released the mic for `endGraceMs` (15 s), so a quick
 *    device switch or mute doesn't end it.
 * Pure: time comes in as an argument.
 */

export const DEFAULT_TRACKER = Object.freeze({ minChecks: 2, sustainMs: Object.freeze({ native: 5000, browser: 15000 }), endGraceMs: 15000 });

/**
 * @typedef {{ key: string, app: string, kind: 'native'|'browser', pid?: number|null, label?: string, source?: string, bounds?: {x:number,y:number,width:number,height:number}|null }} Sighting
 * @typedef {{ type: 'start', key: string, app: string, kind: string, bounds: Sighting['bounds'], label?: string } | { type: 'end', key: string, app: string } | { type: 'update', key: string, app: string }} TrackerEvent
 */

/**
 * @param {{ minChecks?: number, sustainMs?: { native?: number, browser?: number }, endGraceMs?: number }} [opts]
 */
export function createTracker(opts = {}) {
  const minChecks = opts.minChecks ?? DEFAULT_TRACKER.minChecks;
  const sustain = { ...DEFAULT_TRACKER.sustainMs, ...(opts.sustainMs ?? {}) };
  const endGraceMs = opts.endGraceMs ?? DEFAULT_TRACKER.endGraceMs;
  /** @type {Map<string, { key: string, app: string, kind: 'native'|'browser', firstAt: number, lastAt: number, checks: number, active: boolean, info: Sighting }>} */
  const entries = new Map();

  /**
   * @param {number} now
   * @param {Sighting[]} sightings
   * @returns {TrackerEvent[]}
   */
  function update(now, sightings) {
    /** @type {TrackerEvent[]} */
    const events = [];
    const seen = new Set();
    for (const s of sightings) {
      if (!s || !s.key || seen.has(s.key)) continue;
      seen.add(s.key);
      let e = entries.get(s.key);
      if (!e) {
        e = { key: s.key, app: s.app, kind: s.kind === "browser" ? "browser" : "native", firstAt: now, lastAt: now, checks: 0, active: false, info: s };
        entries.set(s.key, e);
      }
      e.checks += 1;
      e.lastAt = now;
      e.info = s;
      // A browser call that turns out to be Meet/Teams keeps the better name.
      if (e.app === "browser" && s.app !== "browser") {
        e.app = s.app;
        if (e.active) events.push({ type: "update", key: e.key, app: e.app });
      }
      const need = e.kind === "browser" ? sustain.browser : sustain.native;
      if (!e.active && e.checks >= minChecks && now - e.firstAt >= need) {
        e.active = true;
        events.push({ type: "start", key: e.key, app: e.app, kind: e.kind, bounds: s.bounds ?? null, label: s.label });
      }
    }
    for (const [key, e] of entries) {
      if (seen.has(key)) continue;
      if (!e.active) {
        entries.delete(key); // sightings must be consecutive
      } else if (now - e.lastAt >= endGraceMs) {
        entries.delete(key);
        events.push({ type: "end", key, app: e.app });
      }
    }
    return events;
  }

  return {
    update,
    /** Calls in progress. */
    active() {
      return [...entries.values()].filter((e) => e.active).map((e) => ({ key: e.key, app: e.app, kind: e.kind, since: e.firstAt, bounds: e.info.bounds ?? null }));
    },
    /** Is this call still going (or within its grace period)? */
    isActive(key) {
      return entries.get(key)?.active === true;
    },
    reset() {
      entries.clear();
    },
  };
}
