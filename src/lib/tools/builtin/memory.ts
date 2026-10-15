import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { newId } from "@/lib/utils";
import { MAX_MEMORIES, MAX_PINNED, findMemory, findSameFact, loadMemories, memoryQuery, rankMemories } from "@/lib/memory";
import { defineTool } from "../types";

export const remember = defineTool({
  name: "remember",
  title: "Remember this",
  description:
    "Save a durable fact about the owner (preferences, people, routines, goals) so you remember it in future chats. One short fact per call. If it changes something you remembered before (they moved, changed jobs), put the old fact's words in `replaces`. Never store passwords or secrets.",
  input: z.object({
    fact: z.string().min(3).max(300).describe("e.g. 'Diego's sister is Ana; her birthday is May 3'"),
    replaces: z.string().max(300).optional().describe("Words from an older fact this one replaces, e.g. 'lives in Dallas'"),
    pin: z.boolean().optional().describe("true only for a basic you should always keep in mind (what they're learning, an allergy). Use it rarely."),
  }),
  connectorId: "memory",
  capabilityId: "remember",
  effect: "write",
  risk: "low",
  taints: false,
  ownerOnly: true,
  outboundText: (a) => a.fact,
  summarize: (a) => `Remember: “${a.fact}”`,
  async run(args, ctx) {
    const rows = await loadMemories(ctx.db, ctx.bot.id);
    // Pins stay few (the owner can pin up to MAX_PINNED in the Memory tab too).
    const pin = args.pin === true && rows.filter((r) => r.pinned).length < MAX_PINNED;
    const update = async (id: string, before: string) => {
      await ctx.db
        .update(schema.memories)
        .set({ text: args.fact, updatedAt: new Date(), ...(pin ? { pinned: true } : {}) })
        .where(and(eq(schema.memories.id, id), eq(schema.memories.botId, ctx.bot.id)));
      return { ok: true as const, content: `Updated memory: “${before}” is now “${args.fact}”`, summary: "Updated" };
    };
    const old = args.replaces ? findMemory(rows, args.replaces) : null;
    if (old) return update(old.id, old.text);
    const same = findSameFact(rows, args.fact);
    if (same?.relation === "more") return update(same.row.id, same.row.text);
    if (same) {
      if (pin && !same.row.pinned) await ctx.db.update(schema.memories).set({ pinned: true }).where(and(eq(schema.memories.id, same.row.id), eq(schema.memories.botId, ctx.bot.id)));
      return { ok: true, content: "Already remembered.", summary: "Already known" };
    }
    if (rows.length >= MAX_MEMORIES) return { ok: false, error: "Memory is full. Ask the owner to tidy it in the Memory tab." };
    await ctx.db.insert(schema.memories).values({ id: newId("mem"), botId: ctx.bot.id, text: args.fact, source: "bot", pinned: pin });
    return { ok: true, content: `Saved to memory: ${args.fact}`, summary: "Saved" };
  },
});

export const recall = defineTool({
  name: "recall",
  title: "Check memory",
  description: "Look up what you've saved about the owner. Search by topic or a few words (e.g. 'sister birthday', 'food'); leave empty for the basics and the newest.",
  input: z.object({ search: z.string().max(100).optional() }),
  connectorId: "memory",
  capabilityId: "recall",
  effect: "read",
  risk: "low",
  taints: false,
  summarize: (a) => (a.search ? `Recall “${a.search}”` : "Recall memories"),
  async run(args, ctx) {
    const rows = await loadMemories(ctx.db, ctx.bot.id);
    if (!rows.length) return { ok: true, content: "Nothing saved yet.", summary: "Nothing yet" };
    const found = args.search?.trim()
      ? rankMemories(rows, memoryQuery([{ text: args.search, weight: 1 }]))
          .slice(0, 30)
          .map((x) => x.row)
      : [...rows.filter((r) => r.pinned), ...rows.filter((r) => !r.pinned)].slice(0, 60);
    if (!found.length) return { ok: true, content: `Nothing saved about “${args.search}”.`, summary: "No match" };
    return { ok: true, content: found.map((r) => `- ${r.text}`).join("\n"), summary: `${found.length} of ${rows.length} facts` };
  },
});

export const forget = defineTool({
  name: "forget",
  title: "Forget something",
  description: "Delete a fact you remembered about the owner, when they ask you to forget it. Give a few words from the fact.",
  input: z.object({ fact: z.string().min(2).max(300).describe("Words from the fact to forget, e.g. 'vegetarian'") }),
  connectorId: "memory",
  capabilityId: "forget",
  effect: "write",
  risk: "low",
  taints: false,
  ownerOnly: true,
  summarize: (a) => `Forget: “${a.fact}”`,
  async run(args, ctx) {
    const found = findMemory(await loadMemories(ctx.db, ctx.bot.id), args.fact);
    if (!found) return { ok: true, content: "Couldn't find that in memory. Nothing was deleted.", summary: "Not found" };
    await ctx.db.delete(schema.memories).where(and(eq(schema.memories.id, found.id), eq(schema.memories.botId, ctx.bot.id)));
    return { ok: true, content: `Forgot: ${found.text}`, summary: "Forgotten" };
  },
});
