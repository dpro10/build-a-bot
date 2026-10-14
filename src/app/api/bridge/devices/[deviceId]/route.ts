import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authed, json, sameOrigin, type RouteCtx } from "@/lib/api";

export async function DELETE(req: Request, ctx: RouteCtx<{ deviceId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const a = await authed();
  if (!a.ok) return a.res;
  const { deviceId } = await ctx.params;
  await a.db
    .update(schema.bridgeDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.bridgeDevices.id, deviceId), eq(schema.bridgeDevices.ownerId, a.user.id)));
  return json({ ok: true });
}
