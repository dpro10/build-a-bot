import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/main/api.mjs";
import { Account, normalizeCode, platformTag } from "../src/main/account.mjs";
import { redact } from "../src/main/log.mjs";
import { buddyUrl } from "../src/main/buddy-url.mjs";

function fakeFetch(responses) {
  const seen = [];
  const fn = async (url, init) => {
    seen.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: {} };
    if (r.throw) throw new Error(r.throw);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => JSON.stringify(r.body) };
  };
  return { fn, seen };
}

test("api: the device token goes in the Authorization header, never the URL", async () => {
  const f = fakeFetch([{ status: 200, body: { bots: [] } }]);
  const api = createApi({ fetch: f.fn, server: () => "http://localhost:3000", token: () => "bab_dev_secret" });
  await api.session();
  assert.equal(f.seen[0].url, "http://localhost:3000/api/desktop/session");
  assert.equal(f.seen[0].init.headers.authorization, "Bearer bab_dev_secret");
  assert.ok(!f.seen[0].url.includes("bab_dev_"));
  assert.equal(f.seen[0].init.credentials, "omit");
});

test("api: pairing sends no token and the desktop platform with no CLIs", async () => {
  const f = fakeFetch([{ status: 200, body: { deviceId: "dev_1", token: "bab_dev_x" } }]);
  const api = createApi({ fetch: f.fn, server: () => null, token: () => null });
  const r = await api.pair({ server: "https://build-a-bot.site", code: "ABCD-1234", name: "Dana's Mac", platform: "desktop-darwin-arm64" });
  assert.equal(r.token, "bab_dev_x");
  assert.equal(f.seen[0].url, "https://build-a-bot.site/api/bridge/pair");
  assert.equal(f.seen[0].init.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(f.seen[0].init.body), { code: "ABCD-1234", name: "Dana's Mac", platform: "desktop-darwin-arm64", clis: {} });
});

test("api: chunk uploads carry track/chunk/timing/silent in the query and the audio as the body", async () => {
  const f = fakeFetch([{ status: 503, body: { code: "retry" } }]);
  const api = createApi({ fetch: f.fn, server: () => "http://s", token: () => "bab_dev_t" });
  const bytes = new Uint8Array([1, 2, 3]);
  const r = await api.uploadChunk({ server: "http://s", botId: "bot_1", meetingId: "mtg_1", track: "system", chunk: 7, startMs: 42000.4, durationMs: 6000, silent: true, mime: "audio/webm", bytes });
  assert.deepEqual(r, { status: 503, body: { code: "retry" } }, "HTTP errors are returned, not thrown");
  assert.equal(f.seen[0].url, "http://s/api/bots/bot_1/meetings/mtg_1/audio?track=system&chunk=7&startMs=42000&durationMs=6000&silent=1");
  assert.equal(f.seen[0].init.headers["content-type"], "audio/webm");
  assert.equal(f.seen[0].init.body, bytes);
});

test("api: what Parakeet heard on this computer goes as lines (JSON), never audio; the meeting is kept alive while it hears", async () => {
  const f = fakeFetch([{ status: 200, body: { segments: [] } }, { status: 200, body: { meeting: {} } }, { status: 201, body: { meeting: { id: "mtg_2" } } }]);
  const api = createApi({ fetch: f.fn, server: () => "http://s", token: () => "bab_dev_t" });
  const item = { server: "http://s", botId: "bot_1", meetingId: "mtg_1", track: "mic", chunk: 2, startMs: 40000, durationMs: 20000, silent: false, mime: "audio/webm", bytes: new Uint8Array([9, 9]) };
  const r = await api.uploadChunkText(item, [{ startMs: 500.4, endMs: 2600, text: "We ship on Friday." }]);
  assert.equal(r.status, 200);
  assert.equal(f.seen[0].url, "http://s/api/bots/bot_1/meetings/mtg_1/audio?track=mic&chunk=2&startMs=40000&durationMs=20000&silent=0");
  assert.equal(f.seen[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(f.seen[0].init.body), { heard: [{ startMs: 500, endMs: 2600, text: "We ship on Friday." }] });
  assert.ok(!String(f.seen[0].init.body).includes("9,9"), "no audio in it");

  await api.keepHearing("bot_1", "mtg_1");
  assert.equal(f.seen[1].init.method, "PATCH");
  assert.deepEqual(JSON.parse(f.seen[1].init.body), { hearing: true });

  // A meeting in the room says so; a call doesn't send the field at all.
  await api.startMeeting("bot_1", { app: "other", consentNotice: false, inPerson: true });
  assert.deepEqual(JSON.parse(f.seen[2].init.body), { app: "other", consentNotice: false, inPerson: true });

  // Lines for a server this computer isn't paired with anymore go nowhere.
  const gone = await api.uploadChunkText({ ...item, server: "http://old" }, []);
  assert.equal(gone.status, 404);
  assert.equal(f.seen.length, 3);
});

test("account: notes are offered when this computer can hear the call, or the server can", () => {
  const settings = { get: () => ({ server: "http://s", botId: "bot_1" }), update: () => {} };
  const account = new Account({ api: createApi({ fetch: async () => ({}), server: () => "http://s", token: () => null }), tokens: {}, settings });
  account.device = { server: "http://s" };
  const bots = [{ id: "bot_1", name: "Inky", avatar: "otto", color: "grape", paused: false, meetingsOn: true }];
  account.session = { bots, meetings: { available: false, local: true, minutesLeft: 100, chunkMs: 20000 } };
  assert.equal(account.whyNot(), null, "the server takes what Parakeet hears here");
  account.setMeetingCheck(() => "Turn on Private speech to take notes");
  assert.equal(account.whyNot(), "Turn on Private speech to take notes");
  account.setMeetingCheck(() => null);
  account.session = { bots, meetings: { available: false, minutesLeft: 100, chunkMs: 20000 } };
  assert.equal(account.whyNot(), "Meeting notes aren't set up on this server", "an older server that takes neither");
  account.session = { bots, meetings: { available: true, minutesLeft: 100, chunkMs: 20000 } };
  assert.equal(account.whyNot(), null, "an older server that hears audio itself");
});

test("account: out of credit, notes wait only for a bot whose notes cost it (its owner's own AI is free)", () => {
  const settings = { get: () => ({ server: "http://s", botId: "bot_1" }), update: () => {} };
  const account = new Account({ api: createApi({ fetch: async () => ({}), server: () => "http://s", token: () => null }), tokens: {}, settings });
  account.device = { server: "http://s" };
  const included = [{ id: "bot_1", name: "Inky", avatar: "otto", color: "grape", paused: false, meetingsOn: true, notesNeedCredit: true }];
  account.session = { bots: included, meetings: { available: false, local: true, credit: false, minutesLeft: 0, chunkMs: 20000 } };
  assert.equal(account.whyNot(), "Out of credit: add some to take notes");
  account.session = { bots: included, meetings: { available: false, local: true, credit: true, minutesLeft: 600, chunkMs: 20000 } };
  assert.equal(account.whyNot(), null);
  const ownKey = [{ ...included[0], notesNeedCredit: false }];
  account.session = { bots: ownKey, meetings: { available: false, local: true, credit: false, minutesLeft: 600, chunkMs: 20000 } };
  assert.equal(account.whyNot(), null, "its own AI writes the notes: free here");
  // An older server says minutesLeft instead.
  account.session = { bots: ownKey, meetings: { available: false, local: true, minutesLeft: 0, chunkMs: 20000 } };
  assert.equal(account.whyNot(), "Out of credit: add some to take notes");
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(5);
  }
}

/** A paired account whose session loads through `responses`. */
function pairedAccount(responses, o = {}) {
  const f = fakeFetch(responses);
  let saved = { server: "http://s", deviceId: "dev_1", token: "bab_dev_t", deviceName: "Mac", stored: "keychain" };
  const tokens = { load: () => saved, save: () => ({ stored: "keychain" }), clear: () => (saved = null) };
  const settings = { get: () => ({ server: "http://s", botId: null }), update: () => {} };
  const api = createApi({ fetch: f.fn, server: () => saved?.server ?? null, token: () => saved?.token ?? null });
  const account = new Account({ api, tokens, settings, retry: { firstMs: 60, maxMs: 400, onlineCheckMs: 10 }, ...o });
  return { account, f };
}

const SESSION = { bots: [], meetings: { available: false, local: true, minutesLeft: 100, chunkMs: 20000 }, voice: { available: false, local: true } };

test("account: a session that didn't load (the app started offline) is tried again, at once when the computer is back online", async () => {
  let online = false;
  const { account, f } = pairedAccount([{ throw: "fetch failed" }, { throw: "fetch failed" }, { status: 200, body: SESSION }], { isOnline: () => online });
  account.load();
  await until(() => f.seen.length === 1 && account.status === "offline");
  assert.equal(account.session, null);
  assert.equal(account.whyNot(), "Can't reach Build-a-bot");
  // Tried again on its own, a little later.
  await until(() => f.seen.length === 2);
  assert.equal(account.status, "offline");
  // The next wait is longer, but the Wi-Fi coming up doesn't wait for it.
  const t0 = Date.now();
  online = true;
  await until(() => account.status === "ready");
  assert.ok(Date.now() - t0 < 100, `took ${Date.now() - t0} ms`);
  assert.equal(f.seen.length, 3);
  assert.deepEqual(account.session, SESSION);
  // Loaded: no more tries.
  await sleep(150);
  assert.equal(f.seen.length, 3);
});

test("account: waking from sleep tries a session that never loaded right away; unpaired, it stops trying", async () => {
  const woke = pairedAccount([{ throw: "fetch failed" }, { status: 200, body: SESSION }], { retry: { firstMs: 60_000, maxMs: 60_000, onlineCheckMs: 60_000 } });
  woke.account.load();
  await until(() => woke.account.status === "offline");
  woke.account.reconnect();
  await until(() => woke.account.status === "ready");
  assert.equal(woke.f.seen.length, 2);
  woke.account.reconnect();
  assert.equal(woke.f.seen.length, 2, "nothing to do once it has a session");

  const gone = pairedAccount([{ throw: "fetch failed" }, { throw: "fetch failed" }]);
  gone.account.load();
  await until(() => gone.account.status === "offline");
  gone.account.signOut(null);
  await sleep(150);
  assert.equal(gone.f.seen.length, 1, "no tries after unpairing");

  // A page in place of the session (a captive portal's) is no session: it's tried again too.
  const portal = pairedAccount([{ status: 200 }, { status: 200, body: SESSION }]);
  portal.account.load();
  await until(() => portal.f.seen.length === 1 && portal.account.status === "offline");
  assert.equal(portal.account.session, null);
  await until(() => portal.account.status === "ready");
});

test("api: errors keep the server's code; network failures are status 0", async () => {
  const f = fakeFetch([{ status: 409, body: { error: "Turn on Meeting notes for Inky first.", code: "meetings_off" } }, { throw: "ECONNREFUSED" }]);
  const api = createApi({ fetch: f.fn, server: () => "http://s", token: () => "bab_dev_t" });
  await assert.rejects(api.startMeeting("bot_1", { app: "zoom", consentNotice: true }), (e) => e.status === 409 && e.code === "meetings_off" && e.message === "Turn on Meeting notes for Inky first.");
  assert.deepEqual(JSON.parse(f.seen[0].init.body), { app: "zoom", consentNotice: true });
  await assert.rejects(api.session(), (e) => e.status === 0 && e.code === "network");
});

test("pairing codes, platform tag, log redaction, buddy URL", () => {
  assert.equal(normalizeCode(" abcd 1234 "), "ABCD-1234");
  assert.equal(normalizeCode("abcd-123"), null);
  assert.match(platformTag(), /^desktop-(darwin|win32|linux)-(x64|arm64|ia32)$/);
  assert.equal(redact("token bab_dev_AbC-123_x ok"), "token bab_dev_[hidden] ok");
  assert.equal(redact('{"authorization":"Bearer abc.def"}'), '{"authorization":"Bearer [hidden]"}');
  const url = buddyUrl("http://localhost:3000", { phase: "asking", bot: { name: "Inky", avatar: "otto", color: "grape" }, app: { id: "zoom", name: "Zoom" }, elapsedMs: 754_000, minutesLeft: 12 });
  assert.equal(url, "http://localhost:3000/desktop/buddy?phase=asking&name=Inky&avatar=otto&color=grape&level=0&app=zoom&elapsed=754&left=12");
});

test("unpair revokes the token on the server, then forgets it here (offline: forgets it anyway)", async () => {
  const make = (responses) => {
    const f = fakeFetch(responses);
    let saved = { server: "http://s", deviceId: "dev_1", token: "bab_dev_t", deviceName: "Mac", stored: "keychain" };
    const tokens = { load: () => saved, save: () => ({ stored: "keychain" }), clear: () => { saved = null; } };
    const settings = { get: () => ({ server: "http://s", botId: null }), update: () => {} };
    const account = new Account({ api: createApi({ fetch: f.fn, server: () => "http://s", token: () => saved?.token ?? null }), tokens, settings });
    account.device = saved;
    return { account, f, tokens: () => saved };
  };

  const online = make([{ status: 200, body: { ok: true } }]);
  assert.deepEqual(await online.account.unpair(), { revoked: true });
  assert.equal(online.f.seen[0].init.method, "DELETE");
  assert.match(online.f.seen[0].url, /\/api\/desktop\/session$/);
  assert.equal(online.tokens(), null);
  assert.equal(online.account.status, "signed_out");

  const offline = make([{ throw: "fetch failed" }]);
  assert.deepEqual(await offline.account.unpair(), { revoked: false });
  assert.equal(offline.tokens(), null);
});

test("api: the device token never goes to a server this computer isn't paired with (anymore)", async () => {
  const f = fakeFetch([]);
  // Re-paired with a new server while chunks, a finish or a notes poll were still addressed to the old one.
  const api = createApi({ fetch: f.fn, server: () => "https://new.example", token: () => "bab_dev_new" });
  const r = await api.uploadChunk({ server: "http://localhost:3000", botId: "bot_1", meetingId: "mtg_1", track: "mic", chunk: 0, startMs: 0, durationMs: 6000, silent: false, mime: "audio/webm", bytes: new Uint8Array([1]) });
  assert.equal(r.status, 404, "the old server's meeting is gone for us: drop just its chunks");
  await assert.rejects(api.finish("bot_1", "mtg_1", "http://localhost:3000"), (e) => e.status === 401);
  await assert.rejects(api.getMeeting("bot_1", "mtg_1", "http://localhost:3000"), (e) => e.status === 401);
  assert.equal(f.seen.length, 0, "nothing was sent to the old server");
  // The paired server still gets it.
  const f2 = fakeFetch([{ status: 200, body: { meeting: { status: "ready" } } }]);
  const api2 = createApi({ fetch: f2.fn, server: () => "https://new.example", token: () => "bab_dev_new" });
  await api2.getMeeting("bot_1", "mtg_1", "https://new.example");
  assert.equal(f2.seen[0].init.headers.authorization, "Bearer bab_dev_new");
});
