/**
 * Approvals: the owner's tap that lets a held action run (or not).
 *
 * - Web: signed-in owner taps Approve / Deny on the card.
 * - Channels: inline buttons (Telegram, Slack, Discord) carry a signed one-shot token;
 *   high-risk actions always route to the app instead (a chat button isn't enough).
 * - After a decision the bot follows up in the original conversation.
 */
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Approval, Bot, User } from "@/lib/db/schema";
import { demoMode, appUrl } from "@/lib/env";
import { signToken, verifyToken } from "@/lib/crypto";
import { buildToolset } from "@/lib/tools/registry";
import type { ToolContext } from "@/lib/tools/types";
import { deliver, ensureConversation } from "@/lib/channels/outbound";
import type { ChannelKind } from "@/lib/channels/catalog";
import { errorMessage, newId, truncate } from "@/lib/utils";
import { receipt, runTurn, type RunInput } from "./run";

export type ApprovalDecision = "approve" | "deny";

export type DecideResult =
  | { ok: true; approval: Approval; followUp?: string }
  | { ok: false; error: string; approval?: Approval };

export async function decideApproval(
  db: Db,
  input: { approvalId: string; ownerId: string; decision: ApprovalDecision; via: string },
): Promise<DecideResult> {
  const [approval] = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.id, input.approvalId), eq(schema.approvals.ownerId, input.ownerId)))
    .limit(1);
  if (!approval) return { ok: false, error: "Approval not found." };
  if (approval.status !== "pending") return { ok: false, error: `Already ${approval.status}.`, approval };
  if (approval.expiresAt.getTime() < Date.now()) {
    await db.update(schema.approvals).set({ status: "expired" }).where(eq(schema.approvals.id, approval.id));
    return { ok: false, error: "This request expired. Ask your bot again.", approval: { ...approval, status: "expired" } };
  }

  const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, approval.botId)).limit(1);
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, approval.ownerId)).limit(1);
  if (!bot || !owner) return { ok: false, error: "Bot not found." };

  // Claim it atomically so a double tap can't run it twice.
  const claimed = await db
    .update(schema.approvals)
    .set({
      status: input.decision === "approve" ? "approved" : "denied",
      decidedAt: new Date(),
      decidedVia: input.via,
    })
    .where(and(eq(schema.approvals.id, approval.id), eq(schema.approvals.status, "pending")))
    .returning();
  if (!claimed.length) return { ok: false, error: "Someone already decided this one.", approval };

  if (input.decision === "deny") {
    await receipt(db, bot, "approval", "ok", `You declined: ${approval.title}`, { approvalId: approval.id, via: input.via });
    const followUp = await followUpTurn(db, bot, owner, approval, `The owner declined: ${approval.title}. Acknowledge in one short sentence and don't do it.`);
    return { ok: true, approval: claimed[0], followUp };
  }

  if (bot.status === "paused") {
    await db.update(schema.approvals).set({ status: "failed", result: { error: "Bot is paused" } }).where(eq(schema.approvals.id, approval.id));
    return { ok: false, error: "Your bot is paused. Resume it first." };
  }

  // Run exactly what was approved — nothing the model says now can change the arguments.
  const ctx: ToolContext = {
    db,
    bot,
    owner,
    conversationId: approval.conversationId,
    channelKind: "web",
    demo: demoMode,
    now: new Date(),
  };
  const toolset = await buildToolset(ctx);
  const spec = toolset.byName.get(approval.tool);
  let resultText: string;
  let ok = false;
  if (!spec) {
    resultText = "That tool is no longer connected.";
  } else {
    const parsed = spec.input.safeParse(approval.args);
    if (!parsed.success) resultText = "The saved request no longer matches the tool.";
    else {
      try {
        const out = await spec.run(parsed.data as Record<string, unknown>, ctx);
        ok = out.ok;
        resultText = out.ok ? out.content : out.error;
        if (out.ok && spec.recipients) {
          const recipients = await spec.recipients(parsed.data as Record<string, unknown>, ctx);
          for (const r of recipients) {
            if (r.isOwner || r.isKnownContact || r.address.includes(" ")) continue;
            await db
              .insert(schema.contacts)
              .values({ id: newId("ctc"), botId: bot.id, kind: r.kind, address: r.address.toLowerCase(), approvedAt: new Date() })
              .onConflictDoNothing();
          }
        }
      } catch (err) {
        resultText = truncate(errorMessage(err), 300);
      }
    }
  }

  const [final] = await db
    .update(schema.approvals)
    .set({ status: ok ? "executed" : "failed", result: { ok, text: truncate(resultText, 2000) } })
    .where(eq(schema.approvals.id, approval.id))
    .returning();
  await receipt(db, bot, "tool", ok ? "ok" : "error", ok ? `Approved & done: ${approval.title}` : `Approved but failed: ${approval.title}`, {
    tool: approval.tool,
    approvalId: approval.id,
    via: input.via,
    effect: spec?.effect ?? "write",
    result: truncate(resultText, 300),
  });

  const followUp = await followUpTurn(
    db,
    bot,
    owner,
    approval,
    ok
      ? `The owner approved: ${approval.title}. It ran. Result: ${truncate(resultText, 1500)}. Tell them it's done in one or two sentences.`
      : `The owner approved: ${approval.title}, but it failed: ${truncate(resultText, 500)}. Tell them briefly and suggest a next step.`,
    // What it says about the approved action is checked against what really happened to it.
    [{ name: approval.tool, effect: spec?.effect ?? "write", connectorId: approval.connectorId ?? "", ok }],
  );
  return { ok: true, approval: final, followUp };
}

async function followUpTurn(db: Db, bot: Bot, owner: User, approval: Approval, directive: string, ran?: RunInput["ran"]): Promise<string | undefined> {
  if (!approval.conversationId) return undefined;
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, approval.conversationId)).limit(1);
  if (!conversation) return undefined;
  const result = await runTurn({
    db,
    bot,
    owner,
    conversation,
    channelKind: conversation.channelKind,
    message: null,
    directive,
    trigger: "approval",
    noTools: true,
    ran,
  });
  if (conversation.channelKind !== "web" && result.text) {
    await deliver(db, bot, conversation.channelKind as ChannelKind, { to: conversation.externalId, text: result.text, toOwner: true }, { owner });
  }
  return result.text;
}

// ---------------------------------------------------------------------------
// Channel buttons: signed one-shot tokens.

export function approvalButtonToken(approvalId: string, decision: ApprovalDecision): string {
  return signToken({ a: approvalId, d: decision === "approve" ? 1 : 0 }, 24 * 60 * 60);
}

export function readApprovalButtonToken(token: string): { approvalId: string; decision: ApprovalDecision } | null {
  const payload = verifyToken<{ a: string; d: number }>(token);
  if (!payload) return null;
  return { approvalId: payload.a, decision: payload.d === 1 ? "approve" : "deny" };
}

/** Buttons for a channel message. High-risk approvals link to the app instead. */
export function approvalButtons(approvals: Approval[]) {
  const buttons: { label: string; url?: string; data?: string }[] = [];
  for (const a of approvals.slice(0, 2)) {
    if (a.risk === "high") {
      buttons.push({ label: "Review in app", url: `${appUrl()}/app/approvals?focus=${a.id}` });
    } else {
      buttons.push({ label: "✅ Approve", data: `ap:${approvalButtonToken(a.id, "approve")}` });
      buttons.push({ label: "✖ Deny", data: `ap:${approvalButtonToken(a.id, "deny")}` });
    }
  }
  return buttons;
}

/** Callback data is limited (Telegram: 64 bytes), so channels store a short key → token map. */
export async function shortApprovalKey(db: Db, ownerId: string, token: string): Promise<string> {
  const code = newId("k").slice(2, 12);
  await db.insert(schema.pairingCodes).values({
    code: `ak_${code}`,
    purpose: "approval",
    ownerId,
    data: { token },
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  return `ak_${code}`;
}

export async function resolveShortApprovalKey(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(schema.pairingCodes).where(eq(schema.pairingCodes.code, key)).limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return (row.data as { token?: string }).token ?? null;
}

export async function ensureWebConversation(db: Db, botId: string) {
  return ensureConversation(db, botId, "web", "owner");
}
