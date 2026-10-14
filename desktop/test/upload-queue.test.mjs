import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UploadQueue } from "../src/main/upload-queue.mjs";
import { Spool } from "../src/main/spool.mjs";

const item = (chunk, track = "mic", meetingId = "mtg_1") => ({
  server: "http://localhost:3000",
  botId: "bot_1",
  meetingId,
  track,
  chunk,
  startMs: chunk * 6000,
  durationMs: 6000,
  silent: false,
  mime: "audio/webm",
  bytes: new Uint8Array(1200).fill(chunk + 1),
});

const tmpSpool = () => new Spool(fs.mkdtempSync(path.join(os.tmpdir(), "bab-spool-")));

test("uploads chunks and hands back the transcript lines", async () => {
  const sent = [];
  const lines = [];
  const q = new UploadQueue({
    send: async (i) => {
      sent.push(`${i.track}#${i.chunk}`);
      return { status: 200, body: { segments: [{ text: `line ${i.chunk}`, speaker: "You" }] } };
    },
    onUploaded: (_i, body) => lines.push(body.segments[0].text),
  });
  q.push(item(0));
  q.push(item(0, "system"));
  q.push(item(1));
  const r = await q.drain("mtg_1", 2000);
  assert.deepEqual(r, { ok: true, left: 0 });
  assert.deepEqual(sent.sort(), ["mic#0", "mic#1", "system#0"]);
  assert.equal(lines.length, 3);
  assert.equal(q.stats.uploaded, 3);
});

test("retries network errors and 503 'retry' with backoff, waiting in the spool (then deletes it)", async () => {
  const spool = tmpSpool();
  let calls = 0;
  const q = new UploadQueue({
    spool,
    baseDelayMs: 20,
    maxDelayMs: 50,
    send: async (i) => {
      calls++;
      if (calls === 1) throw new Error("ECONNRESET");
      if (calls === 2) return { status: 503, body: { code: "retry" } };
      assert.equal(i.bytes.length, 1200, "the audio comes back from the spool intact");
      return { status: 200, body: { segments: [] } };
    },
  });
  q.push(item(3));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(spool.list().length, 1, "waits on disk after the first failure");
  const r = await q.drain("mtg_1", 3000);
  assert.equal(r.ok, true);
  assert.equal(calls, 3);
  assert.equal(q.stats.retried, 2);
  assert.equal(spool.list().length, 0, "deleted after upload");
  assert.deepEqual(fs.readdirSync(spool.dir), [], "nothing left on disk");
});

test("402 (out of minutes) stops recording and throws away the rest", async () => {
  const stops = [];
  let n = 0;
  const q = new UploadQueue({
    concurrency: 1,
    send: async () => (++n === 2 ? { status: 402, body: { code: "limit", error: "You've used this month's meeting minutes." } } : { status: 200, body: { segments: [] } }),
    onStop: (reason) => stops.push(reason),
  });
  for (let c = 0; c < 5; c++) q.push(item(c));
  const r = await q.drain("mtg_1", 2000);
  assert.equal(r.ok, true);
  assert.deepEqual(stops, ["limit"]);
  assert.equal(n, 2, "nothing more is sent after a 402");
  q.push(item(9));
  assert.equal(q.size("mtg_1"), 0, "a stopped meeting takes no more chunks");
});

test("409 not_recording stops; 401 unpaired drops everything; 415 drops just that chunk", async () => {
  const stops = [];
  const q = new UploadQueue({
    concurrency: 1,
    send: async (i) => {
      if (i.meetingId === "mtg_gone") return { status: 409, body: { code: "not_recording" } };
      if (i.chunk === 1) return { status: 415, body: { error: "Send audio as webm" } };
      return { status: 200, body: { segments: [] } };
    },
    onStop: (reason, i) => stops.push(`${reason}:${i.meetingId}`),
  });
  q.push(item(0, "mic", "mtg_gone"));
  q.push(item(1, "mic", "mtg_ok"));
  q.push(item(2, "mic", "mtg_ok"));
  await q.drain(undefined, 2000);
  assert.deepEqual(stops, ["not_recording:mtg_gone"]);
  assert.equal(q.stats.uploaded, 1);

  const q2 = new UploadQueue({ concurrency: 1, send: async () => ({ status: 401, body: {} }), onStop: (r) => stops.push(r) });
  q2.push(item(0, "mic", "a"));
  q2.push(item(0, "mic", "b"));
  await q2.drain(undefined, 2000);
  assert.ok(stops.includes("unpaired"));
  assert.equal(q2.size(), 0);
});

test("re-sending the same chunk is safe (the server answers duplicates); drain times out offline", async () => {
  const seen = new Map();
  const q = new UploadQueue({
    send: async (i) => {
      const k = `${i.track}:${i.chunk}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      return { status: 200, body: { segments: [], duplicate: seen.get(k) > 1 } };
    },
  });
  q.push(item(4));
  q.push(item(4));
  await q.drain("mtg_1", 1000);
  assert.equal(seen.get("mic:4"), 2);

  const offline = new UploadQueue({ baseDelayMs: 5000, send: async () => { throw new Error("offline"); } });
  offline.push(item(0));
  const r = await offline.drain("mtg_1", 100);
  assert.deepEqual(r, { ok: false, left: 1 });
  offline.dispose();
});

test("discarding a meeting deletes its queued chunks and spool files; persist() saves the rest on quit", async () => {
  const spool = tmpSpool();
  const q = new UploadQueue({ spool, baseDelayMs: 10_000, send: async () => { throw new Error("offline"); } });
  q.push(item(0, "mic", "mtg_a"));
  q.push(item(0, "mic", "mtg_b"));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(spool.list().length, 2);
  q.drop("mtg_a");
  assert.deepEqual(spool.list().map((i) => i.meetingId), ["mtg_b"]);

  const q2 = new UploadQueue({ spool, concurrency: 0, send: async () => ({ status: 200, body: {} }) });
  q2.push(item(7, "system", "mtg_c"));
  assert.equal(q2.persist(), 1);
  const left = spool.list().find((i) => i.meetingId === "mtg_c");
  assert.equal(left.track, "system");
  assert.equal(spool.read(left).length, 1200);
  q.dispose();
  q2.dispose();
});
