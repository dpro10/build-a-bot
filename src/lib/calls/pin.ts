/**
 * The phone PIN: how the owner proves it's them on a call when caller ID alone can't (calls without
 * a carrier's full STIR/SHAKEN attestation can be spoofed). Hashed with scrypt; five wrong tries in
 * a row lock it for 15 minutes, on every bot.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";

const scrypt = promisify(scryptCb) as (pin: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 15 * 60_000;
const N = 16384;
const R = 8;
const P = 1;

/** Why a PIN can't be used, or null if it's fine. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return "A PIN is 4 to 8 digits.";
  if (/^(\d)\1+$/.test(pin)) return "Pick a PIN that isn't one digit repeated.";
  const ascending = "0123456789".includes(pin);
  const descending = "9876543210".includes(pin);
  if (ascending || descending) return "Pick a PIN that isn't a run of digits like 1234.";
  return null;
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = await scrypt(pin, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function setPhonePin(db: Db, userId: string, pin: string | null): Promise<void> {
  await db
    .update(schema.users)
    .set({ phonePinHash: pin ? await hashPin(pin) : null, phonePinFailures: 0, phonePinLockedUntil: null, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

export function pinLocked(user: Pick<User, "phonePinLockedUntil">, now = new Date()): boolean {
  return Boolean(user.phonePinLockedUntil && user.phonePinLockedUntil > now);
}

/** `justLocked`: this try is the one that locked it. */
export type PinCheck = { ok: true } | { ok: false; remaining: number; locked: boolean; justLocked?: true };

/** Checks a PIN said or typed on a call, counting failures toward the lock. */
export async function checkPhonePin(db: Db, userId: string, pin: string, now = new Date()): Promise<PinCheck> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user?.phonePinHash) return { ok: false, remaining: 0, locked: false };
  if (pinLocked(user, now)) return { ok: false, remaining: 0, locked: true };
  if (/^\d{4,8}$/.test(pin) && (await pinMatches(pin, user.phonePinHash))) {
    await db.update(schema.users).set({ phonePinFailures: 0, phonePinLockedUntil: null }).where(eq(schema.users.id, userId));
    return { ok: true };
  }
  const [row] = await db
    .update(schema.users)
    .set({ phonePinFailures: sql`${schema.users.phonePinFailures} + 1` })
    .where(eq(schema.users.id, userId))
    .returning({ failures: schema.users.phonePinFailures });
  const failures = row?.failures ?? PIN_MAX_FAILURES;
  if (failures >= PIN_MAX_FAILURES) {
    await db
      .update(schema.users)
      .set({ phonePinFailures: 0, phonePinLockedUntil: new Date(now.getTime() + PIN_LOCK_MS) })
      .where(eq(schema.users.id, userId));
    return { ok: false, remaining: 0, locked: true, justLocked: true };
  }
  return { ok: false, remaining: PIN_MAX_FAILURES - failures, locked: false };
}
