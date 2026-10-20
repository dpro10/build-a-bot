import { apiError, json } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";

/**
 * Desktop apps from before 2026-10-20 call this every 30 seconds while they find Claude Code or
 * Codex (the Bridge, which is gone). It answers that no turns wait for them, so they never ask for
 * one; updated apps don't call it. Calling in still marks the computer as online (authDevice).
 */
export async function POST(req: Request) {
  const auth = await authDevice(req);
  if (!auth) return apiError(401, "Unknown or revoked device");
  return json({ ok: true, deviceId: auth.device.id, queued: 0 });
}
