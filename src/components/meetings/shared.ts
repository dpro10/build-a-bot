/**
 * Meeting helpers that are safe in the browser (src/lib/meetings itself talks to
 * the database, so client components only import its types).
 */
import type { MeetingView, SegmentView } from "@/lib/meetings";
import { MEETING_APPS, isMeetingApp } from "@/lib/meetings/apps";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { BRAND_ICONS } from "@/lib/icons.generated";
import type { ConnectorIcon } from "@/lib/connectors/types";

export type { MeetingView, SegmentView };

/** A bot as the meeting pages show it. */
export type BotFace = { name: string; avatar: AvatarId; color: ColorwayId };

/** "0:42", "12:05", "1:02:09" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "42 sec", "12 min", "1 hr 5 min" (same wording as the notes the bot sends). */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.max(sec, 0)} sec`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** The app's tile icon. A brand without a bundled logo gets its first letter instead of a "?". */
export function meetingAppIcon(app: string | null | undefined, inPerson = false): ConnectorIcon {
  if (inPerson) return { lucide: "Users", color: "0D9488" };
  const def = MEETING_APPS[isMeetingApp(app) ? app : "other"];
  if (def.icon.simpleIcon && !BRAND_ICONS[def.icon.simpleIcon] && !def.icon.letter) return { ...def.icon, simpleIcon: undefined, letter: def.name.charAt(0) };
  return def.icon;
}

export function meetingAppName(app: string | null | undefined): string {
  return MEETING_APPS[isMeetingApp(app) ? app : "other"].name;
}

export type MeetingStatusKey = "recording" | "writing" | "ready" | "failed";

export const STATUS: Record<MeetingStatusKey, { label: string; tone: "danger" | "primary" | "warning" | "success" | "neutral" }> = {
  recording: { label: "Recording now", tone: "danger" },
  writing: { label: "Writing notes", tone: "primary" },
  ready: { label: "Ready", tone: "success" },
  failed: { label: "Notes failed", tone: "neutral" },
};

/** What the owner should see. Notes that couldn't be written come back as "ready" with an error and no notes. */
export function statusOf(m: Pick<MeetingView, "status" | "notes">): MeetingStatusKey {
  if (m.status === "recording") return "recording";
  if (m.status === "processing") return "writing";
  return m.notes ? "ready" : "failed";
}

/** "You" is the owner's microphone; "Room" is one microphone for everyone (in person); "Others" is the call. */
export function speakerName(s: Pick<SegmentView, "speaker" | "track">, ownerName: string): string {
  if (s.speaker === "Room") return "Room";
  if (s.track === "mic" || s.speaker === "You") return ownerName;
  return s.speaker || "Others";
}

export function isOwnerLine(s: Pick<SegmentView, "speaker" | "track">): boolean {
  return s.speaker !== "Room" && (s.track === "mic" || s.speaker === "You");
}

const TRACK_ORDER: Record<string, number> = { mic: 0, system: 1 };

/** Merge new transcript lines into what we have, by id, in time order. */
export function mergeSegments(prev: SegmentView[], incoming: SegmentView[]): SegmentView[] {
  if (!incoming.length) return prev;
  const byId = new Map(prev.map((s) => [s.id, s]));
  let changed = false;
  for (const s of incoming) {
    if (!s.text?.trim()) continue;
    const old = byId.get(s.id);
    if (!old || old.text !== s.text) {
      byId.set(s.id, s);
      changed = true;
    }
  }
  if (!changed) return prev;
  return [...byId.values()].sort((a, b) => a.startMs - b.startMs || (TRACK_ORDER[a.track] ?? 2) - (TRACK_ORDER[b.track] ?? 2) || a.id.localeCompare(b.id));
}

/** Notes markdown split into its "## " sections. */
export function noteSections(notes: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  let cur: { title: string; lines: string[] } = { title: "", lines: [] };
  for (const line of notes.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^\s*#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      if (cur.title || cur.lines.join("").trim()) out.push({ title: cur.title, body: cur.lines.join("\n").trim() });
      cur = { title: h[1].replace(/\*\*/g, "").trim(), lines: [] };
    } else cur.lines.push(line);
  }
  if (cur.title || cur.lines.join("").trim()) out.push({ title: cur.title, body: cur.lines.join("\n").trim() });
  return out;
}

export const SUMMARY_SECTION = /^summary/i;
export const ACTIONS_SECTION = /^action items?|^next steps|^to-?dos?/i;

/** Plain-text and Markdown exports of a meeting. */
export function meetingExport(
  m: Pick<MeetingView, "title" | "summary" | "notes" | "actionItems" | "appName" | "durationSec">,
  segments: SegmentView[],
  opts: { ownerName: string; when: string; format: "txt" | "md" },
): string {
  const md = opts.format === "md";
  const lines: string[] = [];
  lines.push(md ? `# ${m.title}` : m.title);
  lines.push(`${opts.when} · ${formatDuration(m.durationSec)} · ${m.appName}`);
  if (m.summary) lines.push("", md ? "## Summary" : "SUMMARY", m.summary);
  if (m.actionItems.length) {
    lines.push("", md ? "## Action items" : "ACTION ITEMS");
    for (const a of m.actionItems) lines.push(`${md ? `- [${a.done ? "x" : " "}]` : a.done ? "[x]" : "[ ]"} ${a.owner ? `${a.owner}: ` : ""}${a.text}${a.due ? ` (by ${a.due})` : ""}`);
  }
  if (m.notes) {
    const rest = noteSections(m.notes).filter((s) => !SUMMARY_SECTION.test(s.title) && !ACTIONS_SECTION.test(s.title) && s.body);
    for (const s of rest) lines.push("", md ? `## ${s.title || "Notes"}` : (s.title || "Notes").toUpperCase(), s.body);
  }
  if (segments.length) {
    lines.push("", md ? "## Transcript" : "TRANSCRIPT");
    for (const s of segments) lines.push(md ? `**[${clock(s.startMs)}] ${speakerName(s, opts.ownerName)}:** ${s.text}` : `[${clock(s.startMs)}] ${speakerName(s, opts.ownerName)}: ${s.text}`);
  }
  return `${lines.join(md ? "\n\n" : "\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function fileSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "meeting"
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
