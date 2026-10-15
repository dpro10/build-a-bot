/**
 * Signed out and opening a page in the app (a link on the site, in an email, or from the desktop
 * app): go to sign-in, then come back to that page. The app's layout checks the session itself;
 * it can't see which page was asked for, so without this everyone came back to /app.
 */
import { NextResponse, type NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Only without a session cookie (SESSION_COOKIE in src/lib/auth/session.ts; the matcher has to be
  // a literal). An expired session still goes through the layout's own redirect.
  matcher: [{ source: "/app/:path*", missing: [{ type: "cookie", key: "bab_session" }] }],
};
