import { authed, type RouteCtx } from "@/lib/api";
import { readWebSessionScreenshot } from "@/lib/web-actions";

/** The screenshot of a filled web form, for its owner only (shown on the approval). */
export async function GET(_req: Request, ctx: RouteCtx<{ sessionId: string }>) {
  const a = await authed();
  if (!a.ok) return a.res;
  const { sessionId } = await ctx.params;
  const img = await readWebSessionScreenshot(a.db, a.user.id, sessionId);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.body), {
    headers: { "content-type": img.contentType, "cache-control": "private, max-age=900", "x-content-type-options": "nosniff" },
  });
}
