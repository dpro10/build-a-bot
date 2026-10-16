"use client";
import * as React from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { Schedule } from "@/lib/db/schema";
import { zonedParts, zonedToUtc, whenLabel } from "@/components/bot/activity/time";
import { radioKeyDown, radioTabIndex } from "@/components/bot/activity/radio-keys";
import {
  DAY_LETTERS,
  EVERY_DAY,
  WEEKDAYS,
  WEEKENDS,
  describeSchedule,
  parseSimpleCron,
  previewNextRun,
  type ScheduleView,
} from "./schedule";

export type DeliverOption = { value: string; label: string; short: string };

type When = "daily" | "monthly" | "once" | "interval" | "custom";

export type RoutineForm = {
  kind: "routine" | "reminder";
  title: string;
  prompt: string;
  when: When;
  time: string;
  days: number[];
  monthDay: number;
  onceDate: string;
  onceTime: string;
  interval: number;
  cron: string;
  deliverOn: string;
};

const WHEN_OPTIONS: { value: When; label: string }[] = [
  { value: "daily", label: "Daily or weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "once", label: "Once" },
  { value: "interval", label: "Every few hours" },
  { value: "custom", label: "Custom" },
];

const INTERVALS = [
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 120, label: "Every 2 hours" },
  { minutes: 180, label: "Every 3 hours" },
  { minutes: 240, label: "Every 4 hours" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 480, label: "Every 8 hours" },
  { minutes: 720, label: "Every 12 hours" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** A blank form: tomorrow-ish defaults in the owner's time zone. */
export function blankForm(kind: "routine" | "reminder", tz: string, now = new Date()): RoutineForm {
  const inAnHour = zonedParts(new Date(now.getTime() + 60 * 60000), tz);
  return {
    kind,
    title: "",
    prompt: "",
    when: kind === "reminder" ? "once" : "daily",
    time: "08:00",
    days: kind === "reminder" ? EVERY_DAY : WEEKDAYS,
    monthDay: 1,
    onceDate: `${inAnHour.year}-${pad(inAnHour.month)}-${pad(inAnHour.day)}`,
    onceTime: `${pad(inAnHour.hour)}:00`,
    interval: 120,
    cron: "",
    deliverOn: "auto",
  };
}

/** Fill a form from an existing schedule (or a template). */
export function formFrom(
  base: RoutineForm,
  s: { kind: "routine" | "reminder"; title: string; prompt: string; schedule: Schedule; deliverOn?: string },
  tz: string,
): RoutineForm {
  const f: RoutineForm = { ...base, kind: s.kind, title: s.title, prompt: s.prompt, deliverOn: s.deliverOn ?? base.deliverOn };
  const sc = s.schedule;
  if (sc.type === "once") {
    const p = zonedParts(new Date(sc.at), tz);
    return { ...f, when: "once", onceDate: `${p.year}-${pad(p.month)}-${pad(p.day)}`, onceTime: `${pad(p.hour)}:${pad(p.minute)}` };
  }
  if (sc.type === "daily") return { ...f, when: "daily", time: sc.time, days: sc.days?.length ? sc.days : EVERY_DAY };
  if (sc.type === "interval") return { ...f, when: "interval", interval: sc.minutes };
  const c = parseSimpleCron(sc.expr);
  if (c?.type === "monthly") return { ...f, when: "monthly", monthDay: Math.min(28, c.day), time: c.time };
  if (c?.type === "daily") return { ...f, when: "daily", time: c.time, days: c.days };
  return { ...f, when: "custom", cron: sc.expr };
}

function toSchedule(f: RoutineForm, tz: string, now: Date): { schedule: Schedule } | { error: string } {
  switch (f.when) {
    case "daily": {
      if (!/^\d{2}:\d{2}$/.test(f.time)) return { error: "Pick a time." };
      if (!f.days.length) return { error: "Pick at least one day." };
      const days = [...new Set(f.days)].sort((a, b) => a - b);
      return { schedule: { type: "daily", time: f.time, ...(days.length === 7 ? {} : { days }) } };
    }
    case "monthly": {
      if (!/^\d{2}:\d{2}$/.test(f.time)) return { error: "Pick a time." };
      const [h, m] = f.time.split(":").map(Number);
      return { schedule: { type: "cron", expr: `${m} ${h} ${f.monthDay} * *` } };
    }
    case "once": {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.onceDate);
      const t = /^(\d{2}):(\d{2})$/.exec(f.onceTime);
      if (!d || !t) return { error: "Pick a date and time." };
      const at = zonedToUtc(Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2]), tz);
      if (at.getTime() <= now.getTime()) return { error: "That time has already passed. Pick one in the future." };
      return { schedule: { type: "once", at: at.toISOString() } };
    }
    case "interval":
      return { schedule: { type: "interval", minutes: f.interval } };
    case "custom": {
      const expr = f.cron.trim().replace(/\s+/g, " ");
      if (expr.split(" ").length !== 5 || expr.length < 9) return { error: "A custom schedule has five parts: minute, hour, day, month and weekday." };
      return { schedule: { type: "cron", expr } };
    }
  }
}

function sameSchedule(a: Schedule, b: Schedule) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function RoutineDialog({
  open,
  onOpenChange,
  botId,
  botName,
  timezone,
  tzName,
  deliverOptions,
  autoHint,
  initial,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: string;
  botName: string;
  timezone: string;
  tzName: string;
  deliverOptions: DeliverOption[];
  autoHint: string;
  initial: RoutineForm;
  /** The schedule being edited; omit to create. */
  editing?: ScheduleView | null;
  onSaved: (row: ScheduleView, created: boolean) => void;
}) {
  const [f, setF] = React.useState<RoutineForm>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** The error is the fair-use limit on routines (turning one off makes room), not a failure. */
  const [full, setFull] = React.useState(false);
  const [now, setNow] = React.useState(() => new Date());
  const alertRef = React.useRef<HTMLDivElement>(null);

  // Errors show at the bottom of a scrolling dialog: bring them into view.
  React.useEffect(() => {
    if (error) alertRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);

  React.useEffect(() => {
    if (open) {
      setF(initial);
      setError(null);
      setFull(false);
      setNow(new Date());
    }
  }, [open, initial]);

  const set = <K extends keyof RoutineForm>(key: K, value: RoutineForm[K]) => {
    setF((cur) => ({ ...cur, [key]: value }));
    setError(null);
  };

  const isReminder = f.kind === "reminder";
  const built = toSchedule(f, timezone, now);
  const preview = "schedule" in built ? previewNextRun(built.schedule, timezone, now) : null;
  const phrase = "schedule" in built ? describeSchedule(built.schedule, timezone) : null;
  const deliverHint = f.deliverOn === "auto" ? autoHint : f.deliverOn === "web" ? `Only here in the app, in your chat with ${botName}.` : `By ${deliverOptions.find((o) => o.value === f.deliverOn)?.label ?? f.deliverOn}, plus a copy in your chat.`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = f.prompt.trim();
    const title = isReminder ? text.replace(/\s+/g, " ").slice(0, 120) : f.title.trim();
    if (!title) return setError(isReminder ? "What should it remind you about?" : "Give it a short name.");
    if (!text) return setError(isReminder ? "What should it remind you about?" : `Tell ${botName} what to do.`);
    const res = toSchedule(f, timezone, new Date());
    if ("error" in res) return setError(res.error);
    setSaving(true);
    setError(null);
    setFull(false);
    try {
      let row: ScheduleView;
      if (editing) {
        const body: Record<string, unknown> = { title, prompt: text, deliverOn: f.deliverOn };
        if (!sameSchedule(res.schedule, editing.schedule)) {
          body.schedule = res.schedule;
          if (!editing.active) body.active = true;
        }
        const out = await api<{ schedule: ScheduleView }>(`/api/bots/${botId}/schedules/${editing.id}`, { method: "PATCH", body });
        row = out.schedule;
      } else {
        const out = await api<{ schedule: ScheduleView }>(`/api/bots/${botId}/schedules`, {
          method: "POST",
          body: { kind: f.kind, title, prompt: text, schedule: res.schedule, deliverOn: f.deliverOn },
        });
        row = out.schedule;
      }
      onSaved(row, !editing);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "fair_use") {
        setFull(true);
        setError(err.message);
      } else {
        setError((err as Error).message || "Couldn't save that.");
        toast.error((err as Error).message || "Couldn't save that.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="bottom" className="sm:w-[min(620px,calc(100vw-24px))]">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? (isReminder ? "Edit reminder" : "Edit routine") : isReminder ? "New reminder" : "New routine"}</DialogTitle>
            <DialogDescription>
              {isReminder ? `${botName} will send you this at the time you pick.` : `${botName} will do this on its own, on schedule, and send you the result.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5 pb-2">
            {!editing ? (
              <Segmented
                aria-label="Type"
                value={f.kind}
                onChange={(kind) => {
                  setF((cur) => ({
                    ...blankForm(kind, timezone),
                    title: cur.title,
                    prompt: cur.prompt,
                    deliverOn: cur.deliverOn,
                  }));
                  setError(null);
                }}
                options={[
                  { value: "routine", label: "Routine" },
                  { value: "reminder", label: "Reminder" },
                ]}
                className="self-start"
              />
            ) : null}

            {!isReminder ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rt-title">Name</Label>
                <Input id="rt-title" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder="Morning brief" autoComplete="off" />
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rt-prompt">{isReminder ? "Remind me to…" : `What should ${botName} do?`}</Label>
              <Textarea
                id="rt-prompt"
                value={f.prompt}
                onChange={(e) => set("prompt", e.target.value)}
                maxLength={2000}
                rows={isReminder ? 2 : 4}
                className={isReminder ? "min-h-16" : undefined}
                placeholder={isReminder ? "Call mom back about Sunday dinner" : "Check the weather, my calendar and anything urgent in my inbox, then send me a short summary."}
              />
              <div className="flex justify-between gap-3">
                <FieldHint>{isReminder ? "Written the way you want to hear it." : "Write it like you'd ask a person. It follows your trust settings like any other task."}</FieldHint>
                <FieldHint className="shrink-0 tabular-nums">{f.prompt.length}/2000</FieldHint>
              </div>
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1.5 text-sm font-medium">When</legend>
              <div role="radiogroup" aria-label="How often" className="flex flex-wrap gap-1.5">
                {WHEN_OPTIONS.map((o, i) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={f.when === o.value}
                    tabIndex={radioTabIndex(f.when === o.value, i, true)}
                    onKeyDown={radioKeyDown}
                    onClick={() => set("when", o.value)}
                    className={cn(
                      "h-9 rounded-full border px-3.5 text-sm font-semibold transition",
                      f.when === o.value ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-border bg-background-2/60 p-4">
                {f.when === "daily" ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-end gap-4">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="rt-time">Time</Label>
                        <Input id="rt-time" type="time" value={f.time} onChange={(e) => set("time", e.target.value)} className="h-11 w-36" required />
                      </div>
                      <div className="flex flex-wrap gap-1.5 pb-1">
                        {[
                          { label: "Every day", days: EVERY_DAY },
                          { label: "Weekdays", days: WEEKDAYS },
                          { label: "Weekends", days: WEEKENDS },
                        ].map((p) => {
                          const on = [...f.days].sort().join() === [...p.days].sort().join();
                          return (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() => set("days", p.days)}
                              aria-pressed={on}
                              className={cn("rounded-full px-3 py-1 text-xs font-semibold transition", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium" id="rt-days-label">
                        On these days
                      </span>
                      <div className="flex gap-1.5 sm:gap-2" role="group" aria-labelledby="rt-days-label">
                        {DAY_LETTERS.map((letter, d) => {
                          const on = f.days.includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              aria-pressed={on}
                              aria-label={DAY_NAMES[d]}
                              title={DAY_NAMES[d]}
                              onClick={() => set("days", on ? f.days.filter((x) => x !== d) : [...f.days, d])}
                              className={cn(
                                "flex size-10 items-center justify-center rounded-full text-sm font-bold transition sm:size-11",
                                on ? "bg-primary text-primary-foreground shadow-[0_4px_14px_-4px_rgb(109_77_255/0.6)]" : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground",
                              )}
                            >
                              {letter}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : f.when === "monthly" ? (
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="rt-mday">Day of the month</Label>
                      <Select id="rt-mday" value={String(f.monthDay)} onChange={(e) => set("monthDay", Number(e.target.value))} className="w-40">
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>
                            {d === 1 ? "1st" : d === 2 ? "2nd" : d === 3 ? "3rd" : d === 21 ? "21st" : d === 22 ? "22nd" : d === 23 ? "23rd" : `${d}th`}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="rt-mtime">Time</Label>
                      <Input id="rt-mtime" type="time" value={f.time} onChange={(e) => set("time", e.target.value)} className="h-12 w-36" />
                    </div>
                    <FieldHint className="w-full">Up to the 28th, so it runs every month.</FieldHint>
                  </div>
                ) : f.when === "once" ? (
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="rt-date">Date</Label>
                      <Input id="rt-date" type="date" value={f.onceDate} onChange={(e) => set("onceDate", e.target.value)} className="h-11 w-44" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="rt-otime">Time</Label>
                      <Input id="rt-otime" type="time" value={f.onceTime} onChange={(e) => set("onceTime", e.target.value)} className="h-11 w-36" />
                    </div>
                  </div>
                ) : f.when === "interval" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rt-interval">How often</Label>
                    <Select id="rt-interval" value={String(f.interval)} onChange={(e) => set("interval", Number(e.target.value))} className="sm:w-64">
                      {INTERVALS.map((o) => (
                        <option key={o.minutes} value={o.minutes}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <FieldHint>Starts counting from when you save. Scheduled tasks run at most 24 times a day in total.</FieldHint>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rt-cron">Custom schedule</Label>
                    <Input
                      id="rt-cron"
                      value={f.cron}
                      onChange={(e) => set("cron", e.target.value)}
                      placeholder="0 9 * * 1"
                      className="h-11 font-mono"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <FieldHint>
                      Five parts: minute, hour, day of month, month, weekday. <span className="font-mono">0 9 * * 1</span> means Mondays at 9:00 AM.
                    </FieldHint>
                  </div>
                )}
                <div className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-sm">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0">
                    {phrase ? <div className="font-semibold">{phrase}</div> : <div className="text-muted-foreground">{"error" in built ? built.error : ""}</div>}
                    <div className="text-xs text-muted-foreground">
                      {preview ? `First run: ${whenLabel(preview, now, timezone)} · ` : ""}
                      {tzName}
                    </div>
                  </div>
                </div>
              </div>
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rt-deliver">Where should it reach you?</Label>
              <Select id="rt-deliver" value={f.deliverOn} onChange={(e) => set("deliverOn", e.target.value)}>
                {deliverOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <FieldHint>{deliverHint}</FieldHint>
            </div>

            {error ? (
              <div ref={alertRef} role="alert" className={cn("rounded-2xl px-4 py-3 text-sm", full ? "bg-primary-soft text-foreground" : "bg-danger-soft text-danger")}>
                {error}
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter className="border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save changes" : isReminder ? "Set reminder" : "Create routine"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
