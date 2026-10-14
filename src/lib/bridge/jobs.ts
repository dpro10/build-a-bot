/**
 * The Bridge: subscription brains (the owner's own Claude Code / Codex) run on the
 * owner's own computer, signed in by them. We never see or store their login.
 *
 *   cloud: runTurn → queue a bridge job (prompt + context + a short-lived MCP token)
 *   bridge (owner's computer): long-polls /api/bridge/jobs, runs `claude -p` / `codex exec`
 *       with OUR tools mounted over MCP (/api/mcp/[botId]) — every tool call still goes
 *       through the policy engine here in the cloud
 *   bridge → POST /api/bridge/jobs/[id]/result → we store the reply and deliver it.
 *
 * When the computer is asleep: wait (default), or — only if the owner opted in —
 * fall back to the included brain.
 */
import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";
import type { Bot, BridgeJob, User } from "@/lib/db/schema";
import { appUrl } from "@/lib/env";
import { signToken, verifyToken } from "@/lib/crypto";
import { newId, sortableId, truncate } from "@/lib/utils";
import { botEmailAddress } from "@/lib/tools/builtin";
import { buildDynamicContext, buildStablePrompt } from "@/lib/agent/prompt";
import type { RunInput, RunResult } from "@/lib/agent/run";
import { deliver } from "@/lib/channels/outbound";
import type { ChannelKind } from "@/lib/channels/catalog";

export const DEVICE_ONLINE_MS = 90_000;
const JOB_TTL_MS = 12 * 60 * 60 * 1000;
const MCP_TOKEN_TTL_S = 30 * 60;

export async function onlineDevice(db: Db, ownerId: string) {
  const since = new Date(Date.now() - DEVICE_ONLINE_MS);
  const devices = await db
    .select()
    .from(schema.bridgeDevices)
    .where(and(eq(schema.bridgeDevices.ownerId, ownerId), isNull(schema.bridgeDevices.revokedAt), gt(schema.bridgeDevices.lastSeenAt, since)))
    .orderBy(desc(schema.bridgeDevices.lastSeenAt))
    .limit(5);
  // Only a computer with Claude Code or Codex can think for the bot (the desktop app alone takes meeting notes).
  return devices.find((d) => Boolean(d.clis?.claude || d.clis?.codex)) ?? null;
}

/** Has the owner paired the Bridge on a computer? (The desktop app pairs too, but only takes meeting notes.) */
export async function bridgePaired(db: Db, ownerId: string): Promise<boolean> {
  const devices = await db
    .select({ platform: schema.bridgeDevices.platform })
    .from(schema.bridgeDevices)
    .where(and(eq(schema.bridgeDevices.ownerId, ownerId), isNull(schema.bridgeDevices.revokedAt)));
  return devices.some((d) => !d.platform?.startsWith("desktop-"));
}

/** Where a subscription brain's computer stands: online to think, paired but asleep, or never paired. */
export type ComputerState = "online" | "asleep" | "unpaired";

export async function computerState(db: Db, ownerId: string): Promise<ComputerState> {
  if (await onlineDevice(db, ownerId)) return "online";
  return (await bridgePaired(db, ownerId)) ? "asleep" : "unpaired";
}

/** For the header and the chat: this bot's computer, when it can't think without it (else null). */
export async function computerFor(db: Db, bot: Pick<Bot, "ownerId" | "brain">): Promise<ComputerState | null> {
  if (bot.brain.kind !== "subscription" || bot.brain.whenOffline === "included") return null;
  return computerState(db, bot.ownerId);
}

export function mcpTokenFor(job: Pick<BridgeJob, "id" | "botId" | "ownerId">): string {
  return signToken({ kind: "mcp", job: job.id, bot: job.botId, owner: job.ownerId }, MCP_TOKEN_TTL_S);
}

export function readMcpToken(token: string): { jobId: string; botId: string; ownerId: string } | null {
  const p = verifyToken<{ kind: string; job: string; bot: string; owner: string }>(token);
  if (!p || p.kind !== "mcp") return null;
  return { jobId: p.job, botId: p.bot, ownerId: p.owner };
}

export async function runViaBridge(
  input: RunInput,
  brain: { cli: "claude" | "codex"; model: string; label: string },
): Promise<RunResult> {
  const { db, bot, owner, conversation } = input;
  const emit = input.emit ?? (() => {});
  const device = await onlineDevice(db, owner.id);
  const paired = Boolean(device) || (await bridgePaired(db, owner.id));

  if (!device && bot.brain.whenOffline === "included") {
    // Owner opted in: answer with the included brain this time.
    const { runTurn } = await import("@/lib/agent/run");
    emit({
      type: "notice",
      tone: "info",
      text: `${paired ? "Your computer is asleep" : "Your computer isn't paired yet"}, so I'm using the free brain for now (you opted in).`,
    });
    const fallbackBot: Bot = { ...bot, brain: { kind: "included", provider: "nebius", model: "nvidia/Nemotron-3_5-Lightning", effort: "low" } };
    return runTurn({ ...input, bot: fallbackBot, message: null, directive: input.directive });
  }

  const history = await db
    .select({ role: schema.messages.role, author: schema.messages.author, text: schema.messages.text })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversation.id))
    .orderBy(desc(schema.messages.createdAt))
    .limit(24);
  const memories = await db.select({ text: schema.memories.text }).from(schema.memories).where(eq(schema.memories.botId, bot.id)).limit(40);

  const system = [
    buildStablePrompt(bot, owner, input.channelKind, botEmailAddress(bot)),
    buildDynamicContext({
      bot,
      owner,
      channelKind: input.channelKind,
      connectedApps: [],
      memories: memories.map((m) => m.text),
      recentElsewhere: [],
      botEmail: botEmailAddress(bot),
      now: new Date(),
      speakingWith: input.message?.author === "contact" ? "contact" : "owner",
    }),
    "Your tools come from the 'bot' MCP server. Use only those tools; the platform enforces approvals.",
  ].join("\n\n");

  const transcript = history
    .reverse()
    .map((m) => `${m.role === "user" ? (m.author === "contact" ? "Contact" : "Owner") : "You"}: ${truncate(m.text, 2000)}`)
    .join("\n\n");

  const jobId = newId("job");
  const job: BridgeJob = {
    id: jobId,
    ownerId: owner.id,
    botId: bot.id,
    conversationId: conversation.id,
    deviceId: null,
    status: "queued",
    input: {
      cli: brain.cli,
      model: brain.model,
      system,
      transcript,
      directive: input.directive ?? null,
      channelKind: input.channelKind,
      mcpUrl: `${appUrl()}/api/mcp/${bot.id}`,
      meta: input.jobMeta ?? null,
      trigger: input.trigger ?? null,
    },
    output: { tainted: Boolean(input.startTainted) || input.message?.author === "contact" },
    progress: null,
    error: null,
    expiresAt: new Date(Date.now() + JOB_TTL_MS),
    claimedAt: null,
    finishedAt: null,
    createdAt: new Date(),
  };
  // Opening the chat again while its greeting waits for the computer doesn't line up another one.
  const [greeting] =
    input.trigger === "greeting"
      ? await db
          .select({ id: schema.bridgeJobs.id })
          .from(schema.bridgeJobs)
          .where(
            and(
              eq(schema.bridgeJobs.conversationId, conversation.id),
              inArray(schema.bridgeJobs.status, ["queued", "running"]),
              sql`${schema.bridgeJobs.input}->>'trigger' = 'greeting'`,
            ),
          )
          .limit(1)
      : [];
  if (!greeting) await db.insert(schema.bridgeJobs).values(job);

  const text = device
    ? `On it — thinking with ${brain.cli === "claude" ? "your Claude" : "your ChatGPT"} on ${device.name}…`
    : paired
      ? `My brain lives on your computer, and it's asleep right now. I'll answer as soon as it's back online. (You can let me fall back to the free brain in Settings → Brain.)`
      : `Pair your computer to start: open Bridge (your computer)${input.channelKind === "web" ? "" : ` at ${appUrl()}/app/bridge`}.`;
  emit({ type: "status", state: device ? "thinking" : "waiting", label: device ? "Thinking on your computer" : "Waiting for your computer" });
  // Never paired: the chat links the sentence to the Bridge page.
  emit({ type: "notice", tone: device ? "info" : "warn", text, ...(paired ? {} : { href: "/app/bridge" }) });
  emit({ type: "done", messageId: null, text: "", status: "queued" });
  return { status: "queued", text: device ? "" : text, messageId: null, approvals: [] };
}

/** Bridge long-poll: claim the oldest queued job for this owner. */
export async function claimJob(db: Db, ownerId: string, deviceId: string): Promise<BridgeJob | null> {
  const now = new Date();
  // Expire stale jobs first.
  await db
    .update(schema.bridgeJobs)
    .set({ status: "expired" })
    .where(and(eq(schema.bridgeJobs.ownerId, ownerId), eq(schema.bridgeJobs.status, "queued"), lt(schema.bridgeJobs.expiresAt, now)));
  const [next] = await db
    .select()
    .from(schema.bridgeJobs)
    .where(and(eq(schema.bridgeJobs.ownerId, ownerId), eq(schema.bridgeJobs.status, "queued")))
    .orderBy(schema.bridgeJobs.createdAt)
    .limit(1);
  if (!next) return null;
  const claimed = await db
    .update(schema.bridgeJobs)
    .set({ status: "running", deviceId, claimedAt: now })
    .where(and(eq(schema.bridgeJobs.id, next.id), eq(schema.bridgeJobs.status, "queued")))
    .returning();
  return claimed[0] ?? null;
}

/** The Bridge reports the final answer. We store it and deliver it like any reply. */
export async function completeJob(
  db: Db,
  job: BridgeJob,
  result: { ok: boolean; text?: string; error?: string; costUsd?: number; model?: string },
) {
  await db
    .update(schema.bridgeJobs)
    .set({
      status: result.ok ? "done" : "failed",
      output: { ...(job.output ?? {}), text: result.text ?? null, model: result.model ?? null, costUsd: result.costUsd ?? null },
      error: result.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(schema.bridgeJobs.id, job.id));

  const [bot] = await db.select().from(schema.bots).where(eq(schema.bots.id, job.botId)).limit(1);
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, job.ownerId)).limit(1);
  if (!bot || !owner || !job.conversationId) return;
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, job.conversationId)).limit(1);
  if (!conversation) return;

  const usedReceipt = {
    id: sortableId("rcp"),
    botId: bot.id,
    ownerId: owner.id,
    kind: "billing",
    status: result.ok ? "ok" : "error",
    title: `Thought on your computer (${(job.input as { cli?: string }).cli === "codex" ? "ChatGPT/Codex" : "Claude Code"})`,
    detail: { jobId: job.id, model: result.model ?? null, paidBy: "your subscription", costUsdReportedByCli: result.costUsd ?? null },
  };

  // Meeting notes written on the owner's computer land on the meeting, which then tells the owner.
  const meetingId = (job.input as { meta?: { meetingId?: string } | null }).meta?.meetingId;
  if (meetingId) {
    await db.insert(schema.receipts).values(usedReceipt);
    const { applyBridgeNotes } = await import("@/lib/meetings/notes");
    await applyBridgeNotes(db, meetingId, result);
    return;
  }

  const text = result.ok
    ? (result.text?.trim() || "Done.")
    : `My brain on your computer hit a problem: ${truncate(result.error ?? "unknown error", 200)}`;
  await db.insert(schema.messages).values({
    id: sortableId("msg"),
    conversationId: conversation.id,
    botId: bot.id,
    role: "assistant",
    author: "bot",
    text,
    channelKind: conversation.channelKind,
    meta: { via: "bridge", model: result.model ?? (job.input as { cli?: string }).cli, costUsd: result.costUsd ?? null },
  });
  await db.insert(schema.receipts).values(usedReceipt);
  if (conversation.channelKind !== "web") {
    await deliver(db, bot, conversation.channelKind as ChannelKind, { to: conversation.externalId, text, toOwner: true }, { owner });
  }
}

export async function recordTaint(db: Db, jobId: string) {
  const [job] = await db.select().from(schema.bridgeJobs).where(eq(schema.bridgeJobs.id, jobId)).limit(1);
  if (!job) return;
  await db.update(schema.bridgeJobs).set({ output: { ...(job.output ?? {}), tainted: true } }).where(eq(schema.bridgeJobs.id, jobId));
}

export function bridgeOwnerLabel(owner: User) {
  return owner.name ?? owner.email ?? "you";
}
