import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, json, parseJson } from "@/lib/api";
import { available } from "@/lib/env";
import { createFileRow, deleteFile, fileView, uploadRefusal } from "@/lib/library";
import { adoptable, cleanPath, deviceBot, sourceRef } from "@/lib/library/desktop";
import { MAX_FILE_BYTES } from "@/lib/library/limits";
import { storageMode, uploadToken } from "@/lib/library/storage";

const body = z.object({
  botId: z.string().min(1).max(60),
  path: z.string().min(1).max(500),
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * A file in the synced folder is new or changed: where its bytes go. The same bytes already synced
 * from that path: nothing to do. A changed file replaces the old copy (and its passages).
 */
export async function POST(req: Request) {
  if (!available("library")) return apiError(503, "Adding files is coming soon here.", { code: "unavailable" });
  const parsed = await parseJson(req, body);
  if (!parsed.ok) return parsed.res;
  const a = await deviceBot(req, parsed.data.botId);
  if (!a.ok) return a.res;
  const path = cleanPath(parsed.data.path);
  if (!path) return apiError(400, "That path isn't inside the folder.");
  const ref = sourceRef(a.device.id, path);
  const [old] = await a.db.select().from(schema.files).where(and(eq(schema.files.botId, a.bot.id), eq(schema.files.sourceRef, ref))).limit(1);
  if (old && old.sha256 === parsed.data.sha256 && old.status !== "uploading") return json({ file: fileView(old), unchanged: true });
  if (!old) {
    const earlier = await adoptable(a.db, a.bot.id, path, parsed.data.sha256);
    if (earlier) {
      const [taken] = await a.db.update(schema.files).set({ sourceRef: ref, updatedAt: new Date() }).where(eq(schema.files.id, earlier.id)).returning();
      return json({ file: fileView(taken ?? earlier), unchanged: true });
    }
  }
  if (old) await deleteFile(a.db, a.bot.id, old.id);
  const refusal = await uploadRefusal(a.db, a.device.ownerId, parsed.data.size);
  if (refusal) return apiError(413, refusal, { code: "too_big" });
  const name = path.split("/").pop() ?? path;
  const file = await createFileRow(a.db, { bot: a.bot, owner: { id: a.device.ownerId }, name, size: parsed.data.size, source: "desktop", sourceRef: ref });
  const upload =
    storageMode() === "blob"
      ? { mode: "blob" as const, pathname: file.storageKey, token: await uploadToken(file.storageKey, Math.min(MAX_FILE_BYTES, parsed.data.size + 1024)) }
      : { mode: "local" as const, url: `/api/desktop/library/files/${file.id}/content?botId=${encodeURIComponent(a.bot.id)}` };
  return json({ file: fileView(file), upload });
}

/** A file left the synced folder (deleted or moved out): it leaves the Library too. */
export async function DELETE(req: Request) {
  const parsed = await parseJson(req, body.pick({ botId: true, path: true }));
  if (!parsed.ok) return parsed.res;
  const a = await deviceBot(req, parsed.data.botId);
  if (!a.ok) return a.res;
  const path = cleanPath(parsed.data.path);
  if (!path) return apiError(400, "That path isn't inside the folder.");
  const [old] = await a.db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.botId, a.bot.id), eq(schema.files.sourceRef, sourceRef(a.device.id, path))))
    .limit(1);
  if (old) await deleteFile(a.db, a.bot.id, old.id);
  return json({ ok: true, deleted: Boolean(old) });
}
