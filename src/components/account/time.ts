"use client";
/**
 * Small time helpers for the account pages. Client components start from the
 * server's clock (so the first render matches the HTML) and then tick locally.
 */
import * as React from "react";

/** Current time, starting from `initial` and refreshing every `every` ms. */
export function useNow(initial: number, every = 30_000): number {
  const [now, setNow] = React.useState(initial);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** "45 min", "3 hr", "2 days" until `target`. */
export function timeLeft(target: number, now: number): string {
  const ms = target - now;
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** "4:05" from milliseconds. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
