import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authed, json, parseJson, sameOrigin } from "@/lib/api";
import { demoMode, live } from "@/lib/env";

/** Demo mode only: switch plans without paying, to try every feature. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  if (!demoMode || live.stripe) return apiError(404, "Not available");
  const a = await authed();
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, z.object({ plan: z.enum(["free", "plus", "pro"]) }));
  if (!parsed.ok) return parsed.res;
  await a.db.update(schema.users).set({ plan: parsed.data.plan, planStatus: "active", updatedAt: new Date() }).where(eq(schema.users.id, a.user.id));
  return json({ plan: parsed.data.plan, demo: true });
}
