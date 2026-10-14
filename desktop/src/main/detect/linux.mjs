/**
 * Linux: which app is recording from a microphone right now, from PulseAudio /
 * PipeWire "source outputs" (`pactl list source-outputs`, run with LC_ALL=C so the
 * labels are in English). Corked (paused) streams don't count. Pure parsing here;
 * the probe that runs pactl lives in probe.mjs.
 */
import { LINUX_APP_NAMES, LINUX_BINARIES, LINUX_BROWSERS, browserLabel } from "./catalog.mjs";

/**
 * @typedef {{ index: number, corked: boolean, muted: boolean, props: Record<string, string> }} SourceOutput
 */

/**
 * `pactl list source-outputs` (text).
 * @param {string} text
 * @returns {SourceOutput[]}
 */
export function parseSourceOutputs(text) {
  /** @type {SourceOutput[]} */
  const out = [];
  /** @type {SourceOutput | null} */
  let cur = null;
  let inProps = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const head = raw.match(/^Source Output #(\d+)/);
    if (head) {
      cur = { index: Number(head[1]), corked: false, muted: false, props: {} };
      out.push(cur);
      inProps = false;
      continue;
    }
    if (!cur) continue;
    const line = raw.trim();
    if (!line) continue;
    if (/^Properties:$/.test(line)) {
      inProps = true;
      continue;
    }
    const prop = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"(.*)"$/);
    if (inProps && prop) {
      cur.props[prop[1]] = unescape(prop[2]);
      continue;
    }
    const field = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (field) {
      // A new top-level field ends the property list.
      if (!raw.startsWith("\t\t") && !raw.startsWith("        ")) inProps = false;
      const name = field[1].toLowerCase();
      if (name === "corked") cur.corked = /^yes$/i.test(field[2].trim());
      if (name === "mute") cur.muted = /^yes$/i.test(field[2].trim());
    }
  }
  return out;
}

/**
 * `pactl --format=json list source-outputs` (PulseAudio 16+, pipewire-pulse).
 * @param {string} text
 * @returns {SourceOutput[] | null} null when it isn't JSON
 */
export function parseSourceOutputsJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  return data.map((o) => ({
    index: Number(o?.index ?? -1),
    corked: o?.corked === true || o?.corked === "yes",
    muted: o?.mute === true || o?.mute === "yes",
    props: Object.fromEntries(Object.entries(o?.properties ?? {}).map(([k, v]) => [k, String(v)])),
  }));
}

/**
 * Meeting apps holding a microphone open.
 * @param {SourceOutput[]} outputs
 * @param {{ ownPids?: Set<number>, ownBinaries?: string[] }} [opts]
 * @returns {Array<{ key: string, app: string, kind: 'native'|'browser', pid: number|null, label: string, source: string }>}
 */
export function linuxSightings(outputs, opts = {}) {
  const ownPids = opts.ownPids ?? new Set();
  const ownBinaries = (opts.ownBinaries ?? []).map((b) => b.toLowerCase());
  const found = [];
  for (const o of outputs) {
    if (o.corked) continue;
    const p = o.props;
    const pid = Number(p["application.process.id"]) || null;
    if (pid && ownPids.has(pid)) continue;
    const binary = String(p["application.process.binary"] ?? "").toLowerCase();
    const name = String(p["application.name"] ?? "");
    if (binary && ownBinaries.includes(binary)) continue;
    // Level meters (pavucontrol, GNOME Settings) watch the mic too; they aren't calls.
    if (/peak detect/i.test(p["media.name"] ?? "")) continue;

    let app = LINUX_BINARIES[binary];
    let kind = /** @type {'native'|'browser'} */ ("native");
    if (!app) {
      for (const [re, id] of LINUX_APP_NAMES) {
        if (re.test(name)) {
          app = id;
          break;
        }
      }
    }
    if (!app && (LINUX_BROWSERS.includes(binary) || /chrom|firefox|brave|edge|opera|vivaldi/i.test(name))) {
      app = "browser";
      kind = "browser";
    }
    if (!app) continue;
    const id = binary || name.toLowerCase().replace(/\s+/g, "-");
    found.push({ key: `linux:${id}`, app, kind, pid, label: kind === "browser" ? browserLabel(id || name) : name || binary, source: "pactl" });
  }
  return found;
}

function unescape(s) {
  return s.replace(/\\(["\\])/g, "$1");
}
