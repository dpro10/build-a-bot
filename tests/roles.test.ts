/**
 * Ready-made roles: a tutor, a job applier, a language partner, a fitness coach, a meal planner.
 *
 * - A role is what the bot is: it introduces itself as "an AI tutor", works the way the role
 *   says, and its first message asks for the basics instead of offering generic ideas.
 * - Each role has a featured recipe (within the fair-use limits), and a bot made from one keeps the role.
 * - The owner can change the role, or go back to a general assistant, in Settings.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
for (const key of ["TOKEN_FACTORY_API_KEY", "COMPOSIO_API_KEY", "STRIPE_SECRET_KEY", "TAVILY_API_KEY", "BROWSER_USE_API_KEY"]) delete process.env[key];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { buildStablePrompt, greetingDirective } = await import("@/lib/agent/prompt");
const { ROLES, ROLE_BY_ID, roleBadge } = await import("@/lib/roles");
const { FEATURED_RECIPES, findFeatured, recipeSchema, botToRecipe } = await import("@/lib/recipes");
const { startersFor } = await import("@/lib/jobs");
const { FAIR_USE } = await import("@/lib/billing/prices");
const { getConnector } = await import("@/lib/connectors");
const { countsTowardLimit } = await import("@/components/catalog/connector-meta");
const { remember } = await import("@/lib/tools/builtin/memory");
const greetRoute = await import("@/app/api/bots/[botId]/greet/route");
const botRoute = await import("@/app/api/bots/[botId]/route");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

async function makeBot(name: string, extra: Partial<Parameters<typeof createBot>[2]> = {}): Promise<Bot> {
  const res = await createBot(db, owner, {
    avatar: "otto",
    color: "grape",
    name,
    jobs: [],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [],
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
    ...extra,
  });
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

const json = (method: string, url: string, body: unknown) => new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_dana", email: "dana@example.com", name: "Dana", emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
  session.user = owner;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("what a role changes in the prompt", () => {
  it("a tutor is an AI tutor that works like one and pins the basics; a general bot is unchanged", () => {
    const tutor = buildStablePrompt({ name: "Otto", avatar: "otto", role: "tutor", jobs: ["school"], trust: "ask" } as Bot, owner, "web", null);
    expect(tutor).toContain("You are Otto, an AI tutor for Dana.");
    expect(tutor).toContain("Your role: Tutor. Dana made you for this.");
    expect(tutor).toContain("- When they share class materials (a syllabus, slides, notes, readings), work from them");
    expect(tutor).not.toMatch(/graded work/);
    expect(tutor).toMatch(/first save each with the remember tool and pin: true/);
    // Memories are written about the owner by name, not "the owner".
    expect(tutor).toContain('save it with the remember tool, written about Dana by name ("Dana is vegetarian")');
    expect(tutor).toMatch(/a separate bot would do it better/);
    // Its jobs are extras on top of the role.
    expect(tutor).toContain("Also part of the job:\n- School:");

    const general = buildStablePrompt({ name: "Otto", avatar: "otto", role: null, jobs: ["school"], trust: "ask" } as Bot, owner, "web", null);
    expect(general).toContain("You are Otto, a personal AI assistant for Dana.");
    expect(general).not.toContain("Your role:");
    expect(general).toContain("What Dana wants help with:\n- School:");
  });

  it("an unknown role is ignored", () => {
    const prompt = buildStablePrompt({ name: "Otto", avatar: "otto", role: "pirate", jobs: [] as string[], trust: "ask" } as Bot, owner, "web", null);
    expect(prompt).toContain("a personal AI assistant for Dana");
    expect(roleBadge("pirate")).toBe("AI assistant");
    expect(roleBadge("job_applier")).toBe("AI job applier");
  });

  it("the first message asks for the basics instead of offering ideas", () => {
    const directive = greetingDirective({ name: "Blip", avatar: "blip", role: "job_applier" } as Bot, owner, "web", ["Find 5 jobs that fit me"], []);
    expect(directive).toContain("who just created you as their job applier");
    expect(directive).toContain(`ask what you need to get started: ${ROLE_BY_ID.job_applier.firstAsk}.`);
    expect(directive).not.toContain("Ideas you can offer");
    const general = greetingDirective({ name: "Blip", avatar: "blip", role: null } as Bot, owner, "web", ["Remind me to call mom"], []);
    expect(general).toContain("Ideas you can offer: Remind me to call mom");
  });

  it("the role's starter ideas come first", () => {
    const starters = startersFor(["school"], new Set(), "tutor");
    expect(starters.slice(0, 4)).toEqual(ROLE_BY_ID.tutor.starters);
    expect(starters).toContain("Quiz me on chapter 4");
    expect(startersFor(["school"], new Set(), null)[0]).toBe("Quiz me on chapter 4");
  });
});

describe("ready-made recipes", () => {
  it("every role has a featured recipe, within the fair-use limits", () => {
    for (const role of ROLES) {
      const recipe = findFeatured(role.recipe);
      expect(recipe?.role, role.id).toBe(role.id);
      expect(recipeSchema.safeParse(recipe).success, role.id).toBe(true);
      expect(recipe!.routines?.length ?? 0, role.id).toBeLessThanOrEqual(FAIR_USE.routines);
      const thirdParty = recipe!.connectors.filter((id) => {
        const def = getConnector(id);
        return def && countsTowardLimit(def);
      });
      expect(thirdParty.length, role.id).toBeLessThanOrEqual(FAIR_USE.appsPerBot);
      expect(recipe!.connectors.every((id) => getConnector(id)), role.id).toBe(true);
    }
    // The landing page shows the first six: the tutor and the job applier lead.
    expect(FEATURED_RECIPES.slice(0, 2).map((r) => r.role)).toEqual(["tutor", "job_applier"]);
    expect(new Set(FEATURED_RECIPES.map((r) => r.slug)).size).toBe(FEATURED_RECIPES.length);
  });

  it("the old job hunt link opens the job applier", () => {
    expect(findFeatured("job-hunt")?.slug).toBe("job-applier");
  });

  it("a bot made from a role recipe keeps the role, its tools and its routines", async () => {
    const bot = await makeBot("Otto", { recipeId: "tutor", jobs: ["school", "reminders"], connectors: ["web_search", "wikipedia", "notes"] });
    expect(bot.role).toBe("tutor");
    const routines = await db.select().from(schema.schedules).where(eq(schema.schedules.botId, bot.id));
    expect(routines.map((r) => r.title)).toEqual(["Daily review"]);
    const apps = (await db.select().from(schema.connections).where(eq(schema.connections.botId, bot.id))).map((c) => c.connectorId);
    expect(apps).toEqual(expect.arrayContaining(["web_search", "wikipedia", "notes", "reminders"]));
    // Shared again as a recipe, it brings the role along.
    expect(botToRecipe(bot, [], [], []).role).toBe("tutor");
  });

  it("the builder's own pick wins over the recipe's role", async () => {
    const general = await makeBot("Plain", { recipeId: "tutor", role: null });
    expect(general.role).toBeNull();
  });
});

describe("in the app", () => {
  it("a role bot's first message asks for the basics (demo brain)", async () => {
    const bot = await makeBot("Blip", { avatar: "blip", color: "sunny", recipeId: "job-applier" });
    expect(bot.role).toBe("job_applier");
    const res = await greetRoute.POST(new Request(`http://localhost/api/bots/${bot.id}/greet`, { method: "POST" }), { params: Promise.resolve({ botId: bot.id }) });
    expect(res.status).toBe(200);
    await res.text();
    const [first] = await db.select().from(schema.messages).where(eq(schema.messages.botId, bot.id));
    expect(first.text).toContain("I'm Blip, your new AI job applier.");
    expect(first.text).toContain("tell me what kind of job you want (role, location or remote, the pay you need), and your résumé (you can paste it).");
  });

  it("Settings changes the role, or makes it a general assistant again", async () => {
    const bot = await makeBot("Switcher");
    const patch = (body: unknown) => botRoute.PATCH(json("PATCH", `http://localhost/api/bots/${bot.id}`, body), { params: Promise.resolve({ botId: bot.id }) });

    const set = await patch({ role: "meal_planner", jobs: ["errands"] });
    expect(set.status).toBe(200);
    expect((await set.json()).bot.role).toBe("meal_planner");
    const receipts = await db.select().from(schema.receipts).where(eq(schema.receipts.botId, bot.id));
    expect(receipts.some((r) => /role/.test(r.title))).toBe(true);

    const cleared = await patch({ role: null });
    expect((await cleared.json()).bot.role).toBeNull();

    expect((await patch({ role: "pirate" })).status).toBeGreaterThanOrEqual(400);
  });

  it("the bot pins the basics it's told, and pins stay few", async () => {
    const bot = await makeBot("Pinner", { recipeId: "language-partner" });
    const ctx = { db, bot, owner, conversationId: null, channelKind: "web", demo: true, now: new Date() };
    await remember.run({ fact: "Dana is learning Portuguese, as a beginner", pin: true }, ctx);
    await remember.run({ fact: "Dana likes jazz" }, ctx);
    const rows = await db.select().from(schema.memories).where(eq(schema.memories.botId, bot.id));
    expect(rows.find((r) => r.text.includes("Portuguese"))?.pinned).toBe(true);
    expect(rows.find((r) => r.text.includes("jazz"))?.pinned).toBe(false);

    // Saying it again with pin: true pins the fact it already has.
    await remember.run({ fact: "Dana likes jazz", pin: true }, ctx);
    const jazz = (await db.select().from(schema.memories).where(eq(schema.memories.botId, bot.id))).find((r) => r.text.includes("jazz"));
    expect(jazz?.pinned).toBe(true);

    // Past 15 pins, new facts are kept but not pinned.
    for (let i = 0; i < 15; i++) await remember.run({ fact: `Dana's goal number ${i + 10} is practicing topic ${i + 10} daily`, pin: true }, ctx);
    const all = await db.select().from(schema.memories).where(eq(schema.memories.botId, bot.id));
    expect(all.filter((r) => r.pinned).length).toBe(15);
    expect(all.length).toBe(17);
  });
});
