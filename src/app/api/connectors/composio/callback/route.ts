import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { getUser } from "@/lib/auth/session";
import { refreshComposioStatus } from "@/lib/connectors/composio";

/** Composio sends the owner back here after its hosted sign-in. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const connectionId = url.searchParams.get("c") ?? "";
  const db = await getDb();
  const user = await getUser();
  const [conn] = await db.select().from(schema.connections).where(eq(schema.connections.id, connectionId)).limit(1);
  if (!conn || !user) return NextResponse.redirect(new URL("/app", appUrl()));
  const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, conn.botId)).limit(1);
  // Callback identity check: only the bot's owner can complete it.
  if (!bot || bot.ownerId !== user.id) return NextResponse.redirect(new URL("/app", appUrl()));
  const status = await refreshComposioStatus(db, conn).catch(() => "error" as const);
  const back = new URL(`/app/bots/${conn.botId}/tools`, appUrl());
  back.searchParams.set(status === "connected" ? "connected" : "connect_error", status === "connected" ? "1" : "Sign-in didn't finish.");
  return NextResponse.redirect(back);
}
