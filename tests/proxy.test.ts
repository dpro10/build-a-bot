/**
 * Signed out, a link into the app (the site's "Try voice typing", an email, the desktop app) goes
 * to sign-in and remembers the page, so signing in lands there instead of on /app.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/magic";

describe("the sign-in redirect for app pages", () => {
  it("keeps the page (and its query) as where to go after signing in", () => {
    const res = proxy(new NextRequest("https://build-a-bot.site/app/voice?from=landing#dictionary"));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://build-a-bot.site");
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/app/voice?from=landing");
    // The login page accepts it as a safe place to go.
    expect(safeNext(to.searchParams.get("next")!)).toBe("/app/voice?from=landing");
  });

  it("runs only on app pages, and only without a session cookie", () => {
    const [m] = config.matcher;
    expect(m.source).toBe("/app/:path*");
    expect(m.missing).toEqual([{ type: "cookie", key: SESSION_COOKIE }]);
  });
});

describe("where signing in may send you", () => {
  it("a page on this site", () => {
    for (const ok of ["/app", "/app/voice", "/app/bots/abc?tab=memory", "/build?recipe=inbox-zero"]) expect(safeNext(ok)).toBe(ok);
  });

  it("never another site, however it's written", () => {
    // Each of these is a link to evil.example once a browser reads it (or nothing useful at all).
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/\\/evil.example", "/\t/evil.example", "/\n/evil.example", "app", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/app");
    }
    // What a browser makes of the backslash form, for the record.
    expect(new URL("/\\evil.example", "https://build-a-bot.site").host).toBe("evil.example");
  });
});
