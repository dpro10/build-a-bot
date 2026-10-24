import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, json, parseJson, type RouteCtx } from "@/lib/api";
import { z } from "zod";
import { fileView, readLibraryFile } from "@/lib/library";
import { deviceBot } from "@/lib/library/desktop";

export const maxDuration = 300;

/** A synced file's bytes are uploaded: read it (after the response; the app doesn't wait). */
export async function POST(req: Request, ctx: RouteCtx<{ fileId: string }>) {
  const parsed = await parseJson(req, z.object({ botId: z.string().min(1).max(60) }));
  if (!parsed.ok) return parsed.res;
  const { fileId } = await ctx.params;
  const a = await deviceBot(req, parsed.data.botId);
  if (!a.ok) return a.res;
  const [file] = await a.db.select().from(schema.files).where(and(eq(schema.files.id, fileId), eq(schema.files.botId, a.bot.id))).limit(1);
  if (!file || !file.sourceRef?.startsWith(`desktop:${a.device.id}:`)) return apiError(404, "That file isn't there anymore.");
  const [marked] = await a.db.update(schema.files).set({ status: "reading", error: null, updatedAt: new Date() }).where(eq(schema.files.id, file.id)).returning();
  after(async () => {
    await readLibraryFile(a.db, file.id);
  });
  return json({ file: fileView(marked ?? file) });
}
