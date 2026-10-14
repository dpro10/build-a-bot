/**
 * Sessions: opaque random token in an httpOnly cookie; only its sha256 is stored.
 *
 * Build first, sign up later: the builder creates an anonymous account on the fly so
 * people can make a bot in a minute. A magic link later attaches an email (and merges
 * into an existing account if that email already has one).
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { isProduction } from "@/lib/env";
import { newId } from "@/lib/utils";
import { isValidTimeZone } from "@/lib/scheduler/time";

export const SESSION_COOKIE = "bab_session";
const SESSION_DAYS = 180;

export type Session = { user: User; sessionId: string };

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const id = sha256(token);
  const rows = await db
    .select({ user: schema.users, sessionId: schema.sessions.id })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUser(): Promise<User | null> {
  return (await getSession())?.user ?? null;
}

/** For pages: signed-in (or anonymous-with-session) user, else go to login. */
export async function requireUser(next = "/app"): Promise<User> {
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomToken(32);
  const h = await headers();
  await db.insert(schema.sessions).values({
    id: sha256(token),
    userId,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return token;
}

/** Route handlers / server actions only (sets a cookie when creating). */
export async function getOrCreateUser(opts: { timezone?: string } = {}): Promise<User> {
  const existing = await getUser();
  if (existing) return existing;
  const db = await getDb();
  const [user] = await db
    .insert(schema.users)
    .values({ id: newId("usr"), timezone: opts.timezone && isValidTimeZone(opts.timezone) ? opts.timezone : "UTC" })
    .returning();
  await createSession(db, user.id);
  return user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export function isAnonymous(user: Pick<User, "email" | "emailVerifiedAt">): boolean {
  return !user.email || !user.emailVerifiedAt;
}
