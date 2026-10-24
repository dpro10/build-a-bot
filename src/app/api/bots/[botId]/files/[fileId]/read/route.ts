import { after } from "next/server";
import { and, eq, lt, ne, or } from "drizzle-orm";
import { schema } from "@/lib/db";
import { apiError, authedBot, json, sameOrigin, type RouteCtx } from "@/lib/api";
import { fileView, getFile, readLibraryFile } from "@/lib/library";

// Long PDFs with scanned pages take a while: the vision model reads them a few at a time.
export const maxDuration = 300;

/**
 * The bytes are uploaded: read the file. It runs after the response (the app polls the file's
 * status), so the page never waits on a 300-page PDF. Also "Try again" for a file that failed.
 */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string; fileId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, fileId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const file = await getFile(a.db, botId, fileId);
  if (!file) return apiError(404, "That file isn't there anymore.", { code: "gone" });
  if (file.status === "ready") return json({ file: fileView(file) });
  // Claimed once: two of these at the same moment read the file once (not twice, into duplicate passages).
  const [marked] = await a.db
    .update(schema.files)
    .set({ status: "reading", error: null, updatedAt: new Date() })
    .where(and(eq(schema.files.id, file.id), or(ne(schema.files.status, "reading"), lt(schema.files.updatedAt, new Date(Date.now() - 5 * 60_000)))))
    .returning();
  if (!marked) return json({ file: fileView(file) });
  after(async () => {
    await readLibraryFile(a.db, file.id);
  });
  return json({ file: fileView(marked) });
}
