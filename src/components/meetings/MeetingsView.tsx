"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, AudioLines, Check, ChevronRight, Laptop, ListChecks, LoaderCircle, NotebookPen, Sparkles } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { dayKey, dayLabel, timeLabel, useNow } from "@/components/bot/activity/time";
import { api, ApiError } from "@/lib/client/api";
import { BrowserRecorder, type RecorderBlock } from "./BrowserRecorder";
import type { BotFace } from "./RecorderSetup";
import { formatDuration, meetingAppIcon, recordingHere, STATUS, statusOf, type MeetingView } from "./shared";

export type DesktopDevice = { id: string; name: string; online: boolean };

type Props = {
  botId: string;
  bot: BotFace & { paused: boolean };
  ownerId: string;
  ownerName: string;
  timezone: string;
  serverNow: string;
  initialMeetings: MeetingView[];
  enabled: boolean;
  available: boolean;
  plan: { id: string; name: string; minutes: number };
  minutesUsed: number;
  resetsOn: string;
  transcriptDays: number | null;
  desktopDevices: DesktopDevice[];
};

const KEEP_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "forever", label: "Forever" },
] as const;
type KeepValue = (typeof KEEP_OPTIONS)[number]["value"];

export function MeetingsView(props: Props) {
  const { botId, bot, timezone, plan } = props;
  const router = useRouter();
  const [meetings, setMeetings] = React.useState(props.initialMeetings);
  const [enabled, setEnabled] = React.useState(props.enabled);
  const [turningOn, setTurningOn] = React.useState(false);
  const [ownId, setOwnId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [stopping, setStopping] = React.useState(false);
  const [elsewhereHere, setElsewhereHere] = React.useState(false);
  const now = useNow(props.serverNow, 30_000);

  React.useEffect(() => setMeetings(props.initialMeetings), [props.initialMeetings]);
  React.useEffect(() => setEnabled(props.enabled), [props.enabled]);

  const minutesLeft = Math.max(0, plan.minutes - props.minutesUsed);
  const active = meetings.find((m) => m.status === "recording" && m.id !== ownId) ?? (busyId ? meetings.find((m) => m.id === busyId) : undefined) ?? null;

  React.useEffect(() => {
    if (!active) return;
    setElsewhereHere(recordingHere(active.id));
  }, [active]);

  // Keep statuses fresh while something is recording or being written.
  const working = meetings.some((m) => m.status === "recording" || m.status === "processing");
  React.useEffect(() => {
    if (!working) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const data = await api<{ meetings: MeetingView[] }>(`/api/bots/${botId}/meetings`);
        setMeetings(data.meetings);
      } catch {
        /* next time */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [working, botId]);

  const turnOn = async () => {
    setTurningOn(true);
    try {
      await api(`/api/bots/${botId}/connections`, { method: "POST", body: { connectorId: "meetings" } });
      setEnabled(true);
      toast.success(`Meeting notes are on. ${bot.name} is ready when you are.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't turn it on. Try again.");
    } finally {
      setTurningOn(false);
    }
  };

  const stopActive = async () => {
    if (!active) return;
    setStopping(true);
    try {
      const { meeting } = await api<{ meeting: MeetingView }>(`/api/bots/${botId}/meetings/${active.id}/finish`, { method: "POST" });
      setMeetings((ms) => ms.map((m) => (m.id === meeting.id ? meeting : m)));
      setBusyId(null);
      toast.success(`${bot.name} stopped and is writing your notes.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't stop it. Try again.");
    } finally {
      setStopping(false);
    }
  };

  const block: RecorderBlock = !enabled
    ? { kind: "off", text: `Turn on meeting notes for ${bot.name} first.` }
    : !props.available
      ? { kind: "unavailable", text: "Meeting notes aren't set up on this server yet." }
      : bot.paused
        ? { kind: "paused", text: `${bot.name} is paused. Resume it at the top of the page to take notes.` }
        : active && (active.source === "desktop" || elsewhereHere)
          ? { kind: "busy", text: `${bot.name} is already taking notes in another meeting.` }
          : minutesLeft <= 0
            ? { kind: "minutes", text: `You've used all ${plan.minutes} meeting minutes on ${plan.name} this month.` }
            : null;

  const groups = React.useMemo(() => {
    const out: { key: string; items: MeetingView[] }[] = [];
    for (const m of meetings) {
      const key = dayKey(m.startedAt, timezone);
      const g = out[out.length - 1];
      if (g && g.key === key) g.items.push(m);
      else out.push({ key, items: [m] });
    }
    return out;
  }, [meetings, timezone]);

  const desktopCard = <DesktopCard botName={bot.name} devices={props.desktopDevices} />;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-2xl font-bold sm:text-3xl">Meetings</h2>
        <p className="max-w-2xl text-muted-foreground">
          {bot.name} takes notes in your calls when you say yes. Audio becomes text and is thrown away.
        </p>
      </div>

      {!enabled ? (
        <TurnOnCard bot={bot} onTurnOn={turnOn} busy={turningOn} />
      ) : (
        <>
          {active ? (
            <div className="flex flex-col gap-3 rounded-3xl border border-danger/25 bg-danger-soft/50 p-4 sm:flex-row sm:items-center sm:p-5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="relative flex size-3 shrink-0" aria-hidden>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
                  <span className="relative inline-flex size-3 rounded-full bg-danger" />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold">
                    {bot.name} is taking notes{" "}
                    {active.source === "desktop" ? "with the desktop app" : elsewhereHere ? "in another tab" : "in another browser"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <span className="block truncate sm:inline">{active.title}</span>
                    <span className="hidden sm:inline"> · </span>
                    started {timeLabel(active.startedAt, timezone)}
                    {active.source === "browser" && !elsewhereHere ? ". Starting notes here wraps that one up." : ""}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/bots/${botId}/meetings/${active.id}`}>Open</Link>
                </Button>
                <Button variant="danger-soft" size="sm" onClick={stopActive} loading={stopping}>
                  Stop and write notes
                </Button>
              </div>
            </div>
          ) : null}

          <section aria-labelledby="take-notes-title" className="flex flex-col gap-3">
            <div>
              <h3 id="take-notes-title" className="font-display text-lg font-semibold">
                Take notes in a call
              </h3>
              <p className="text-sm text-muted-foreground">Either way, {bot.name} asks first and stays on your screen the whole time it listens.</p>
            </div>
            <BrowserRecorder
              botId={botId}
              bot={bot}
              ownerId={props.ownerId}
              ownerName={props.ownerName}
              minutesLeft={minutesLeft}
              block={block}
              desktopCard={desktopCard}
              onStarted={(m) => {
                setOwnId(m.id);
                setMeetings((ms) => [m, ...ms.filter((x) => x.id !== m.id)]);
              }}
              onDiscarded={(id) => {
                setOwnId(null);
                setMeetings((ms) => ms.filter((x) => x.id !== id));
              }}
              onBlocked={({ code, meetingId }) => {
                if (code === "meetings_off") setEnabled(false);
                if (code === "already_recording" && meetingId) {
                  setBusyId(meetingId);
                  router.refresh();
                }
              }}
            />
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <MinutesCard plan={plan} used={props.minutesUsed} resetsOn={props.resetsOn} />
            <KeepCard botId={botId} initial={props.transcriptDays} />
          </div>
        </>
      )}

      <section aria-labelledby="meetings-list-title" className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <h3 id="meetings-list-title" className="font-display text-lg font-semibold">
            Your meetings
          </h3>
          {meetings.length ? <span className="text-sm text-muted-foreground">{meetings.length === 1 ? "1 meeting" : `${meetings.length} meetings`}</span> : null}
        </div>
        {meetings.length ? (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <div key={g.key}>
                <h4 className="mb-2 px-1 text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">{dayLabel(g.key, now, timezone)}</h4>
                <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
                  {g.items.map((m) => (
                    <MeetingRow key={m.id} botId={botId} meeting={m} timezone={timezone} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <EmptyMeetings bot={bot} enabled={enabled} />
        )}
      </section>
    </div>
  );
}

function StatusBadge({ m }: { m: MeetingView }) {
  const key = statusOf(m);
  const s = STATUS[key];
  return (
    <Badge tone={s.tone}>
      {key === "recording" ? (
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-danger" />
        </span>
      ) : key === "writing" ? (
        <LoaderCircle className="animate-spin" aria-hidden />
      ) : null}
      {s.label}
    </Badge>
  );
}

function MeetingRow({ botId, meeting: m, timezone }: { botId: string; meeting: MeetingView; timezone: string }) {
  const open = m.actionItems.filter((a) => !a.done).length;
  const key = statusOf(m);
  return (
    <li>
      <Link
        href={`/app/bots/${botId}/meetings/${m.id}`}
        className="group flex items-start gap-3.5 px-4 py-4 transition hover:bg-muted/50 focus-visible:-outline-offset-2 sm:px-5"
      >
        <BrandTile icon={meetingAppIcon(m.app, m.inPerson)} size={44} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-semibold break-words">{m.title}</span>
            <StatusBadge m={m} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {timeLabel(m.startedAt, timezone)} · {formatDuration(m.durationSec)}
            {m.status === "recording" ? " so far" : ""} · {m.inPerson ? "In person" : m.appName}
          </div>
          {m.summary ? (
            <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{m.summary}</p>
          ) : key === "failed" && m.error ? (
            <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{m.error}</p>
          ) : null}
          {m.actionItems.length ? (
            <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <ListChecks className="size-3.5 text-primary" aria-hidden />
              {m.actionItems.length} action item{m.actionItems.length === 1 ? "" : "s"}
              {open < m.actionItems.length ? <span className="text-muted-foreground">· {open} open</span> : null}
            </span>
          ) : null}
        </div>
        <ChevronRight className="mt-3 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

function TurnOnCard({ bot, onTurnOn, busy }: { bot: BotFace; onTurnOn: () => void; busy: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary-soft via-card to-card p-6 shadow-soft sm:p-8">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(60%_80%_at_15%_50%,#000,transparent)]" aria-hidden />
      <div className="relative flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:text-left">
        <div className="relative shrink-0">
          <span className="absolute inset-3 rounded-full bg-primary/15 blur-2xl" aria-hidden />
          <Avatar avatar={bot.avatar} color={bot.color} mood="listening" size={132} title={bot.name} />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-xl font-bold sm:text-2xl">Let {bot.name} take notes in your calls</h3>
          <p className="mt-1.5 max-w-xl text-[15px] text-muted-foreground">
            Turn on Meeting notes, and {bot.name} can listen in when you say yes. You get a summary, decisions and action items, and you can ask about
            any meeting later.
          </p>
          <ul className="mx-auto mt-4 flex w-fit flex-col items-start gap-1.5 text-left text-sm sm:mx-0">
            {["It asks first, every time", "It stays on your screen while it listens", "Audio becomes text and is thrown away"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden>
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {t}
              </li>
            ))}
          </ul>
          <Button size="lg" className="mt-5" onClick={onTurnOn} loading={busy}>
            {!busy ? <AudioLines /> : null}
            Turn on meeting notes
          </Button>
        </div>
      </div>
    </div>
  );
}

function DesktopCard({ botName, devices }: { botName: string; devices: DesktopDevice[] }) {
  const apps = ["zoom", "meet", "teams", "webex", "slack"] as const;
  const online = devices.find((d) => d.online);
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background">
          <Laptop className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-lg leading-tight font-semibold">
            With the desktop app <Badge tone="primary">Beta</Badge>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Notices when a call starts in Zoom, Meet, Teams…, asks first, and sits at the bottom of your screen while it listens.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {apps.map((a) => (
            <BrandTile key={a} icon={meetingAppIcon(a)} size={30} className="ring-2 ring-card" />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {devices.length
            ? online
              ? `Paired on ${online.name} · online`
              : `Paired on ${devices[0].name} · offline`
            : `Mac and Windows. ${botName} pops up when a call starts.`}
        </span>
      </div>
      <div className="mt-auto">
        <Button asChild variant="outline">
          <Link href="/app/bridge#desktop">
            {devices.length ? "Manage the desktop app" : "Set up the desktop app"} <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function MinutesCard({ plan, used, resetsOn }: { plan: { id: string; name: string; minutes: number }; used: number; resetsOn: string }) {
  const left = Math.max(0, plan.minutes - used);
  const pct = (Math.min(used, plan.minutes) / Math.max(1, plan.minutes)) * 100;
  const low = left <= Math.max(15, plan.minutes * 0.15);
  const hours = (n: number) => (n % 60 === 0 && n >= 60 ? `${n / 60} hours` : `${n.toLocaleString("en-US")} min`);
  return (
    <div className="flex flex-col justify-center gap-2 rounded-3xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold">
          {used.toLocaleString("en-US")} of {plan.minutes.toLocaleString("en-US")} meeting minutes
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge tone="primary">{plan.name}</Badge>
          {plan.id !== "pro" ? (
            <Link href="/app/billing" className="text-xs font-semibold text-primary hover:underline">
              {low ? "Get more" : "Plans"}
            </Link>
          ) : null}
        </span>
      </div>
      <Progress value={pct} tone={left === 0 ? "danger" : low ? "warning" : "primary"} label="Meeting minutes used this month" />
      <div className="text-xs text-muted-foreground">
        {left === 0 ? "None left this month." : `${hours(left)} left this month.`} Resets {resetsOn}.
        {low && plan.id !== "pro" ? (
          <>
            {" "}
            <Link href="/app/billing" className="font-semibold text-primary hover:underline">
              {plan.id === "free" ? "Plus has 15 hours a month." : "Pro has 50 hours a month."}
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}

function KeepCard({ botId, initial }: { botId: string; initial: number | null }) {
  const toValue = (d: number | null): KeepValue => (d === null ? "forever" : d <= 30 ? "30" : "90");
  const [value, setValue] = React.useState<KeepValue>(toValue(initial));
  const [saving, setSaving] = React.useState(false);
  const change = async (v: KeepValue) => {
    const prev = value;
    setValue(v);
    setSaving(true);
    try {
      await api(`/api/bots/${botId}`, { method: "PATCH", body: { limits: { transcriptDays: v === "forever" ? null : Number(v) } } });
      toast.success(v === "forever" ? "Transcripts are kept until you delete them." : `Transcripts are deleted after ${v} days. Notes stay.`);
    } catch (err) {
      setValue(prev);
      toast.error(err instanceof ApiError ? err.message : "Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col justify-center gap-2.5 rounded-3xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span id="keep-transcripts" className="text-sm font-semibold">
          Keep transcripts
        </span>
        {saving ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
      </div>
      <Segmented<KeepValue> aria-label="Keep transcripts for" value={value} onChange={(v) => void change(v)} options={KEEP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} size="sm" className="self-start" />
      <p className="text-xs text-muted-foreground">Notes stay until you delete them. You can delete any transcript sooner.</p>
    </div>
  );
}

function EmptyMeetings({ bot, enabled }: { bot: BotFace; enabled: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
      <div className="relative">
        <div className="absolute -top-2 -right-16 hidden rotate-6 rounded-2xl border border-border bg-card px-3 py-2 text-left shadow-soft sm:block" aria-hidden>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
            <NotebookPen className="size-3" /> Notes
          </div>
          <div className="mt-1 h-1.5 w-16 rounded-full bg-muted" />
          <div className="mt-1 h-1.5 w-12 rounded-full bg-muted" />
        </div>
        <Avatar avatar={bot.avatar} color={bot.color} mood="idle" size={96} title={bot.name} />
      </div>
      <div className="font-display text-lg font-semibold">No meetings yet</div>
      <p className="max-w-md text-sm text-muted-foreground">
        {enabled
          ? `Start notes in your next call. The summary, action items and transcript land here, and ${bot.name} sends you the notes in chat.`
          : `Once meeting notes are on, every meeting ${bot.name} takes notes in shows up here.`}
      </p>
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" aria-hidden /> Later, just ask: &ldquo;What did we decide in Monday&apos;s call?&rdquo;
      </p>
    </div>
  );
}

