import { apiError, authedBot, json, sameOrigin, type RouteCtx } from "@/lib/api";
import { deleteFile, fileView, getFile } from "@/lib/library";

/** One file (the upload and chat chips poll this while it's being read). */
export async function GET(_req: Request, ctx: RouteCtx<{ botId: string; fileId: string }>) {
  const { botId, fileId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const file = await getFile(a.db, botId, fileId);
  if (!file) return apiError(404, "That file isn't there anymore.", { code: "gone" });
  return json({ file: fileView(file) });
}

export async function DELETE(req: Request, ctx: RouteCtx<{ botId: string; fileId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId, fileId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  if (!(await deleteFile(a.db, botId, fileId))) return apiError(404, "That file isn't there anymore.");
  return json({ ok: true });
}
