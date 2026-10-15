/**
 * Friendly words for schedules, a next-run preview for the editor, and the
 * one-tap templates. Pure functions, safe for the browser.
 */
import type { Schedule } from "@/lib/db/schema";
import type { AppKind } from "@/lib/connectors/types";
import { joinList } from "@/lib/utils";
import { dayKey, zonedParts, zonedToUtc, whenLabel } from "@/components/bot/activity/time";

export type ScheduleView = {
  id: string;
  kind: "reminder" | "routine";
  title: string;
  prompt: string;
  schedule: Schedule;
  timezone: string;
  deliverOn: string;
  active: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
};

export const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKENDS = [0, 6];
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export function hm12(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return time;
  const h = Number(m[1]);
  const min = m[2];
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${suffix}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function daysPhrase(days: number[] | undefined): string {
  const sorted = [...new Set(days ?? [])].sort((a, b) => a - b);
  if (!sorted.length || sorted.length === 7) return "Every day";
  const key = sorted.join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  if (sorted.length === 1) return DAY_PLURAL[sorted[0]];
  return sorted.map((d) => DAY_SHORT[d]).join(", ");
}

/** "0 9 1 * *" → monthly on the 1st at 9:00 AM, plus a few other common shapes. */
export function parseSimpleCron(expr: string):
  | { type: "monthly"; day: number; time: string }
  | { type: "daily"; days: number[]; time: string }
  | { type: "minutes"; every: number }
  | { type: "hours"; every: number; minute: number }
  | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [mi, h, dom, mon, dow] = parts;
  const num = (s: string) => (/^\d{1,2}$/.test(s) ? Number(s) : null);
  const minute = num(mi);
  const hour = num(h);
  if (minute !== null && hour !== null && minute < 60 && hour < 24) {
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const day = num(dom);
    if (day !== null && day >= 1 && day <= 31 && mon === "*" && dow === "*") return { type: "monthly", day, time };
    if (dom === "*" && mon === "*") {
      if (dow === "*") return { type: "daily", days: EVERY_DAY, time };
      const days = expandDow(dow);
      if (days) return { type: "daily", days, time };
    }
  }
  const everyMin = /^\*\/(\d{1,2})$/.exec(mi);
  if (everyMin && h === "*" && dom === "*" && mon === "*" && dow === "*") return { type: "minutes", every: Number(everyMin[1]) };
  const everyHour = /^\*\/(\d{1,2})$/.exec(h);
  if (minute !== null && everyHour && dom === "*" && mon === "*" && dow === "*") return { type: "hours", every: Number(everyHour[1]), minute };
  return null;
}

function expandDow(dow: string): number[] | null {
  const out = new Set<number>();
  for (const part of dow.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > 7 || b > 7 || a > b) return null;
      for (let d = a; d <= b; d++) out.add(d % 7);
    } else if (/^\d$/.test(part) && Number(part) <= 7) out.add(Number(part) % 7);
    else return null;
  }
  return [...out];
}

function intervalPhrase(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "Once a day" : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "Every hour" : `Every ${minutes / 60} hours`;
  return `Every ${minutes} minutes`;
}

/** "Weekdays at 8:00 AM", "Once, Tue Oct 15 at 6:00 PM", "Monthly on the 1st at 9:00 AM". */
export function describeSchedule(s: Schedule, tz: string): string {
  switch (s.type) {
    case "once": {
      const at = new Date(s.at);
      if (Number.isNaN(at.getTime())) return "Once";
      const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(at).replace(",", "");
      const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(at);
      return `Once, ${day} at ${time}`;
    }
    case "daily":
      return `${daysPhrase(s.days)} at ${hm12(s.time)}`;
    case "interval":
      return intervalPhrase(s.minutes);
    case "cron": {
      const c = parseSimpleCron(s.expr);
      if (c?.type === "monthly") return `Monthly on the ${ordinal(c.day)} at ${hm12(c.time)}`;
      if (c?.type === "daily") return `${daysPhrase(c.days)} at ${hm12(c.time)}`;
      if (c?.type === "minutes") return intervalPhrase(c.every);
      if (c?.type === "hours") return c.every === 1 ? `Every hour at :${String(c.minute).padStart(2, "0")}` : `Every ${c.every} hours`;
      return `Custom schedule (${s.expr})`;
    }
  }
}

/** Best-effort next run for the editor preview (the server computes the real one). */
export function previewNextRun(s: Schedule, tz: string, now = new Date()): Date | null {
  switch (s.type) {
    case "once": {
      const at = new Date(s.at);
      return Number.isNaN(at.getTime()) || at.getTime() <= now.getTime() ? null : at;
    }
    case "interval":
      return new Date(now.getTime() + Math.max(15, s.minutes) * 60000);
    case "daily":
      return nextDaily(s.time, s.days?.length ? s.days : EVERY_DAY, tz, now);
    case "cron": {
      const c = parseSimpleCron(s.expr);
      if (c?.type === "daily") return nextDaily(c.time, c.days, tz, now);
      if (c?.type === "monthly") {
        const [h, m] = c.time.split(":").map(Number);
        const p = zonedParts(now, tz);
        for (let i = 0; i < 14; i++) {
          const y = p.year + Math.floor((p.month - 1 + i) / 12);
          const mo = ((p.month - 1 + i) % 12) + 1;
          const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
          if (c.day > daysInMonth) continue;
          const at = zonedToUtc(y, mo, c.day, h, m, tz);
          if (at.getTime() > now.getTime()) return at;
        }
        return null;
      }
      return null;
    }
  }
}

function nextDaily(time: string, days: number[], tz: string, now: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || !days.length) return null;
  const p = zonedParts(now, tz);
  for (let i = 0; i < 8; i++) {
    const probe = new Date(Date.UTC(p.year, p.month - 1, p.day + i, 12));
    if (!days.includes(probe.getUTCDay())) continue;
    const at = zonedToUtc(probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate(), Number(m[1]), Number(m[2]), tz);
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}

export function nextRunLabel(date: string | Date | null, now: Date, tz: string): string | null {
  if (!date) return null;
  return whenLabel(date, now, tz);
}

/** Has a one-off already gone out (or can it never run again)? */
export function isFinished(s: Pick<ScheduleView, "schedule" | "nextRunAt" | "active">, now: Date): boolean {
  if (s.schedule.type !== "once") return false;
  const at = new Date(s.schedule.at).getTime();
  return !s.nextRunAt && (at <= now.getTime() || !s.active);
}

export function routineEmoji(title: string, kind: string): string {
  const t = title.toLowerCase();
  if (/brief|morning|sunrise|wake/.test(t)) return "☀️";
  if (/inbox|email|mail/.test(t)) return "📬";
  if (/week|review|recap|digest/.test(t)) return "🗓️";
  if (/evening|night|wind|sleep|bed/.test(t)) return "🌙";
  if (/bill|money|budget|pay|subscription/.test(t)) return "💸";
  if (/habit|water|walk|stretch|workout|health/.test(t)) return "🌱";
  if (/news|headline/.test(t)) return "📰";
  if (/study|exam|homework|school/.test(t)) return "📚";
  if (/call|phone|mom|dad|birthday/.test(t)) return "📞";
  if (/github|pr|code|deploy/.test(t)) return "🧑‍💻";
  return kind === "reminder" ? "⏰" : "✨";
}

export type Template = {
  id: string;
  emoji: string;
  title: string;
  prompt: string;
  schedule: Schedule;
  kind: "routine" | "reminder";
};

/** A template whose instruction can depend on what the bot's apps see (null: it doesn't fit this bot). */
type TemplateSource = Omit<Template, "prompt"> & { prompt: string | ((apps: ReadonlySet<AppKind>) => string | null) };

const TEMPLATE_SOURCES: TemplateSource[] = [
  {
    id: "morning-brief",
    emoji: "☀️",
    title: "Morning brief",
    prompt: (apps) => {
      const parts = ["today's weather", apps.has("calendar") ? "what's on my calendar" : null, apps.has("email") ? "anything urgent in my inbox" : null, "one thing I shouldn't forget"];
      return `Give me a short morning brief: ${joinList(parts.filter((p): p is string => Boolean(p)))}.`;
    },
    schedule: { type: "daily", time: "08:00", days: WEEKDAYS },
    kind: "routine",
  },
  {
    id: "inbox-sweep",
    emoji: "📬",
    title: "Inbox sweep",
    prompt: (apps) =>
      apps.has("email") ? "Go through today's email. List what needs a reply from me, draft quick replies for the easy ones, and flag anything urgent. Don't send anything." : null,
    schedule: { type: "daily", time: "16:30", days: WEEKDAYS },
    kind: "routine",
  },
  {
    id: "weekly-review",
    emoji: "🗓️",
    title: "Weekly review",
    prompt: "Recap my week: what got done, what slipped, and the three most important things for next week.",
    schedule: { type: "daily", time: "16:00", days: [5] },
    kind: "routine",
  },
  {
    id: "wind-down",
    emoji: "🌙",
    title: "Evening wind-down",
    prompt: "Help me wind down: a quick look at tomorrow's first commitments, anything to prep tonight, and one kind word to end the day.",
    schedule: { type: "daily", time: "21:30", days: EVERY_DAY },
    kind: "routine",
  },
  {
    id: "bill-check",
    emoji: "💸",
    title: "Bill check",
    prompt: (apps) => {
      const where = [apps.has("email") ? "email" : null, apps.has("calendar") ? "calendar" : null].filter((w): w is string => Boolean(w));
      return where.length ? `Look for bills and subscriptions due this month in my ${joinList(where)}. List each with the amount and due date. Never pay anything.` : null;
    },
    schedule: { type: "cron", expr: "0 9 1 * *" },
    kind: "routine",
  },
  {
    id: "habit-check-in",
    emoji: "🌱",
    title: "Habit check-in",
    prompt: "Ask how today's habits went (water, a walk, some reading). Cheer me on and keep it to two sentences.",
    schedule: { type: "daily", time: "20:00", days: EVERY_DAY },
    kind: "routine",
  },
];

/** The one-tap templates that fit a bot: nothing about an inbox or a calendar it can't see. */
export function templatesFor(apps: ReadonlySet<AppKind>): Template[] {
  return TEMPLATE_SOURCES.flatMap((t) => {
    const prompt = typeof t.prompt === "string" ? t.prompt : t.prompt(apps);
    return prompt ? [{ ...t, prompt }] : [];
  });
}

export function todayKey(now: Date, tz: string) {
  return dayKey(now, tz);
}
