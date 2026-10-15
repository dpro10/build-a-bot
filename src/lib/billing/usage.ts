/**
 * Monthly usage counters and plan-limit checks. One row per user per UTC month.
 */
import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { periodKey } from "@/lib/utils";
import { getPlan, type Plan } from "./plans";

export type UsageDelta = Partial<{
  messages: number;
  includedMessages: number;
  tokensIn: number;
  tokensOut: number;
  searches: number;
  actions: number;
  voiceSeconds: number;
  meetingSeconds: number;
  smsSegments: number;
  emailsSent: number;
  costMicros: number;
}>;

export async function recordUsage(db: Db, userId: string, delta: UsageDelta, when = new Date()) {
  const period = periodKey(when);
  const id = `${userId}:${period}`;
  const d = {
    messages: delta.messages ?? 0,
    includedMessages: delta.includedMessages ?? 0,
    tokensIn: delta.tokensIn ?? 0,
    tokensOut: delta.tokensOut ?? 0,
    searches: delta.searches ?? 0,
    actions: delta.actions ?? 0,
    voiceSeconds: delta.voiceSeconds ?? 0,
    meetingSeconds: delta.meetingSeconds ?? 0,
    smsSegments: delta.smsSegments ?? 0,
    emailsSent: delta.emailsSent ?? 0,
    costMicros: Math.round(delta.costMicros ?? 0),
  };
  await db
    .insert(schema.usage)
    .values({ id, userId, period, ...d })
    .onConflictDoUpdate({
      target: schema.usage.id,
      set: {
        messages: sql`${schema.usage.messages} + ${d.messages}`,
        includedMessages: sql`${schema.usage.includedMessages} + ${d.includedMessages}`,
        tokensIn: sql`${schema.usage.tokensIn} + ${d.tokensIn}`,
        tokensOut: sql`${schema.usage.tokensOut} + ${d.tokensOut}`,
        searches: sql`${schema.usage.searches} + ${d.searches}`,
        actions: sql`${schema.usage.actions} + ${d.actions}`,
        voiceSeconds: sql`${schema.usage.voiceSeconds} + ${d.voiceSeconds}`,
        meetingSeconds: sql`${schema.usage.meetingSeconds} + ${d.meetingSeconds}`,
        smsSegments: sql`${schema.usage.smsSegments} + ${d.smsSegments}`,
        emailsSent: sql`${schema.usage.emailsSent} + ${d.emailsSent}`,
        costMicros: sql`${schema.usage.costMicros} + ${d.costMicros}`,
        updatedAt: new Date(),
      },
    });
}

export async function getUsage(db: Db, userId: string, when = new Date()) {
  const id = `${userId}:${periodKey(when)}`;
  const [row] = await db.select().from(schema.usage).where(eq(schema.usage.id, id)).limit(1);
  return (
    row ?? {
      id,
      userId,
      period: periodKey(when),
      messages: 0,
      includedMessages: 0,
      tokensIn: 0,
      tokensOut: 0,
      searches: 0,
      actions: 0,
      voiceSeconds: 0,
      meetingSeconds: 0,
      smsSegments: 0,
      emailsSent: 0,
      costMicros: 0,
      updatedAt: new Date(),
    }
  );
}

export type LimitKind = "includedMessages" | "byoMessages" | "searches" | "voiceMinutes" | "smsSegments" | "meetingMinutes";

export type LimitCheck =
  | { ok: true; plan: Plan }
  | { ok: false; plan: Plan; kind: LimitKind; used: number; limit: number; message: string; /** Over the allowance for accounts without a confirmed email. */ signIn?: boolean };

/** Included-brain messages an account gets before it confirms an email (accounts are free to make). */
export const ANONYMOUS_INCLUDED_MESSAGES = 5;

export async function checkLimit(db: Db, owner: Pick<User, "id" | "plan" | "emailVerifiedAt">, kind: LimitKind): Promise<LimitCheck> {
  const plan = getPlan(owner.plan);
  const u = await getUsage(db, owner.id);
  const used =
    kind === "includedMessages"
      ? u.includedMessages
      : kind === "byoMessages"
        ? u.messages - u.includedMessages
        : kind === "searches"
          ? u.searches
          : kind === "voiceMinutes"
            ? Math.ceil(u.voiceSeconds / 60)
            : kind === "meetingMinutes"
              ? Math.floor(u.meetingSeconds / 60)
              : u.smsSegments;
  const signIn = kind === "includedMessages" && !owner.emailVerifiedAt;
  const limit = signIn ? Math.min(plan.limits[kind], ANONYMOUS_INCLUDED_MESSAGES) : plan.limits[kind];
  if (used < limit) return { ok: true, plan };
  if (signIn && limit < plan.limits[kind]) {
    return { ok: false, plan, kind, used, limit, signIn, message: `You've used the ${limit} free messages you get before signing in. Sign in with your email (it's free) to keep going.` };
  }
  const labels: Record<LimitKind, string> = {
    includedMessages: "messages on included brains",
    byoMessages: "messages",
    searches: "web searches",
    voiceMinutes: "call minutes",
    smsSegments: "texts",
    meetingMinutes: "minutes of meeting notes",
  };
  return {
    ok: false,
    plan,
    kind,
    used,
    limit,
    message: `You've used all ${limit.toLocaleString()} ${labels[kind]} on the ${plan.name} plan this month.`,
  };
}
