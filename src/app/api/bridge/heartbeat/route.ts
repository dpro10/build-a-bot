import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, json } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";

export async function POST(req: Request) {
  const auth = await authDevice(req);
  if (!auth) return apiError(401, "Unknown or revoked device");
  const body = z.object({ clis: z.record(z.string(), z.string().nullable()).optional() }).safeParse(await req.json().catch(() => ({})));
  if (body.success && body.data.clis) {
    await auth.db.update(schema.bridgeDevices).set({ clis: body.data.clis }).where(eq(schema.bridgeDevices.id, auth.device.id));
  }
  return json({ ok: true, deviceId: auth.device.id });
}
