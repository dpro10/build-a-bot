import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, readBodyCapped, type RouteCtx } from "@/lib/api";
import { deviceBot } from "@/lib/library/desktop";
import { MAX_FILE_BYTES } from "@/lib/library/limits";
import { putBytes, storageMode } from "@/lib/library/storage";

/** Running it yourself (no Blob store): the desktop app uploads a synced file's bytes here. */
export async function PUT(req: Request, ctx: RouteCtx<{ fileId: string }>) {
  if (storageMode() !== "local") return apiError(405, "Uploads go straight to storage here.");
  const { fileId } = await ctx.params;
  const a = await deviceBot(req, new URL(req.url).searchParams.get("botId"));
  if (!a.ok) return a.res;
  const [file] = await a.db.select().from(schema.files).where(and(eq(schema.files.id, fileId), eq(schema.files.botId, a.bot.id))).limit(1);
  if (!file || file.status !== "uploading" || !file.sourceRef?.startsWith(`desktop:${a.device.id}:`)) return apiError(404, "That upload isn't waiting anymore.");
  const bytes = await readBodyCapped(req, MAX_FILE_BYTES);
  if (!bytes) return apiError(413, "Files can be up to 25 MB.");
  await putBytes(file.storageKey, new Uint8Array(bytes), "application/octet-stream");
  return new Response(null, { status: 204 });
}
