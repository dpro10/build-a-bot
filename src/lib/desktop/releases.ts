/**
 * The desktop app's signed downloads. CI (.github/workflows/desktop.yml) publishes each signed build
 * as a GitHub release tagged `desktop-v<version>`. The download page and the installed apps' update
 * checks (electron-builder.yml › publish) come through this site, which sends them on to the files,
 * so where the files live can change without shipping a new app.
 */

/** The repository whose releases hold the downloads (public, so anyone can fetch them). */
const REPO = process.env.DESKTOP_RELEASES_REPO?.trim() || "dpro10/build-a-bot";
/** GitHub's API (another address only for local checks of the pages). */
const API = (process.env.DESKTOP_RELEASES_API?.trim() || "https://api.github.com").replace(/\/$/, "");
const CACHE_MS = 5 * 60_000;

export type DesktopPlatform = "mac" | "windows";
export type ReleaseAsset = { name: string; url: string; size: number };
export type DesktopRelease = { version: string; tag: string; publishedAt: string; assets: ReleaseAsset[] };

export const PLATFORMS: Record<DesktopPlatform, { label: string; file: RegExp; needs: string }> = {
  mac: { label: "Mac", file: /^Build-a-bot-\d+(\.\d+)*-mac-universal\.dmg$/, needs: "macOS 13 Ventura or later, Apple silicon or Intel" },
  windows: { label: "Windows", file: /^Build-a-bot-Setup-\d+(\.\d+)*\.exe$/, needs: "Windows 10 or 11, 64-bit" },
};

type GithubRelease = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
};

/** Signed releases only, newest first: no drafts, no pre-releases (the test build is one). */
export function parseReleases(list: unknown): DesktopRelease[] {
  if (!Array.isArray(list)) return [];
  return (list as GithubRelease[])
    .filter((r) => !r.draft && !r.prerelease && /^desktop-v\d/.test(r.tag_name ?? ""))
    .map((r) => ({
      version: (r.tag_name ?? "").slice("desktop-v".length),
      tag: r.tag_name ?? "",
      publishedAt: r.published_at ?? "",
      assets: (r.assets ?? [])
        .filter((a) => a.name && a.browser_download_url?.startsWith("https://"))
        .map((a) => ({ name: a.name!, url: a.browser_download_url!, size: a.size ?? 0 })),
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** The updater's own files, one per platform, in every release (electron-builder writes them). */
const UPDATE_FILES = ["latest-mac.yml", "latest.yml"] as const;

/** latest.yml or latest-mac.yml: the version, when it was built, and each file's name and size. */
export function parseUpdateManifest(text: string): { version: string; releaseDate: string; files: { name: string; size: number }[] } | null {
  let version = "";
  let releaseDate = "";
  let inFiles = false;
  const files: { name: string; size: number }[] = [];
  const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, "");
  for (const line of text.split(/\r?\n/)) {
    const top = /^(\w+):\s*(.*)$/.exec(line);
    if (top) {
      inFiles = top[1] === "files";
      if (top[1] === "version") version = unquote(top[2]);
      if (top[1] === "releaseDate") releaseDate = unquote(top[2]);
      continue;
    }
    if (!inFiles) continue;
    const url = /^\s*-\s*url:\s*(.+)$/.exec(line);
    if (url) files.push({ name: unquote(url[1]), size: 0 });
    const size = /^\s+size:\s*(\d+)\s*$/.exec(line);
    if (size && files.length) files[files.length - 1].size = Number(size[1]);
  }
  const named = files.filter((f) => /^[\w.-]+$/.test(f.name));
  return /^\d+(\.\d+)*$/.test(version) && named.length ? { version, releaseDate, files: named } : null;
}

/**
 * The newest release, read from its updater files on github.com itself (which hands release files
 * out without the API's limit): for when the API says no and there's no list from before (a
 * fresh deployment). Only that one release, with the files those name.
 */
async function fromUpdateFiles(fetchImpl: typeof fetch): Promise<DesktopRelease[] | null> {
  const read = async (file: string) => {
    try {
      const res = await fetchImpl(`https://github.com/${REPO}/releases/latest/download/${file}`, {
        headers: { "user-agent": "build-a-bot.site" },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      return res.ok ? parseUpdateManifest(await res.text()) : null;
    } catch {
      return null;
    }
  };
  const found = (await Promise.all(UPDATE_FILES.map(async (file) => ({ file, manifest: await read(file) })))).flatMap((f) =>
    f.manifest ? [{ file: f.file, ...f.manifest }] : [],
  );
  if (!found.length) return null;
  const { version, releaseDate } = found[0];
  const tag = `desktop-v${version}`;
  const url = (name: string) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;
  const assets = found
    .filter((f) => f.version === version)
    .flatMap((f) => [{ name: f.file, url: url(f.file), size: 0 }, ...f.files.map((x) => ({ name: x.name, url: url(x.name), size: x.size }))]);
  return [{ version, tag, publishedAt: releaseDate, assets }];
}

let cached: { at: number; releases: DesktopRelease[] } | null = null;
/** The last list GitHub gave, kept through its hiccups (and its limit on calls without a token). */
let lastGood: DesktopRelease[] | null = null;

/**
 * The releases, from GitHub, kept for five minutes. With GITHUB_TOKEN set the calls count against
 * that token (5,000 an hour) instead of the 60 an hour GitHub allows calls without one, shared
 * across Vercel. When the API says no, the newest release is read from its updater files instead;
 * when that fails too, the last list it gave is kept (and it tries again in a minute); only with
 * none at all is it empty (the page then says "coming soon").
 */
export async function desktopReleases(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<DesktopRelease[]> {
  if (cached && now - cached.at < CACHE_MS) return cached.releases;
  const token = process.env.GITHUB_TOKEN?.trim();
  let releases: DesktopRelease[] | null = null;
  try {
    const res = await fetchImpl(`${API}/repos/${REPO}/releases?per_page=30`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "build-a-bot.site",
        "x-github-api-version": "2022-11-28",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) releases = parseReleases(await res.json());
    else console.error(`[desktop] GitHub releases: ${res.status}`);
  } catch (err) {
    console.error(`[desktop] GitHub releases: ${err instanceof Error ? err.message : err}`);
  }
  if (!releases) releases = await fromUpdateFiles(fetchImpl);
  if (releases) {
    lastGood = releases;
    cached = { at: now, releases };
    return releases;
  }
  const fallback = lastGood ?? [];
  cached = { at: now - CACHE_MS + 60_000, releases: fallback };
  return fallback;
}

/** For tests. */
export function resetDesktopReleasesCache() {
  cached = null;
  lastGood = null;
}

/** The newest signed build for a platform (one release may hold only the Mac app or only Windows'). */
export function latestDownload(releases: DesktopRelease[], platform: DesktopPlatform): { version: string; asset: ReleaseAsset } | null {
  for (const r of releases) {
    const asset = r.assets.find((a) => PLATFORMS[platform].file.test(a.name));
    if (asset) return { version: r.version, asset };
  }
  return null;
}

/**
 * A file the installed apps' updater asks for: latest.yml (Windows) or latest-mac.yml (Mac) from the
 * newest release that has it, or a file one of those names (the installer, the Mac .zip, block maps).
 */
export function updateFile(releases: DesktopRelease[], file: string): ReleaseAsset | null {
  if (!/^[\w.-]+$/.test(file) || file.startsWith(".")) return null;
  for (const r of releases) {
    const asset = r.assets.find((a) => a.name === file);
    if (asset) return asset;
  }
  return null;
}

/** A phone or tablet: nothing to install there. */
export function isPhoneUserAgent(ua: string | null | undefined): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua ?? "");
}

/** Which computer a browser is on, from its user agent (phones and tablets get both choices). */
export function platformFromUserAgent(ua: string | null | undefined): DesktopPlatform | null {
  const s = ua ?? "";
  if (isPhoneUserAgent(s)) return null;
  if (/Windows NT/i.test(s)) return "windows";
  if (/Macintosh|Mac OS X/i.test(s)) return "mac";
  return null;
}

/** "142 MB". */
export function formatSize(bytes: number): string {
  return bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
