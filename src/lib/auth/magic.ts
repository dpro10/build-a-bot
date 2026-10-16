/**
 * Passwordless sign-in links. One-time, 20 minutes, stored hashed.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { carryCredit } from "@/lib/billing/credit";

const TTL_MS = 20 * 60 * 1000;

export async function createLoginLink(
  db: Db,
  input: { email: string; anonymousUserId?: string | null; next?: string | null },
): Promise<string> {
  const token = randomToken(32);
  await db.insert(schema.loginTokens).values({
    id: sha256(token),
    email: input.email.trim().toLowerCase(),
    userId: input.anonymousUserId ?? null,
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

/**
 * Consume a link: returns the user to sign in as. If an anonymous account asked for
 * the link, its bots move to the verified account (or the anonymous account becomes it).
 */
export async function consumeLoginLink(db: Db, token: string): Promise<{ user: User; redirectTo: string } | null> {
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
    const anon = row.userId
      ? (await tx.select().from(schema.users).where(eq(schema.users.id, row.userId)).limit(1))[0]
      : undefined;

    let user: User;
    if (existing) {
      if (!existing.emailVerifiedAt) {
        await tx.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, existing.id));
      }
      if (anon && anon.id !== existing.id && !anon.email) {
        // Merge the anonymous account's bots and devices into the real one.
        await tx.update(schema.bots).set({ ownerId: existing.id }).where(eq(schema.bots.ownerId, anon.id));
        await tx.update(schema.credentials).set({ ownerId: existing.id }).where(eq(schema.credentials.ownerId, anon.id));
        await tx.update(schema.approvals).set({ ownerId: existing.id }).where(eq(schema.approvals.ownerId, anon.id));
        await tx.update(schema.bridgeDevices).set({ ownerId: existing.id }).where(eq(schema.bridgeDevices.ownerId, anon.id));
        await tx.update(schema.recipes).set({ authorId: existing.id }).where(eq(schema.recipes.authorId, anon.id));
        await tx.update(schema.pairingCodes).set({ ownerId: existing.id }).where(eq(schema.pairingCodes.ownerId, anon.id));
        await tx.update(schema.waitlist).set({ userId: existing.id }).where(eq(schema.waitlist.userId, anon.id));
        await tx.update(schema.meetings).set({ ownerId: existing.id }).where(eq(schema.meetings.ownerId, anon.id));
        await tx.update(schema.dictionary).set({ ownerId: existing.id }).where(eq(schema.dictionary.ownerId, anon.id));
        await carryCredit(tx, anon.id, existing.id);
        await tx.update(schema.users).set({ timezone: anon.timezone, ageConfirmedAt: existing.ageConfirmedAt ?? anon.ageConfirmedAt }).where(eq(schema.users.id, existing.id));
        await tx.delete(schema.users).where(eq(schema.users.id, anon.id));
      }
      user = (await tx.select().from(schema.users).where(eq(schema.users.id, existing.id)).limit(1))[0];
    } else if (anon && !anon.email) {
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
