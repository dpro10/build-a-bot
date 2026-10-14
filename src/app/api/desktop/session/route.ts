import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, json } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";
import { getPlan } from "@/lib/billing/plans";
import { getUsage } from "@/lib/billing/usage";
import { appUrl, demoMode } from "@/lib/env";
import { CHUNK_MS, MEETINGS_CONNECTOR } from "@/lib/meetings";
import { transcriptionAvailable } from "@/lib/transcribe";

/** The desktop app's view of the account: which bots can take notes, and how many minutes are left. */
export async function GET(req: Request) {
  const auth = await authDevice(req);
  if (!auth) return apiError(401, "This computer was unpaired. Pair it again from the app.");
  const { db, device } = auth;
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, device.ownerId)).limit(1);
  if (!owner) return apiError(401, "Account not found");
  const bots = await db.select().from(schema.bots).where(eq(schema.bots.ownerId, owner.id));
  const on = bots.length
    ? await db
        .select({ botId: schema.connections.botId, status: schema.connections.status })
        .from(schema.connections)
        .where(and(inArray(schema.connections.botId, bots.map((b) => b.id)), eq(schema.connections.connectorId, MEETINGS_CONNECTOR)))
    : [];
  const plan = getPlan(owner.plan);
  const usage = await getUsage(db, owner.id);
  return json({
    device: { id: device.id, name: device.name },
    owner: { name: owner.name ?? owner.email?.split("@")[0] ?? null, plan: plan.id },
    bots: bots.map((b) => ({
      id: b.id,
      name: b.name,
      avatar: b.avatar,
      color: b.color,
      paused: b.status === "paused",
      meetingsOn: on.some((c) => c.botId === b.id && c.status !== "disabled"),
    })),
    meetings: {
      available: transcriptionAvailable(),
      minutesLeft: Math.max(0, plan.limits.meetingMinutes - Math.floor(usage.meetingSeconds / 60)),
      chunkMs: CHUNK_MS,
    },
    appUrl: appUrl(),
    demo: demoMode,
  });
}
