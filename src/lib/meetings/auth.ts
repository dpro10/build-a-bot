/**
 * Meeting routes are called by the web app (signed-in session) and by the desktop
 * app (a paired computer's device token, the same pairing the Bridge uses).
 */
import { eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, BridgeDevice, User } from "@/lib/db/schema";
import { apiError, authedBot, sameOrigin } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";

export type MeetingAuth = { ok: true; db: Db; bot: Bot; owner: User; device: BridgeDevice | null };

export function hasDeviceToken(req: Request): boolean {
  return /^bearer\s+bab_dev_/i.test(req.headers.get("authorization") ?? "");
}

export async function meetingAuth(req: Request, botId: string, opts: { write?: boolean } = {}): Promise<MeetingAuth | { ok: false; res: Response }> {
  if (hasDeviceToken(req)) {
    const auth = await authDevice(req);
    if (!auth) return { ok: false, res: apiError(401, "This computer was unpaired. Pair it again from the app.") };
    const [bot] = await auth.db.select().from(schema.bots).where(eq(schema.bots.id, botId)).limit(1);
    if (!bot || bot.ownerId !== auth.device.ownerId) return { ok: false, res: apiError(404, "Bot not found") };
    const [owner] = await auth.db.select().from(schema.users).where(eq(schema.users.id, bot.ownerId)).limit(1);
    if (!owner) return { ok: false, res: apiError(404, "Bot not found") };
    return { ok: true, db: auth.db, bot, owner, device: auth.device };
  }
  if (opts.write && !sameOrigin(req)) return { ok: false, res: apiError(403, "Bad origin") };
  const a = await authedBot(botId);
  if (!a.ok) return a;
  return { ok: true, db: a.db, bot: a.bot, owner: a.user, device: null };
}
