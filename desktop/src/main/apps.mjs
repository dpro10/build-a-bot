/**
 * Meeting apps, as the server knows them (src/lib/meetings/apps.ts in the web app).
 * Pure data: no Electron here, so tests can import it.
 */

/** @typedef {'zoom'|'meet'|'teams'|'webex'|'slack'|'discord'|'facetime'|'whatsapp'|'browser'|'other'} AppId */

/** @type {Record<AppId, string>} */
export const APP_NAMES = {
  zoom: "Zoom",
  meet: "Google Meet",
  teams: "Microsoft Teams",
  webex: "Webex",
  slack: "Slack huddle",
  discord: "Discord call",
  facetime: "FaceTime",
  whatsapp: "WhatsApp call",
  browser: "Browser call",
  other: "Meeting",
};

/** Short names for menus ("Don't ask in Zoom"). */
export const APP_SHORT_NAMES = {
  zoom: "Zoom",
  meet: "Google Meet",
  teams: "Teams",
  webex: "Webex",
  slack: "Slack",
  discord: "Discord",
  facetime: "FaceTime",
  whatsapp: "WhatsApp",
  browser: "your browser",
  other: "other calls",
};

export const APP_IDS = /** @type {AppId[]} */ (Object.keys(APP_NAMES));

/** @returns {value is AppId} */
export function isAppId(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(APP_NAMES, value);
}

/** @param {string | null | undefined} id */
export function appName(id) {
  return isAppId(id) ? APP_NAMES[id] : APP_NAMES.other;
}

/** @param {string | null | undefined} id */
export function appShortName(id) {
  return isAppId(id) ? APP_SHORT_NAMES[id] : APP_SHORT_NAMES.other;
}

/** "Don't ask in <app>" only makes sense for a real app, not "a call in your browser". */
export function canNeverAsk(id) {
  return isAppId(id) && id !== "browser" && id !== "other";
}

/** The heads-up the owner can paste into the call chat. Always says it's an AI. */
export function consentNote(botName) {
  const name = String(botName || "").trim();
  return name
    ? `Heads-up: I'm using my AI assistant ${name} to take notes on this call (a transcript and a summary). Let me know if you'd rather I didn't.`
    : "Heads-up: I'm using my AI assistant to take notes on this call (a transcript and a summary). Let me know if you'd rather I didn't.";
}
