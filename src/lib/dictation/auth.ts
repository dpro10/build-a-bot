/**
 * Voice typing is used from the desktop app (a paired computer's device token, the same pairing
 * as the Bridge and meeting notes) and from the Voice typing page (a signed-in session).
 */
import { eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { BridgeDevice, User } from "@/lib/db/schema";
import { apiError, authed, sameOrigin } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";
import { hasDeviceToken } from "@/lib/meetings/auth";

export type VoiceAuth = { ok: true; db: Db; owner: User; device: BridgeDevice | null };

export async function voiceAuth(req: Request, opts: { write?: boolean } = {}): Promise<VoiceAuth | { ok: false; res: Response }> {
  if (hasDeviceToken(req)) {
    const auth = await authDevice(req);
    if (!auth) return { ok: false, res: apiError(401, "This computer was unpaired. Pair it again from the app.") };
    const [owner] = await auth.db.select().from(schema.users).where(eq(schema.users.id, auth.device.ownerId)).limit(1);
    if (!owner) return { ok: false, res: apiError(401, "Account not found") };
    return { ok: true, db: auth.db, owner, device: auth.device };
  }
  if (opts.write && !sameOrigin(req)) return { ok: false, res: apiError(403, "Bad origin") };
  const a = await authed();
  if (!a.ok) return a;
  return { ok: true, db: a.db, owner: a.user, device: null };
}
