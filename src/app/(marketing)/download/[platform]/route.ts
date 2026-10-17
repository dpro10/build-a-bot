import { NextResponse } from "next/server";
import { desktopReleases, latestDownload, type DesktopPlatform } from "@/lib/desktop/releases";

/**
 * /download/mac and /download/windows: straight to the newest signed build's file. With none yet,
 * back to the download page, which says so.
 */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  if (platform !== "mac" && platform !== "windows") return NextResponse.redirect(new URL("/download", req.url), 303);
  const latest = latestDownload(await desktopReleases(), platform as DesktopPlatform);
  if (!latest) return NextResponse.redirect(new URL("/download", req.url), 303);
  return new NextResponse(null, { status: 302, headers: { location: latest.asset.url, "cache-control": "no-store" } });
}
