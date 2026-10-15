import { z } from "zod";
import { apiError, authedBot, json, parseJson, sameOrigin, type RouteCtx } from "@/lib/api";
import { rateLimit } from "@/lib/safety/ratelimit";
import { receipt } from "@/lib/agent/run";
import { IMPORT_MAX_CHARS, IMPORT_MAX_FACTS, readImport, saveImport } from "@/lib/memory/import";

export const maxDuration = 120;

const body = z.discriminatedUnion("step", [
  // Read what the owner pasted into facts to review (nothing is saved).
  z.object({ step: z.literal("read"), text: z.string().max(IMPORT_MAX_CHARS * 2) }),
  // Save the facts the owner kept.
  z.object({
    step: z.literal("save"),
    facts: z
      .array(z.object({ text: z.string().trim().min(2).max(300), pinned: z.boolean().default(false) }))
      .min(1)
      .max(IMPORT_MAX_FACTS),
  }),
]);

/** "Bring my memories" from ChatGPT, Claude or Gemini (src/lib/memory/import.ts). */
export async function POST(req: Request, ctx: RouteCtx<{ botId: string }>) {
  if (!sameOrigin(req)) return apiError(403, "Bad origin");
  const { botId } = await ctx.params;
  const a = await authedBot(botId);
  if (!a.ok) return a.res;
  const parsed = await parseJson(req, body);
  if (!parsed.ok) return parsed.res;

  if (parsed.data.step === "read") {
    if (parsed.data.text.trim().length < 20) return apiError(422, "Paste the whole answer from ChatGPT, Claude or Gemini first.");
    // Each read may call a big model once.
    if (!(await rateLimit(a.db, `memory-import:${a.user.id}`, 10, 3600)).ok) return apiError(429, "That's a lot of imports for one hour. Try again a bit later.");
    const read = await readImport(a.db, a.bot, a.user, parsed.data.text);
    return json(read);
  }

  const saved = await saveImport(a.db, a.bot, a.user, parsed.data.facts.map((f) => ({ text: f.text, pinned: f.pinned })));
  if (saved.length) await receipt(a.db, a.bot, "system", "ok", `Brought ${saved.length} ${saved.length === 1 ? "memory" : "memories"} from another assistant`, { count: saved.length });
  return json({ memories: saved });
}
