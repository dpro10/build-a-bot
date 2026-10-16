import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { gather, readTwilioForm, say, twiml } from "@/lib/channels/twilio-inbound";

/**
 * Twilio comes here when a call's stream to the voice server ends. If the voice server ended the
 * call (goodbye, or the caller hung up), hang up. If it dropped the call, carry on on the simpler
 * line, as whoever the caller had shown they were.
 */
export async function POST(req: Request) {
  const { valid } = await readTwilioForm(req);
  if (!valid) return new Response("bad signature", { status: 403 });
  const url = new URL(req.url);
  const channelId = url.searchParams.get("c") ?? "";
  const callId = url.searchParams.get("call") ?? "";
  const db = await getDb();
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId)).limit(1);
  if (!call || call.status === "ended") return twiml("<Hangup/>");
  await db
    .update(schema.calls)
    .set({ status: "failed", endedAt: new Date() })
    .where(and(eq(schema.calls.id, call.id), inArray(schema.calls.status, ["pending", "active"])));
  const tier = call.speaker === "owner" ? "owner" : "contact";
  return twiml(`${gather(channelId, "Sorry, I lost my connection for a second. What can I do for you?", 0, tier)}${say("Talk soon!")}<Hangup/>`);
}
