import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanFolder, MAX_FILE_BYTES } from "../src/main/library/scan.mjs";
import { LibrarySync, hashFile, stopsTheSync } from "../src/main/library/index.mjs";
import { trayItems } from "../src/main/tray-menu.mjs";
import { Settings } from "../src/main/store.mjs";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Real timeouts (so a scheduled pass runs), but the 10-minute look never fires during a test. */
const timers = { setTimeout, clearTimeout, setInterval: () => ({ unref() {} }), clearInterval: () => {} };

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** @param {string} root @param {Record<string, string>} files */
function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
}

/** A server that keeps what it was sent, by path, the way /api/desktop/library/files does. */
function harness({ bots = [{ id: "bot_1", name: "Tutor" }], mode = "blob", fail } = {}) {
  const dir = tmp("bab-lib-");
  const folder = path.join(dir, "Bio 101");
  fs.mkdirSync(folder);
  const settings = new Settings(path.join(dir, "settings.json"));
  /** @type {Map<string, { id: string, sha256: string, bytes: string | null, read: boolean }>} */
  const server = new Map();
  const calls = { starts: [], uploads: [], reads: [], deletes: [], logs: [] };
  let n = 0;
  const api = {
    async libraryStart(f) {
      calls.starts.push(f);
      const err = fail?.(f);
      if (err) throw err;
      const old = server.get(f.path);
      if (old && old.sha256 === f.sha256 && old.bytes != null) return { file: { id: old.id }, unchanged: true };
      const id = `file_${++n}`;
      server.set(f.path, { id, sha256: f.sha256, bytes: null, read: false });
      return { file: { id }, upload: mode === "blob" ? { mode: "blob", pathname: `lib/${id}`, token: "tok" } : { mode: "local", url: `/api/desktop/library/files/${id}/content?botId=${f.botId}` } };
    },
    async libraryUploadLocal(url, bytes) {
      const id = url.split("/")[5];
      for (const v of server.values()) if (v.id === id) v.bytes = Buffer.from(bytes).toString();
      calls.uploads.push({ url, size: bytes.length });
      return null;
    },
    async libraryRead(botId, fileId) {
      calls.reads.push({ botId, fileId });
      for (const v of server.values()) if (v.id === fileId) v.read = true;
      return { file: { id: fileId } };
    },
    async libraryDelete(botId, p) {
      calls.deletes.push({ botId, path: p });
      server.delete(p);
      return { ok: true };
    },
  };
  const account = { device: { token: "bab_dev_secret" }, session: { library: { available: true } }, bots: () => bots };
  const lib = new LibrarySync({
    api: /** @type {any} */ (api),
    account: /** @type {any} */ (account),
    settings,
    stateFile: path.join(dir, "library-sync.json"),
    uploadBlob: async (pathname, bytes, token) => {
      const id = pathname.split("/")[1];
      for (const v of server.values()) if (v.id === id) v.bytes = Buffer.from(bytes).toString();
      calls.uploads.push({ pathname, size: bytes.length, token });
    },
    watch: /** @type {any} */ (() => ({ close() {}, on() {} })),
    timers: /** @type {any} */ (timers),
    log: (m) => calls.logs.push(m),
  });
  return { lib, folder, dir, settings, server, calls, account };
}

/** Wait for the pass that's running or about to run (a retry minutes away doesn't count). */
const idle = async (lib) => {
  const soon = () => lib.settle && lib.settle._idleTimeout < 10_000;
  const t0 = Date.now();
  while (lib.running || soon()) {
    if (Date.now() - t0 > 5000) throw new Error("the sync didn't settle");
    await (lib.running ?? new Promise((r) => setTimeout(r, 5)));
  }
};

// ---------------------------------------------------------------------------
// Scanning

test("library folder: the scan takes PDFs, Office files, text and photos, and skips the rest", async () => {
  const root = tmp("bab-scan-");
  write(root, {
    "syllabus.pdf": "%PDF-1.7",
    "Week 1/notes.docx": "PK",
    "Week 1/slides.pptx": "PK",
    "Week 1/board.jpg": "jpg",
    "reading.md": "# hi",
    "app.exe": "MZ",
    ".secret.txt": "hidden",
    ".git/config": "x",
    "node_modules/pkg/readme.md": "x",
    "~$notes.docx": "lock",
    "empty.txt": "",
  });
  try {
    fs.symlinkSync(os.tmpdir(), path.join(root, "outside"), "dir");
  } catch {
    /* Windows without the right to make links */
  }
  const { files, skipped } = await scanFolder(root);
  assert.deepEqual(
    files.map((f) => f.rel),
    ["reading.md", "syllabus.pdf", "Week 1/board.jpg", "Week 1/notes.docx", "Week 1/slides.pptx"],
  );
  assert.deepEqual(skipped, { tooBig: 0, tooMany: 0 });
  assert.ok(files.every((f) => f.abs.startsWith(root) && f.size > 0 && f.mtimeMs > 0));
});

test("library folder: files over 25 MB are counted, not sent", async () => {
  const root = tmp("bab-scan-");
  const fd = fs.openSync(path.join(root, "huge.pdf"), "w");
  fs.ftruncateSync(fd, MAX_FILE_BYTES + 1);
  fs.closeSync(fd);
  write(root, { "ok.txt": "fine" });
  const { files, skipped } = await scanFolder(root);
  assert.deepEqual(files.map((f) => f.rel), ["ok.txt"]);
  assert.equal(skipped.tooBig, 1);
});

test("library folder: a file's hash is its bytes' SHA-256", async () => {
  const root = tmp("bab-scan-");
  write(root, { "a.txt": "photosynthesis" });
  assert.equal(await hashFile(path.join(root, "a.txt")), sha("photosynthesis"));
});

// ---------------------------------------------------------------------------
// Syncing

test("library folder: choosing a folder sends every file (straight to storage), then asks for each to be read", async () => {
  const h = harness();
  write(h.folder, { "syllabus.txt": "Exam 1 is Oct 20", "Week 1/notes.md": "Cells" });
  await h.lib.choose(h.folder, "bot_1");
  await idle(h.lib);
  assert.deepEqual(h.settings.get().library, { folder: h.folder, botId: "bot_1" });
  assert.deepEqual(h.calls.starts.map((s) => s.path).sort(), ["Week 1/notes.md", "syllabus.txt"]);
  assert.equal(h.calls.starts[0].botId, "bot_1");
  assert.equal(h.calls.starts.find((s) => s.path === "syllabus.txt").sha256, sha("Exam 1 is Oct 20"));
  assert.equal(h.server.get("syllabus.txt").bytes, "Exam 1 is Oct 20");
  assert.ok(h.calls.uploads.every((u) => u.token === "tok"));
  assert.equal(h.calls.reads.length, 2);
  const info = h.lib.info();
  assert.equal(info.synced, 2);
  assert.equal(info.pending, 0);
  assert.match(info.status, /“Bio 101” → Tutor · 2 files/);
  assert.equal(info.error, null);
});

test("library folder: running it yourself, the bytes go to the server instead", async () => {
  const h = harness({ mode: "local" });
  write(h.folder, { "a.txt": "alpha" });
  await h.lib.choose(h.folder, "bot_1");
  await idle(h.lib);
  assert.equal(h.calls.uploads.length, 1);
  assert.match(h.calls.uploads[0].url, /^\/api\/desktop\/library\/files\/file_1\/content/);
  assert.equal(h.server.get("a.txt").bytes, "alpha");
});

test("library folder: nothing is sent again until a file changes; a changed file replaces its copy; a deleted one leaves", async () => {
  const h = harness();
  write(h.folder, { "a.txt": "alpha", "b.txt": "beta", "c.txt": "gamma" });
  await h.lib.choose(h.folder, "bot_1");
  await idle(h.lib);
  assert.equal(h.calls.starts.length, 3);

  await h.lib.sync();
  assert.equal(h.calls.starts.length, 3, "no changes, no requests");

  // Touched but the same bytes: not sent.
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(h.folder, "c.txt"), later, later);
  write(h.folder, { "a.txt": "alpha, revised" });
  fs.rmSync(path.join(h.folder, "b.txt"));
  await h.lib.sync();
  assert.deepEqual(h.calls.starts.slice(3).map((s) => s.path), ["a.txt"]);
  assert.equal(h.server.get("a.txt").bytes, "alpha, revised");
  assert.deepEqual(h.calls.deletes, [{ botId: "bot_1", path: "b.txt" }]);
  assert.equal(h.lib.info().synced, 2);
});

test("library folder: after the app starts again it remembers what it sent", async () => {
  const h = harness();
  write(h.folder, { "a.txt": "alpha" });
  await h.lib.choose(h.folder, "bot_1");
  await idle(h.lib);
  const again = new LibrarySync({ ...h.lib.o, timers });
  await again.sync();
  assert.equal(h.calls.starts.length, 1);
  assert.equal(again.info().synced, 1);
});

test("library folder: a folder that suddenly looks empty doesn't empty the Library", async () => {
  const h = harness();
  write(h.folder, { "a.txt": "alpha", "b.txt": "beta" });
  await h.lib.choose(h.folder, "bot_1");
  await idle(h.lib);
  fs.rmSync(path.join(h.folder, "a.txt"));
  fs.rmSync(path.join(h.folder, "b.txt"));
  await h.lib.sync();
  assert.equal(h.calls.deletes.length, 0);
  assert.match(h.lib.info().status, /looks empty/);
});

test("library folder: a folder that isn't there anymore says so", async () => {
  const h = harness();
  await h.lib.choose(path.join(h.dir, "gone"), "bot_1");
  assert.match(h.lib.info().status, /isn't there anymore/);
  assert.equal(h.calls.starts.length, 0);
});

test("library folder: offline stops the pass and tries again; one file the server turns down is skipped until it changes", async () => {
  let offline = true;
  const h = harness({
    fail: (f) =>
      offline ? Object.assign(new Error("offline"), { status: 0 }) : f.path === "bad.txt" ? Object.assign(new Error("That path isn't inside the folder."), { status: 400 }) : null,
  });
  write(h.folder, { "a.txt": "alpha", "bad.txt": "nope", "c.txt": "gamma" });
  await h.lib.choose(h.folder, "bot_1");
  await idle(h.lib);
  assert.match(h.lib.info().status, /Can't reach Build-a-bot/);
  assert.equal(h.calls.starts.length, 1, "the first failure stops the pass");
  assert.ok(h.lib.settle, "and another is scheduled");

  offline = false;
  await h.lib.sync();
  assert.deepEqual([...h.server.keys()].sort(), ["a.txt", "c.txt"]);
  assert.equal(h.lib.info().error, null);
  assert.match(h.lib.info().note ?? "", /1 couldn't be read/);

  const before = h.calls.starts.length;
  await h.lib.sync();
  assert.equal(h.calls.starts.length, before, "the skipped file isn't tried again unchanged");
  write(h.folder, { "bad.txt": "nope, edited" });
  await h.lib.sync();
  assert.equal(h.calls.starts.length, before + 1, "it is once it changes");
});

test("library folder: a full Library or an unpaired computer stops without retrying", async () => {
  const h = harness({ fail: () => Object.assign(new Error("Your Library is full (500 MB)."), { status: 413 }) });
  write(h.folder, { "a.txt": "alpha" });
  await h.lib.choose(h.folder, "bot_1");
  await idle(h.lib);
  assert.equal(h.lib.info().status, "Your Library is full (500 MB).");
  assert.equal(h.lib.settle, null);
  assert.ok(stopsTheSync({ status: 401 }) && stopsTheSync({ status: 503 }) && stopsTheSync({ status: 0 }));
  assert.ok(!stopsTheSync({ status: 400 }) && !stopsTheSync(Object.assign(new Error("gone"), { code: "ENOENT" })));
});

test("library folder: it only syncs for a bot of this account, and not while signed out", async () => {
  const h = harness();
  write(h.folder, { "a.txt": "alpha" });
  await h.lib.choose(h.folder, "bot_someone_else");
  await h.lib.sync();
  assert.equal(h.calls.starts.length, 0);

  await h.lib.choose(h.folder, "bot_1");
  h.account.device = null;
  await h.lib.sync();
  assert.equal(h.calls.starts.length, 0);

  h.account.device = { token: "t" };
  h.account.session = { library: { available: false } };
  await h.lib.sync();
  assert.equal(h.calls.starts.length, 0, "not on a server that doesn't keep files");
  assert.equal(h.lib.info().available, false);
});

test("library folder: stopping keeps what was added; another folder starts fresh", async () => {
  const h = harness();
  write(h.folder, { "a.txt": "alpha" });
  await h.lib.choose(h.folder, "bot_1");
  await idle(h.lib);
  h.lib.stop();
  assert.deepEqual(h.settings.get().library, { folder: null, botId: null });
  assert.equal(h.calls.deletes.length, 0, "nothing leaves the Library");
  assert.equal(h.lib.info().status, "");

  const other = path.join(h.dir, "Chem");
  write(other, { "lab.txt": "titration" });
  await h.lib.choose(other, "bot_1");
  await idle(h.lib);
  assert.ok(h.server.has("lab.txt") && h.server.has("a.txt"));
  assert.match(h.lib.info().status, /“Chem” → Tutor · 1 file$/);
});

// ---------------------------------------------------------------------------
// The tray

test("library folder: the tray offers it, then shows its status with Open, Choose another and Stop", () => {
  const base = { status: "Watching for calls", icon: "watching", signedIn: true, phase: "idle", canTake: true, detectionPaused: false, captions: true, openAtLogin: false, macTabs: false, platform: "darwin", bots: [], botId: null, neverApps: [] };
  const offer = trayItems({ ...base, library: { available: true, folder: null, folderName: null, status: "" } });
  assert.equal(offer.find((i) => i.id === "library-choose")?.label, "Give a bot a folder…");

  const on = trayItems({ ...base, library: { available: true, folder: "/u/Bio 101", folderName: "Bio 101", status: "“Bio 101” → Tutor · 12 files" } });
  const item = on.find((i) => i.id === "library");
  assert.equal(item?.label, "“Bio 101” → Tutor · 12 files");
  assert.deepEqual(
    item.submenu.filter((i) => i.id).map((i) => i.id),
    ["library-open", "library-choose", "library-stop"],
  );

  assert.ok(!trayItems({ ...base, library: { available: false, folder: null, folderName: null, status: "" } }).some((i) => i.id?.startsWith("library")));
  assert.ok(!trayItems({ ...base, signedIn: false, library: { available: true, folder: null, folderName: null, status: "" } }).some((i) => i.id?.startsWith("library")));
});
