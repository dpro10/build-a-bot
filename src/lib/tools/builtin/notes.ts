import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { newId, truncate } from "@/lib/utils";
import { defineTool } from "../types";

export const listNotes = defineTool({
  name: "list_notes",
  title: "List notes",
  description: "List the owner's notes and lists (titles with a preview).",
  input: z.object({}),
  connectorId: "notes",
  capabilityId: "read_notes",
  effect: "read",
  risk: "low",
  taints: false,
  summarize: () => "List notes",
  async run(_a, ctx) {
    const rows = await ctx.db
      .select()
      .from(schema.notes)
      .where(eq(schema.notes.botId, ctx.bot.id))
      .orderBy(desc(schema.notes.updatedAt))
      .limit(50);
    if (!rows.length) return { ok: true, content: "No notes yet.", summary: "None" };
    return {
      ok: true,
      content: rows.map((n) => `- ${n.title}: ${truncate(n.body.replace(/\n/g, " / "), 120)}`).join("\n"),
      summary: `${rows.length} notes`,
    };
  },
});

export const readNote = defineTool({
  name: "read_note",
  title: "Read a note",
  description: "Read one note or list by its title.",
  input: z.object({ title: z.string().min(1).max(120) }),
  connectorId: "notes",
  capabilityId: "read_notes",
  effect: "read",
  risk: "low",
  taints: false,
  summarize: (a) => `Read note “${a.title}”`,
  async run(args, ctx) {
    const [row] = await ctx.db
      .select()
      .from(schema.notes)
      .where(and(eq(schema.notes.botId, ctx.bot.id), eq(schema.notes.title, args.title)))
      .limit(1);
    if (!row) return { ok: false, error: `No note called “${args.title}”.` };
    return { ok: true, content: `# ${row.title}\n${row.body}`, summary: row.title };
  },
});

export const writeNote = defineTool({
  name: "write_note",
  title: "Write a note",
  description:
    "Create or update a note or checklist (e.g. 'Groceries'). mode=append adds lines; mode=replace rewrites it. Use '- [ ] item' for checklist items.",
  input: z.object({
    title: z.string().min(1).max(120),
    content: z.string().max(8000),
    mode: z.enum(["append", "replace"]).optional(),
  }),
  connectorId: "notes",
  capabilityId: "write_notes",
  effect: "write",
  risk: "low",
  taints: false,
  ownerOnly: true,
  summarize: (a) => `${a.mode === "replace" ? "Rewrite" : "Update"} note “${a.title}”`,
  async run(args, ctx) {
    const [row] = await ctx.db
      .select()
      .from(schema.notes)
      .where(and(eq(schema.notes.botId, ctx.bot.id), eq(schema.notes.title, args.title)))
      .limit(1);
    if (row) {
      const body = args.mode === "replace" ? args.content : [row.body, args.content].filter(Boolean).join("\n");
      await ctx.db.update(schema.notes).set({ body, updatedAt: new Date() }).where(eq(schema.notes.id, row.id));
      return { ok: true, content: `Updated “${args.title}”.`, summary: "Updated" };
    }
    await ctx.db.insert(schema.notes).values({ id: newId("note"), botId: ctx.bot.id, title: args.title, body: args.content });
    return { ok: true, content: `Created “${args.title}”.`, summary: "Created" };
  },
});
