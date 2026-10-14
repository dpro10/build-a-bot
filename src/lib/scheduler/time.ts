/**
 * Timezone-aware schedule math using only Intl (no tz database dependency).
 */
import { CronExpressionParser } from "cron-parser";
import type { Schedule } from "@/lib/db/schema";

/** Offset (minutes) of `timeZone` from UTC at the given instant. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** The UTC instant for a wall-clock time in a timezone. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset1 = tzOffsetMinutes(guess, timeZone);
  let result = new Date(guess.getTime() - offset1 * 60000);
  const offset2 = tzOffsetMinutes(result, timeZone);
  if (offset2 !== offset1) result = new Date(guess.getTime() - offset2 * 60000);
  return result;
}

/** Wall-clock parts of an instant in a timezone. */
export function zonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdays.indexOf(parts.weekday ?? "Sun"),
  };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseHm(time: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** Next run strictly after `after`. Returns null when a one-off is in the past. */
export function computeNextRun(schedule: Schedule, timeZone: string, after: Date = new Date()): Date | null {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  switch (schedule.type) {
    case "once": {
      const at = new Date(schedule.at);
      if (Number.isNaN(at.getTime())) return null;
      return at.getTime() > after.getTime() ? at : null;
    }
    case "interval": {
      const minutes = Math.max(5, Math.floor(schedule.minutes));
      return new Date(after.getTime() + minutes * 60000);
    }
    case "daily": {
      const hm = parseHm(schedule.time);
      if (!hm) return null;
      const days = schedule.days?.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
      const today = zonedParts(after, tz);
      for (let i = 0; i < 8; i++) {
        const probe = new Date(Date.UTC(today.year, today.month - 1, today.day + i, 12));
        const weekday = probe.getUTCDay();
        if (!days.includes(weekday)) continue;
        const candidate = zonedToUtc(probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate(), hm.h, hm.m, tz);
        if (candidate.getTime() > after.getTime()) return candidate;
      }
      return null;
    }
    case "cron": {
      try {
        const expr = CronExpressionParser.parse(schedule.expr, { currentDate: after, tz });
        return expr.next().toDate();
      } catch {
        return null;
      }
    }
  }
}

export function describeSchedule(schedule: Schedule, timeZone: string): string {
  const fmtTime = (hm: string) => {
    const p = parseHm(hm);
    if (!p) return hm;
    const d = new Date(Date.UTC(2000, 0, 1, p.h, p.m));
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d);
  };
  switch (schedule.type) {
    case "once":
      return new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
      }).format(new Date(schedule.at));
    case "interval":
      return schedule.minutes % 60 === 0 ? `Every ${schedule.minutes / 60} hr` : `Every ${schedule.minutes} min`;
    case "daily": {
      const days = schedule.days;
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      let when = "Every day";
      if (days?.length && days.length < 7) {
        const sorted = [...days].sort();
        if (sorted.join() === "1,2,3,4,5") when = "Weekdays";
        else if (sorted.join() === "0,6") when = "Weekends";
        else when = sorted.map((d) => names[d]).join(", ");
      }
      return `${when} at ${fmtTime(schedule.time)}`;
    }
    case "cron":
      return `Custom (${schedule.expr})`;
  }
}

/** "Tue, Oct 14, 9:05 AM" in the owner's timezone, for prompts. */
export function formatNow(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
    timeZoneName: "short",
  }).format(date);
}

/** Interpret a model-supplied datetime. Accepts ISO with offset, or a naive local time in the owner's tz. */
export function parseOwnerDateTime(value: string, timeZone: string): Date | null {
  const v = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v);
  if (m) return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), timeZone);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
