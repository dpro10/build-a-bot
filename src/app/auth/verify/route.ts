import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { consumeLoginLink } from "@/lib/auth/magic";
import { createSession, destroySession } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/login?error=missing", appUrl()));
  const db = await getDb();
  const result = await consumeLoginLink(db, token);
  if (!result) return NextResponse.redirect(new URL("/login?error=expired", appUrl()));
  await destroySession();
  await createSession(db, result.user.id);
  return NextResponse.redirect(new URL(result.redirectTo, appUrl()));
}
