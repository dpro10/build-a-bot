import { apiError, authedBot, readBodyCapped, sameOrigin, type RouteCtx } from "@/lib/api";
import { getFile } from "@/lib/library";
import { MAX_FILE_BYTES } from "@/lib/library/limits";
import { putBytes, readBytes, storageMode } from "@/lib/library/storage";

/**
 * The original file, for its owner only (Blob storage is private: nothing in it has a public
 * link). `?download=1` saves it instead of opening it. Served as an attachment unless it's a PDF
 * or a photo, so nothing uploaded can run as a page on this site.
 */
export async function GET(req: Request, ctx: RouteCtx<{ botId: string; fileId: string }>) {
  const { botId, fileId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const file = await getFile(a.db, botId, fileId);
  if (!file || file.status === "uploading") return apiError(404, "That file isn't there anymore.");
  const bytes = await readBytes(file.storageKey);
  if (!bytes) return apiError(404, "That file's contents are gone.");
  const inline = new URL(req.url).searchParams.get("download") !== "1" && (file.kind === "pdf" || (file.kind === "image" && /^image\/(png|jpeg|gif|webp)$/.test(file.mime)));
  const encoded = encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": inline ? file.mime : "application/octet-stream",
      "content-length": String(bytes.length),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
      "x-content-type-options": "nosniff",
      // Browsers' PDF viewers won't open in a sandbox; a PDF can't run this site's scripts anyway.
      ...(file.kind === "pdf" && inline ? {} : { "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
      "cache-control": "private, no-store",
    },
  });
}

/** Running it yourself (no Blob store): the browser uploads the bytes here. */
export async function PUT(req: Request, ctx: RouteCtx<{ botId: string; fileId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  if (storageMode() !== "local") return apiError(405, "Uploads go straight to storage here.");
  const { botId, fileId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const file = await getFile(a.db, botId, fileId);
  if (!file || file.status !== "uploading") return apiError(404, "That upload isn't waiting anymore.");
  const body = await readBodyCapped(req, MAX_FILE_BYTES);
  if (!body) return apiError(413, "Files can be up to 25 MB.");
  await putBytes(file.storageKey, new Uint8Array(body), "application/octet-stream");
  return new Response(null, { status: 204 });
}
