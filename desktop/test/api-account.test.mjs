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
