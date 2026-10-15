import { eq, inArray } from "drizzle-orm";
import { schema } from "@/lib/db";
import { authed } from "@/lib/api";

/** Everything we hold about you, as JSON (secrets are never included). */
export async function GET() {
  const a = await authed();
  if (!a.ok) return a.res;
  const bots = await a.db.select().from(schema.bots).where(eq(schema.bots.ownerId, a.user.id));
  const ids = bots.map((b) => b.id);
  const any = ids.length ? ids : ["-"];
  const [messages, receipts, memories, notes, schedules, connections, channels, approvals, contacts, meetings, dictionary] = await Promise.all([
    a.db.select().from(schema.messages).where(inArray(schema.messages.botId, any)),
    a.db.select().from(schema.receipts).where(inArray(schema.receipts.botId, any)),
    a.db.select().from(schema.memories).where(inArray(schema.memories.botId, any)),
    a.db.select().from(schema.notes).where(inArray(schema.notes.botId, any)),
    a.db.select().from(schema.schedules).where(inArray(schema.schedules.botId, any)),
    a.db.select().from(schema.connections).where(inArray(schema.connections.botId, any)),
    a.db.select().from(schema.channels).where(inArray(schema.channels.botId, any)),
    a.db.select().from(schema.approvals).where(eq(schema.approvals.ownerId, a.user.id)),
    a.db.select().from(schema.contacts).where(inArray(schema.contacts.botId, any)),
    a.db.select().from(schema.meetings).where(eq(schema.meetings.ownerId, a.user.id)),
    a.db.select().from(schema.dictionary).where(eq(schema.dictionary.ownerId, a.user.id)),
  ]);
  const meetingIds = meetings.length ? meetings.map((m) => m.id) : ["-"];
  const transcripts = await a.db.select().from(schema.meetingSegments).where(inArray(schema.meetingSegments.meetingId, meetingIds));
  const { stripeCustomerId: _c, stripeSubscriptionId: _s, ...user } = a.user;
  const data = {
    exportedAt: new Date().toISOString(),
    user,
    bots: bots.map(({ mcpTokenHash: _h, ...b }) => b),
    messages,
    receipts,
    memories,
    notes,
    schedules,
    connections: connections.map(({ credentialId: _x, ...c }) => c),
    channels: channels.map(({ credentialId: _x, ...c }) => c),
    approvals,
    contacts,
    meetings: meetings.map((m) => ({ ...m, transcript: transcripts.filter((t) => t.meetingId === m.id && t.text) })),
    /** Voice typing: your words and snippets. What you dictated is never kept, so it isn't here. */
    dictionary,
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="build-a-bot-export.json"' },
  });
}
