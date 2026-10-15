import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { getUser } from "@/lib/auth/session";
import { finishSlackInstall } from "@/lib/channels/slack-app";

/** Slack sends the owner back here after "Add to Slack". */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const db = await getDb();
  const user = await getUser();
  const result = await finishSlackInstall(db, {
    state: url.searchParams.get("state") ?? "",
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
    userId: user?.id ?? null,
  });
  const back = new URL(result.redirectTo ?? "/app", appUrl());
  if (result.ok) {
    back.searchParams.set("slack", "added");
    if (result.movedFrom.length) back.searchParams.set("moved", result.movedFrom.join(", "));
  } else {
    back.searchParams.set("channel_error", result.message);
  }
  back.hash = "slack";
  return NextResponse.redirect(back);
}
