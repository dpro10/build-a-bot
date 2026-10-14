import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { finishMcpOAuth } from "@/lib/connectors/mcp/oauth";
import { refreshMcpTools } from "@/lib/connectors/mcp/tools";
import { receipt } from "@/lib/agent/run";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const db = await getDb();
  const result = await finishMcpOAuth(db, {
    state: url.searchParams.get("state") ?? "",
    code: url.searchParams.get("code"),
    iss: url.searchParams.get("iss"),
    error: url.searchParams.get("error"),
  });
  if (!result.ok) {
    const back = new URL(result.redirectTo ?? "/app", appUrl());
    back.searchParams.set("connect_error", result.message);
    return NextResponse.redirect(back);
  }
  const [conn] = await db.select().from(schema.connections).where(eq(schema.connections.id, result.connectionId)).limit(1);
  if (conn) {
    await refreshMcpTools(conn, { db }).catch(() => null);
    const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, conn.botId)).limit(1);
    if (bot) await receipt(db, bot, "system", "ok", `Signed in to ${conn.connectorId}`, { connectorId: conn.connectorId });
  }
  const back = new URL(result.redirectTo, appUrl());
  back.searchParams.set("connected", "1");
  return NextResponse.redirect(back);
}
