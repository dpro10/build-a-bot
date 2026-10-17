/**
 * "Give my bot a folder", end to end, against a running Build-a-bot dev server in demo mode
 * (default http://localhost:3000; BAB_E2E_SERVER to change it):
 *
 *   node --test --test-timeout=300000 e2e/library.e2e.mjs
 *
 * It makes a demo account with a tutor bot, pairs the app through its pairing window with a folder
 * of class files (BAB_LIBRARY_FOLDER stands in for the folder picker), and checks the files land in
 * the bot's Library, read. Then it edits one, deletes one and adds one, and checks the Library
 * follows, and the bot reads the synced file (as it is now) in the web chat. Linux runs it under Xvfb.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, request } from "playwright";

const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const SERVER = process.env.BAB_E2E_SERVER ?? "http://localhost:3000";
const ELECTRON = path.join(APP_DIR, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 30_000, everyMs = 300) {
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
    await sleep(everyMs);
  }
}

let app = null;
after(async () => {
  if (app) await app.close().catch(() => {});
});

test("a folder on this computer stays in step with a bot's Library", { timeout: 300_000 }, async () => {
  const web = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { origin: SERVER } });
  const created = await web.post("/api/bots", {
    data: {
      avatar: "otto",
      color: "grape",
      name: "Tutor",
      role: "tutor",
      jobs: [],
      brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
      connectors: [],
      trust: "trusted",
      channels: [],
      contact: { email: "me@example.com" },
      ageConfirmed: true,
      timezone: "America/Chicago",
      ownerName: "Dana",
    },
  });
  assert.ok(created.ok(), `create bot: ${created.status()} ${await created.text()}`);
  const botId = (await created.json()).id;
  const { code } = await (await web.post("/api/bridge/pairing-code")).json();

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bab-library-e2e-"));
  const folder = path.join(userData, "Bio 101");
  fs.mkdirSync(path.join(folder, "Week 1"), { recursive: true });
  fs.writeFileSync(path.join(folder, "syllabus.md"), "# Biology 101\n\nThe midterm exam is on October 20 in Room 204. It covers photosynthesis.\n");
  fs.writeFileSync(path.join(folder, "Week 1", "notes.txt"), "Mitochondria make ATP through cellular respiration.\n");
  fs.writeFileSync(path.join(folder, "old-quiz.txt"), "Practice quiz from last year.\n");
  fs.writeFileSync(path.join(folder, "installer.exe"), "MZ not a class file");
  fs.writeFileSync(path.join(folder, ".DS_Store"), "hidden");

  app = await electron.launch({
    executablePath: ELECTRON,
    args: ["--no-sandbox", ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []), APP_DIR],
    env: { ...process.env, BAB_USER_DATA: userData, BAB_SERVER: SERVER, BAB_TEST: "1", BAB_ALLOW_PLAINTEXT_TOKEN: "1", BAB_UPDATES: "off", BAB_LIBRARY_FOLDER: folder },
  });
  const logs = [];
  app.process().stdout?.on("data", (d) => logs.push(String(d)));
  app.process().stderr?.on("data", (d) => logs.push(String(d)));
  const probe = () => app.evaluate(() => globalThis.__babTest?.state() ?? null);
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      if (lastMessages.length) console.log(`--- chat ---\n${lastMessages.join("\n")}`);
      console.log(`--- app log at "${name}" ---\n${logs.join("").split("\n").slice(-60).join("\n")}`);
      throw err;
    }
  };
  let lastMessages = [];
  const library = async () => (await (await web.get(`/api/bots/${botId}/files`)).json()).files;
  const names = (files) => files.map((f) => f.name).sort();

  const pairWin = await app.firstWindow();
  await pairWin.waitForSelector("#signed-out:not([hidden])");
  await pairWin.fill("#code", code);
  await pairWin.click("#pair-button");
  await step("paired", () => pairWin.waitForSelector("#paired:not([hidden])", { timeout: 20_000 }));

  // The class files arrive, read; nothing else from the folder does.
  const first = await step("first sync", () =>
    until("the folder's files, read", async () => {
      const files = await library();
      return files.length === 3 && files.every((f) => f.status === "ready") ? files : null;
    }, 60_000, 500),
  );
  assert.deepEqual(names(first), ["notes.txt", "old-quiz.txt", "syllabus.md"]);
  await step("card", () => pairWin.waitForSelector("#library-card:not([hidden])"));
  await step("card status", () => until("the card's status", async () => /“Bio 101” → Tutor · 3 files/.test((await pairWin.textContent("#library-line")) ?? ""), 15_000));
  assert.equal(await pairWin.isVisible("#library-stop"), true);
  const s = await probe();
  assert.equal(s.library.synced, 3);
  assert.equal(s.library.error, null);

  // Edit one, delete one, add one: the Library follows by itself.
  fs.writeFileSync(path.join(folder, "syllabus.md"), "# Biology 101\n\nThe midterm exam moved to October 27 in Room 110. It covers photosynthesis.\n");
  fs.rmSync(path.join(folder, "old-quiz.txt"));
  fs.writeFileSync(path.join(folder, "Week 1", "lab.md"), "Lab 1: measure the rate of photosynthesis in pondweed.\n");
  const second = await step("second sync", () =>
    until("the edit, the deletion and the new file", async () => {
      const files = await library();
      const syllabus = files.find((f) => f.name === "syllabus.md");
      return names(files).join() === "lab.md,notes.txt,syllabus.md" && files.every((f) => f.status === "ready") && syllabus.id !== first.find((f) => f.name === "syllabus.md").id ? files : null;
    }, 60_000, 500),
  );
  assert.equal(second.length, 3);

  // The bot reads the synced file like any other, as it is now.
  const chat = await web.post(`/api/bots/${botId}/chat`, { data: { text: "Summarize \"syllabus.md\"" } });
  assert.ok(chat.ok(), `chat: ${chat.status()}`);
  const reply = await step("answer", () =>
    until("the bot's answer from the synced file", async () => {
      const m = await (await web.get(`/api/bots/${botId}/messages`)).json();
      lastMessages = m.messages.map((x) => `${x.role}: ${x.text.slice(0, 160)}`);
      return m.messages.find((x) => x.role === "assistant" && (x.parts ?? []).some((p) => p.type === "tool_result" && p.name === "read_file")) ?? null;
    }, 60_000, 1000),
  );
  assert.match(reply.text, /October 27/, "read from the edited file");
  assert.doesNotMatch(reply.text, /October 20/);

  // Stop syncing: what was added stays.
  await pairWin.click("#library-stop");
  await step("stopped", () => pairWin.waitForSelector("#library-stop", { state: "hidden" }));
  assert.match(await pairWin.textContent("#library-choose"), /Choose a folder/);
  assert.equal((await library()).length, 3);

  await app.close();
  app = null;
  await web.delete(`/api/bots/${botId}`);
  fs.rmSync(userData, { recursive: true, force: true });
});
