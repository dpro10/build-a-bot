import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@/lib/db";
import { MAX_ATTACHMENTS } from "@/lib/library/limits";
import type { AttachedFile } from "@/lib/library/attachments";
import { apiError, authedBot, clientIp, limitOr429, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { networkOf } from "@/lib/tools/net";
import { runTurn } from "@/lib/agent/run";
import { ensureConversation } from "@/lib/channels/outbound";
import { sseResponse } from "@/lib/sse";
import { watchForStop } from "@/lib/agent/stop";

export const maxDuration = 300;

const bodySchema = z
  .object({
    text: z.string().trim().max(8000).default(""),
    /** Library files attached with the paperclip (already uploaded and read). */
    fileIds: z.array(z.string().min(1).max(60)).max(MAX_ATTACHMENTS).optional(),
  })
  .refine((b) => b.text.length > 0 || (b.fileIds?.length ?? 0) > 0, { message: "Write a message or attach a file." });

export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, bodySchema);
  if (!parsed.ok) return parsed.res;
  // Plans meter messages; this only stops runaway scripts.
  const limited = await limitOr429(a.db, `chat:${a.user.id}`, 30, 60, "That's a lot of messages at once — give it a moment.");
  if (limited) return limited;
  // Attached files: a light copy of each goes with the message (they're in the Library already).
  let files: AttachedFile[] = [];
  if (parsed.data.fileIds?.length) {
    const rows = await a.db
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.botId, botId), inArray(schema.files.id, parsed.data.fileIds)));
    files = parsed.data.fileIds
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind, pages: r.pages, status: r.status, note: r.error }));
  }
  const conversation = await ensureConversation(a.db, botId, "web", "owner");
  return sseResponse(async (send, signal) => {
    // The chat's Stop button stops the answer where it is (stop.ts); a dropped connection doesn't.
    const stop = watchForStop(a.db, conversation.id, signal);
    try {
      await runTurn({
        db: a.db,
        bot: a.bot,
        owner: a.user,
        conversation,
        channelKind: "web",
        message: { text: parsed.data.text, author: "owner", ...(files.length ? { meta: { files } } : {}) },
        network: networkOf(clientIp(req)),
        emit: send,
        signal: stop.signal,
      });
    } finally {
      stop.done();
    }
  }, req.signal);
}
