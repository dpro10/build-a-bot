import { test } from "node:test";
import assert from "node:assert/strict";
import { LINE_PAUSE_MS, linesFromWords, meetingSender } from "../src/main/meeting-speech.mjs";
import { UploadQueue } from "../src/main/upload-queue.mjs";

const w = (word, start, end) => ({ word, start, end });

test("Parakeet's timed words become transcript lines: by pauses and sentence ends, kept within the piece", () => {
  const words = [
    w("Thanks", 0.4, 0.7),
    w("for", 0.7, 0.8),
    w("joining.", 0.8, 1.2),
    w("Let's", 1.3, 1.5),
    w("lock", 1.5, 1.7),
    w("the", 1.7, 1.8),
    w("launch", 1.8, 2.1),
    w("plan", 2.1, 2.3),
    w("today.", 2.3, 2.8),
    w("Priya", 2.9, 3.2),
    w("sends", 3.2, 3.5),
    w("notes", 3.5, 3.8),
    w("at", 3.8, 3.9),
    w("3.30.", 3.9, 4.4),
    // A long pause: someone else's turn.
    w("Sounds", 4.4 + LINE_PAUSE_MS / 1000 + 0.3, 6.2),
    w("good", 6.2, 6.5),
    // A word running past the end of the piece is kept within it.
    w("bye", 19.8, 20.6),
  ];
  assert.deepEqual(linesFromWords(words, { durationMs: 20_000 }), [
    // "Thanks for joining." is too short to stand alone: it runs on to the next sentence.
    { startMs: 400, endMs: 2800, text: "Thanks for joining. Let's lock the launch plan today." },
    // Parakeet's British-style time is tidied, as in voice typing.
    { startMs: 2900, endMs: 4400, text: "Priya sends notes at 3:30." },
    { startMs: 5900, endMs: 6500, text: "Sounds good" },
    { startMs: 19_800, endMs: 20_000, text: "bye" },
  ]);
});

test("no word times: the whole piece is one line; nothing heard: no lines", () => {
  assert.deepEqual(linesFromWords([], { durationMs: 20_000, text: " We ship on Friday. " }), [{ startMs: 0, endMs: 20_000, text: "We ship on Friday." }]);
  assert.deepEqual(linesFromWords([], { durationMs: 20_000, text: "  " }), []);
  assert.deepEqual(linesFromWords([w("", 0, 1), { word: "x", start: Number.NaN, end: 1 }], { durationMs: 20_000 }), []);
});

/** A sender with fakes that record what happened. */
function sender(o = {}) {
  const sent = [];
  const api = {
    async uploadChunk(item) {
      sent.push(["audio", item.track, item.chunk]);
      return { status: 200, body: { segments: [] } };
    },
    async uploadChunkText(item, lines) {
      sent.push(["text", item.track, item.chunk, lines]);
      return { status: 200, body: { segments: lines } };
    },
  };
  const decoded = [];
  const heard = [];
  const s = meetingSender({
    api,
    way: () => o.way ?? "local",
    takesText: () => o.takesText ?? true,
    toWav: async (bytes, mime) => {
      decoded.push(mime);
      if (o.unreadable) throw new Error("not audio");
      return new Uint8Array([82, 73, 70, 70]);
    },
    hear: async (wav, opts) => {
      heard.push(opts.durationMs);
      if (o.hearError) throw o.hearError;
      return { text: "We ship on Friday.", words: [w("We", 0.5, 0.7), w("ship", 0.7, 1), w("on", 1, 1.1), w("Friday.", 1.1, 1.6)] };
    },
    maxEngineTries: 2,
  });
  return { s, sent, decoded, heard };
}

const piece = (extra = {}) => ({ server: "http://x", botId: "bot_1", meetingId: "mtg_1", track: "system", chunk: 3, startMs: 60_000, durationMs: 20_000, silent: false, mime: "audio/webm", bytes: new Uint8Array(900), ...extra });

test("a piece is heard on this computer and only its lines are sent", async () => {
  const { s, sent, decoded, heard } = sender();
  const res = await s.send(piece());
  assert.equal(res.status, 200);
  assert.deepEqual(decoded, ["audio/webm"]);
  assert.deepEqual(heard, [20_000]);
  assert.deepEqual(sent, [["text", "system", 3, [{ startMs: 500, endMs: 1600, text: "We ship on Friday." }]]]);
});

test("a silent piece sends only its time: no audio, nothing heard", async () => {
  const { s, sent, decoded } = sender();
  assert.equal(s.ready(piece({ silent: true })), true);
  await s.send(piece({ silent: true }));
  assert.deepEqual(sent, [["text", "system", 3, []]]);
  assert.deepEqual(decoded, []);
});

test("Parakeet still on its way: the piece waits (unread), and nothing is sent", async () => {
  const { s, sent, decoded } = sender({ way: "wait" });
  assert.equal(s.ready(piece()), false);
  // A silent one doesn't need hearing.
  assert.equal(s.ready(piece({ silent: true })), true);
  const res = await s.send(piece());
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "retry");
  assert.deepEqual(sent, []);
  assert.deepEqual(decoded, []);
});

test("Parakeet can't run here and the server hears audio: the piece's audio goes, as before", async () => {
  const { s, sent } = sender({ way: "server" });
  assert.equal(s.ready(piece()), true);
  await s.send(piece());
  assert.deepEqual(sent, [["audio", "system", 3]]);
});

test("nothing can ever hear it (Parakeet can't run here, the server doesn't hear audio): only its time goes, never the audio", async () => {
  const { s, sent, decoded, heard } = sender({ way: "none" });
  assert.equal(s.ready(piece()), true, "it doesn't wait for what will never come");
  const res = await s.send(piece());
  assert.equal(res.status, 200);
  assert.deepEqual(sent, [["text", "system", 3, []]]);
  assert.deepEqual(decoded, []);
  assert.deepEqual(heard, []);
  assert.equal(s.stats.unheard, 1);
});

test("a server that doesn't take lines gets a silent piece's audio, as before", async () => {
  const { s, sent } = sender({ way: "server", takesText: false });
  await s.send(piece({ silent: true }));
  assert.deepEqual(sent, [["audio", "system", 3]]);
});

test("audio it can't read is marked as nothing heard, so the meeting goes on", async () => {
  const { s, sent } = sender({ unreadable: true });
  await s.send(piece());
  assert.deepEqual(sent, [["text", "system", 3, []]]);
});

test("an engine still starting is tried again; one that keeps refusing a piece moves on without it", async () => {
  const starting = Object.assign(new Error("It's still starting."), { code: "starting" });
  const a = sender({ hearError: starting });
  const res = await a.s.send(piece({ attempts: 5 }));
  assert.equal(res.status, 503);
  assert.deepEqual(a.sent, [], "a busy or loading engine is never a reason to drop a piece");

  const refused = Object.assign(new Error("It answered 400."), { code: "engine" });
  const b = sender({ hearError: refused });
  assert.equal((await b.s.send(piece({ attempts: 0 }))).status, 503);
  await b.s.send(piece({ attempts: 1 }));
  assert.deepEqual(b.sent, [["text", "system", 3, []]]);
});

test("the upload queue keeps a piece that isn't ready on disk, unread, until it is", async () => {
  const written = new Map();
  let reads = 0;
  const spool = {
    write(i) {
      written.set(`${i.track}-${i.chunk}`, i.bytes);
      return true;
    },
    read(i) {
      reads++;
      return written.get(`${i.track}-${i.chunk}`) ?? null;
    },
    remove(i) {
      written.delete(`${i.track}-${i.chunk}`);
    },
    removeMeeting() {},
  };
  let ready = false;
  const sent = [];
  let now = 1_000_000;
  const q = new UploadQueue({
    send: async (i) => {
      sent.push(i.chunk);
      return { status: 200, body: {} };
    },
    ready: () => ready,
    spool,
    baseDelayMs: 5,
    maxDelayMs: 10,
    now: () => now,
  });
  q.push(piece({ chunk: 0 }));
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(sent, []);
  assert.equal(q.size("mtg_1"), 1);
  assert.equal(reads, 0, "its audio isn't read while it waits");
  assert.ok(written.has("system-0"), "it waits on disk, not in memory");
  now += 5 * 60_000;
  assert.equal(q.oldestAge("mtg_1"), 5 * 60_000);
  ready = true;
  const done = await q.drain("mtg_1", 2000);
  assert.deepEqual(done, { ok: true, left: 0 });
  assert.deepEqual(sent, [0]);
  assert.equal(written.size, 0, "gone from disk once it's sent");
  assert.equal(q.oldestAge("mtg_1"), 0);
  assert.equal(q.isDropped("mtg_1"), false);
  q.drop("mtg_1");
  assert.equal(q.isDropped("mtg_1"), true);
  q.dispose();
});

test("waiting for Parakeet isn't a failed try: the pieces keep their order and every try the engine gets", async () => {
  let ready = false;
  const sent = [];
  const q = new UploadQueue({
    send: async (i) => {
      sent.push([i.chunk, i.attempts]);
      return { status: 200, body: {} };
    },
    ready: () => ready,
    concurrency: 1,
    waitMs: 5,
    baseDelayMs: 5,
    maxDelayMs: 10,
  });
  for (const chunk of [0, 1, 2]) q.push(piece({ chunk, bytes: new Uint8Array(900) }));
  // A few minutes' worth of waiting, at test speed.
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(sent, []);
  assert.equal(q.stats.retried, 0, "waiting isn't retrying");
  ready = true;
  assert.deepEqual(await q.drain("mtg_1", 2000), { ok: true, left: 0 });
  assert.deepEqual(sent, [[0, 0], [1, 0], [2, 0]], "in order, none of their tries used up");
  q.dispose();
});
