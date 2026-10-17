import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, limitOr429, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { available } from "@/lib/env";
import { createFileRow, fileView, listFiles, ownerUsage, uploadRefusal } from "@/lib/library";
import { MAX_FILE_BYTES, MAX_OWNER_BYTES } from "@/lib/library/limits";
import { storageMode, uploadToken } from "@/lib/library/storage";

/** The bot's Library: its files and how much room is left. */
export async function GET(_req: Request, ctx: RouteCtx<{ botId: string }>) {
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const [files, used] = await Promise.all([listFiles(a.db, botId), ownerUsage(a.db, a.user.id)]);
  return json({ files: files.map(fileView), usage: { bytes: used.bytes, maxBytes: MAX_OWNER_BYTES, files: used.files } });
}

/**
 * Start an upload: checks the limits and returns where the bytes go. A private Blob path with a
 * token good for that one path (straight from the browser), or this server (running it yourself).
 * The same bytes already in this bot's Library (by their SHA-256): nothing to upload.
 */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  if (!available("library")) return apiError(503, "Adding files is coming soon here.", { code: "unavailable" });
  const parsed = await parseJson(
    req,
    z.object({
      name: z.string().trim().min(1).max(300),
      size: z.number().int().min(0),
      sha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    }),
  );
  if (!parsed.ok) return parsed.res;
  const limited = await limitOr429(a.db, `files:${a.user.id}`, 60, 600, "That's a lot of files at once. Give it a few minutes.");
  if (limited) return limited;
  if (parsed.data.sha256) {
    const [same] = await a.db
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.botId, botId), eq(schema.files.sha256, parsed.data.sha256), eq(schema.files.status, "ready")))
      .limit(1);
    if (same) return json({ file: fileView(same), duplicate: true });
  }
  const refusal = await uploadRefusal(a.db, a.user.id, parsed.data.size);
  if (refusal) return apiError(413, refusal, { code: "too_big" });
  const file = await createFileRow(a.db, { bot: a.bot, owner: a.user, name: parsed.data.name, size: parsed.data.size });
  const upload =
    storageMode() === "blob"
      ? { mode: "blob" as const, pathname: file.storageKey, token: await uploadToken(file.storageKey, Math.min(MAX_FILE_BYTES, parsed.data.size + 1024)) }
      : { mode: "local" as const, url: `/api/bots/${botId}/files/${file.id}/content` };
  return json({ file: fileView(file), upload });
}
