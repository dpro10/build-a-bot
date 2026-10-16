import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authed, json, parseJson, sameOrigin } from "@/lib/api";
import { demoMode, live } from "@/lib/env";
import { addCredit } from "@/lib/billing/credit";
import { DEMO_CREDIT_CAP_USD } from "@/lib/billing/prices";
import { isTopUp } from "@/lib/billing/stripe";

/** Demo mode only: add credit without paying, to try everything (up to DEMO_CREDIT_CAP_USD an account). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  if (!demoMode || live.stripe) return apiError(404, "Not available");
  const a = await authed();
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ usd: z.number().int() }));
  if (!parsed.ok) return parsed.res;
  if (!isTopUp(parsed.data.usd)) return apiError(422, "Add $5, $10 or $20 of credit.");
  const [given] = await a.db
    .select({ micros: sql<string>`coalesce(sum(${schema.credits.amountMicros}), 0)` })
    .from(schema.credits)
    .where(and(eq(schema.credits.userId, a.user.id), eq(schema.credits.kind, "demo")));
  const leftUsd = Math.max(0, Math.floor(DEMO_CREDIT_CAP_USD - Number(given?.micros ?? 0) / 1_000_000));
  if (parsed.data.usd > leftUsd) {
    const cap = `Demo mode adds up to $${DEMO_CREDIT_CAP_USD} of credit to an account`;
    return apiError(409, leftUsd ? `${cap}. This one can have $${leftUsd} more.` : `${cap}, and this one has had it.`, { code: "demo_cap" });
  }
  await addCredit(a.db, { userId: a.user.id, kind: "demo", amountMicros: parsed.data.usd * 1_000_000, note: "demo mode: nothing was charged" });
  return json({ added: parsed.data.usd, demo: true });
}
