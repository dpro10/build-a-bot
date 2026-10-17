import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, json } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";
import { queuedTurns } from "@/lib/bridge/jobs";

/**
 * A computer says it's there and which CLIs it has (the desktop app says none while its Bridge is
 * off). `queued`: turns waiting for one of the owner's computers, so a desktop app that isn't
 * listening yet starts to.
 */
export async function POST(req: Request) {
  const auth = await authDevice(req);
  if (!auth) return apiError(401, "Unknown or revoked device");
  const body = z.object({ clis: z.record(z.string(), z.string().nullable()).optional() }).safeParse(await req.json().catch(() => ({})));
  if (body.success && body.data.clis) {
    await auth.db.update(schema.bridgeDevices).set({ clis: body.data.clis }).where(eq(schema.bridgeDevices.id, auth.device.id));
  }
  return json({ ok: true, deviceId: auth.device.id, queued: await queuedTurns(auth.db, auth.device.ownerId) });
}
