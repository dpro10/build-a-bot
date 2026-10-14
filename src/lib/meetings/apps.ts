/**
 * Meeting apps the bot can take notes in. The desktop app detects these; the
 * browser recorder works with any call that runs in a browser tab.
 */
import type { ConnectorIcon } from "@/lib/connectors/types";

export const MEETING_APP_IDS = ["zoom", "meet", "teams", "webex", "slack", "discord", "facetime", "whatsapp", "browser", "other"] as const;
export type MeetingAppId = (typeof MEETING_APP_IDS)[number];

export type MeetingAppDef = { id: MeetingAppId; name: string; icon: ConnectorIcon };

export const MEETING_APPS: Record<MeetingAppId, MeetingAppDef> = {
  zoom: { id: "zoom", name: "Zoom", icon: { simpleIcon: "zoom", color: "0B5CFF" } },
  meet: { id: "meet", name: "Google Meet", icon: { simpleIcon: "googlemeet", color: "00897B" } },
  teams: { id: "teams", name: "Microsoft Teams", icon: { letter: "T", color: "6264A7" } },
  webex: { id: "webex", name: "Webex", icon: { simpleIcon: "webex", letter: "W", color: "000000" } },
  slack: { id: "slack", name: "Slack huddle", icon: { letter: "S", color: "4A154B" } },
  discord: { id: "discord", name: "Discord call", icon: { simpleIcon: "discord", color: "5865F2" } },
  facetime: { id: "facetime", name: "FaceTime", icon: { lucide: "Video", color: "34C759" } },
  whatsapp: { id: "whatsapp", name: "WhatsApp call", icon: { simpleIcon: "whatsapp", color: "25D366" } },
  browser: { id: "browser", name: "Browser call", icon: { lucide: "Globe", color: "0EA5E9" } },
  other: { id: "other", name: "Meeting", icon: { lucide: "Video", color: "7C5CFF" } },
};

export function isMeetingApp(value: unknown): value is MeetingAppId {
  return typeof value === "string" && (MEETING_APP_IDS as readonly string[]).includes(value);
}

export function meetingAppName(id: string | null | undefined): string {
  return isMeetingApp(id) ? MEETING_APPS[id].name : MEETING_APPS.other.name;
}

/** Default title until the bot names the meeting from what was said. */
export function defaultMeetingTitle(app: MeetingAppId, startedAt: Date, timezone: string): string {
  let when = "";
  try {
    when = startedAt.toLocaleString("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", minute: "2-digit" });
  } catch {
    when = startedAt.toISOString().slice(0, 16).replace("T", " ");
  }
  const base = app === "other" || app === "browser" ? "Meeting" : `${MEETING_APPS[app].name} meeting`;
  return `${base}, ${when}`;
}
