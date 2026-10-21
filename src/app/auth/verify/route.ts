import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sameOrigin } from "@/lib/api";
import { SIGNIN_COOKIE, consumeLoginLink, findLoginLink, sameBrowser } from "@/lib/auth/magic";
import { createSession, destroySession } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";

/**
 * Opening a sign-in link. In the browser that asked for it, it signs in right away. Anywhere else
 * (another device, or a mail scanner opening links to check them), nothing is used up: the
 * confirm page asks first, and signing in there is a POST from this site.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/login?error=missing", appUrl()));
  const db = await getDb();
  const link = await findLoginLink(db, token);
  if (!link) return NextResponse.redirect(new URL("/login?error=expired", appUrl()));
  const browser = (await cookies()).get(SIGNIN_COOKIE)?.value;
  if (!sameBrowser(link, browser)) return NextResponse.redirect(new URL(`/auth/confirm?token=${encodeURIComponent(token)}`, appUrl()));
  return signIn(token, browser);
}

/** "Sign in" on the confirm page. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new NextResponse("Bad origin", { status: 403 });
  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token !== "string" || !token) return NextResponse.redirect(new URL("/login?error=missing", appUrl()), 303);
  return signIn(token, (await cookies()).get(SIGNIN_COOKIE)?.value);
}

async function signIn(token: string, browser: string | undefined) {
  const db = await getDb();
  const result = await consumeLoginLink(db, token, browser);
  if (!result) return NextResponse.redirect(new URL("/login?error=expired", appUrl()), 303);
  await destroySession();
  await createSession(db, result.user.id);
  // 303: after the confirm page's POST, the browser goes on with a GET.
  return NextResponse.redirect(new URL(result.redirectTo, appUrl()), 303);
}
