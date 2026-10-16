/**
 * What a real (not demo) server shows as "coming soon" instead of a dead end:
 *  - without Stripe, nothing promises an upgrade: the bot limit says to delete one first, and
 *    Full faith and the app limit say paid plans are coming soon;
 *  - without signed downloads, the desktop app is coming soon and the bot doesn't offer it;
 *  - so are meeting notes, which are taken in the desktop app.
 * Also: "save up to" is one number everywhere, never overstated.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL;
delete process.env.TRANSCRIBE_API_KEY;

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { config, paidPlansOpen } = await import("@/lib/env");
const { createBot } = await import("@/lib/bots/create");
const { MAX_YEARLY_SAVING, PLANS, PLAN_ORDER, yearlySaving } = await import("@/lib/billing/plans");
const { desktopApp, meetingNotesAvailable, startMeeting } = await import("@/lib/meetings");
const { listMeetings } = await import("@/lib/tools/builtin/meetings");
const connectionsRoute = await import("@/app/api/bots/[botId]/connections/route");
import type { User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;

async function freeOwner(id: string): Promise<User> {
  const [user] = await db.insert(schema.users).values({ id, email: `${id}@example.com`, emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  return user;
}

const botInput = (name: string, extra: Partial<Parameters<typeof createBot>[2]> = {}): Parameters<typeof createBot>[2] => ({
  avatar: "otto",
  color: "grape",
  name,
  jobs: [],
  brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
  connectors: [],
  exactConnectors: true,
  trust: "ask",
  channels: [],
  contact: {},
  ageConfirmed: true,
  timezone: "UTC",
  ...extra,
});

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("paid plans before Stripe is set up", () => {
  it("aren't for sale", () => {
    expect(paidPlansOpen).toBe(false);
  });

  it("the bot limit says to delete one first, not to upgrade", async () => {
    const owner = await freeOwner("usr_limit");
    expect((await createBot(db, owner, botInput("First"))).ok).toBe(true);
    const second = await createBot(db, owner, botInput("Second"));
    expect(second).toEqual({
      ok: false,
      status: 402,
      error: "The Free plan includes 1 bot. To make another, delete it first. Paid plans are coming soon.",
    });
  });

  it("Full faith and the app limit say paid plans are coming soon", async () => {
    const owner = await freeOwner("usr_faith");
    const res = await createBot(db, owner, botInput("Faithful", { trust: "full", connectors: ["github", "notion", "linear", "todoist"] }));
    if (!res.ok) throw new Error(res.error);
    expect(res.bot.trust).toBe("trusted");
    expect(res.notes).toContain("Full faith is part of Plus. Paid plans are coming soon. Your bot starts as a Trusted helper.");
    expect(res.notes).toContain("The Free plan connects 3 apps. Todoist was skipped — paid plans are coming soon.");
    for (const note of res.notes) expect(note).not.toMatch(/upgrade/i);
  });

  it("adding one app too many says so without pointing at a checkout", async () => {
    const owner = await freeOwner("usr_apps");
    session.user = owner;
    const res = await createBot(db, owner, botInput("Appy"));
    if (!res.ok) throw new Error(res.error);
    // Far past the Free plan's apps (built-ins included in the count).
    await db.insert(schema.connections).values(Array.from({ length: 16 }, (_, i) => ({ id: `con_fill_${i}`, botId: res.bot.id, connectorId: `filler_${i}`, mode: "mcp" })));
    const added = await connectionsRoute.POST(
      new Request(`http://localhost/api/bots/${res.bot.id}/connections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectorId: "github" }) }),
      { params: Promise.resolve({ botId: res.bot.id }) },
    );
    expect(added.status).toBe(402);
    expect(await added.json()).toEqual({ error: "The Free plan connects 3 apps. Paid plans are coming soon.", upgrade: "plus" });
  });
});

describe("the desktop app before signed downloads", () => {
  it("is coming soon, and the bot doesn't send people to it", async () => {
    expect(desktopApp()).toEqual({ status: "soon" });
    const owner = await freeOwner("usr_desk");
    const res = await createBot(db, owner, botInput("Desky", { connectors: ["meetings"] }));
    if (!res.ok) throw new Error(res.error);
    const out = await listMeetings.run({}, { db, bot: res.bot, owner, conversationId: null, channelKind: "web", demo: false, now: new Date() });
    expect(out).toMatchObject({ ok: true, content: "No meetings yet. Notes are taken with the desktop app, which is coming soon." });
  });

  it("offers the download once its address is set", () => {
    config.desktop.downloadUrl = "https://downloads.example.com/build-a-bot";
    try {
      expect(desktopApp()).toEqual({ status: "download", url: "https://downloads.example.com/build-a-bot" });
    } finally {
      config.desktop.downloadUrl = undefined;
    }
  });
});

describe("meeting notes without the desktop app", () => {
  it("are coming soon", async () => {
    const owner = await freeOwner("usr_notes");
    const res = await createBot(db, owner, botInput("Scribe", { connectors: ["meetings"] }));
    if (!res.ok) throw new Error(res.error);
    expect(meetingNotesAvailable()).toBe(false);
    expect(await startMeeting(db, { bot: res.bot, owner, source: "desktop" })).toMatchObject({ ok: false, status: 503, code: "unavailable", error: "Meeting notes are coming soon." });
  });

  it("are offered once the app can be downloaded, with no speech-to-text here", () => {
    config.desktop.downloadUrl = "https://downloads.example.com/build-a-bot";
    try {
      expect(meetingNotesAvailable()).toBe(true);
    } finally {
      config.desktop.downloadUrl = undefined;
    }
  });
});

describe("yearly billing", () => {
  it("“save up to” is one number, rounded down so it's never overstated", () => {
    // Pro: $39 → $32 a month is 17.9% off, shown as 17% (Plan & usage used to round it up to 18%).
    expect(MAX_YEARLY_SAVING).toBe(17);
    for (const id of PLAN_ORDER) {
      const p = PLANS[id];
      const exact = p.priceMonthly ? ((p.priceMonthly - p.priceYearly) / p.priceMonthly) * 100 : 0;
      expect(yearlySaving(p)).toBeLessThanOrEqual(exact);
      expect(exact - yearlySaving(p)).toBeLessThan(1);
    }
  });
});
