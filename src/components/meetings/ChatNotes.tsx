"use client";
/**
 * A meeting's notes as they arrive in chat: a small header (the app, the title, how
 * long) with a link to the meeting page, then the notes themselves.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowRight, NotebookPen } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { Markdown } from "@/components/chat/Markdown";
import { meetingAppIcon } from "./shared";

export type ChatMeetingRef = { id: string; app?: string; inPerson?: boolean; gone?: boolean };

/**
 * "📝 Notes from “Title” (12 min) — 2 decisions, 5 action items" + notes + "[Open the full transcript](…)",
 * or "No notes from “Title” (40 sec)" + why + "[Open the meeting](…)" when there were none.
 */
export function parseNotesMessage(text: string): { title: string | null; duration: string | null; tally: string | null; body: string; footer: string | null; missing: boolean } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const head = /^\s*(?:📝\s*)?(No notes|Notes) from [“"](.+)[”"]\s*\(([^)]+)\)(?:\s*[—–-]\s*(.+?))?\s*$/.exec(lines[0] ?? "");
  let body = (head ? lines.slice(1) : lines).join("\n");
  body = body.replace(/^\s*\[Open (?:the )?(?:full )?(?:transcript|meeting)\]\([^)]*\)\s*$/gim, "");
  const blocks = body
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  let footer: string | null = null;
  const last = blocks[blocks.length - 1];
  if (blocks.length > 1 && last && !/^[-*#\d•]/.test(last) && /just say so|audio is already gone|want me to/i.test(last)) footer = blocks.pop() ?? null;
  return { title: head?.[2] ?? null, duration: head?.[3] ?? null, tally: head?.[4] ?? null, body: blocks.join("\n\n"), footer, missing: head?.[1] === "No notes" };
}

const lookups = new Map<string, Promise<Record<string, { app: string; inPerson: boolean }>>>();

function lookup(botId: string, refresh = false) {
  if (refresh || !lookups.has(botId)) {
    lookups.set(
      botId,
      fetch(`/api/bots/${botId}/meetings`)
        .then((r) => (r.ok ? r.json() : { meetings: [] }))
        .then((d: { meetings?: { id: string; app: string; inPerson?: boolean }[] }) => Object.fromEntries((d.meetings ?? []).map((m) => [m.id, { app: m.app, inPerson: Boolean(m.inPerson) }])))
        .catch(() => ({})),
    );
  }
  return lookups.get(botId)!;
}

/** Notes that arrived while the chat was open don't carry the app yet: look it up once. */
function useMeetingApp(botId: string, ref: ChatMeetingRef) {
  const [found, setFound] = React.useState<{ app: string; inPerson: boolean } | null>(ref.app ? { app: ref.app, inPerson: Boolean(ref.inPerson) } : null);
  React.useEffect(() => {
    if (found || ref.gone) return;
    let cancelled = false;
    void lookup(botId).then(async (map) => {
      const hit = map[ref.id] ?? (await lookup(botId, true))[ref.id];
      if (!cancelled && hit) setFound(hit);
    });
    return () => {
      cancelled = true;
    };
  }, [botId, ref.id, ref.gone, found]);
  return found;
}

export function ChatMeetingNotes({ botId, text, meeting }: { botId: string; text: string; meeting: ChatMeetingRef }) {
  const parsed = React.useMemo(() => parseNotesMessage(text), [text]);
  const app = useMeetingApp(botId, meeting);
  const href = `/app/bots/${botId}/meetings/${meeting.id}`;
  const meta = [parsed.duration, parsed.tally].filter(Boolean).join(" · ");
  return (
    <div className="max-w-full self-start overflow-hidden rounded-3xl rounded-tl-lg border border-border bg-bubble-bot shadow-soft sm:min-w-[22rem]">
      <div className="flex items-center gap-3 border-b border-border bg-gradient-to-r from-primary-soft/70 to-transparent px-4 py-3">
        {app ? (
          <BrandTile icon={meetingAppIcon(app.app, app.inPerson)} size={36} className="shrink-0" />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <NotebookPen className="size-[18px]" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-bold tracking-[0.08em] text-primary uppercase">{parsed.missing ? "No notes this time" : "Meeting notes"}</div>
          <div className="line-clamp-2 leading-snug font-semibold break-words">{parsed.title ?? "Your meeting"}</div>
          {meta ? <div className="truncate text-xs text-muted-foreground">{meta}</div> : null}
        </div>
        {meeting.gone ? (
          <span className="shrink-0 text-xs text-muted-foreground">Deleted</span>
        ) : (
          <Link
            href={href}
            aria-label={parsed.missing ? "Open the meeting" : "Open notes"}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary-soft px-3 text-sm font-semibold text-primary transition hover:brightness-95 dark:hover:brightness-125"
          >
            {/* Short on phones, so the meeting's title gets the room. */}
            Open<span className="hidden sm:inline">{parsed.missing ? " meeting" : " notes"}</span> <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      <div className="px-4 py-3 text-[15px]">
        <Markdown text={parsed.body} />
        {parsed.footer ? <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">{parsed.footer}</p> : null}
      </div>
    </div>
  );
}
