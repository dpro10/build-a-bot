"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, CalendarClock, CircleCheck, Clock, MoreHorizontal, Pencil, Play, Plus, Repeat, Send, Sparkles, Trash2 } from "lucide-react";
import { useBotLive } from "@/components/app/live-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { EmptyState, Progress } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { ago, useNow, whenLabel } from "@/components/bot/activity/time";
import { RoutineDialog, blankForm, formFrom, type DeliverOption, type RoutineForm } from "./RoutineDialog";
import { TEMPLATES, describeSchedule, isFinished, routineEmoji, type ScheduleView, type Template } from "./schedule";
import { PLANS } from "@/lib/billing/plans";

type DialogState = { open: boolean; initial: RoutineForm; editing: ScheduleView | null };

function normalize(row: ScheduleView & { description?: string }): ScheduleView {
  return {
    id: row.id,
    kind: row.kind === "reminder" ? "reminder" : "routine",
    title: row.title,
    prompt: row.prompt,
    schedule: row.schedule,
    timezone: row.timezone,
    deliverOn: row.deliverOn,
    active: row.active,
    nextRunAt: row.nextRunAt ? new Date(row.nextRunAt).toISOString() : null,
    lastRunAt: row.lastRunAt ? new Date(row.lastRunAt).toISOString() : null,
    runCount: row.runCount ?? 0,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/**
 * The order the page opens with: routines that are on first, soonest next; reminders still
 * to come first, finished ones last. It stays put after that, so a card doesn't jump away
 * from under the switch you just flipped (new ones show up on top).
 */
function initialRank(list: ScheduleView[], now: Date): Map<string, number> {
  const routines = list
    .filter((s) => s.kind === "routine")
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.nextRunAt ?? "9").localeCompare(b.nextRunAt ?? "9"));
  const reminders = list
    .filter((s) => s.kind === "reminder")
    .sort((a, b) => {
      const fa = isFinished(a, now);
      const fb = isFinished(b, now);
      if (fa !== fb) return fa ? 1 : -1;
      if (fa) return (b.lastRunAt ?? b.createdAt).localeCompare(a.lastRunAt ?? a.createdAt);
      return Number(b.active) - Number(a.active) || (a.nextRunAt ?? "9").localeCompare(b.nextRunAt ?? "9");
    });
  return new Map([...routines, ...reminders].map((s, i) => [s.id, i]));
}

export function RoutinesView({
  botId,
  botName,
  timezone,
  tzName,
  serverNow,
  initial,
  plan,
  deliverOptions,
  autoHint,
}: {
  botId: string;
  botName: string;
  timezone: string;
  tzName: string;
  serverNow: string;
  initial: ScheduleView[];
  plan: { id: string; name: string; limit: number };
  deliverOptions: DeliverOption[];
  autoHint: string;
}) {
  const router = useRouter();
  const live = useBotLive();
  const now = useNow(serverNow);
  const [items, setItems] = React.useState<ScheduleView[]>(initial);
  const [dialog, setDialog] = React.useState<DialogState>(() => ({ open: false, initial: blankForm("routine", timezone), editing: null }));
  const [confirm, setConfirm] = React.useState<ScheduleView | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [running, setRunning] = React.useState<string | null>(null);

  const [rank] = React.useState(() => initialRank(initial, new Date(serverNow)));
  // Unranked (just made here, or new since the page opened) first, in the order they arrived.
  const byRank = (a: ScheduleView, b: ScheduleView) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1);
  const routines = items.filter((s) => s.kind === "routine").sort(byRank);
  const reminders = items.filter((s) => s.kind === "reminder").sort(byRank);
  const activeRoutines = routines.filter((r) => r.active).length;
  const atLimit = activeRoutines >= plan.limit;
  const overLimit = activeRoutines > plan.limit;
  const nextPlan = plan.id === "free" ? PLANS.plus : PLANS.pro;
  const nextUp = items
    .filter((s) => s.active && s.nextRunAt)
    .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];

  const refresh = React.useCallback(async () => {
    try {
      const res = await api<{ schedules: ScheduleView[] }>(`/api/bots/${botId}/schedules`);
      setItems(res.schedules.map(normalize));
    } catch {
      /* the list stays as it was */
    }
  }, [botId]);

  const openNew = (kind: "routine" | "reminder" = "routine") =>
    setDialog({ open: true, initial: blankForm(kind, timezone), editing: null });

  const openTemplate = (t: Template) =>
    setDialog({ open: true, initial: formFrom(blankForm(t.kind, timezone), { ...t, deliverOn: "auto" }, timezone), editing: null });

  const openEdit = (s: ScheduleView) =>
    setDialog({ open: true, initial: formFrom(blankForm(s.kind, timezone), s, s.timezone || timezone), editing: s });

  const onSaved = (row: ScheduleView, created: boolean) => {
    const n = normalize(row);
    setItems((cur) => (created ? [n, ...cur] : cur.map((s) => (s.id === n.id ? n : s))));
    toast.success(
      created ? (n.kind === "reminder" ? "Reminder set" : `“${n.title}” is scheduled`) : "Saved",
      n.nextRunAt ? { description: `Next: ${whenLabel(n.nextRunAt, new Date(), timezone)}` } : undefined,
    );
  };

  const toggle = async (s: ScheduleView, active: boolean) => {
    setItems((cur) => cur.map((x) => (x.id === s.id ? { ...x, active } : x)));
    try {
      const res = await api<{ schedule: ScheduleView }>(`/api/bots/${botId}/schedules/${s.id}`, { method: "PATCH", body: { active } });
      const n = normalize(res.schedule);
      setItems((cur) => cur.map((x) => (x.id === n.id ? n : x)));
      toast(active ? `“${s.title}” is on` : `“${s.title}” is off`, active && n.nextRunAt ? { description: `Next: ${whenLabel(n.nextRunAt, new Date(), timezone)}` } : undefined);
    } catch (err) {
      setItems((cur) => cur.map((x) => (x.id === s.id ? { ...x, active: s.active } : x)));
      toast.error((err as Error).message || "Couldn't change that.");
    }
  };

  const runNow = async (s: ScheduleView) => {
    setRunning(s.id);
    try {
      const res = await api<{ ok: boolean; ran: number }>(`/api/bots/${botId}/schedules/${s.id}/run`, { method: "POST" });
      await refresh();
      if (live.paused) toast(`${botName} is paused`, { description: "Resume it to run routines." });
      else if (!res.ran) toast("Nothing ran", { description: "It may already have run a moment ago. Check Activity." });
      else
        toast.success(s.kind === "reminder" ? "Reminder sent" : `Ran “${s.title}”`, {
          description: s.kind === "reminder" ? "It went to the place you picked." : "The result is in your chat.",
          action: { label: s.kind === "reminder" ? "See activity" : "Open chat", onClick: () => router.push(s.kind === "reminder" ? `/app/bots/${botId}/activity` : `/app/bots/${botId}`) },
        });
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't run it.");
    } finally {
      setRunning(null);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      await api(`/api/bots/${botId}/schedules/${confirm.id}`, { method: "DELETE" });
      setItems((cur) => cur.filter((x) => x.id !== confirm.id));
      toast(`Deleted “${confirm.title}”`);
      setConfirm(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't delete it.");
    } finally {
      setDeleting(false);
    }
  };

  const takenTitles = new Set(items.map((s) => s.title.toLowerCase()));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-bold sm:text-3xl">Routines</h2>
          <p className="text-muted-foreground">Things {botName} does on a schedule: briefs, check-ins and reminders.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openNew("reminder")}>
            <AlarmClock /> Reminder
          </Button>
          <Button onClick={() => openNew("routine")}>
            <Plus /> New routine
          </Button>
        </div>
      </div>

      {live.paused ? (
        <div className="rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          {botName} is paused. Nothing runs until you resume it from the top of the page.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex items-center gap-4 rounded-3xl border border-border bg-card p-4 shadow-soft">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <CalendarClock className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Next up</div>
            {nextUp?.nextRunAt ? (
              <div className="truncate font-semibold">
                {nextUp.title} <span className="font-normal text-muted-foreground">· {whenLabel(nextUp.nextRunAt, now, timezone)}</span>
              </div>
            ) : (
              <div className="font-semibold text-muted-foreground">Nothing scheduled</div>
            )}
            <div className="truncate text-xs text-muted-foreground">Times are in {tzName}</div>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-2 rounded-3xl border border-border bg-card p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold">
              {overLimit ? `${activeRoutines} routines on · ${plan.name} includes ${plan.limit}` : `${activeRoutines} of ${plan.limit} routines on`}
            </span>
            <span className="flex items-center gap-2">
              <Badge tone="primary">{plan.name}</Badge>
              {plan.id !== "pro" ? (
                <Link href="/app/billing" className="text-xs font-semibold text-primary hover:underline">
                  {atLimit ? "Get more" : "Plans"}
                </Link>
              ) : null}
            </span>
          </div>
          <Progress value={(activeRoutines / Math.max(1, plan.limit)) * 100} tone={atLimit ? "warning" : "primary"} />
          <div className="text-xs text-muted-foreground">Reminders don&apos;t count toward this.</div>
        </div>
      </div>

      {atLimit && plan.id !== "pro" ? (
        <div className="flex flex-col gap-3 rounded-3xl border border-primary/20 bg-primary-soft/60 p-4 sm:flex-row sm:items-center">
          <Sparkles className="size-5 shrink-0 text-primary" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            {overLimit
              ? `You have ${activeRoutines} routines on, and ${plan.name} includes ${plan.limit}. ${nextPlan.name} gives you up to ${nextPlan.limits.routines}, or turn some off.`
              : `You're using all ${plan.limit} routines on ${plan.name}. ${nextPlan.name} gives you up to ${nextPlan.limits.routines}, or turn one off to make room.`}
          </p>
          <Button asChild size="sm">
            <Link href="/app/billing">See plans</Link>
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="tpl-heading" className="flex flex-col gap-3">
        <div>
          <h3 id="tpl-heading" className="font-display text-lg font-semibold">
            Start from a template
          </h3>
          <p className="text-sm text-muted-foreground">One tap fills everything in. Change anything before you save.</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          {TEMPLATES.map((t) => {
            const added = takenTitles.has(t.title.toLowerCase());
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => openTemplate(t)}
                className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lift sm:p-4"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xl transition group-hover:scale-110" aria-hidden>
                  {t.emoji}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {t.title}
                    {added ? <CircleCheck className="size-3.5 text-success" aria-label="Already added" /> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{describeSchedule(t.schedule, timezone)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="routines-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="routines-heading" className="font-display text-lg font-semibold">
            Routines <span className="text-muted-foreground">{routines.length || ""}</span>
          </h3>
          <span className="text-xs text-muted-foreground">{botName} does the work and sends you the result</span>
        </div>
        {routines.length ? (
          <ul className="flex flex-col gap-3">
            {routines.map((s) => (
              <ScheduleCard
                key={s.id}
                s={s}
                now={now}
                timezone={timezone}
                deliverOptions={deliverOptions}
                running={running === s.id}
                onToggle={(on) => toggle(s, on)}
                onRun={() => runNow(s)}
                onEdit={() => openEdit(s)}
                onDelete={() => setConfirm(s)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Repeat className="size-8" />}
            title="No routines yet"
            action={
              <Button variant="soft" onClick={() => openTemplate(TEMPLATES[0])}>
                <Sparkles /> Try a morning brief
              </Button>
            }
            className="bg-card/50"
          >
            Pick a template above or make your own. You can also just ask {botName} in chat: “Send me a brief every weekday at 8.”
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="reminders-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="reminders-heading" className="font-display text-lg font-semibold">
            Reminders <span className="text-muted-foreground">{reminders.length || ""}</span>
          </h3>
          <span className="text-xs text-muted-foreground">A nudge at the time you pick</span>
        </div>
        {reminders.length ? (
          <ul className="flex flex-col gap-3">
            {reminders.map((s) => (
              <ScheduleCard
                key={s.id}
                s={s}
                now={now}
                timezone={timezone}
                deliverOptions={deliverOptions}
                running={running === s.id}
                onToggle={(on) => toggle(s, on)}
                onRun={() => runNow(s)}
                onEdit={() => openEdit(s)}
                onDelete={() => setConfirm(s)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<AlarmClock className="size-8" />}
            title="No reminders"
            action={
              <Button variant="soft" onClick={() => openNew("reminder")}>
                <Plus /> Add a reminder
              </Button>
            }
            className="bg-card/50"
          >
            Ask {botName} in chat (“Remind me to call mom at 6pm”) or add one here.
          </EmptyState>
        )}
      </section>

      <RoutineDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        botId={botId}
        botName={botName}
        timezone={timezone}
        tzName={tzName}
        deliverOptions={deliverOptions}
        autoHint={autoHint}
        initial={dialog.initial}
        editing={dialog.editing}
        planName={plan.name}
        onSaved={onSaved}
      />

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{confirm?.title}”?</DialogTitle>
            <DialogDescription>
              {botName} will stop doing this. To pause it instead, turn it off with the switch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={remove} loading={deleting}>
              <Trash2 /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScheduleCard({
  s,
  now,
  timezone,
  deliverOptions,
  running,
  onToggle,
  onRun,
  onEdit,
  onDelete,
}: {
  s: ScheduleView;
  now: Date;
  timezone: string;
  deliverOptions: DeliverOption[];
  running: boolean;
  onToggle: (on: boolean) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const finished = isFinished(s, now);
  const tz = s.timezone || timezone;
  const deliver = deliverOptions.find((o) => o.value === s.deliverOn)?.short ?? s.deliverOn;
  const isReminder = s.kind === "reminder";
  const runLabel = isReminder ? "Send now" : "Run now";
  return (
    <li
      className={cn(
        "rounded-3xl border border-border bg-card p-4 shadow-soft transition sm:p-5",
        (!s.active || finished) && "bg-card/60",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl transition sm:size-12",
            s.active && !finished ? "bg-primary-soft" : "bg-muted grayscale",
          )}
          aria-hidden
        >
          {routineEmoji(s.title, s.kind)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h4 className={cn("leading-snug font-semibold [overflow-wrap:anywhere]", (!s.active || finished) && "text-muted-foreground")}>{s.title}</h4>
              {!isReminder || s.prompt !== s.title ? (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{s.prompt}</p>
              ) : null}
            </div>
            {finished ? (
              <Badge tone="success" className="mt-0.5 shrink-0">
                <CircleCheck /> Sent
              </Badge>
            ) : (
              <Switch checked={s.active} onCheckedChange={onToggle} aria-label={`${s.title}: ${s.active ? "on" : "off"}`} className="mt-0.5" />
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium">
              <Repeat className="size-3.5 text-muted-foreground" aria-hidden />
              {describeSchedule(s.schedule, tz)}
            </span>
            {finished ? null : s.active && s.nextRunAt ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 font-medium text-primary">
                <Clock className="size-3.5" aria-hidden />
                Next: {whenLabel(s.nextRunAt, now, timezone)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">Off</span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium">
              <Send className="size-3.5 text-muted-foreground" aria-hidden />
              {deliver}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {s.runCount
                ? `${isReminder ? "Sent" : "Ran"} ${s.runCount === 1 ? "once" : `${s.runCount} times`}${s.lastRunAt ? ` · last ${ago(s.lastRunAt, now)}` : ""}`
                : isReminder
                  ? "Not sent yet"
                  : "Hasn't run yet"}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="soft" size="sm" onClick={onRun} loading={running} disabled={running}>
                {running ? null : <Play />} {running ? (isReminder ? "Sending…" : "Running…") : runLabel}
              </Button>
              <Button variant="ghost" size="sm" onClick={onEdit} className="hidden sm:inline-flex">
                <Pencil /> Edit
              </Button>
              <Dropdown>
                <DropdownTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`More for ${s.title}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  <DropdownItem onSelect={onEdit}>
                    <Pencil /> Edit
                  </DropdownItem>
                  <DropdownItem onSelect={onRun} disabled={running}>
                    <Play /> {runLabel}
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem danger onSelect={onDelete}>
                    <Trash2 /> Delete
                  </DropdownItem>
                </DropdownContent>
              </Dropdown>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
