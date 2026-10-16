/**
 * What a real (not demo) server shows as "coming soon" instead of a dead end:
 *  - without Stripe, adding credit is coming soon (there are no plans: people pay for what they
 *    use, and every account has its starter credit), and nothing anywhere says "upgrade";
 *  - without signed downloads, the desktop app is coming soon and the bot doesn't offer it;
 *  - so are meeting notes, which are taken in the desktop app.
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
const { config, creditOpen } = await import("@/lib/env");
const { createBot } = await import("@/lib/bots/create");
const { outOfCreditMessage } = await import("@/lib/billing/credit");
const checkoutRoute = await import("@/app/api/billing/checkout/route");
const { desktopApp, meetingNotesAvailable, startMeeting } = await import("@/lib/meetings");
const { listMeetings } = await import("@/lib/tools/builtin/meetings");
import type { User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;

async function freeOwner(id: string): Promise<User> {
  const [user] = await db.insert(schema.users).values({ id, email: `${id}@example.com`, emailVerifiedAt: new Date(), timezone: "UTC" }).returning();
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

describe("adding credit before Stripe is set up", () => {
  it("isn't offered: the starter credit is what there is, and running out says adding credit is coming soon", async () => {
    expect(creditOpen).toBe(false);
    expect(outOfCreditMessage({ canAdd: creditOpen, ownBrain: true })).toBe(
      "You're out of credit. Adding credit is coming soon; or switch me to your own AI key or subscription in Settings → Brain (that's free here).",
    );
    const owner = await freeOwner("usr_checkout");
    session.user = owner;
    const res = await checkoutRoute.POST(new Request("http://localhost/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ usd: 10 }) }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Adding credit is coming soon.");
  });

  it("there are no plans to upgrade to: the only limits are fair use, and nothing says upgrade", async () => {
    const owner = await freeOwner("usr_limit");
    for (let i = 0; i < 10; i++) expect((await createBot(db, owner, botInput(`Bot ${i + 1}`))).ok).toBe(true);
    const eleventh = await createBot(db, owner, botInput("Eleventh"));
    expect(eleventh).toEqual({ ok: false, status: 409, error: "You can have up to 10 bots. To make another, delete one first." });
  });

  it("Full faith, every included model and plenty of apps are there from the start", async () => {
    const owner = await freeOwner("usr_faith");
    const res = await createBot(
      db,
      owner,
      botInput("Faithful", { trust: "full", brain: { kind: "included", model: "nvidia/Nemotron-3-Ultra-550b-a55b" }, connectors: ["github", "notion", "linear", "todoist"] }),
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.bot.trust).toBe("full");
    expect(res.bot.brain.model).toBe("nvidia/Nemotron-3-Ultra-550b-a55b");
    for (const note of res.notes) expect(note).not.toMatch(/upgrade|plan/i);
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
