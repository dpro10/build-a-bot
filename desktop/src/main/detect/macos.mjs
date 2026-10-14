/**
 * macOS: which app has the microphone open.
 *
 * Best: the small Swift helper (native/macos/BabAudioHelper.swift), which reads Core
 * Audio's per-process objects (macOS 14+: kAudioHardwarePropertyProcessObjectList →
 * kAudioProcessPropertyIsRunningInput, PID, bundle ID). No permission prompt.
 *
 * Without the helper, detection degrades: Zoom is noticed by its in-meeting process
 * (CptHost), and — only if the owner turned it on — Google Meet / Teams tabs in
 * Chrome or Safari via AppleScript (macOS asks for permission per browser).
 * Pure parsing here.
 */
import { MAC_MEETING_PROCESSES, appFromBundleId, appFromTitle, appFromUrl, browserLabel } from "./catalog.mjs";

/**
 * The helper's `mic` output:
 *   {"ok":true,"api":"process-objects","inputInUse":true,
 *    "processes":[{"pid":123,"bundleId":"us.zoom.xos","input":true,"windows":[{"x":0,"y":25,"w":1280,"h":775}]}]}
 * @param {string} text
 * @returns {{ ok: boolean, api: string | null, inputInUse: boolean, processes: Array<{ pid: number, bundleId: string, input: boolean, windows: Array<{x:number,y:number,width:number,height:number}> }>, error?: string }}
 */
export function parseHelperOutput(text) {
  let data;
  try {
    data = JSON.parse(String(text || "").trim().split(/\r?\n/).pop() || "{}");
  } catch {
    return { ok: false, api: null, inputInUse: false, processes: [], error: "unreadable helper output" };
  }
  const processes = Array.isArray(data.processes)
    ? data.processes
        .filter((p) => p && typeof p.bundleId === "string")
        .map((p) => ({
          pid: Number(p.pid) || 0,
          bundleId: p.bundleId,
          input: p.input === true,
          windows: Array.isArray(p.windows)
            ? p.windows.map((w) => ({ x: Number(w.x) || 0, y: Number(w.y) || 0, width: Number(w.w) || 0, height: Number(w.h) || 0 })).filter((w) => w.width > 0 && w.height > 0)
            : [],
        }))
    : [];
  return { ok: data.ok === true, api: typeof data.api === "string" ? data.api : null, inputInUse: data.inputInUse === true, processes, error: data.error };
}

/**
 * @param {ReturnType<typeof parseHelperOutput>} out
 * @param {{ ownPids?: Set<number>, tabs?: Array<{ url: string, title: string }> }} [opts]
 * @returns {Array<{ key: string, app: string, kind: 'native'|'browser', pid: number|null, label: string, source: string, bounds: {x:number,y:number,width:number,height:number}|null }>}
 */
export function macHelperSightings(out, opts = {}) {
  const ownPids = opts.ownPids ?? new Set();
  const found = [];
  for (const p of out.processes) {
    if (!p.input || ownPids.has(p.pid)) continue;
    const hit = appFromBundleId(p.bundleId);
    if (!hit) continue;
    let app = hit.app;
    if (hit.kind === "browser") app = appFromTabs(opts.tabs ?? [], hit.bundle) ?? "browser";
    const biggest = [...p.windows].sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
    found.push({
      key: `mac:${hit.bundle}`,
      app,
      kind: hit.kind,
      pid: p.pid || null,
      label: hit.kind === "browser" ? browserLabel(hit.bundle) : hit.bundle,
      source: "helper",
      bounds: biggest,
    });
  }
  return dedupe(found);
}

/**
 * `ps -axo pid=,comm=` (comm is the executable path on macOS).
 * @param {string} text
 */
export function parsePs(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!m) continue;
    const path = m[2];
    rows.push({ pid: Number(m[1]), path, name: path.split("/").pop() ?? path });
  }
  return rows;
}

/**
 * Fallback without the helper: meeting-only processes (Zoom's CptHost).
 * @param {ReturnType<typeof parsePs>} rows
 */
export function macProcessSightings(rows, opts = {}) {
  const ownPids = opts.ownPids ?? new Set();
  const found = [];
  for (const r of rows) {
    if (ownPids.has(r.pid)) continue;
    const app = MAC_MEETING_PROCESSES[r.name];
    // Only Zoom's own copy (inside zoom.us.app) counts.
    if (app === "zoom" && !/zoom\.us\.app/i.test(r.path)) continue;
    if (app) found.push({ key: `mac:proc:${app}`, app, kind: "native", pid: r.pid, label: r.name, source: "process", bounds: null });
  }
  return dedupe(found);
}

/**
 * Output of the tab-listing AppleScript: one "browser<TAB>url<TAB>title" line per tab.
 * @param {string} text
 */
export function parseTabLines(text) {
  const tabs = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [browser, url, ...title] = line.split("\t");
    tabs.push({ browser: browser ?? "", url: url ?? "", title: title.join("\t") });
  }
  return tabs;
}

/** The meeting a browser's tabs point at (Meet/Teams/Zoom on the web), if any. */
export function appFromTabs(tabs, bundle) {
  const mine = bundle ? tabs.filter((t) => !t.browser || bundleMatches(t.browser, bundle)) : tabs;
  for (const t of mine) {
    const app = appFromUrl(t.url) ?? appFromTitle(t.title);
    if (app) return app;
  }
  return null;
}

/**
 * Fallback without the helper and with tab checking on: an open meeting tab counts
 * as a browser call (held to the longer browser sustain time).
 */
export function macTabSightings(tabs) {
  const found = [];
  for (const t of tabs) {
    const app = appFromUrl(t.url) ?? appFromTitle(t.title);
    if (!app) continue;
    // A Meet tab only means a call when it's in a room (meet.google.com/abc-defg-hij).
    if (app === "meet" && !/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(t.url)) continue;
    found.push({ key: `mac:tab:${app}`, app, kind: "browser", pid: null, label: t.browser || "browser", source: "tabs", bounds: null });
  }
  return dedupe(found);
}

/** AppleScript that lists Chrome/Safari/Edge/Brave/Arc tabs (only browsers that are running). */
export const TABS_APPLESCRIPT = `
set out to ""
set browsers to {"Google Chrome", "Microsoft Edge", "Brave Browser", "Arc", "Safari"}
repeat with b in browsers
  if application (b as text) is running then
    try
      if (b as text) is "Safari" then
        tell application "Safari"
          repeat with w in windows
            repeat with t in tabs of w
              set out to out & "Safari" & tab & (URL of t) & tab & (name of t) & linefeed
            end repeat
          end repeat
        end tell
      else
        using terms from application "Google Chrome"
          tell application (b as text)
            repeat with w in windows
              repeat with t in tabs of w
                set out to out & (b as text) & tab & (URL of t) & tab & (title of t) & linefeed
              end repeat
            end repeat
          end tell
        end using terms from
      end if
    end try
  end if
end repeat
return out
`;

function bundleMatches(browserName, bundle) {
  const b = browserName.toLowerCase();
  const id = bundle.toLowerCase();
  if (id.includes("chrome")) return b.includes("chrome");
  if (id.includes("edge")) return b.includes("edge");
  if (id.includes("safari")) return b.includes("safari");
  if (id.includes("brave")) return b.includes("brave");
  if (id.includes("thebrowser")) return b === "arc";
  return true;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
}
