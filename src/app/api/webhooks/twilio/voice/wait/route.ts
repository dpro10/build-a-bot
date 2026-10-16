import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { answerTwiml, readTwilioForm, say, tierParam, twiml } from "@/lib/channels/twilio-inbound";
import { escapeXml } from "@/lib/channels/twilio";
import { sleep } from "@/lib/utils";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { valid } = await readTwilioForm(req);
  if (!valid) return new Response("bad signature", { status: 403 });
  const url = new URL(req.url);
  const channelId = url.searchParams.get("c") ?? "";
  const resultId = url.searchParams.get("r") ?? "";
  const tier = tierParam(url);
  const db = await getDb();
  for (let i = 0; i < 12; i++) {
    const [row] = await db.select().from(schema.asyncResults).where(eq(schema.asyncResults.id, resultId)).limit(1);
    if (!row) return twiml(`${say("Sorry, I lost my train of thought.")}<Hangup/>`);
    if (row.status !== "pending") return twiml(answerTwiml(channelId, row.result as { text?: string; approvals?: number; error?: string } | null, tier));
    if (i === 0 && row.polls >= 6) return twiml(`${say("This is taking a while. I'll text you the answer when it's ready.")}<Hangup/>`);
    await sleep(500);
  }
  await db.update(schema.asyncResults).set({ polls: sql`${schema.asyncResults.polls} + 1` }).where(eq(schema.asyncResults.id, resultId));
  const again = `${appUrl()}/api/webhooks/twilio/voice/wait?c=${encodeURIComponent(channelId)}&r=${resultId}&t=${tier}`;
  return twiml(`${say("Still on it.")}<Pause length="2"/><Redirect method="POST">${escapeXml(again)}</Redirect>`);
}
