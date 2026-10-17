import { NextResponse } from "next/server";
import { desktopReleases, updateFile } from "@/lib/desktop/releases";

/**
 * The installed apps' update feed (desktop/electron-builder.yml › publish): latest.yml, latest-mac.yml
 * and the files they name, sent on to the newest signed release that has them.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const asset = updateFile(await desktopReleases(), file);
  if (!asset) return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new NextResponse(null, { status: 302, headers: { location: asset.url, "cache-control": "no-store" } });
}
