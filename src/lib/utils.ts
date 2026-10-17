import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { customAlphabet } from "nanoid";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 16);
const shortNano = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 6);

/** Prefixed, URL-safe ids: usr_..., bot_..., msg_... */
export function newId(prefix: string): string {
  return `${prefix}_${nano()}`;
}

/** Time-sortable id (for append-only logs): base36 ms timestamp + random. */
export function sortableId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36).padStart(9, "0")}${nano().slice(0, 8)}`;
}

/** Short lowercase code without look-alike characters (handles, slugs). */
export function shortCode(): string {
  return shortNano();
}

export function slugify(input: string, max = 40): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "YYYY-MM" in UTC, the billing period key. */
export function periodKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatUsdMicros(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function relativeTime(date: Date | string | number, now = Date.now()): string {
  const t = new Date(date).getTime();
  const diff = Math.round((now - t) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 45) return diff >= 0 ? "just now" : "in a moment";
  if (abs < 90) return `1 min ${suffix}`;
  if (abs < 3600) return `${Math.round(abs / 60)} min ${suffix}`;
  if (abs < 5400) return `1 hr ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)} hr ${suffix}`;
  if (abs < 172800) return diff >= 0 ? "yesterday" : "tomorrow";
  return `${Math.round(abs / 86400)} days ${suffix}`;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** Loose E.164 normalization for US-first input ("(512) 555-0100" → "+15125550100"). */
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * A US or Canada number. +1 also covers Caribbean countries, where texts and calls cost far more
 * (and are a favorite of toll fraud), and 900 numbers, which charge the caller.
 */
const NOT_US_OR_CANADA = new Set(["242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721", "758", "767", "784", "809", "829", "849", "868", "869", "876", "900"]);
export function isUsOrCanadaPhone(e164: string): boolean {
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e164) && !NOT_US_OR_CANADA.has(e164.slice(2, 5));
}

export function maskPhone(e164: string): string {
  return e164.length > 4 ? `${e164.slice(0, -4).replace(/\d/g, "•")}${e164.slice(-4)}` : e164;
}

export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** ["a", "b", "c"] → "a, b and c" (or "a, b or c"). */
export function joinList(items: string[], last: "and" | "or" = "and"): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}` : (items[0] ?? "");
}

/** A service never answered (DNS, timeout, a dropped connection), which isn't the same as it saying no. */
export class UnreachableError extends Error {
  constructor(service: string, options?: ErrorOptions) {
    super(`Couldn't reach ${service}. Try again in a moment.`, options);
    this.name = "UnreachableError";
  }
}
