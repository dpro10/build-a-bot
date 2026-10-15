import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { getUser } from "@/lib/auth/session";
import { COMPOSIO_PENDING_COOKIE, completeComposioAuth, refreshComposioStatus } from "@/lib/connectors/composio";

/**
 * Composio's callback identity check. With this URL set as the project's verifier (Composio:
 * Settings → General → Configuration), Composio holds every app sign-in until we confirm who came
 * back: the signed-in owner of the bot that started it, in the same browser. Someone who was sent
 * a copied sign-in link can't attach their account to another person's bot.
 */
export async function GET(req: Request) {
  const sessionUri = new URL(req.url).searchParams.get("session_uri");
  const jar = await cookies();
  const connectionId = jar.get(COMPOSIO_PENDING_COOKIE)?.value;
  jar.delete({ name: COMPOSIO_PENDING_COOKIE, path: "/api/connectors/composio" });
  const user = await getUser();
  const db = await getDb();
  const [conn] = connectionId ? await db.select().from(schema.connections).where(eq(schema.connections.id, connectionId)).limit(1) : [];
  const [bot] = conn ? await db.select().from(schema.bots).where(eq(schema.bots.id, conn.botId)).limit(1) : [];
  if (!sessionUri || !conn || !bot || !user || bot.ownerId !== user.id) {
    // Not confirmed: the connection stays pending at Composio and lapses with its session.
    return NextResponse.redirect(new URL("/app", appUrl()));
  }
  const back = new URL(`/app/bots/${conn.botId}/tools`, appUrl());
  try {
    await completeComposioAuth(conn.botId, sessionUri);
  } catch (err) {
    console.warn("[composio] sign-in check failed:", (err as Error).message);
    back.searchParams.set("connect_error", "Sign-in didn't finish. Try connecting again.");
    return NextResponse.redirect(back);
  }
  const status = await refreshComposioStatus(db, conn).catch(() => "error" as const);
  back.searchParams.set(status === "connected" ? "connected" : "connect_error", status === "connected" ? "1" : "Sign-in didn't finish.");
  return NextResponse.redirect(back);
}
