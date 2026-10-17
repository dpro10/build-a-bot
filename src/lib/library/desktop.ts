/**
 * The desktop app's synced folder ("Give my bot a folder"): the app sends the files in one folder
 * the owner picked, keeps them in step (changed files replace their old copy, deleted ones go),
 * and never sees anything else on the disk. Each file is keyed by the device and its path in the
 * folder (`desktop:<device>:<path>`). Pairing again makes a new device: the same bytes at the same
 * path are taken over (`adoptable`), not uploaded twice.
 */
import { and, eq, like } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, BridgeDevice } from "@/lib/db/schema";
import { apiError } from "@/lib/api";
import { authDevice } from "@/lib/bridge/auth";

export function sourceRef(deviceId: string, path: string): string {
  return `desktop:${deviceId}:${path}`;
}

/** A path inside the synced folder: relative, forward slashes, no way out of it. */
export function cleanPath(path: string): string | null {
  const p = String(path ?? "").replace(/\\/g, "/").replace(/^\.?\/+/, "").trim();
  if (!p || p.length > 500 || p.split("/").some((seg) => seg === ".." || seg === "") || /[\u0000-\u001f]/.test(p)) return null;
  return p;
}

/** The device (its token) and one of its owner's bots, or a response to send back. */
export async function deviceBot(req: Request, botId: string | null | undefined): Promise<{ ok: true; db: Db; device: BridgeDevice; bot: Bot } | { ok: false; res: Response }> {
  const auth = await authDevice(req);
  if (!auth) return { ok: false, res: apiError(401, "This computer was unpaired. Pair it again from the app.") };
  if (!botId) return { ok: false, res: apiError(400, "Which bot?") };
  const [bot] = await auth.db.select().from(schema.bots).where(and(eq(schema.bots.id, botId), eq(schema.bots.ownerId, auth.device.ownerId))).limit(1);
  if (!bot) return { ok: false, res: apiError(404, "Bot not found") };
  return { ok: true, db: auth.db, device: auth.device, bot };
}

/** The path part of a synced file's key. */
function refPath(ref: string): string | null {
  if (!ref.startsWith("desktop:")) return null;
  const at = ref.indexOf(":", "desktop:".length);
  return at < 0 ? null : ref.slice(at + 1);
}

/**
 * A copy of these exact bytes at this path, synced to this bot from an earlier pairing of a computer
 * (or another computer syncing the same cloud folder): this device takes it over instead of
 * uploading it again.
 */
export async function adoptable(db: Db, botId: string, path: string, sha256: string) {
  const rows = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.botId, botId),
        eq(schema.files.sha256, sha256),
        like(schema.files.sourceRef, `desktop:%:${path.replace(/[%_\\]/g, (c) => `\\${c}`)}`),
      ),
    )
    .limit(10);
  return rows.find((f) => f.status !== "uploading" && refPath(f.sourceRef ?? "") === path) ?? null;
}
