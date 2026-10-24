/**
 * Passwordless sign-in links. One-time, 20 minutes, stored hashed.
 *
 * A link only brings an anonymous account along (its bots, keys and credit) when it's opened in
 * the browser that asked for it: that browser holds a random value (SIGNIN_COOKIE) whose hash the
 * link keeps. Anywhere else, someone who got the link (the inbox's owner, or a mail scanner) can
 * only sign in to the email's own account, and only with a click (`/auth/confirm`): otherwise
 * anyone could ask for a link to someone else's email and, once it was opened, have that
 * person's verified email on their own anonymous account, or slip their bots into it.
 */
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { randomToken, sha256, timingSafeEqualStr } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { carryCredit } from "@/lib/billing/credit";

const TTL_MS = 20 * 60 * 1000;

/** The cookie that marks the browser that asked for a link (a random value; the link keeps its hash). */
export const SIGNIN_COOKIE = "bab_signin";
export const SIGNIN_COOKIE_MAX_AGE = TTL_MS / 1000;

export async function createLoginLink(
  db: Db,
  input: { email: string; anonymousUserId?: string | null; next?: string | null; browser?: string | null },
): Promise<string> {
  const token = randomToken(32);
  await db.insert(schema.loginTokens).values({
    id: sha256(token),
    email: input.email.trim().toLowerCase(),
    userId: input.anonymousUserId ?? null,
    browserHash: input.browser ? sha256(input.browser) : null,
    redirectTo: safeNext(input.next),
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return `${appUrl()}/auth/verify?token=${encodeURIComponent(token)}`;
}

/**
 * Where to go after signing in: a path on this site, else /app. Browsers read "//host" and "/\host"
 * (and either with tabs or newlines in between, which they drop) as another site.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(next)) return "/app";
  return next;
}

/** A link that can still be used (not used up, not expired), without using it. */
export async function findLoginLink(db: Db, token: string) {
  const [row] = await db
    .select()
    .from(schema.loginTokens)
    .where(and(eq(schema.loginTokens.id, sha256(token)), isNull(schema.loginTokens.usedAt), gt(schema.loginTokens.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** It's being opened in the browser that asked for it (`browser`: that browser's SIGNIN_COOKIE). */
export function sameBrowser(link: { browserHash: string | null }, browser: string | null | undefined): boolean {
  return Boolean(link.browserHash && browser && timingSafeEqualStr(sha256(browser), link.browserHash));
}

/**
 * Consume a link: returns the user to sign in as. Opened in the browser that asked for it
 * (`browser`, its SIGNIN_COOKIE), the anonymous account that asked brings its bots to the
 * verified account (or becomes it). Anywhere else, it only signs in to the email's own account.
 */
export async function consumeLoginLink(db: Db, token: string, browser?: string | null): Promise<{ user: User; redirectTo: string } | null> {
  const id = sha256(token);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.loginTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.loginTokens.id, id), isNull(schema.loginTokens.usedAt), gt(schema.loginTokens.expiresAt, new Date())))
      .returning();
    if (!row) return null;
    const email = row.email;
    const [existing] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    const anon =
      row.userId && sameBrowser(row, browser)
        ? (await tx.select().from(schema.users).where(eq(schema.users.id, row.userId)).limit(1))[0]
        : undefined;

    let user: User;
    if (existing) {
      if (!existing.emailVerifiedAt) {
        await tx.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, existing.id));
      }
      if (anon && anon.id !== existing.id && !anon.email) {
        // Merge the anonymous account's bots into the real one. Not its desktop apps or their pairing
        // codes: on a shared computer they could be someone else's, left to read the next person's
        // bots. They go with the anonymous account, and the app pairs again in a minute.
        await tx.update(schema.bots).set({ ownerId: existing.id }).where(eq(schema.bots.ownerId, anon.id));
        await tx.update(schema.credentials).set({ ownerId: existing.id }).where(eq(schema.credentials.ownerId, anon.id));
        await tx.update(schema.approvals).set({ ownerId: existing.id }).where(eq(schema.approvals.ownerId, anon.id));
        await tx.update(schema.recipes).set({ authorId: existing.id }).where(eq(schema.recipes.authorId, anon.id));
        await tx.update(schema.pairingCodes).set({ ownerId: existing.id }).where(and(eq(schema.pairingCodes.ownerId, anon.id), ne(schema.pairingCodes.purpose, "bridge")));
        // Calls go with their bots (and a call still going is billed to the account it's now in).
        await tx.update(schema.calls).set({ ownerId: existing.id }).where(eq(schema.calls.ownerId, anon.id));
        await tx.update(schema.waitlist).set({ userId: existing.id }).where(eq(schema.waitlist.userId, anon.id));
        await tx.update(schema.meetings).set({ ownerId: existing.id }).where(eq(schema.meetings.ownerId, anon.id));
        await tx.update(schema.dictionary).set({ ownerId: existing.id }).where(eq(schema.dictionary.ownerId, anon.id));
        // The Library's files go with their bots (deleting the anonymous account would take them).
        await tx.update(schema.files).set({ ownerId: existing.id }).where(eq(schema.files.ownerId, anon.id));
        await carryCredit(tx, anon.id, existing.id);
        await tx.update(schema.users).set({ timezone: anon.timezone, ageConfirmedAt: existing.ageConfirmedAt ?? anon.ageConfirmedAt }).where(eq(schema.users.id, existing.id));
        await tx.delete(schema.users).where(eq(schema.users.id, anon.id));
      }
      user = (await tx.select().from(schema.users).where(eq(schema.users.id, existing.id)).limit(1))[0];
    } else if (anon && !anon.email) {
      // The anonymous account becomes the real one: a desktop app paired before signing in is
      // unpaired all the same (on a shared computer it could be someone else's).
      await tx.update(schema.bridgeDevices).set({ revokedAt: new Date() }).where(and(eq(schema.bridgeDevices.ownerId, anon.id), isNull(schema.bridgeDevices.revokedAt)));
      await tx.delete(schema.pairingCodes).where(and(eq(schema.pairingCodes.ownerId, anon.id), eq(schema.pairingCodes.purpose, "bridge")));
      [user] = await tx
        .update(schema.users)
        .set({ email, emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.users.id, anon.id))
        .returning();
    } else {
      const { newId } = await import("@/lib/utils");
      [user] = await tx.insert(schema.users).values({ id: newId("usr"), email, emailVerifiedAt: new Date() }).returning();
    }
    return { user, redirectTo: row.redirectTo ?? "/app" };
  });
}
