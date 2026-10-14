import { after } from "next/server";
import { getDb } from "@/lib/db";
import { config } from "@/lib/env";
import { verifySvix } from "@/lib/channels/svix";
import { routeInboundEmail } from "@/lib/channels/email-inbound";
import { seenBefore } from "@/lib/channels/inbound";

export const maxDuration = 300;

/** AgentMail inbound: `message.received` with the new text already extracted. */
export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySvix(config.email.agentmailWebhookSecret, req.headers, body)) return new Response("bad signature", { status: 401 });
  const event = JSON.parse(body) as {
    event_type?: string;
    event_id?: string;
    message?: { inbox_id: string; message_id: string; from: string; to?: string[]; subject?: string; text?: string; extracted_text?: string };
  };
  if (event.event_type !== "message.received" || !event.message) return new Response("ignored");
  const db = await getDb();
  if (await seenBefore(db, "agentmail", event.event_id ?? event.message.message_id)) return new Response("ok");
  const m = event.message;
  after(() =>
    routeInboundEmail(db, {
      to: [m.inbox_id, ...(m.to ?? [])],
      from: m.from,
      subject: m.subject ?? "",
      text: m.extracted_text ?? m.text ?? "",
      messageId: m.message_id,
    }),
  );
  return new Response("ok");
}
