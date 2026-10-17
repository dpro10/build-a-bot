/**
 * The tray / menu-bar menu, as plain data (no Electron), so it can be tested.
 * tray.mjs turns it into a real Menu and wires the clicks.
 */
import { appShortName } from "./apps.mjs";

/**
 * @typedef {object} TrayModel
 * @property {string} status          one line: "Watching for calls", "Taking notes", …
 * @property {'watching'|'recording'|'paused'|'off'} icon
 * @property {boolean} signedIn
 * @property {string} phase           the call machine's phase
 * @property {boolean} canTake        "Take notes now" is possible
 * @property {boolean} detectionPaused
 * @property {boolean} captions
 * @property {boolean} openAtLogin
 * @property {boolean} macTabs        (macOS only)
 * @property {string} platform
 * @property {Array<{ id: string, name: string, meetingsOn: boolean, paused: boolean }>} bots
 * @property {string | null} botId
 * @property {string[]} neverApps
 * @property {{ enabled: boolean, mode: 'hold'|'toggle'|'off', hint: string | null, canPasteLast: boolean } | null} [voice]  voice typing
 * @property {{ version: string, canRestart: boolean } | null} [update]  a new version, downloaded and waiting
 */

/** @param {TrayModel} m */
export function trayIcon(m) {
  if (m.phase === "listening" || m.phase === "starting") return "recording";
  if (m.phase === "paused") return "paused";
  if (!m.signedIn || m.detectionPaused) return "off";
  return "watching";
}

/**
 * Menu items: { id, label, type?, checked?, enabled?, submenu? }. `id` is what a click sends back.
 * @param {TrayModel} m
 */
export function trayItems(m) {
  const recording = m.phase === "listening" || m.phase === "paused" || m.phase === "starting";
  const items = [];
  items.push({ id: "status", label: m.status, enabled: false });
  // Not while taking notes or dictating: it can wait until that's done (or until quitting).
  if (m.update) items.push({ id: "update", label: `Restart to update to ${m.update.version}`, enabled: m.update.canRestart });
  items.push({ type: "separator" });

  if (recording) {
    items.push({ id: "stop", label: "Stop and write notes" });
    if (m.phase === "listening") items.push({ id: "pause", label: "Pause taking notes" });
    if (m.phase === "paused") items.push({ id: "resume", label: "Resume taking notes" });
    items.push({ id: "copy-heads-up", label: "Copy a heads-up for the call" });
  } else {
    const canTake = m.canTake && m.phase !== "stopping" && m.phase !== "discarding";
    items.push({ id: "take", label: "Take notes now", enabled: canTake });
    // A meeting in the room, not a call: the mic only, and its lines are labeled "Room".
    items.push({ id: "take-room", label: "Take notes in the room", enabled: canTake });
    if (m.phase === "asking") items.push({ id: "copy-heads-up", label: "Copy a heads-up for the call" });
  }
  items.push({ type: "separator" });

  // Voice typing.
  if (m.signedIn && m.voice) {
    if (m.voice.enabled) {
      items.push({ id: "voice-status", label: m.voice.hint ? `Voice typing: ${m.voice.hint}` : "Voice typing is starting…", enabled: false });
      items.push({ id: "voice-paste-last", label: "Paste last dictation", enabled: m.voice.canPasteLast });
      items.push({ id: "voice-settings", label: "Voice typing settings…" });
    } else {
      items.push({ id: "voice-setup", label: "Set up voice typing…" });
    }
    items.push({ type: "separator" });
  }

  if (m.signedIn) {
    items.push(m.detectionPaused ? { id: "detect-resume", label: "Resume call detection" } : { id: "detect-pause", label: "Pause call detection for 1 hour" });
    items.push({ id: "captions", label: "Show live captions", type: "checkbox", checked: m.captions });

    const on = m.bots.filter((b) => b.meetingsOn);
    const off = m.bots.filter((b) => !b.meetingsOn);
    const botItems = [
      ...on.map((b) => ({ id: `bot:${b.id}`, label: b.paused ? `${b.name} (paused)` : b.name, type: "radio", checked: b.id === m.botId })),
      ...off.map((b) => ({ id: `bot-off:${b.id}`, label: `${b.name}: meeting notes are off`, enabled: false })),
    ];
    if (off.length) botItems.push({ type: "separator" }, { id: `turn-on:${off[0].id}`, label: `Turn on meeting notes for ${off[0].name}…` });
    if (botItems.length) items.push({ id: "bots", label: "Bot that takes notes", submenu: botItems });

    if (m.neverApps.length) {
      items.push({
        id: "never",
        label: "Apps it won't ask in",
        submenu: m.neverApps.map((a) => ({ id: `ask-again:${a}`, label: `Ask in ${appShortName(a)} again` })),
      });
    }
    if (m.platform === "darwin") items.push({ id: "mac-tabs", label: "Recognize Meet and Teams in browser tabs", type: "checkbox", checked: m.macTabs });
    items.push({ type: "separator" });
  }

  items.push({ id: "open-app", label: "Open Build-a-bot" });
  items.push(m.signedIn ? { id: "account", label: "This computer…" } : { id: "pair", label: "Pair this computer…" });
  items.push({ id: "login", label: "Start at login", type: "checkbox", checked: m.openAtLogin });
  items.push({ type: "separator" });
  items.push({ id: "quit", label: recording ? "Stop and quit Build-a-bot" : "Quit Build-a-bot" });
  return items;
}
