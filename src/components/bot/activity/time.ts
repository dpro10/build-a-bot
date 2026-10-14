/**
 * Date helpers for the bot dashboard tabs. Everything is formatted in the owner's
 * time zone (users.timezone) so the server render and the browser agree.
 */
import * as React from "react";
import { relativeTime } from "@/lib/utils";

export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions, locale = "en-US") {
  const key = `${locale}|${tz}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz });
    cache.set(key, f);
  }
  return f;
}

/** "2026-10-14" for the calendar day of `date` in `tz`. */
export function dayKey(date: Date | string, tz: string): string {
  return fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA").format(new Date(date));
}

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", "Tomorrow", "Monday, Oct 12" (with the year when it isn't this year). */
export function dayLabel(key: string, now: Date, tz: string): string {
  const today = dayKey(now, tz);
  if (key === today) return "Today";
  if (key === shiftKey(today, -1)) return "Yesterday";
  if (key === shiftKey(today, 1)) return "Tomorrow";
  const [y, m, d] = key.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(noon);
}

/** "3:42 PM" */
export function timeLabel(date: Date | string, tz: string): string {
  return fmt(tz, { hour: "numeric", minute: "2-digit" }).format(new Date(date));
}

/** "Tue, Oct 14, 2026, 3:42:10 PM CDT" */
export function fullDateTime(date: Date | string, tz: string): string {
  return fmt(tz, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(date));
}

/** "Today at 8:00 AM", "Tomorrow at 8:00 AM", "Wed, Oct 16 at 8:00 AM" */
export function whenLabel(date: Date | string, now: Date, tz: string): string {
  const d = new Date(date);
  const key = dayKey(d, tz);
  const today = dayKey(now, tz);
  const time = timeLabel(d, tz);
  if (key === today) return `Today at ${time}`;
  if (key === shiftKey(today, 1)) return `Tomorrow at ${time}`;
  if (key === shiftKey(today, -1)) return `Yesterday at ${time}`;
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  const day = fmt(tz, { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
  return `${day} at ${time}`;
}

/** "Central Daylight Time" (falls back to the IANA name). */
export function timeZoneLongName(tz: string, at = new Date()): string {
  try {
    const part = fmt(tz, { timeZoneName: "long" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date: Date, tz: string) {
  const parts = Object.fromEntries(
    fmt(tz, { hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** The instant for a wall-clock time in `tz` (handles DST like the scheduler does). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const o1 = offsetMinutes(guess, tz);
  let result = new Date(guess.getTime() - o1 * 60000);
  const o2 = offsetMinutes(result, tz);
  if (o2 !== o1) result = new Date(guess.getTime() - o2 * 60000);
  return result;
}

/**
 * A clock that renders the server's "now" first (so hydration matches) and then
 * ticks in the browser.
 */
export function useNow(serverNow: string, everyMs = 30_000): Date {
  const [mounted, setMounted] = React.useState(false);
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    setMounted(true);
    const id = window.setInterval(() => tick((n) => n + 1), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  // After hydration every render reads the real clock, so "just now" stays right after updates.
  return mounted ? new Date() : new Date(serverNow);
}

/** "5 min ago" for things that already happened (a clock a little behind the server never says "in a moment"). */
export function ago(date: Date | string, now: Date): string {
  const t = Math.min(new Date(date).getTime(), now.getTime());
  return relativeTime(t, now.getTime());
}
