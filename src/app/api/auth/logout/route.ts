import { NextResponse } from "next/server";
import { apiError, sameOrigin } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";

export async function POST(req: Request) {
  // Another site can't sign people out by posting a form here.
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  await destroySession();
  return NextResponse.redirect(new URL("/", appUrl()), { status: 303 });
}
