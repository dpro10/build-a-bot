import { after } from "next/server";
import { getDb } from "@/lib/db";
import { config } from "@/lib/env";
import { verifySvix } from "@/lib/channels/svix";
import { routeInboundEmail } from "@/lib/channels/email-inbound";
import { seenBefore } from "@/lib/channels/inbound";

export const maxDuration = 300;

/** Resend inbound: `email.received` (metadata) → fetch body → route to the bot. */
export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySvix(process.env.RESEND_WEBHOOK_SECRET, req.headers, body)) return new Response("bad signature", { status: 401 });
  const event = JSON.parse(body) as { type: string; data?: { email_id?: string; to?: string[]; from?: string; subject?: string } };
  if (event.type !== "email.received" || !event.data?.email_id) return new Response("ignored");
  const db = await getDb();
  if (await seenBefore(db, "resend", event.data.email_id)) return new Response("ok");
  const data = event.data;
  after(async () => {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(data.email_id!)}`, {
      headers: { authorization: `Bearer ${config.email.resendKey}` },
    });
    if (!res.ok) return;
    const email = (await res.json()) as { text?: string; html?: string; from?: string; to?: string[]; subject?: string; message_id?: string };
    const text = email.text ?? (email.html ?? "").replace(/<[^>]+>/g, " ");
    await routeInboundEmail(db, {
      to: email.to ?? data.to ?? [],
      from: email.from ?? data.from ?? "",
      subject: email.subject ?? data.subject ?? "",
      text,
      messageId: email.message_id,
    });
  });
  return new Response("ok");
}
