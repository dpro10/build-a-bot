import { z } from "zod";
import { and, desc, eq, ilike } from "drizzle-orm";
import { schema } from "@/lib/db";
import { newId } from "@/lib/utils";
import { defineTool } from "../types";

export const MAX_MEMORIES = 200;

export const remember = defineTool({
  name: "remember",
  title: "Remember this",
  description:
    "Save a durable fact about the owner (preferences, people, routines, goals) so you remember it in future chats. One short fact per call. Never store passwords or secrets.",
  input: z.object({ fact: z.string().min(3).max(300).describe("e.g. 'Diego's sister is Ana; her birthday is May 3'") }),
  connectorId: "memory",
  capabilityId: "remember",
  effect: "write",
  risk: "low",
  taints: false,
  ownerOnly: true,
  outboundText: (a) => a.fact,
  summarize: (a) => `Remember: “${a.fact}”`,
  async run(args, ctx) {
    const existing = await ctx.db
      .select({ id: schema.memories.id })
      .from(schema.memories)
      .where(and(eq(schema.memories.botId, ctx.bot.id), ilike(schema.memories.text, args.fact)))
      .limit(1);
    if (existing.length) return { ok: true, content: "Already remembered.", summary: "Already known" };
    const count = await ctx.db.$count(schema.memories, eq(schema.memories.botId, ctx.bot.id));
    if (count >= MAX_MEMORIES) return { ok: false, error: "Memory is full. Ask the owner to tidy it in the Memory tab." };
    await ctx.db.insert(schema.memories).values({ id: newId("mem"), botId: ctx.bot.id, text: args.fact, source: "bot" });
    return { ok: true, content: `Saved to memory: ${args.fact}`, summary: "Saved" };
  },
});

export const recall = defineTool({
  name: "recall",
  title: "Check memory",
  description: "Look up what you've saved about the owner. Optional search text.",
  input: z.object({ search: z.string().max(100).optional() }),
  connectorId: "memory",
  capabilityId: "recall",
  effect: "read",
  risk: "low",
  taints: false,
  summarize: (a) => (a.search ? `Recall “${a.search}”` : "Recall memories"),
  async run(args, ctx) {
    const where = args.search
      ? and(eq(schema.memories.botId, ctx.bot.id), ilike(schema.memories.text, `%${args.search}%`))
      : eq(schema.memories.botId, ctx.bot.id);
    const rows = await ctx.db.select().from(schema.memories).where(where).orderBy(desc(schema.memories.createdAt)).limit(60);
    if (!rows.length) return { ok: true, content: "Nothing saved yet.", summary: "Nothing yet" };
    return { ok: true, content: rows.map((r) => `- ${r.text}`).join("\n"), summary: `${rows.length} facts` };
  },
});
