/**
 * Which programs are meeting apps, per OS. Lists come from the research note
 * (docs/research/meetings-2026-10-14.md §2.2–2.4, after Anarlog's and OpenWhispr's
 * MIT-licensed tables). Only apps on these lists ever trigger a prompt.
 *
 * FaceTime and phone calls are left out on purpose (research §3.2/§5.5: macOS won't
 * let apps record FaceTime, and phone calls bring stricter consent laws).
 */

/** macOS bundle IDs (exact, or a prefix followed by "." for helper processes). */
export const MAC_BUNDLES = {
  "us.zoom.xos": "zoom",
  "com.microsoft.teams2": "teams",
  "com.microsoft.teams": "teams",
  "com.tinyspeck.slackmacgap": "slack",
  "com.slack.Slack": "slack",
  "com.hnc.Discord": "discord",
  "com.discordapp.Discord": "discord",
  "Cisco-Systems.Spark": "webex",
  "com.cisco.webex": "webex",
  "com.cisco.webexmeetingsapp": "webex",
  "com.webex.meetingmanager": "webex",
  "net.whatsapp.WhatsApp": "whatsapp",
  "desktop.WhatsApp": "whatsapp",
};

export const MAC_BROWSERS = [
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.dev",
  "com.google.Chrome.canary",
  "org.chromium.Chromium",
  "com.microsoft.edgemac",
  "com.apple.Safari",
  "com.apple.SafariTechnologyPreview",
  "org.mozilla.firefox",
  "company.thebrowser.Browser",
  "com.brave.Browser",
  "com.vivaldi.Vivaldi",
  "com.operasoftware.Opera",
];

/** Without the mic helper: processes that only run while you're in a meeting. */
export const MAC_MEETING_PROCESSES = {
  // Zoom starts CptHost (its sharing/caption host) inside a meeting.
  CptHost: "zoom",
  cpthost: "zoom",
};

/** Windows executables (lowercase). */
export const WIN_EXES = {
  "zoom.exe": "zoom",
  "cpthost.exe": "zoom",
  "ms-teams.exe": "teams",
  "ms-teams_modulehost.exe": "teams",
  "teams.exe": "teams",
  "ciscocollabhost.exe": "webex",
  "webexmeetingsapp.exe": "webex",
  "webexhost.exe": "webex",
  "ciscowebexstart.exe": "webex",
  "atmgr.exe": "webex",
  "slack.exe": "slack",
  "discord.exe": "discord",
  "whatsapp.exe": "whatsapp",
};

/** Store (packaged) apps: ConsentStore key prefixes (package family names). */
export const WIN_PACKAGES = {
  "MSTeams_": "teams",
  "MicrosoftTeams_": "teams",
  "5319275A.WhatsAppDesktop_": "whatsapp",
  "Zoom.Zoom_": "zoom",
};

/** What a packaged app's process is called, to check it is really running. */
export const WIN_PACKAGE_EXES = {
  teams: ["ms-teams.exe", "ms-teams_modulehost.exe", "teams.exe"],
  whatsapp: ["whatsapp.exe", "whatsapp.root.exe"],
  zoom: ["zoom.exe"],
};

export const WIN_BROWSERS = ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe", "chromium.exe"];

/** Linux `application.process.binary` values (lowercase). */
export const LINUX_BINARIES = {
  zoom: "zoom",
  "zoom.real": "zoom",
  zoomwebinar: "zoom",
  teams: "teams",
  "teams-for-linux": "teams",
  "teams-insiders": "teams",
  slack: "slack",
  discord: "discord",
  discordcanary: "discord",
  discordptb: "discord",
  webex: "webex",
  "whatsapp-for-linux": "whatsapp",
  zapzap: "whatsapp",
};

/** Linux `application.name` patterns, when the binary name doesn't say. */
export const LINUX_APP_NAMES = [
  [/\bzoom\b/i, "zoom"],
  [/teams/i, "teams"],
  [/\bslack\b/i, "slack"],
  [/\bdiscord\b/i, "discord"],
  [/\bwebex\b/i, "webex"],
];

export const LINUX_BROWSERS = [
  "chrome",
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "firefox",
  "firefox-bin",
  "firefox-esr",
  "librewolf",
  "brave",
  "brave-browser",
  "msedge",
  "microsoft-edge",
  "opera",
  "vivaldi-bin",
];

/** Meeting sites in a browser tab (research §2.2, Anarlog's list). */
export const MEETING_HOSTS = [
  [/(^|\.)meet\.google\.com$/i, "meet"],
  [/(^|\.)teams\.microsoft\.com$/i, "teams"],
  [/(^|\.)teams\.live\.com$/i, "teams"],
  [/(^|\.)zoom\.us$/i, "zoom"],
  [/(^|\.)webex\.com$/i, "webex"],
  [/^app\.slack\.com$/i, "slack"],
  [/(^|\.)discord\.com$/i, "discord"],
  [/^web\.whatsapp\.com$/i, "whatsapp"],
];

/** Window or tab titles that mean a meeting. */
export const MEETING_TITLES = [
  [/\bMeet\s*[-–]\s*[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i, "meet"],
  [/\bgoogle meet\b/i, "meet"],
  [/microsoft teams/i, "teams"],
  [/\bteams meeting\b/i, "teams"],
  [/\bzoom meeting\b/i, "zoom"],
  [/\bzoom workplace\b/i, "zoom"],
  [/\bhuddle\b.*\bslack\b|\bslack\b.*\bhuddle\b/i, "slack"],
  [/\bdiscord\b.*\b(voice|call|stage)\b|\b(voice|call|stage)\b.*\bdiscord\b/i, "discord"],
  [/\bwebex\b.*\bmeeting\b|\bmeeting\b.*\bwebex\b/i, "webex"],
];

/** @param {string | null | undefined} url */
export function appFromUrl(url) {
  if (!url) return null;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const [re, app] of MEETING_HOSTS) if (re.test(host)) return app;
  return null;
}

/** @param {string | null | undefined} title */
export function appFromTitle(title) {
  if (!title) return null;
  for (const [re, app] of MEETING_TITLES) if (re.test(title)) return app;
  return null;
}

/**
 * Bundle ID → app, mapping helper processes to their outermost app
 * ("com.google.Chrome.helper.renderer" → Chrome, a browser).
 * @returns {{ app: string, kind: 'native'|'browser', bundle: string } | null}
 */
export function appFromBundleId(bundleId) {
  if (!bundleId || typeof bundleId !== "string") return null;
  for (const [id, app] of Object.entries(MAC_BUNDLES)) {
    if (bundleId === id || bundleId.startsWith(`${id}.`)) return { app, kind: "native", bundle: id };
  }
  for (const id of MAC_BROWSERS) {
    if (bundleId === id || bundleId.startsWith(`${id}.`)) return { app: "browser", kind: "browser", bundle: id };
  }
  return null;
}

/** Pretty browser name from an id, for logs and the tray. */
export function browserLabel(id) {
  const s = String(id || "").toLowerCase();
  if (s.includes("edge")) return "Edge";
  if (s.includes("chrome") || s.includes("chromium")) return "Chrome";
  if (s.includes("safari")) return "Safari";
  if (s.includes("firefox") || s.includes("librewolf")) return "Firefox";
  if (s.includes("brave")) return "Brave";
  if (s.includes("thebrowser") || s === "arc.exe") return "Arc";
  if (s.includes("vivaldi")) return "Vivaldi";
  if (s.includes("opera")) return "Opera";
  return "your browser";
}
