/**
 * The desktop app's downloads and update feed: build-a-bot.site sends people (and the installed
 * apps' updater) on to the newest signed release's files, leaves pre-releases (the test build) and
 * drafts out, and says "coming soon" when there's nothing signed yet.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  desktopReleases,
  formatSize,
  latestDownload,
  parseReleases,
  parseUpdateManifest,
  platformFromUserAgent,
  resetDesktopReleasesCache,
  updateFile,
} from "@/lib/desktop/releases";

const asset = (name: string, size = 150_000_000) => ({ name, size, browser_download_url: `https://github.com/dpro10/build-a-bot/releases/download/x/${name}` });
const GITHUB = [
  // The test build: a pre-release, never offered.
  { tag_name: "desktop-test", prerelease: true, draft: false, published_at: "2026-10-20T12:00:00Z", assets: [asset("Build-a-bot-0.1.90-mac-universal.dmg"), asset("Build-a-bot-Setup-0.1.90.exe")] },
  // The newest signed release has only the Mac app (Windows' signing wasn't set up yet).
  {
    tag_name: "desktop-v0.1.88",
    prerelease: false,
    draft: false,
    published_at: "2026-10-19T12:00:00Z",
    assets: [asset("Build-a-bot-0.1.88-mac-universal.dmg", 151_000_000), asset("Build-a-bot-0.1.88-mac-universal.zip"), asset("latest-mac.yml", 600)],
  },
  { tag_name: "desktop-v0.1.80", prerelease: false, draft: false, published_at: "2026-10-18T12:00:00Z", assets: [asset("Build-a-bot-Setup-0.1.80.exe", 98_000_000), asset("latest.yml", 400), asset("Build-a-bot-Setup-0.1.80.exe.blockmap", 120_000)] },
  { tag_name: "desktop-v0.1.99", prerelease: false, draft: true, published_at: "", assets: [asset("Build-a-bot-Setup-0.1.99.exe")] },
  { tag_name: "v2.0.0", prerelease: false, draft: false, published_at: "2026-10-21T12:00:00Z", assets: [asset("something-else.tgz")] },
];

afterEach(() => {
  resetDesktopReleasesCache();
  vi.unstubAllGlobals();
});

describe("desktop downloads", () => {
  it("only signed desktop releases count, newest first", () => {
    expect(parseReleases(GITHUB).map((r) => r.version)).toEqual(["0.1.88", "0.1.80"]);
    expect(parseReleases({ message: "Not Found" })).toEqual([]);
  });

  it("each platform gets its newest signed build, even from different releases", () => {
    const releases = parseReleases(GITHUB);
    expect(latestDownload(releases, "mac")).toMatchObject({ version: "0.1.88", asset: { name: "Build-a-bot-0.1.88-mac-universal.dmg", size: 151_000_000 } });
    expect(latestDownload(releases, "windows")).toMatchObject({ version: "0.1.80", asset: { name: "Build-a-bot-Setup-0.1.80.exe" } });
    expect(latestDownload([], "mac")).toBeNull();
  });

  it("the update feed finds latest.yml, latest-mac.yml and the files they name, and nothing else", () => {
    const releases = parseReleases(GITHUB);
    expect(updateFile(releases, "latest-mac.yml")?.url).toContain("latest-mac.yml");
    expect(updateFile(releases, "latest.yml")?.url).toContain("latest.yml");
    expect(updateFile(releases, "Build-a-bot-Setup-0.1.80.exe.blockmap")).not.toBeNull();
    expect(updateFile(releases, "Build-a-bot-Setup-0.1.90.exe")).toBeNull(); // only in the test build
    expect(updateFile(releases, "../secrets")).toBeNull();
    expect(updateFile(releases, ".env")).toBeNull();
  });

  it("knows a Mac from a PC; phones get both choices", () => {
    expect(platformFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("mac");
    expect(platformFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe("windows");
    expect(platformFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBeNull();
    expect(platformFromUserAgent("Mozilla/5.0 (X11; Linux x86_64)")).toBeNull();
    expect(platformFromUserAgent(null)).toBeNull();
    expect(formatSize(151_000_000)).toBe("151 MB");
  });

  it("reads GitHub once every few minutes, and a failure means nothing to offer (not an error page)", async () => {
    const calls: string[] = [];
    const ok = (async (url: string) => {
      calls.push(url);
      return Response.json(GITHUB);
    }) as unknown as typeof fetch;
    expect((await desktopReleases(ok, 1_000_000)).length).toBe(2);
    expect((await desktopReleases(ok, 1_000_000 + 60_000)).length).toBe(2);
    expect(calls).toEqual(["https://api.github.com/repos/dpro10/build-a-bot/releases?per_page=30"]);
    resetDesktopReleasesCache();
    const down = (async () => new Response("rate limited", { status: 403 })) as unknown as typeof fetch;
    expect(await desktopReleases(down)).toEqual([]);
    resetDesktopReleasesCache();
    const offline = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await desktopReleases(offline)).toEqual([]);
  });

  it("a failure after a good read keeps the list it had (and tries again a minute later)", async () => {
    const ok = (async () => Response.json(GITHUB)) as unknown as typeof fetch;
    let downCalls = 0;
    const down = (async (url: string) => {
      if (url.startsWith("https://api.github.com/")) downCalls++;
      return new Response("rate limited", { status: 403 });
    }) as unknown as typeof fetch;
    const t = 5_000_000;
    expect((await desktopReleases(ok, t)).length).toBe(2);
    // Five minutes on, GitHub says no: the downloads stay up.
    expect((await desktopReleases(down, t + 5 * 60_000 + 1)).length).toBe(2);
    expect((await desktopReleases(down, t + 5 * 60_000 + 30_000)).length).toBe(2);
    expect(downCalls).toBe(1);
    expect((await desktopReleases(down, t + 5 * 60_000 + 61_000)).length).toBe(2);
    expect(downCalls).toBe(2);
  });

  it("when the API says no and there's no list yet, the newest release comes from its updater files", async () => {
    const MAC_YML = [
      "version: 0.1.64",
      "files:",
      "  - url: Build-a-bot-0.1.64-mac-universal.zip",
      "    sha512: qnbNkj4u==",
      "    size: 230393576",
      "  - url: Build-a-bot-0.1.64-mac-universal.dmg",
      "    sha512: yZr73lSB==",
      "    size: 231168542",
      "path: Build-a-bot-0.1.64-mac-universal.zip",
      "sha512: qnbNkj4u==",
      "releaseDate: '2026-10-23T00:59:23.869Z'",
    ].join("\n");
    const WIN_YML = ["version: 0.1.64", "files:", "  - url: Build-a-bot-Setup-0.1.64.exe", "    sha512: P2vM4vpt==", "    size: 112677488", "path: Build-a-bot-Setup-0.1.64.exe", "releaseDate: '2026-10-23T00:57:13.064Z'"].join("\n");
    const calls: string[] = [];
    const github = (async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://api.github.com/")) return new Response("rate limited", { status: 403 });
      if (url.endsWith("/releases/latest/download/latest-mac.yml")) return new Response(MAC_YML);
      if (url.endsWith("/releases/latest/download/latest.yml")) return new Response(WIN_YML);
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const releases = await desktopReleases(github);
    expect(calls.filter((u) => u.startsWith("https://github.com/")).sort()).toEqual([
      "https://github.com/dpro10/build-a-bot/releases/latest/download/latest-mac.yml",
      "https://github.com/dpro10/build-a-bot/releases/latest/download/latest.yml",
    ]);
    const base = "https://github.com/dpro10/build-a-bot/releases/download/desktop-v0.1.64";
    expect(latestDownload(releases, "mac")).toEqual({ version: "0.1.64", asset: { name: "Build-a-bot-0.1.64-mac-universal.dmg", url: `${base}/Build-a-bot-0.1.64-mac-universal.dmg`, size: 231168542 } });
    expect(latestDownload(releases, "windows")).toEqual({ version: "0.1.64", asset: { name: "Build-a-bot-Setup-0.1.64.exe", url: `${base}/Build-a-bot-Setup-0.1.64.exe`, size: 112677488 } });
    // The installed apps' updater gets its files the same way.
    expect(updateFile(releases, "latest.yml")?.url).toBe(`${base}/latest.yml`);
    expect(updateFile(releases, "Build-a-bot-0.1.64-mac-universal.zip")?.url).toBe(`${base}/Build-a-bot-0.1.64-mac-universal.zip`);
    // A manifest that isn't one names nothing.
    expect(parseUpdateManifest("<html>Not found</html>")).toBeNull();
    expect(parseUpdateManifest("version: 0.1.64\nfiles:\n  - url: ../../evil.exe\n    size: 1")).toBeNull();
  });

  it("/download/<platform> and the update feed redirect to the files", async () => {
    vi.stubGlobal("fetch", async () => Response.json(GITHUB));
    const download = await import("@/app/(marketing)/download/[platform]/route");
    const mac = await download.GET(new Request("https://build-a-bot.site/download/mac"), { params: Promise.resolve({ platform: "mac" }) });
    expect(mac.status).toBe(302);
    expect(mac.headers.get("location")).toBe("https://github.com/dpro10/build-a-bot/releases/download/x/Build-a-bot-0.1.88-mac-universal.dmg");
    const linux = await download.GET(new Request("https://build-a-bot.site/download/linux"), { params: Promise.resolve({ platform: "linux" }) });
    expect(linux.status).toBe(303);
    expect(linux.headers.get("location")).toBe("https://build-a-bot.site/download");

    const feed = await import("@/app/desktop/updates/[file]/route");
    const yml = await feed.GET(new Request("https://build-a-bot.site/desktop/updates/latest.yml"), { params: Promise.resolve({ file: "latest.yml" }) });
    expect(yml.status).toBe(302);
    expect(yml.headers.get("location")).toContain("/latest.yml");
    const missing = await feed.GET(new Request("https://build-a-bot.site/desktop/updates/nope.exe"), { params: Promise.resolve({ file: "nope.exe" }) });
    expect(missing.status).toBe(404);
  });

  it("with nothing signed yet, /download/<platform> goes back to the page, which says it's coming", async () => {
    vi.stubGlobal("fetch", async () => Response.json([GITHUB[0]]));
    const download = await import("@/app/(marketing)/download/[platform]/route");
    const res = await download.GET(new Request("https://build-a-bot.site/download/windows"), { params: Promise.resolve({ platform: "windows" }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://build-a-bot.site/download");
  });
});
