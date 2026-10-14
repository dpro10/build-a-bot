/** Small formatting helpers for recipe pages and cards. Pure; safe anywhere. */

const ACRONYMS: Record<string, string> = { pr: "PR", ai: "AI", sms: "SMS" };

/** "inbox-zero" → "Inbox zero", "pr-patrol" → "PR patrol". */
export function recipeTitle(slug: string): string {
  const words = slug.split("-").filter(Boolean);
  return words
    .map((w, i) => ACRONYMS[w] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** "Busy people drowning in email" → "For busy people drowning in email". */
export function forWho(who: string): string {
  const trimmed = who.trim();
  if (!trimmed) return "";
  return `For ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "08:00" → "8:00 AM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** [1,2,3,4,5] → "Weekdays", [0] → "Sundays", undefined → "Every day". */
export function formatDays(days?: number[]): string {
  if (!days || days.length === 0 || days.length === 7) return "Every day";
  const set = [...new Set(days)].sort((a, b) => a - b);
  const key = set.join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  if (set.length === 1) return DAY_LONG[set[0]] ?? "Every week";
  return set.map((d) => DAY[d]).join(", ");
}
