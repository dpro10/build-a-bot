/**
 * Windows: which app is using the microphone, from the privacy "ConsentStore" in the
 * registry (what the taskbar mic icon reads):
 *
 *   HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone
 *     \<PackageFamilyName>            Store apps (the new Teams: MSTeams_8wekyb3d8bbwe)
 *     \NonPackaged\C:#Program Files#…#Zoom.exe   desktop apps (the path with # for \)
 *       LastUsedTimeStart / LastUsedTimeStop  (FILETIME; Stop == 0 means "in use now")
 *
 * Stop values can stick at 0 after a crash, so an entry only counts when its program
 * is actually running (tasklist). Browsers are named from their window title when it
 * says Meet/Teams/Zoom. A WASAPI audio-session helper is the better long-term path
 * (see native/windows/README in desktop/README.md). Pure parsing here.
 */
import { WIN_BROWSERS, WIN_EXES, WIN_PACKAGES, WIN_PACKAGE_EXES, appFromTitle, browserLabel } from "./catalog.mjs";

export const CONSENT_STORE_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";

/**
 * Output of `reg query <key> /s`.
 * @param {string} text
 * @returns {Array<{ key: string, values: Record<string, { type: string, data: string }> }>}
 */
export function parseRegQuery(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (/^HKEY_/i.test(raw)) {
      cur = { key: raw.trim(), values: {} };
      out.push(cur);
      continue;
    }
    if (!cur || !raw.trim()) continue;
    // "    Name    REG_TYPE    Data" (columns separated by 4 spaces; data may be empty)
    const m = raw.match(/^\s+(.+?)\s{2,}(REG_[A-Z_]+)(?:\s{2,}(.*))?$/);
    if (m) cur.values[m[1].trim()] = { type: m[2], data: (m[3] ?? "").trim() };
  }
  return out;
}

/** "0x1db3e8f0a1b2c30" → 133xxxxxxxxxxxxxxxxn (FILETIME). Bad input → 0n. */
export function parseQword(data) {
  try {
    if (/^0x[0-9a-f]+$/i.test(data)) return BigInt(data);
    if (/^\d+$/.test(data)) return BigInt(data);
  } catch {
    /* fall through */
  }
  return 0n;
}

/** FILETIME (100 ns since 1601) → epoch ms. */
export function filetimeToMs(ft) {
  if (!ft) return 0;
  return Number(ft / 10000n - 11644473600000n);
}

/**
 * ConsentStore entries with their last-used times.
 * @param {ReturnType<typeof parseRegQuery>} keys
 */
export function consentStoreEntries(keys) {
  const entries = [];
  for (const k of keys) {
    const m = k.key.match(/\\ConsentStore\\microphone\\(.+)$/i);
    if (!m) continue;
    const rest = m[1];
    if (/^NonPackaged$/i.test(rest)) continue;
    const start = parseQword(k.values.LastUsedTimeStart?.data ?? "");
    const stop = parseQword(k.values.LastUsedTimeStop?.data ?? "");
    const nonPackaged = rest.match(/^NonPackaged\\(.+)$/i);
    const exePath = nonPackaged ? nonPackaged[1].replace(/#/g, "\\") : null;
    entries.push({
      id: nonPackaged ? nonPackaged[1] : rest,
      packaged: !nonPackaged,
      exePath,
      exe: exePath ? exePath.split("\\").pop().toLowerCase() : null,
      start,
      stop,
      startedAt: filetimeToMs(start),
      inUse: start > 0n && stop === 0n,
    });
  }
  return entries;
}

/**
 * `tasklist /fo csv /nh` (optionally /v, which adds the window title as the last column).
 * @param {string} text
 * @returns {Array<{ image: string, pid: number, title: string | null }>}
 */
export function parseTasklistCsv(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 2) continue;
    const pid = Number(cols[1]);
    if (!Number.isFinite(pid)) continue;
    rows.push({ image: cols[0], pid, title: cols.length >= 9 ? cols[cols.length - 1] : null });
  }
  return rows;
}

/** One CSV line with "quoted, fields". */
export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Meeting apps using the mic now, cross-checked against running processes.
 * @param {ReturnType<typeof consentStoreEntries>} entries
 * @param {Array<{ image: string, pid: number, title?: string | null }>} processes  running programs (`tasklist`)
 * @param {{ ownExe?: string, titles?: Array<{ image: string, title: string | null }> }} [opts]
 * @returns {Array<{ key: string, app: string, kind: 'native'|'browser', pid: number|null, label: string, source: string }>}
 */
export function windowsSightings(entries, processes, opts = {}) {
  const running = new Map();
  for (const p of processes) {
    const name = p.image.toLowerCase();
    if (!running.has(name)) running.set(name, p.pid);
  }
  const ownExe = (opts.ownExe ?? "").toLowerCase();
  const found = [];
  for (const e of entries) {
    if (!e.inUse) continue;
    if (e.packaged) {
      const prefix = Object.keys(WIN_PACKAGES).find((p) => e.id.startsWith(p));
      if (!prefix) continue;
      const app = WIN_PACKAGES[prefix];
      const exes = WIN_PACKAGE_EXES[app] ?? [];
      const pid = exes.map((x) => running.get(x)).find(Boolean) ?? null;
      if (!pid) continue; // a stuck value: the app isn't running
      found.push({ key: `win:${prefix}`, app, kind: "native", pid, label: e.id, source: "consentstore" });
      continue;
    }
    if (!e.exe || (ownExe && e.exePath?.toLowerCase() === ownExe)) continue;
    const pid = running.get(e.exe) ?? null;
    if (!pid) continue;
    const app = WIN_EXES[e.exe];
    if (app) {
      found.push({ key: `win:${app === "zoom" ? "zoom.exe" : e.exe}`, app, kind: "native", pid, label: e.exe, source: "consentstore" });
      continue;
    }
    if (WIN_BROWSERS.includes(e.exe)) {
      // "Meet - abc-defg-hij - Google Chrome" names the call; otherwise it's "a call in Chrome".
      const titles = (opts.titles ?? []).filter((t) => t.image.toLowerCase() === e.exe).map((t) => t.title);
      const named = titles.map((t) => appFromTitle(t)).find(Boolean);
      found.push({ key: `win:${e.exe}`, app: named ?? "browser", kind: "browser", pid, label: browserLabel(e.exe), source: "consentstore" });
    }
  }
  // Zoom.exe and CptHost.exe are the same call.
  const seen = new Set();
  return found.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
}
