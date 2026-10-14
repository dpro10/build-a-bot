import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, ipKey, json, limitOr429, parseJson, sameOrigin } from "@/lib/api";
import { getUser } from "@/lib/auth/session";
import { newId } from "@/lib/utils";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const parsed = await parseJson(req, z.object({ email: z.string().trim().toLowerCase().email(), feature: z.string().min(2).max(60) }));
  if (!parsed.ok) return parsed.res;
  const db = await getDb();
  const limited = await limitOr429(db, ipKey("waitlist", req), 10, 3600);
  if (limited) return limited;
  const user = await getUser();
  await db
    .insert(schema.waitlist)
    .values({ id: newId("wl"), email: parsed.data.email, feature: parsed.data.feature, userId: user?.id ?? null })
    .onConflictDoNothing();
  return json({ ok: true });
}
