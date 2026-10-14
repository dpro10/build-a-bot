import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db";
import type { BridgeDevice } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";

export async function authDevice(req: Request): Promise<{ db: Db; device: BridgeDevice } | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const db = await getDb();
  const [device] = await db
    .select()
    .from(schema.bridgeDevices)
    .where(and(eq(schema.bridgeDevices.tokenHash, sha256(token)), isNull(schema.bridgeDevices.revokedAt)))
    .limit(1);
  if (!device) return null;
  await db.update(schema.bridgeDevices).set({ lastSeenAt: new Date() }).where(eq(schema.bridgeDevices.id, device.id));
  return { db, device };
}
