/**
 * Files sent to a bot on Telegram: the owner's go into its Library (read first) and the message goes
 * on with them attached; anyone else's aren't kept; files Telegram won't hand over (over 20 MB)
 * get a plain answer.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
for (const key of ["TOKEN_FACTORY_API_KEY", "TAVILY_API_KEY", "COMPOSIO_API_KEY"]) delete process.env[key];

const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => void background.push(Promise.resolve().then(fn)),
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { storeCredential } = await import("@/lib/channels/secrets");
const { listFiles } = await import("@/lib/library");
const telegram = await import("@/app/api/webhooks/telegram/[channelId]/route");
import type { Bot, User } from "@/lib/db/schema";

const PDF = new Uint8Array(fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "library", "syllabus.pdf")));
const TOKEN = "123456:telegram-test-token";
const SECRET = "tg-webhook-secret";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let bot: Bot;
const channelId = "chn_tg";
const sent: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_dana", email: "dana@example.com", name: "Dana", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  const res = await createBot(db, owner, {
    avatar: "otto", color: "grape", name: "Otto", jobs: [], brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [], trust: "ask", channels: [], contact: {}, ageConfirmed: true, timezone: "UTC",
  });
  if (!res.ok) throw new Error(res.error);
  bot = res.bot;
  const credentialId = await storeCredential(db, { ownerId: owner.id, kind: "channel", provider: "telegram", secret: TOKEN });
  await db.insert(schema.channels).values({ id: channelId, botId: bot.id, kind: "telegram", status: "active", credentialId, ownerAddress: "42", ownerVerifiedAt: new Date(), config: { webhookSecret: SECRET } } as never);
  // Telegram's API, played here: getFile, the file itself, and what the bot sends back.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes(`/bot${TOKEN}/getFile`)) return Response.json({ ok: true, result: { file_path: "documents/file_1.pdf" } });
    if (url.endsWith(`/file/bot${TOKEN}/documents/file_1.pdf`)) return new Response(PDF, { headers: { "content-length": String(PDF.length) } });
    if (url.includes(`/bot${TOKEN}/sendMessage`)) {
      sent.push(String(JSON.parse(String(init?.body ?? "{}")).text ?? ""));
      return Response.json({ ok: true, result: { message_id: 1 } });
    }
    if (url.includes(`/bot${TOKEN}/`)) return Response.json({ ok: true, result: true });
    return realFetch(input, init);
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await resetDbForTests();
});

let update = 1000;
async function deliver(message: Record<string, unknown>) {
  const res = await telegram.POST(
    new Request(`http://localhost/api/webhooks/telegram/${channelId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify({ update_id: update++, message: { message_id: update, chat: { id: 42, type: "private" }, ...message } }),
    }),
    { params: Promise.resolve({ channelId }) },
  );
  expect(res.status).toBe(200);
  await Promise.all(background.splice(0));
}

describe("files on Telegram", () => {
  it("the owner's PDF goes into the Library, read, and the message carries it", async () => {
    sent.length = 0;
    await deliver({ from: { id: 42, first_name: "Dana" }, document: { file_id: "f1", file_name: "Bio 101 Syllabus.pdf", mime_type: "application/pdf", file_size: PDF.length } });
    const files = await listFiles(db, bot.id);
    expect(files).toEqual([expect.objectContaining({ name: "Bio 101 Syllabus.pdf", status: "ready", source: "telegram", pages: 2 })]);
    const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.channelKind, "telegram"));
    expect((msg.meta as { files: { name: string }[] }).files[0].name).toBe("Bio 101 Syllabus.pdf");
    // No caption: the bot says it has it and offers what it can do.
    expect(sent.at(-1)).toMatch(/flashcards, a practice quiz, or a summary/);
  });

  it("someone else's file isn't kept", async () => {
    sent.length = 0;
    await deliver({ from: { id: 7, first_name: "Stranger" }, document: { file_id: "f2", file_name: "spam.pdf", file_size: 100 } });
    expect((await listFiles(db, bot.id)).map((f) => f.name)).toEqual(["Bio 101 Syllabus.pdf"]);
    expect(sent).toEqual(["I only take files from the person I work for."]);
  });

  it("a file over Telegram's 20 MB gets a plain answer and a pointer to the website", async () => {
    sent.length = 0;
    await deliver({ from: { id: 42 }, document: { file_id: "f3", file_name: "huge.pdf", file_size: 22 * 1024 * 1024 } });
    expect(sent[0]).toMatch(/too big for Telegram.*Library/);
  });
});
