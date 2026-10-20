"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Check,
  Clock,
  Copy,
  Download,
  Eraser,
  FileText,
  Globe,
  Laptop,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { Markdown } from "@/components/chat/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { useNow, whenLabel } from "@/components/bot/activity/time";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { TranscriptList } from "./Transcript";
import {
  ACTIONS_SECTION,
  clock,
  copyText,
  downloadText,
  fileSlug,
  formatDuration,
  meetingAppIcon,
  meetingExport,
  mergeSegments,
  noteSections,
  speakerName,
  STATUS,
  statusOf,
  SUMMARY_SECTION,
  type BotFace,
  type MeetingView,
  type SegmentView,
} from "./shared";

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function MeetingDetail({
  botId,
  bot,
  initialMeeting,
  initialSegments,
  ownerName,
  timezone,
  serverNow,
  transcriptDays,
}: {
  botId: string;
  bot: BotFace;
  initialMeeting: MeetingView;
  initialSegments: SegmentView[];
  ownerName: string;
  timezone: string;
  serverNow: string;
  /** How long transcripts are kept (null = until deleted). */
  transcriptDays: number | null;
}) {
  const router = useRouter();
  const [m, setM] = React.useState(initialMeeting);
  const [segments, setSegments] = React.useState(initialSegments);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState<null | "stop" | "rewrite" | "delete" | "transcript">(null);
  const [confirm, setConfirm] = React.useState<null | "meeting" | "transcript">(null);
  const now = useNow(serverNow, 30_000);
  const status = statusOf(m);
  const listHref = `/app/bots/${botId}/meetings`;
  const ask = (text: string) => `/app/bots/${botId}?ask=${encodeURIComponent(text)}`;

  // Follow along while it's recording or the notes are being written.
  const working = m.status === "recording" || m.status === "processing";
  /** The status we last showed, to announce "notes are ready" once (not from inside a state updater). */
  const shownStatus = React.useRef(m.status);
  React.useEffect(() => {
    shownStatus.current = m.status;
  }, [m.status]);
  React.useEffect(() => {
    if (!working) return;
    let since: string | null = null;
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState !== "visible" && since) return;
      try {
        const data = await api<{ meeting: MeetingView; segments: SegmentView[]; serverTime: string }>(
          `/api/bots/${botId}/meetings/${m.id}${since ? `?since=${encodeURIComponent(since)}` : ""}`,
        );
        if (cancelled) return;
        since = data.serverTime;
        setSegments((prev) => mergeSegments(prev, data.segments));
        const next = data.meeting;
        if (shownStatus.current === "processing" && next.status !== "processing") {
          if (next.notes) toast.success("Your notes are ready!", { description: `${bot.name} also sent them to your chat.` });
          else toast(`${bot.name} couldn't write notes for this one.`);
        }
        shownStatus.current = next.status;
        setM(next);
      } catch (err) {
        if (!cancelled && err instanceof ApiError && err.status === 404) {
          toast("This meeting was deleted.");
          router.push(listHref);
        }
      }
    };
    void tick();
    const t = setInterval(tick, m.status === "recording" ? 3000 : 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [working, m.status, m.id, botId, bot.name, listHref, router]);

  const patch = async (body: Record<string, unknown>) => {
    const res = await api<{ meeting: MeetingView }>(`/api/bots/${botId}/meetings/${m.id}`, { method: "PATCH", body });
    return res.meeting;
  };

  const stop = async () => {
    setBusy("stop");
    try {
      const { meeting } = await api<{ meeting: MeetingView }>(`/api/bots/${botId}/meetings/${m.id}/finish`, { method: "POST" });
      setM(meeting);
      toast.success(`${bot.name} stopped and is writing your notes.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't stop it. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const rewrite = async () => {
    setBusy("rewrite");
    try {
      setM(await patch({ rewrite: true }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't start that. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const toggleItem = async (index: number, done: boolean) => {
    const before = m.actionItems;
    setM((x) => ({ ...x, actionItems: x.actionItems.map((a, i) => (i === index ? { ...a, done } : a)) }));
    try {
      await patch({ actionItem: { index, done } });
    } catch (err) {
      setM((x) => ({ ...x, actionItems: before }));
      toast.error(err instanceof ApiError ? err.message : "Couldn't save that. Try again.");
    }
  };

  const deleteMeeting = async () => {
    setBusy("delete");
    try {
      await api(`/api/bots/${botId}/meetings/${m.id}`, { method: "DELETE" });
      toast.success("Meeting deleted. The notes and transcript are gone.");
      router.push(listHref);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't delete it. Try again.");
      setBusy(null);
    }
  };

  const deleteTranscript = async () => {
    setBusy("transcript");
    try {
      setM(await patch({ deleteTranscript: true }));
      setSegments([]);
      setConfirm(null);
      toast.success("Transcript deleted. Your notes stay.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't delete it. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const when = whenLabel(m.startedAt, now, timezone);
  const exportText = (format: "txt" | "md") => meetingExport(m, segments, { ownerName, when, format });
  const download = (format: "txt" | "md") => {
    downloadText(`${fileSlug(m.title)}.${format}`, exportText(format), format === "md" ? "text/markdown" : "text/plain");
  };
  const copyTranscript = async () => {
    const text = segments.map((s) => `[${clock(s.startMs)}] ${speakerName(s, ownerName)}: ${s.text}`).join("\n");
    if (await copyText(text)) toast.success("Transcript copied.");
    else toast.error("Couldn't copy. Try downloading it instead.");
  };

  const q = query.trim().toLowerCase();
  const shown = q ? segments.filter((s) => s.text.toLowerCase().includes(q) || speakerName(s, ownerName).toLowerCase().includes(q)) : segments;
  const sections = m.notes ? noteSections(m.notes).filter((s) => !SUMMARY_SECTION.test(s.title) && !ACTIONS_SECTION.test(s.title) && s.body) : [];
  const done = m.actionItems.filter((a) => a.done).length;
  const canExport = Boolean(segments.length || m.notes);
  const expires =
    transcriptDays !== null && !m.transcriptDeleted && segments.length
      ? new Date(new Date(m.startedAt).getTime() + transcriptDays * 86400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone })
      : null;
  const speakers = [...new Set(segments.map((s) => speakerName(s, ownerName)))];

  return (
    <div className="flex flex-col gap-6">
      <Link href={listHref} className="inline-flex w-fit items-center gap-1.5 rounded-full text-sm font-medium text-muted-foreground transition hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All meetings
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          <BrandTile icon={meetingAppIcon(m.app, m.inPerson)} size={48} className="mt-0.5 shrink-0" label={m.inPerson ? "In person" : m.appName} />
          <div className="min-w-0 flex-1">
            <TitleEditor
              title={m.title}
              onSave={async (title) => {
                const before = m.title;
                setM((x) => ({ ...x, title }));
                try {
                  await patch({ title });
                  toast.success("Renamed.");
                } catch (err) {
                  setM((x) => ({ ...x, title: before }));
                  toast.error(err instanceof ApiError ? err.message : "Couldn't rename it. Try again.");
                }
              }}
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" aria-hidden /> {when}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4" aria-hidden /> {m.status === "recording" ? `${formatDuration(m.durationSec)} so far` : formatDuration(m.durationSec)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                {m.inPerson ? <Users className="size-4" aria-hidden /> : m.source === "desktop" ? <Laptop className="size-4" aria-hidden /> : <Globe className="size-4" aria-hidden />}
                {m.inPerson ? "In person" : m.appName}
                {m.source === "desktop" ? " · desktop app" : ""}
              </span>
              <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status === "ready" ? (
            <Button asChild variant="soft">
              <Link href={ask(`About my meeting “${m.title}”: `)}>
                <MessageCircle /> Ask {bot.name}
              </Link>
            </Button>
          ) : null}
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More options">
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => void copyTranscript()} disabled={!segments.length}>
                <Copy /> Copy transcript
              </DropdownItem>
              <DropdownItem onSelect={() => download("txt")} disabled={!canExport}>
                <FileText /> Download as .txt
              </DropdownItem>
              <DropdownItem onSelect={() => download("md")} disabled={!canExport}>
                <Download /> Download as .md
              </DropdownItem>
              <DropdownSeparator />
              {segments.length && !m.transcriptDeleted && m.status !== "recording" && m.status !== "processing" ? (
                <DropdownItem onSelect={() => setConfirm("transcript")}>
                  <Eraser /> Delete the transcript, keep the notes
                </DropdownItem>
              ) : null}
              <DropdownItem danger onSelect={() => setConfirm("meeting")}>
                <Trash2 /> Delete meeting
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
      </header>

      {status === "recording" ? (
        <Banner
          tone="danger"
          avatar={<Avatar avatar={bot.avatar} color={bot.color} mood="listening" size={56} title={bot.name} />}
          action={
            <Button variant="danger-soft" onClick={stop} loading={busy === "stop"}>
              Stop and write notes
            </Button>
          }
        >
          <div className="font-semibold">
            {bot.name} is taking notes{m.source === "desktop" ? " with the desktop app" : ""}
          </div>
          <p className="text-sm text-muted-foreground">
            {m.source === "desktop"
              ? `Use ${bot.name} at the bottom of your screen to pause or stop. The transcript fills in below as it's heard on your computer.`
              : "The transcript fills in below as people talk."}
          </p>
        </Banner>
      ) : status === "writing" ? (
        <Banner tone="primary" avatar={<Avatar avatar={bot.avatar} color={bot.color} mood="thinking" size={56} title={bot.name} />} live>
          <div className="shimmer-text font-semibold">{bot.name} is writing your notes…</div>
          <p className="text-sm text-muted-foreground">Usually a few seconds. They&apos;ll show up here and in your chat.</p>
        </Banner>
      ) : status === "failed" ? (
        <Banner
          tone="neutral"
          avatar={<Avatar avatar={bot.avatar} color={bot.color} mood="alert" size={56} title={bot.name} />}
          action={
            segments.length && !m.transcriptDeleted ? (
              <Button onClick={rewrite} loading={busy === "rewrite"}>
                {busy !== "rewrite" ? <RefreshCw /> : null} Try again
              </Button>
            ) : null
          }
        >
          <div className="font-semibold">No notes this time</div>
          <p className="text-sm text-muted-foreground">{m.error ?? "The notes didn't get written."}</p>
        </Banner>
      ) : null}

      {status === "ready" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
          <div className="flex flex-col gap-4">
            {m.summary ? (
              <section aria-labelledby="summary-title" className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
                <h3 id="summary-title" className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">
                  Summary
                </h3>
                <p className="mt-2 text-[17px] leading-relaxed text-pretty">{m.summary}</p>
                <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 text-primary" aria-hidden />
                  Written by {bot.name}
                  {m.notesBy ? ` with ${m.notesBy}` : ""}
                </p>
              </section>
            ) : null}
            {sections.length ? (
              <section aria-label="Notes" className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
                {sections.map((s, i) => (
                  <div key={i}>
                    {s.title ? <h3 className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">{s.title}</h3> : null}
                    <Markdown text={s.body} className="mt-2 text-[15px]" />
                  </div>
                ))}
              </section>
            ) : null}
          </div>
          <section aria-labelledby="actions-title" className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6 lg:sticky lg:top-4">
            <div className="flex items-center justify-between gap-3">
              <h3 id="actions-title" className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">
                Action items
              </h3>
              {m.actionItems.length ? (
                <span className="text-xs font-medium text-muted-foreground">
                  {done} of {m.actionItems.length} done
                </span>
              ) : null}
            </div>
            {m.actionItems.length ? (
              <ul className="-mx-2 mt-2 flex flex-col">
                {m.actionItems.map((a, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer gap-3 rounded-2xl px-2 py-2.5 transition hover:bg-muted/60">
                      <input
                        type="checkbox"
                        checked={Boolean(a.done)}
                        onChange={(e) => void toggleItem(i, e.target.checked)}
                        className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-[var(--primary)]"
                      />
                      <span className="min-w-0">
                        <span className={cn("block text-[15px] leading-snug", a.done && "text-muted-foreground line-through")}>{cap(a.text)}</span>
                        {a.owner || a.due ? (
                          <span className="mt-1.5 flex flex-wrap gap-1.5">
                            {a.owner ? (
                              <Badge tone="primary">
                                <UserRound aria-hidden /> {a.owner}
                              </Badge>
                            ) : null}
                            {a.due ? (
                              <Badge tone="neutral">
                                <CalendarClock aria-hidden /> {a.due}
                              </Badge>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Nobody signed up for anything this time.</p>
            )}
            {m.actionItems.length ? (
              <Link href={ask(`Remind me about my action items from “${m.title}”.`)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                <MessageCircle className="size-4" aria-hidden /> Ask {bot.name} to remind you
              </Link>
            ) : null}
          </section>
        </div>
      ) : null}

      {status === "ready" ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Ask {bot.name} about it</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Draft a recap email", text: `Draft a recap email for everyone from my meeting “${m.title}”.` },
              { label: "What did we decide?", text: `What did we decide in my meeting “${m.title}”?` },
              { label: "Set reminders for my action items", text: `Set reminders for my action items from “${m.title}”.` },
            ].map((c) => (
              <Link
                key={c.label}
                href={ask(c.text)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground/90 shadow-soft transition hover:border-primary/40 hover:text-primary"
              >
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                {c.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <section aria-labelledby="transcript-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="transcript-title" className="font-display text-lg font-semibold">
              Transcript
            </h3>
            <p className="text-sm text-muted-foreground">
              {m.transcriptDeleted
                ? "Deleted. The notes stay."
                : segments.length
                  ? `${segments.length} line${segments.length === 1 ? "" : "s"}${speakers.length ? ` · ${speakers.join(", ")}` : ""}${expires ? ` · kept until ${expires}` : ""}`
                  : "The audio is never kept, only the text."}
            </p>
          </div>
          {segments.length ? (
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the transcript"
                  aria-label="Search the transcript"
                  className="h-10 rounded-full pr-9 pl-10 text-sm"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted" aria-label="Clear search">
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
              <Button variant="outline" size="icon" onClick={() => void copyTranscript()} aria-label="Copy transcript">
                <Copy />
              </Button>
              <Dropdown>
                <DropdownTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Download">
                    <Download />
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  <DropdownItem onSelect={() => download("txt")}>
                    <FileText /> Download as .txt
                  </DropdownItem>
                  <DropdownItem onSelect={() => download("md")}>
                    <Download /> Download as .md
                  </DropdownItem>
                </DropdownContent>
              </Dropdown>
            </div>
          ) : null}
        </div>
        <div className="rounded-3xl border border-border bg-card p-4 shadow-soft sm:p-6">
          {m.transcriptDeleted ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Eraser className="size-5" aria-hidden />
              </span>
              <div className="font-semibold">The transcript was deleted</div>
              <p className="max-w-sm text-sm text-muted-foreground">The summary and action items are still here. The audio was never kept.</p>
            </div>
          ) : !segments.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {m.status === "recording" ? "Lines show up here a few seconds after people talk." : "Nothing was transcribed in this meeting."}
            </p>
          ) : shown.length ? (
            <>
              {q ? (
                <p className="mb-4 text-sm text-muted-foreground" role="status">
                  {shown.length} line{shown.length === 1 ? "" : "s"} match &ldquo;{query.trim()}&rdquo;
                </p>
              ) : null}
              <TranscriptList segments={shown} ownerName={ownerName} query={query} />
            </>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground" role="status">
              No lines match &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
        </div>
      </section>

      <Dialog open={confirm === "meeting"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this meeting?</DialogTitle>
            <DialogDescription>
              The notes, action items and transcript of &ldquo;{m.title}&rdquo; are deleted for good. {bot.name}&apos;s message in your chat stays.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse items-stretch sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={deleteMeeting} loading={busy === "delete"}>
              {busy !== "delete" ? <Trash2 /> : null} Delete meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm === "transcript"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete the transcript?</DialogTitle>
            <DialogDescription>
              Every line of what was said is deleted for good. The summary, decisions and action items stay. You won&apos;t be able to search this
              meeting or have the notes written again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse items-stretch sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={deleteTranscript} loading={busy === "transcript"}>
              {busy !== "transcript" ? <Eraser /> : null} Delete transcript
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Banner({
  tone,
  avatar,
  live,
  action,
  children,
}: {
  tone: "danger" | "primary" | "warning" | "neutral";
  avatar: React.ReactNode;
  live?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role={live ? "status" : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-3xl border p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5",
        tone === "danger" && "border-danger/25 bg-danger-soft/50",
        tone === "primary" && "border-primary/20 bg-primary-soft/50",
        tone === "warning" && "border-warning/30 bg-warning-soft/60",
        tone === "neutral" && "border-border bg-card shadow-soft",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="shrink-0">{avatar}</span>
        <div className="min-w-0">{children}</div>
      </div>
      {action ? <div className="shrink-0 sm:ml-auto">{action}</div> : null}
    </div>
  );
}

function TitleEditor({ title, onSave }: { title: string; onSave: (title: string) => Promise<void> }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);
  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <div className="group flex items-start gap-1.5">
        <h2 className="min-w-0 font-display text-2xl leading-tight font-bold break-words sm:text-3xl">{title}</h2>
        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Rename meeting" className="mt-0.5 shrink-0 text-muted-foreground">
          <Pencil />
        </Button>
      </div>
    );
  }
  const save = async () => {
    const t = draft.trim();
    if (!t || t === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    await onSave(t.slice(0, 120));
    setSaving(false);
    setEditing(false);
  };
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={120}
        aria-label="Meeting title"
        className="h-11 font-display text-lg font-semibold"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={saving}>
          {!saving ? <Check /> : null} Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
