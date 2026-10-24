/**
 * Sign-in links can't be used against the person who opens them. Only the browser that asked for
 * a link brings its anonymous account along; opened anywhere else it asks first, signs in to the
 * email's own account only, and a mail scanner opening it can't use it up. Each "browser" here has
 * its own cookies.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.RESEND_API_KEY;
delete process.env.AGENTMAIL_API_KEY;
delete process.env.ADMIN_EMAILS;

const browsers = vi.hoisted(() => {
  const jars = new Map<string, Map<string, string>>();
  return {
    current: "first",
    jar(): Map<string, string> {
      if (!jars.has(this.current)) jars.set(this.current, new Map());
      return jars.get(this.current)!;
    },
  };
});
vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  headers: async () => new Headers({ "user-agent": "vitest" }),
  cookies: async () => {
    const jar = browsers.jar();
    return {
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
      set: (name: string, value: string) => void jar.set(name, value),
      delete: (opts: string | { name: string }) => void jar.delete(typeof opts === "string" ? opts : opts.name),
    };
  },
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { getOrCreateUser, getUser } = await import("@/lib/auth/session");
const { findLoginLink } = await import("@/lib/auth/magic");
const magic = await import("@/app/api/auth/magic/route");
const verify = await import("@/app/auth/verify/route");
import type { User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;

/** Everything after this happens in that browser (its own cookies). */
const inBrowser = (name: string) => void (browsers.current = name);

async function anonymousWithBot(name: string): Promise<User> {
  const user = await getOrCreateUser();
  await db.insert(schema.bots).values({
    id: `bot_${name}`,
    ownerId: user.id,
    name,
    avatar: "blip",
    color: "ocean",
    brain: { kind: "included", provider: "nebius", model: "nvidia/Nemotron-3_5-Lightning" },
    handle: `${name.toLowerCase()}-bot`,
  });
  return user;
}

async function askForLink(email: string, ip = "198.51.100.1"): Promise<string> {
  const res = await magic.POST(
    new Request("http://localhost/api/auth/magic", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email }) }),
  );
  expect(res.status).toBe(200);
  return new URL((await res.json()).demoLink).searchParams.get("token")!;
}

const open = (token: string) => verify.GET(new Request(`http://localhost/auth/verify?token=${encodeURIComponent(token)}`));

const pressSignIn = (token: string, origin = "http://localhost") =>
  verify.POST(
    new Request("http://localhost/auth/verify", {
      method: "POST",
      headers: { origin, "x-forwarded-host": "localhost", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    }),
  );

const ownerOf = async (botId: string) => (await db.select().from(schema.bots).where(eq(schema.bots.id, botId)))[0]?.ownerId;
const userById = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0];

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("sign-in links", () => {
  it("opened in the browser that asked, it signs in right away and the bots made first come along", async () => {
    inBrowser("dana's laptop");
    const anon = await anonymousWithBot("Pip");
    const token = await askForLink("dana@example.com");
    const res = await open(token);
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/app");
    const me = await getUser();
    expect(me).toMatchObject({ id: anon.id, email: "dana@example.com" });
    expect(await ownerOf("bot_Pip")).toBe(anon.id);
  });

  it("opened anywhere else, it asks first: a mail scanner opening it doesn't use it up", async () => {
    inBrowser("dana's laptop, again");
    const token = await askForLink("sam@example.com");
    inBrowser("the inbox's link checker");
    for (let i = 0; i < 2; i++) {
      const res = await open(token);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/confirm");
    }
    expect(await findLoginLink(db, token)).not.toBeNull();
    expect(await getUser()).toBeNull();
  });

  it("asked for someone else's account, it never moves the asker's bots in or the asker into it", async () => {
    const [victim] = await db.insert(schema.users).values({ id: "usr_victim", email: "victim@example.com", emailVerifiedAt: new Date() }).returning();
    inBrowser("mallory");
    const mallory = await anonymousWithBot("Mole");
    const token = await askForLink(victim.email!);

    inBrowser("victim's phone");
    expect(new URL((await open(token)).headers.get("location")!).pathname).toBe("/auth/confirm");
    const res = await pressSignIn(token);
    expect(res.status).toBe(303);
    expect((await getUser())?.id).toBe(victim.id);

    expect(await ownerOf("bot_Mole")).toBe(mallory.id);
    expect(await userById(mallory.id)).toMatchObject({ email: null });
    inBrowser("mallory");
    expect((await getUser())?.id).toBe(mallory.id);
  });

  it("asked for an email with no account yet, it doesn't put that email on the asker's account", async () => {
    inBrowser("mallory's other browser");
    const mallory = await anonymousWithBot("Vole");
    const token = await askForLink("new-person@example.com");

    inBrowser("new person's laptop");
    await pressSignIn(token);
    const them = await getUser();
    expect(them).toMatchObject({ email: "new-person@example.com" });
    expect(them?.id).not.toBe(mallory.id);
    expect(await userById(mallory.id)).toMatchObject({ email: null });
    expect(await ownerOf("bot_Vole")).toBe(mallory.id);
  });

  it("a sign-in posted from another site is refused, and the link still works", async () => {
    inBrowser("someone");
    const token = await askForLink("someone@example.com");
    inBrowser("someone, on a page that isn't ours");
    expect((await pressSignIn(token, "https://evil.example")).status).toBe(403);
    expect(await findLoginLink(db, token)).not.toBeNull();
  });

  it("a link works once", async () => {
    inBrowser("once");
    const token = await askForLink("once@example.com");
    expect((await open(token)).status).toBe(303);
    const again = await open(token);
    expect(new URL(again.headers.get("location")!).search).toBe("?error=expired");
  });

  it("one network can't send floods of sign-in emails", async () => {
    inBrowser("a script");
    // 20 an hour from one network (each is an email we send).
    for (let i = 0; i < 20; i++) await askForLink(`flood-${i}@example.com`, "203.0.113.9");
    const res = await magic.POST(
      new Request("http://localhost/api/auth/magic", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ email: "flood-30@example.com" }),
      }),
    );
    expect(res.status).toBe(429);
    // Another network is unaffected.
    await askForLink("flood-30@example.com", "203.0.113.10");
  });
});
