import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authed, json, parseJson, sameOrigin } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";
import { computeNextRun, isValidTimeZone } from "@/lib/scheduler/time";
import { deleteLibrary } from "@/lib/library";
import { forgetBotSecrets } from "@/lib/bots/forget";

export async function PATCH(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ name: z.string().trim().max(60).optional(), timezone: z.string().max(80).optional() }));
  if (!parsed.ok) return parsed.res;
  if (parsed.data.timezone && !isValidTimeZone(parsed.data.timezone)) return apiError(422, "Unknown timezone");
  const [user] = await a.db.update(schema.users).set({ ...parsed.data, updatedAt: new Date() }).where(eq(schema.users.id, a.user.id)).returning();
  const tz = parsed.data.timezone;
  if (tz && tz !== a.user.timezone) {
    // Reminders and routines go with the owner to the new zone: "8:00 every day" is 8:00 there.
    // A one-off keeps its moment (and shows in the new zone's time).
    const rows = await a.db
      .select({ s: schema.schedules })
      .from(schema.schedules)
      .innerJoin(schema.bots, eq(schema.bots.id, schema.schedules.botId))
      .where(and(eq(schema.bots.ownerId, a.user.id), eq(schema.schedules.active, true)));
    const now = new Date();
    for (const { s } of rows) {
      const next = s.schedule.type === "once" ? s.nextRunAt : computeNextRun(s.schedule, tz, now);
      await a.db.update(schema.schedules).set({ timezone: tz, nextRunAt: next, active: next !== null, updatedAt: now }).where(eq(schema.schedules.id, s.id));
    }
  }
  return json({ user: { id: user.id, name: user.name, timezone: user.timezone, email: user.email } });
}

/** Delete the account and everything in it (bots, receipts, keys, credit). There's no subscription to cancel: credit is prepaid. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  // The Library's bytes live in storage, not the database: they go first.
  const bots = await a.db.select({ id: schema.bots.id }).from(schema.bots).where(eq(schema.bots.ownerId, a.user.id));
  await deleteLibrary(a.db, bots.map((b) => b.id));
  await forgetBotSecrets(a.db, bots.map((b) => b.id));
  await a.db.transaction(async (tx) => {
    await tx.execute(sql`set local app.allow_receipt_delete = 'on'`);
    // What would outlive the account: its published recipes, and rows that keep its email.
    await tx.delete(schema.recipes).where(eq(schema.recipes.authorId, a.user.id));
    await tx.delete(schema.waitlist).where(eq(schema.waitlist.userId, a.user.id));
    if (a.user.email) {
      await tx.delete(schema.waitlist).where(eq(schema.waitlist.email, a.user.email));
      await tx.delete(schema.loginTokens).where(eq(schema.loginTokens.email, a.user.email));
    }
    await tx.delete(schema.users).where(eq(schema.users.id, a.user.id));
  });
  await destroySession();
  return json({ ok: true });
}
