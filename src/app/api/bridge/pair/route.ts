import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError, json, parseJson } from "@/lib/api";
import { randomToken, sha256 } from "@/lib/crypto";
import { rateLimit } from "@/lib/safety/ratelimit";
import { newId } from "@/lib/utils";

/** Called by the Bridge CLI with a pairing code. Returns a device token (shown once). */
export async function POST(req: Request) {
  const parsed = await parseJson(
    req,
    z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
      name: z.string().trim().min(1).max(80),
      platform: z.string().max(40).optional(),
      clis: z.record(z.string(), z.string().nullable()).optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const db = await getDb();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!(await rateLimit(db, `bridge-pair:${ip}`, 10, 600)).ok) return apiError(429, "Too many attempts. Wait a few minutes.");

  const [row] = await db
    .update(schema.pairingCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.pairingCodes.code, parsed.data.code),
        eq(schema.pairingCodes.purpose, "bridge"),
        isNull(schema.pairingCodes.usedAt),
        gt(schema.pairingCodes.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) return apiError(404, "That code is wrong or expired. Get a new one in the app (Settings → Bridge).");

  const token = `bab_dev_${randomToken(32)}`;
  const id = newId("dev");
  await db.insert(schema.bridgeDevices).values({
    id,
    ownerId: row.ownerId,
    name: parsed.data.name,
    tokenHash: sha256(token),
    platform: parsed.data.platform ?? null,
    clis: parsed.data.clis ?? {},
    lastSeenAt: new Date(),
  });
  return json({ deviceId: id, token });
}
