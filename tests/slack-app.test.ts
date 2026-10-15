/**
 * One-click "Add to Slack" on the shared app, outside demo mode: only the owner who started it
 * can finish it, the Slack person who allowed it becomes the owner there (no link code), DMs go
 * to the sender's own bot with that bot's name and face, strangers get one short note, and
 * removing the app in Slack turns Slack off for that workspace. A fake Slack API stands in.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "0";
process.env.APP_URL = "https://build-a-bot.site";
process.env.SLACK_CLIENT_ID = "123.456";
process.env.SLACK_CLIENT_SECRET = "client-secret";
process.env.SLACK_SIGNING_SECRET = "signing-secret-for-tests";
delete process.env.DATABASE_URL;
for (const key of ["TOKEN_FACTORY_API_KEY", "COMPOSIO_API_KEY", "STRIPE_SECRET_KEY"]) delete process.env[key];

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getUser: async () => session.user,
}));
// Webhook work runs after the response: run it right away and let tests wait for it.
const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => void background.push(Promise.resolve().then(fn)),
}));
// The bot's brain isn't what's tested here: it answers with what it heard.
vi.mock("@/lib/agent/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/run")>()),
  runTurn: async (input: { bot: { name: string }; message: { text: string } }) => ({
    status: "ok",
    text: `${input.bot.name} heard: ${input.message.text}`,
    messageId: null,
    approvals: [],
  }),
}));

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { channelAction } = await import("@/lib/channels/setup");
const { approvalButtonToken } = await import("@/lib/agent/approvals");
const callback = await import("@/app/api/channels/slack/callback/route");
const events = await import("@/app/api/webhooks/slack/events/route");
const interactive = await import("@/app/api/webhooks/slack/interactive/route");
const ownEvents = await import("@/app/api/webhooks/slack/[channelId]/events/route");
import type { Bot, User } from "@/lib/db/schema";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;
let stranger: User;

type Call = { method: string; body: Record<string, unknown>; auth: string | null };

/** Workspaces whose token Slack has revoked (the app was removed there). */
const revoked = new Set<string>();

/** A fake slack.com: oauth.v2.access hands out a bot token for whichever workspace and person the code names. */
function stubSlack(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = url.replace("https://slack.com/api/", "");
    const headers = new Headers(init.headers);
    const raw = typeof init.body === "string" ? init.body : "";
    const body = headers.get("content-type")?.includes("json") ? (JSON.parse(raw || "{}") as Record<string, unknown>) : Object.fromEntries(new URLSearchParams(raw));
    calls.push({ method, body, auth: headers.get("authorization") });
    if (method === "oauth.v2.access") {
      const [team, user] = String(body.code).split(":");
      return Response.json({ ok: true, access_token: `xoxb-${team}-token`, token_type: "bot", scope: "chat:write", bot_user_id: "UBOT", app_id: "AAPP", team: { id: team, name: `${team} Inc` }, authed_user: { id: user } });
    }
    if (method === "conversations.open") return Response.json({ ok: true, channel: { id: `D-${String(body.users)}` } });
    if (method === "chat.postMessage") return Response.json({ ok: true, ts: "1700000000.000100" });
    if (method === "auth.test") {
      const team = /^Bearer xoxb-(T\w+)-token$/.exec(headers.get("authorization") ?? "")?.[1];
      return Response.json(team && revoked.has(team) ? { ok: false, error: "token_revoked" } : { ok: true, team: "Own Inc" });
    }
    return Response.json({ ok: false, error: "unknown_method" });
  });
  return calls;
}

async function makeBot(user: User, name: string): Promise<Bot> {
  const res = await createBot(db, user, {
    avatar: "blip",
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
  });
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

/** Click "Add to Slack": returns the state Slack will send back. */
async function startInstall(user: User, bot: Bot): Promise<string> {
  const res = await channelAction(db, user, bot, "slack", "install", {});
  if (!res.ok) throw new Error(res.error);
  const url = new URL(String(res.data?.installUrl));
  expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
  expect(url.searchParams.get("client_id")).toBe("123.456");
  expect(url.searchParams.get("scope")).toBe("chat:write,chat:write.customize,im:history,im:write");
  expect(url.searchParams.get("redirect_uri")).toBe("https://build-a-bot.site/api/channels/slack/callback");
  return url.searchParams.get("state")!;
}

const back = (state: string, query: string) => callback.GET(new Request(`https://build-a-bot.site/api/channels/slack/callback?${query}&state=${state}`));

function signed(path: string, body: string, contentType = "application/json"): Request {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = "v0=" + crypto.createHmac("sha256", "signing-secret-for-tests").update(`v0:${ts}:${body}`).digest("hex");
  return new Request(`https://build-a-bot.site${path}`, { method: "POST", headers: { "content-type": contentType, "x-slack-request-timestamp": ts, "x-slack-signature": sig }, body });
}

let eventCount = 0;
async function dm(team: string, user: string, text: string) {
  const res = await events.POST(signed("/api/webhooks/slack/events", JSON.stringify({ type: "event_callback", team_id: team, event_id: `Ev${++eventCount}`, event: { type: "message", channel_type: "im", user, text, ts: "1.2" } })));
  await Promise.all(background.splice(0));
  return res;
}

const slackChannel = async (botId: string) => (await db.select().from(schema.channels).where(eq(schema.channels.botId, botId))).find((c) => c.kind === "slack")!;

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner, stranger] = await db
    .insert(schema.users)
    .values([
      { id: "usr_slack_owner", email: "owner@example.com", emailVerifiedAt: new Date(), timezone: "UTC", name: "Dana", plan: "pro" },
      { id: "usr_slack_stranger", email: "stranger@example.com", emailVerifiedAt: new Date(), timezone: "UTC" },
    ])
    .returning();
});

afterEach(() => {
  vi.unstubAllGlobals();
  session.user = null;
});

afterAll(async () => {
  await resetDbForTests();
});

describe("Add to Slack", () => {
  it("only the owner who started it, signed in, can finish it", async () => {
    const calls = stubSlack();
    const bot = await makeBot(owner, "Juniper");
    const state = await startInstall(owner, bot);

    session.user = stranger;
    const res = await back(state, "code=T1:U_STRANGER");
    expect(new URL(res.headers.get("location")!).searchParams.get("channel_error")).toMatch(/Sign in to Build-a-bot as the bot's owner/);
    expect(calls.some((c) => c.method === "oauth.v2.access")).toBe(false); // the code is never exchanged
    expect((await slackChannel(bot.id)).status).not.toBe("active");

    // The state was used up: the owner can't replay it either.
    session.user = owner;
    const again = await back(state, "code=T1:U_DANA");
    expect(new URL(again.headers.get("location")!).searchParams.get("channel_error")).toMatch(/expired/);
  });

  it("canceling in Slack says so", async () => {
    stubSlack();
    const bot = await makeBot(owner, "Canceled");
    const state = await startInstall(owner, bot);
    session.user = owner;
    const res = await back(state, "error=access_denied");
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe(`/app/bots/${bot.id}/channels`);
    expect(location.searchParams.get("channel_error")).toBe("Slack wasn't added: it was canceled in Slack.");
  });

  it("the person who clicked Allow is the owner on Slack, and the bot says hi with its own name and face", async () => {
    const calls = stubSlack();
    const bot = await makeBot(owner, "Pip");
    const state = await startInstall(owner, bot);
    session.user = owner;
    const res = await back(state, "code=T1:U_DANA");
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe(`/app/bots/${bot.id}/channels`);
    expect(location.searchParams.get("slack")).toBe("added");
    expect(location.hash).toBe("#slack");

    const exchange = calls.find((c) => c.method === "oauth.v2.access")!;
    expect(exchange.auth).toBe(`Basic ${Buffer.from("123.456:client-secret").toString("base64")}`);
    expect(exchange.body).toEqual({ code: "T1:U_DANA", redirect_uri: "https://build-a-bot.site/api/channels/slack/callback" });

    const channel = await slackChannel(bot.id);
    expect(channel).toMatchObject({ status: "active", address: "T1 Inc", ownerAddress: "U_DANA", config: { via: "app", teamId: "T1" } });
    expect(channel.ownerVerifiedAt).toBeTruthy();

    const hello = calls.find((c) => c.method === "chat.postMessage")!;
    expect(hello.auth).toBe("Bearer xoxb-T1-token");
    expect(hello.body).toMatchObject({ channel: "D-U_DANA", username: "Pip", icon_url: "https://build-a-bot.site/avatars/blip-grape.jpg" });
    expect(String(hello.body.text)).toMatch(/^Hi! It's Pip, your AI assistant/);
    // The hello said it's an AI, so the first reply doesn't repeat it.
    const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.botId, bot.id));
    expect(conversation).toMatchObject({ channelKind: "slack", externalId: "U_DANA" });
    expect(conversation.lastDisclosureAt).toBeTruthy();
  });

  it("a DM goes to the sender's own bot, which answers as itself", async () => {
    const calls = stubSlack();
    const res = await dm("T1", "U_DANA", "what's on today?");
    expect(res.status).toBe(200);
    const reply = calls.find((c) => c.method === "chat.postMessage")!;
    expect(reply.body).toMatchObject({ channel: "D-U_DANA", username: "Pip", text: "Pip heard: what's on today?" });
  });

  it("someone without a bot gets one short note a day, and their messages go nowhere", async () => {
    const calls = stubSlack();
    await dm("T1", "U_COWORKER", "hey, who are you?");
    const note = calls.filter((c) => c.method === "chat.postMessage");
    expect(note).toHaveLength(1);
    expect(note[0].body).toMatchObject({ channel: "D-U_COWORKER" });
    expect(String(note[0].body.text)).toMatch(/you don't have one here yet. Make your own for free at https:\/\/build-a-bot.site/);
    expect(note[0].body.username).toBeUndefined();

    await dm("T1", "U_COWORKER", "hello??");
    expect(calls.filter((c) => c.method === "chat.postMessage")).toHaveLength(1);
  });

  it("refuses events without Slack's signature", async () => {
    const body = JSON.stringify({ type: "event_callback", team_id: "T1", event_id: "EvForged", event: { type: "message", channel_type: "im", user: "U_DANA", text: "hi" } });
    const forged = new Request("https://build-a-bot.site/api/webhooks/slack/events", { method: "POST", headers: { "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)), "x-slack-signature": "v0=00" }, body });
    expect((await events.POST(forged)).status).toBe(401);
    const verify = await events.POST(signed("/api/webhooks/slack/events", JSON.stringify({ type: "url_verification", challenge: "c-123" })));
    expect(await verify.json()).toEqual({ challenge: "c-123" });
  });

  it("one bot per person in a workspace: adding another moves Slack to it", async () => {
    const calls = stubSlack();
    const [pip] = await db.select().from(schema.bots).where(eq(schema.bots.name, "Pip"));
    const pipCredential = (await slackChannel(pip.id)).credentialId!;
    const bot = await makeBot(owner, "Moss");
    const state = await startInstall(owner, bot);
    session.user = owner;
    const res = await back(state, "code=T1:U_DANA");
    expect(new URL(res.headers.get("location")!).searchParams.get("moved")).toBe("Pip");

    expect(await slackChannel(pip.id)).toMatchObject({ status: "needs_setup", ownerAddress: null, credentialId: null });
    expect(await db.select().from(schema.credentials).where(eq(schema.credentials.id, pipCredential))).toHaveLength(0);

    calls.length = 0;
    await dm("T1", "U_DANA", "still there?");
    expect(calls.find((c) => c.method === "chat.postMessage")!.body).toMatchObject({ username: "Moss", text: "Moss heard: still there?" });
  });

  it("Approve buttons work only for the bot's owner", async () => {
    stubSlack();
    const [moss] = await db.select().from(schema.bots).where(eq(schema.bots.name, "Moss"));
    await db.insert(schema.approvals).values({
      id: "apr_slack",
      botId: moss.id,
      ownerId: owner.id,
      tool: "send_email",
      title: "Email Sam",
      risk: "medium",
      status: "pending",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const press = (user: string) =>
      interactive.POST(
        signed(
          "/api/webhooks/slack/interactive",
          new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", team: { id: "T1" }, user: { id: user }, actions: [{ value: `ap:${approvalButtonToken("apr_slack", "approve")}` }] }) }).toString(),
          "application/x-www-form-urlencoded",
        ),
      );
    expect(await (await press("U_COWORKER")).json()).toEqual({ text: "Only the bot's owner can approve this." });
    expect((await db.select().from(schema.approvals).where(eq(schema.approvals.id, "apr_slack")))[0].status).toBe("pending");

    expect((await press("U_DANA")).status).toBe(200);
    expect((await db.select().from(schema.approvals).where(eq(schema.approvals.id, "apr_slack")))[0].status).not.toBe("pending");
  });

  it("a revoked token that's no longer in use changes nothing", async () => {
    stubSlack();
    const [moss] = await db.select().from(schema.bots).where(eq(schema.bots.name, "Moss"));
    const res = await events.POST(signed("/api/webhooks/slack/events", JSON.stringify({ type: "event_callback", team_id: "T1", event_id: "EvOldToken", event: { type: "tokens_revoked", tokens: { bot: ["UBOT"] } } })));
    expect(res.status).toBe(200);
    expect(await slackChannel(moss.id)).toMatchObject({ status: "active", ownerAddress: "U_DANA" });
  });

  it("removing the app in Slack turns Slack off for every bot in that workspace", async () => {
    stubSlack();
    revoked.add("T1");
    const [moss] = await db.select().from(schema.bots).where(eq(schema.bots.name, "Moss"));
    const res = await events.POST(signed("/api/webhooks/slack/events", JSON.stringify({ type: "event_callback", team_id: "T1", event_id: "EvGone", event: { type: "app_uninstalled" } })));
    expect(res.status).toBe(200);
    expect(await slackChannel(moss.id)).toMatchObject({ status: "needs_setup", ownerAddress: null, credentialId: null });
    const receipts = await db.select().from(schema.receipts).where(eq(schema.receipts.botId, moss.id));
    expect(receipts.some((r) => r.title === "Removed from Slack (T1 Inc)")).toBe(true);
  });
});

describe("a bot's own Slack app", () => {
  it("replies with the bot token, not the stored keys", async () => {
    const calls = stubSlack();
    const bot = await makeBot(owner, "Fern");
    const tokens = await channelAction(db, owner, bot, "slack", "tokens", { botToken: "xoxb-own-token", signingSecret: "own-signing-secret-123" });
    expect(tokens.ok).toBe(true);
    const code = String(tokens.ok && tokens.data?.code);
    const channel = await slackChannel(bot.id);
    expect(channel.config).toEqual({ via: "own" });

    const body = JSON.stringify({ type: "event_callback", event_id: "EvOwn1", event: { type: "message", channel_type: "im", user: "U_FERN_OWNER", text: `link ${code}`, ts: "1.3" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = "v0=" + crypto.createHmac("sha256", "own-signing-secret-123").update(`v0:${ts}:${body}`).digest("hex");
    const req = new Request(`https://build-a-bot.site/api/webhooks/slack/${channel.id}/events`, { method: "POST", headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig }, body });
    expect((await ownEvents.POST(req, { params: Promise.resolve({ channelId: channel.id }) })).status).toBe(200);
    await Promise.all(background.splice(0));

    expect(await slackChannel(bot.id)).toMatchObject({ status: "active", ownerAddress: "U_FERN_OWNER" });
    const reply = calls.find((c) => c.method === "chat.postMessage")!;
    expect(reply.auth).toBe("Bearer xoxb-own-token");
    expect(reply.body.username).toBeUndefined(); // its own app already has its name
  });
});

describe("creating the shared app in Slack", () => {
  it("Slack's URL check is answered before the signing secret is in the settings; nothing else is", async () => {
    const saved = process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_SIGNING_SECRET;
    vi.resetModules();
    try {
      const fresh = await import("@/app/api/webhooks/slack/events/route");
      const post = (body: unknown) => fresh.POST(new Request("https://build-a-bot.site/api/webhooks/slack/events", { method: "POST", body: JSON.stringify(body) }));
      expect(await (await post({ type: "url_verification", challenge: "c-9" })).json()).toEqual({ challenge: "c-9" });
      expect((await post({ type: "event_callback", team_id: "T1", event_id: "EvEarly", event: { type: "app_uninstalled" } })).status).toBe(404);
    } finally {
      process.env.SLACK_SIGNING_SECRET = saved;
    }
  });
});
