/**
 * "Give my bot a folder": the desktop app (its device token) sends the files in one folder to a
 * bot's Library and keeps them in step.
 *
 * - The same bytes at the same path: nothing to upload. Changed bytes replace the old copy.
 * - Paths stay inside the folder; only the owner's own bots; only this device's files.
 * - Pairing again (a new device) takes over the earlier copies instead of uploading them twice.
 * - Uploaded, read (after the response), searchable like any file. Deleted from the folder: gone.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

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
const { sha256: tokenHash } = await import("@/lib/crypto");
const { cleanPath } = await import("@/lib/library/desktop");
const { searchLibrary } = await import("@/lib/library/search");
const filesRoute = await import("@/app/api/desktop/library/files/route");
const contentRoute = await import("@/app/api/desktop/library/files/[fileId]/content/route");
const readRoute = await import("@/app/api/desktop/library/files/[fileId]/read/route");
const sessionRoute = await import("@/app/api/desktop/session/route");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let bot: Bot;
let strangersBot: Bot;
const MAC = { authorization: "Bearer bab_dev_folder_mac" };
const MAC_AGAIN = { authorization: "Bearer bab_dev_folder_mac_repaired" };
const PC = { authorization: "Bearer bab_dev_folder_pc" };

const hex = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const req = (method: string, url: string, body: unknown, headers: Record<string, string> = MAC) =>
  new Request(`http://localhost${url}`, { method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (fileId: string) => ({ params: Promise.resolve({ fileId }) });

async function makeBot(user: User, name: string) {
  const res = await createBot(db, user, {
    avatar: "otto",
    color: "grape",
    name,
    role: "tutor",
    jobs: [],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [],
    trust: "ask",
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "UTC",
  } as never);
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

/** What the app does for one new or changed file: start, upload, read. */
async function sync(path: string, text: string, headers = MAC) {
  const start = await filesRoute.POST(req("POST", "/api/desktop/library/files", { botId: bot.id, path, size: text.length, sha256: hex(text) }, headers));
  const body = await start.json();
  if (start.status !== 200) return { status: start.status, body };
  if (body.unchanged) return { status: 200, body, unchanged: true };
  expect(body.upload.mode).toBe("local");
  const put = await contentRoute.PUT(
    new Request(`http://localhost${body.upload.url}`, { method: "PUT", headers: { ...headers, "content-type": "application/octet-stream" }, body: new TextEncoder().encode(text) }),
    params(body.file.id),
  );
  expect(put.status).toBe(204);
  const read = await readRoute.POST(req("POST", `/api/desktop/library/files/${body.file.id}/read`, { botId: bot.id }, headers), params(body.file.id));
  expect(read.status).toBe(200);
  await Promise.all(background.splice(0));
  return { status: 200, body, unchanged: false };
}

const botFiles = async () => db.select().from(schema.files).where(eq(schema.files.botId, bot.id));

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_dana", email: "dana@example.com", name: "Dana", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  const [stranger] = await db.insert(schema.users).values({ id: "usr_eve", email: "eve@example.com", name: "Eve", emailVerifiedAt: new Date(), timezone: "UTC", plan: "free" }).returning();
  await db.insert(schema.bridgeDevices).values([
    { id: "dev_mac", ownerId: owner.id, name: "Dana's Mac", tokenHash: tokenHash(MAC.authorization.slice(7)), platform: "desktop-darwin-arm64", clis: {} },
    { id: "dev_mac2", ownerId: owner.id, name: "Dana's Mac", tokenHash: tokenHash(MAC_AGAIN.authorization.slice(7)), platform: "desktop-darwin-arm64", clis: {} },
    { id: "dev_pc", ownerId: owner.id, name: "Dana's PC", tokenHash: tokenHash(PC.authorization.slice(7)), platform: "desktop-win32-x64", clis: {} },
  ]);
  bot = await makeBot(owner, "Tutor");
  strangersBot = await makeBot(stranger, "Eve's bot");
});

describe("Give my bot a folder", () => {
  it("the desktop session says whether this server keeps files", async () => {
    const res = await sessionRoute.GET(new Request("http://localhost/api/desktop/session", { headers: MAC }));
    expect((await res.json()).library).toEqual({ available: true });
  });

  it("a new file is uploaded, read after the response, and searchable like any file", async () => {
    const r = await sync("Week 1/syllabus.txt", "Biology 101. Exam one covers photosynthesis and the Calvin cycle.");
    expect(r.unchanged).toBe(false);
    const [file] = await botFiles();
    expect(file).toMatchObject({ name: "syllabus.txt", source: "desktop", sourceRef: "desktop:dev_mac:Week 1/syllabus.txt", status: "ready" });
    const hits = await searchLibrary(db, bot.id, "photosynthesis");
    expect(hits[0]?.fileName).toBe("syllabus.txt");
  });

  it("the same bytes at the same path: nothing to upload", async () => {
    const r = await sync("Week 1/syllabus.txt", "Biology 101. Exam one covers photosynthesis and the Calvin cycle.");
    expect(r.unchanged).toBe(true);
    expect(await botFiles()).toHaveLength(1);
  });

  it("changed bytes replace the old copy and its passages", async () => {
    const before = (await botFiles())[0];
    await sync("Week 1/syllabus.txt", "Biology 101, revised. Exam one now covers mitosis.");
    const files = await botFiles();
    expect(files).toHaveLength(1);
    expect(files[0].id).not.toBe(before.id);
    expect(await searchLibrary(db, bot.id, "mitosis")).toHaveLength(1);
    expect(await searchLibrary(db, bot.id, "Calvin")).toHaveLength(0);
  });

  it("pairing again takes over the earlier copies instead of uploading them twice", async () => {
    const r = await sync("Week 1/syllabus.txt", "Biology 101, revised. Exam one now covers mitosis.", MAC_AGAIN);
    expect(r.unchanged).toBe(true);
    const files = await botFiles();
    expect(files).toHaveLength(1);
    expect(files[0].sourceRef).toBe("desktop:dev_mac2:Week 1/syllabus.txt");
    // Different bytes at that path from another computer are its own file.
    await sync("Week 1/syllabus.txt", "PC copy, different", PC);
    expect(await botFiles()).toHaveLength(2);
  });

  it("deleted from the folder, it leaves the Library (only this computer's copy)", async () => {
    const del = await filesRoute.DELETE(req("DELETE", "/api/desktop/library/files", { botId: bot.id, path: "Week 1/syllabus.txt" }, PC));
    expect(await del.json()).toEqual({ ok: true, deleted: true });
    const files = await botFiles();
    expect(files.map((f) => f.sourceRef)).toEqual(["desktop:dev_mac2:Week 1/syllabus.txt"]);
    const again = await filesRoute.DELETE(req("DELETE", "/api/desktop/library/files", { botId: bot.id, path: "Week 1/syllabus.txt" }, PC));
    expect((await again.json()).deleted).toBe(false);
  });

  it("paths stay inside the folder", async () => {
    expect(cleanPath("Week 1\\notes.md")).toBe("Week 1/notes.md");
    expect(cleanPath("./a.txt")).toBe("a.txt");
    for (const bad of ["../secrets.txt", "a/../../b", "a//b", "", "a\u0000b"]) expect(cleanPath(bad)).toBeNull();
    const r = await filesRoute.POST(req("POST", "/api/desktop/library/files", { botId: bot.id, path: "../../etc/passwd", size: 3, sha256: hex("abc") }));
    expect(r.status).toBe(400);
  });

  it("only with a paired computer's token, and only to the owner's own bots", async () => {
    const body = { botId: bot.id, path: "a.txt", size: 3, sha256: hex("abc") };
    expect((await filesRoute.POST(req("POST", "/api/desktop/library/files", body, { authorization: "Bearer bab_dev_nope" }))).status).toBe(401);
    expect((await filesRoute.POST(req("POST", "/api/desktop/library/files", { ...body, botId: strangersBot.id }))).status).toBe(404);
    expect((await filesRoute.DELETE(req("DELETE", "/api/desktop/library/files", { botId: strangersBot.id, path: "a.txt" }))).status).toBe(404);
  });

  it("another computer can't upload to or read this computer's file", async () => {
    const start = await filesRoute.POST(req("POST", "/api/desktop/library/files", { botId: bot.id, path: "b.txt", size: 4, sha256: hex("beta") }));
    const { file, upload } = await start.json();
    const put = await contentRoute.PUT(new Request(`http://localhost${upload.url}`, { method: "PUT", headers: PC, body: new TextEncoder().encode("evil") }), params(file.id));
    expect(put.status).toBe(404);
    const read = await readRoute.POST(req("POST", `/api/desktop/library/files/${file.id}/read`, { botId: bot.id }, PC), params(file.id));
    expect(read.status).toBe(404);
  });

  it("a file too big for what's left is turned down before any upload", async () => {
    const r = await filesRoute.POST(req("POST", "/api/desktop/library/files", { botId: bot.id, path: "huge.pdf", size: 600 * 1024 * 1024, sha256: hex("huge") }));
    expect(r.status).toBe(413);
  });
});
