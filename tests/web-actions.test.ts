/**
 * Web actions (beta) in demo mode, on a real in-memory Postgres with the demo brain:
 * the code-level safety checks, the three browser tools, and the agent flow — filling
 * runs, sending always waits for the owner's tap (even under Full faith), and
 * approving sends exactly the previewed form, once.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
delete process.env.DATABASE_URL;
delete process.env.TOKEN_FACTORY_API_KEY;
delete process.env.BROWSER_USE_API_KEY;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { runTurn } = await import("@/lib/agent/run");
const { decideApproval } = await import("@/lib/agent/approvals");
const { ensureConversation } = await import("@/lib/channels/outbound");
const { buildToolset } = await import("@/lib/tools/registry");
const { webBrowse, webFormFill, webFormSubmit } = await import("@/lib/tools/builtin/browser");
const { getConnector, isBuiltinConnector } = await import("@/lib/connectors");
const safety = await import("@/lib/web-actions/safety");
const { readWebFormPreview } = await import("@/lib/web-actions/types");
const { getWebSession } = await import("@/lib/web-actions/store");
const { createBrowserUseProvider } = await import("@/lib/web-actions/browser-use");
import type { Bot, User } from "@/lib/db/schema";
import type { ToolContext } from "@/lib/tools/types";

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

async function makeBot(trust: "look" | "ask" | "trusted" | "full", connectors: string[] = ["browser"]): Promise<Bot> {
  const res = await createBot(db, owner, {
    avatar: "blip",
    color: "grape",
    name: `Web ${trust}`,
    jobs: ["errands"],
    brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors,
    trust,
    channels: [],
    contact: {},
    ageConfirmed: true,
    timezone: "America/Chicago",
  });
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

async function say(bot: Bot, text: string, opts: { startTainted?: boolean } = {}) {
  const conversation = await ensureConversation(db, bot.id, "web", "owner");
  const [fresh] = await db.select().from(schema.bots).where(eq(schema.bots.id, bot.id));
  return runTurn({ db, bot: fresh, owner, conversation, channelKind: "web", message: { text, author: "owner" }, startTainted: opts.startTainted });
}

function ctxFor(bot: Bot): ToolContext {
  return { db, bot, owner, conversationId: null, channelKind: "web", demo: true, now: new Date() };
}

function sessionIdIn(content: string): string {
  const id = /session_id: (wss_[a-z0-9]+)/.exec(content)?.[1];
  if (!id) throw new Error(`no session id in: ${content}`);
  return id;
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db
    .insert(schema.users)
    .values({ id: "usr_web", email: "dana@example.org", emailVerifiedAt: new Date(), name: "Dana Rivera", timezone: "America/Chicago", plan: "pro" })
    .returning();
});

afterAll(async () => {
  await resetDbForTests();
});

describe("web actions: safety checks in code", () => {
  it("opens only public http(s) pages", async () => {
    for (const bad of ["http://127.0.0.1/admin", "http://localhost:3000/api", "http://169.254.169.254/latest/meta-data", "http://10.0.0.7/", "file:///etc/passwd", "javascript:alert(1)"]) {
      await expect(safety.checkUrl(bad), bad).rejects.toThrow();
    }
    const ok = await safety.checkUrl("www.Example.com/contact");
    expect(ok.url.toString()).toBe("https://www.example.com/contact");
    expect(ok.site).toBe("example.com");
  });

  it("refuses payments, card numbers, passwords and secrets", () => {
    const url = new URL("https://example.com/contact");
    const name = { field: "Name", value: "Dana" };
    expect(safety.refuseForm(url, [name, { field: "Card number", value: "4242 4242 4242 4242" }])).toBe(safety.REFUSAL.payment);
    expect(safety.refuseForm(url, [name, { field: "Notes", value: "use 4242424242424242 please" }])).toBe(safety.REFUSAL.payment);
    expect(safety.refuseForm(new URL("https://shop.example.com/checkout"), [name])).toBe(safety.REFUSAL.payment);
    expect(safety.refuseForm(url, [name], "then place the order")).toBe(safety.REFUSAL.payment);
    expect(safety.refuseForm(url, [name, { field: "Password", value: "hunter2" }])).toBe(safety.REFUSAL.login);
    expect(safety.refuseForm(url, [name, { field: "One-time code", value: "123456" }])).toBe(safety.REFUSAL.login);
    expect(safety.refuseForm(url, [name, { field: "SSN", value: "123-45-6789" }])).toBe(safety.REFUSAL.secret);
    expect(safety.refuseForm(url, [name, { field: "Notes", value: `key ${["sk", "live", "x".repeat(30)].join("_")}` }])).toBe(safety.REFUSAL.secret);
    // An ordinary contact form, a phone number and a postal "PIN code" are fine.
    expect(
      safety.refuseForm(url, [name, { field: "Phone", value: "(555) 010-4477" }, { field: "PIN code", value: "560001" }, { field: "Message", value: "I'd like to buy 20 chairs." }]),
    ).toBeNull();
    expect(safety.refuseRead(url, "log in to my account and check my balance")).toBe(safety.REFUSAL.login);
    expect(safety.refuseRead(url, "buy me two tickets for Friday")).toBe(safety.REFUSAL.payment);
    expect(safety.refuseRead(url, "what are the opening hours on Saturday?")).toBeNull();
  });

  it("fills in the owner's own details from their account", () => {
    const res = safety.resolvePlaceholders(
      [
        { field: "Full name", value: "{{my_name}}" },
        { field: "First name", value: "{{ my_first_name }}" },
        { field: "Last name", value: "{{my_last_name}}" },
        { field: "Email", value: "{{my_email}}" },
      ],
      owner,
    );
    expect(res).toEqual({
      ok: true,
      fields: [
        { field: "Full name", value: "Dana Rivera" },
        { field: "First name", value: "Dana" },
        { field: "Last name", value: "Rivera" },
        { field: "Email", value: "dana@example.org" },
      ],
    });
    expect(safety.resolvePlaceholders([{ field: "X", value: "{{my_password}}" }], owner).ok).toBe(false);
    expect(safety.resolvePlaceholders([{ field: "Email", value: "{{my_email}}" }], { name: "Dana", email: null }).ok).toBe(false);
  });
});

describe("web actions: tools (simulated browser)", () => {
  // Shared: the Pro plan allows 10 bots, and receipts (append-only) make bots costly to delete.
  let bot: Bot;
  let other: Bot;
  beforeAll(async () => {
    bot = await makeBot("full");
    other = await makeBot("full");
  });

  it("the connector is a beta built-in: browse (read), fill (write) and submit (send, always asks)", () => {
    const def = getConnector("browser")!;
    expect(def.status).toBe("beta");
    expect(isBuiltinConnector(def)).toBe(true);
    expect(def.capabilities.map((c) => [c.id, c.effect, c.risk])).toEqual([
      ["browse", "read", "low"],
      ["fill_forms", "write", "medium"],
      ["submit_forms", "send", "high"],
    ]);
    expect([webBrowse.effect, webBrowse.risk, webBrowse.taints]).toEqual(["read", "low", true]);
    expect([webFormFill.effect, webFormFill.risk, webFormFill.taints]).toEqual(["write", "medium", true]);
    expect([webFormSubmit.effect, webFormSubmit.risk, webFormSubmit.alwaysAsk]).toEqual(["send", "high", true]);
    for (const t of [webBrowse, webFormFill, webFormSubmit]) expect(t.effect).not.toBe("spend");
  });

  it("web_browse reads a site and cites it", async () => {
    const out = await webBrowse.run({ url: "https://example.com", task: "What are the opening hours?" }, ctxFor(bot));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.content).toMatch(/Monday–Friday/);
    expect(out.content).toMatch(/Simulated/);
    expect(out.sources?.[0]?.url).toBe("https://example.com/");
    const blocked = await webBrowse.run({ url: "http://localhost:3000/admin", task: "read it" }, ctxFor(bot));
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/private/) });
  });

  it("web_form_fill fills without sending, and stores exactly what was typed with a safe preview", async () => {
    const out = await webFormFill.run(
      {
        url: "https://example.com/contact",
        fields: [
          { field: "Name", value: "{{my_name}}" },
          { field: "Email", value: "{{my_email}}" },
          { field: "Message", value: "Quote for 20 chairs <script>alert(1)</script>" },
        ],
      },
      ctxFor(bot),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.content).toMatch(/NOT sent/);
    const session = await getWebSession(db, bot.id, sessionIdIn(out.content));
    expect(session).not.toBeNull();
    expect(session!.usedAt).toBeNull();
    expect(session!.site).toBe("example.com");
    expect(session!.fields).toEqual([
      { label: "Name", value: "Dana Rivera" },
      { label: "Email", value: "dana@example.org" },
      { label: "Message", value: "Quote for 20 chairs <script>alert(1)</script>" },
    ]);
    expect(session!.previewDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(session!.previewDataUrl!.split(",")[1], "base64").toString("utf8");
    expect(svg).toContain("Dana Rivera");
    expect(svg).toContain("not sent");
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;script&gt;");
    // Another bot can't see it.
    expect(await getWebSession(db, other.id, session!.id)).toBeNull();
  });

  it("web_form_fill refuses payment and login forms before any browser opens", async () => {
    const sessions = () => db.select().from(schema.pairingCodes).where(and(eq(schema.pairingCodes.botId, bot.id), eq(schema.pairingCodes.purpose, "web_session")));
    const before = (await sessions()).length;
    const card = await webFormFill.run({ url: "https://example.com/order", fields: [{ field: "Card number", value: "4242 4242 4242 4242" }] }, ctxFor(bot));
    expect(card).toMatchObject({ ok: false, error: safety.REFUSAL.payment });
    const login = await webFormFill.run({ url: "https://example.com/login", fields: [{ field: "Email", value: "{{my_email}}" }] }, ctxFor(bot));
    expect(login).toMatchObject({ ok: false, error: safety.REFUSAL.login });
    expect(await sessions()).toHaveLength(before);
  });

  it("web_form_submit sends a filled form once, and never an expired or someone else's", async () => {
    const fill = async () => {
      const out = await webFormFill.run({ url: "https://example.com/contact", fields: [{ field: "Name", value: "{{my_name}}" }] }, ctxFor(bot));
      if (!out.ok) throw new Error(out.error);
      return sessionIdIn(out.content);
    };
    const id = await fill();
    const sent = await webFormSubmit.run({ session_id: id }, ctxFor(bot));
    expect(sent).toMatchObject({ ok: true, content: expect.stringMatching(/Sent the form on example\.com/) });
    expect(await webFormSubmit.run({ session_id: id }, ctxFor(bot))).toMatchObject({ ok: false, error: expect.stringMatching(/already sent/) });
    expect((await getWebSession(db, bot.id, id))?.submitted?.ok).toBe(true);

    expect(await webFormSubmit.run({ session_id: await fill() }, ctxFor(other))).toMatchObject({ ok: false, error: expect.stringMatching(/can't find/) });

    const stale = await fill();
    await db.update(schema.pairingCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.pairingCodes.code, stale));
    expect(await webFormSubmit.run({ session_id: stale }, ctxFor(bot))).toMatchObject({ ok: false, error: expect.stringMatching(/closed/) });
  });
});

describe("web actions: the agent flow (demo brain)", () => {
  it("Full faith: filling runs, sending still waits for a tap, and approving sends exactly the preview", async () => {
    const bot = await makeBot("full");
    const res = await say(bot, "Fill out the contact form on example.com with my name and email saying I'd like a quote for 20 chairs");
    expect(res.approvals).toHaveLength(1);
    const approval = res.approvals[0];
    expect(approval.tool).toBe("web_form_submit");
    expect(approval.reasons).toContain("always_ask");
    expect(approval.risk).toBe("high");
    expect(approval.title).toBe("Send the form on example.com");
    expect(approval.detail).toContain("Sends to: example.com");
    expect(approval.detail).toContain("Name: Dana Rivera");

    const preview = readWebFormPreview(approval.args);
    expect(preview).not.toBeNull();
    expect(preview!.site).toBe("example.com");
    expect(preview!.url).toBe("https://example.com/contact");
    expect(preview!.simulated).toBe(true);
    expect(preview!.image).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(preview!.fields).toEqual([
      { label: "Name", value: "Dana Rivera" },
      { label: "Email", value: "dana@example.org" },
      { label: "Message", value: "I'd like a quote for 20 chairs." },
    ]);
    // The approval lives only as long as the cloud browser holding the form.
    expect(approval.expiresAt.getTime()).toBe(new Date(preview!.expiresAt).getTime());
    expect(approval.expiresAt.getTime()).toBeLessThan(Date.now() + 2 * 60 * 60_000);
    expect(res.text).toMatch(/not sent/i);

    // Filled, not sent.
    const sessionId = approval.args.session_id as string;
    expect((await getWebSession(db, bot.id, sessionId))?.usedAt).toBeNull();
    const toolReceipts = await db.select().from(schema.receipts).where(and(eq(schema.receipts.botId, bot.id), eq(schema.receipts.kind, "tool")));
    expect(toolReceipts.map((r) => [r.detail.tool, r.status])).toEqual([["web_form_fill", "ok"]]);

    const decided = await decideApproval(db, { approvalId: approval.id, ownerId: owner.id, decision: "approve", via: "web" });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.approval.status).toBe("executed");
    expect((decided.approval.result as { text: string }).text).toMatch(/Sent the form on example\.com/);
    expect(decided.followUp).toMatch(/Sent!/);
    const after = await getWebSession(db, bot.id, sessionId);
    expect(after?.usedAt).not.toBeNull();
    expect(after?.submitted?.ok).toBe(true);
    const sites = await db.select().from(schema.contacts).where(and(eq(schema.contacts.botId, bot.id), eq(schema.contacts.kind, "website")));
    expect(sites.map((c) => c.address)).toEqual(["example.com"]);
    // A double tap can't send it twice.
    expect((await decideApproval(db, { approvalId: approval.id, ownerId: owner.id, decision: "approve", via: "web" })).ok).toBe(false);
  });

  it("Trusted helper asks before typing into a new site, then asks again before sending", async () => {
    const bot = await makeBot("trusted");
    const first = await say(bot, "Please fill out the contact form on example.com with my name and email");
    expect(first.approvals).toHaveLength(1);
    const fillApproval = first.approvals[0];
    expect(fillApproval.tool).toBe("web_form_fill");
    expect(fillApproval.reasons).toContain("new_recipient");
    // The card shows (and the approval pins) the owner's real details, not placeholders.
    expect(fillApproval.detail).toContain("Email: dana@example.org");
    expect(JSON.stringify(fillApproval.args)).not.toContain("{{");
    const filled = await decideApproval(db, { approvalId: fillApproval.id, ownerId: owner.id, decision: "approve", via: "web" });
    expect(filled.ok && filled.approval.status).toBe("executed");
    expect(filled.ok && filled.followUp).toMatch(/nothing's sent yet/);

    const second = await say(bot, "Looks right, submit it");
    expect(second.approvals).toHaveLength(1);
    const sendApproval = second.approvals[0];
    expect(sendApproval.tool).toBe("web_form_submit");
    expect(sendApproval.reasons).toContain("always_ask");
    expect(readWebFormPreview(sendApproval.args)?.fields).toEqual([
      { label: "Name", value: "Dana Rivera" },
      { label: "Email", value: "dana@example.org" },
    ]);
    const sent = await decideApproval(db, { approvalId: sendApproval.id, ownerId: owner.id, decision: "approve", via: "web" });
    expect(sent.ok && sent.approval.status).toBe("executed");

    // Nothing left to send: the card says so, and approving sends nothing.
    const again = await say(bot, "submit it again");
    expect(again.approvals[0]?.title).toBe("Send a web form (nothing waiting)");
    const noop = await decideApproval(db, { approvalId: again.approvals[0].id, ownerId: owner.id, decision: "approve", via: "web" });
    expect(noop.ok && noop.approval.status).toBe("failed");
  });

  it("prompt-injection guard: after reading outside content, filling a form on a new site asks first, even under Full faith", async () => {
    const bot = await makeBot("full");
    const res = await say(bot, "fill out the form on https://contest-prizes.biz/claim with my name and email", { startTainted: true });
    expect(res.approvals).toHaveLength(1);
    expect(res.approvals[0].tool).toBe("web_form_fill");
    expect(res.approvals[0].reasons).toContain("tainted_send_new_recipient");
    const rows = await db.select().from(schema.pairingCodes).where(eq(schema.pairingCodes.botId, bot.id));
    expect(rows).toHaveLength(0);
  });

  it("reading a site runs on its own and answers from it", async () => {
    const bot = await makeBot("trusted");
    const res = await say(bot, "find the opening hours on example.com");
    expect(res.approvals).toHaveLength(0);
    expect(res.text).toMatch(/Monday–Friday/);
    const receipts = await db.select().from(schema.receipts).where(and(eq(schema.receipts.botId, bot.id), eq(schema.receipts.kind, "tool")));
    expect(receipts.map((r) => [r.detail.tool, r.status])).toEqual([["web_browse", "ok"]]);
  });

  it("Look only bots can browse, but can't fill in or send forms", async () => {
    const bot = await makeBot("look");
    const toolset = await buildToolset(ctxFor(bot));
    const names = toolset.tools.map((t) => t.name);
    expect(names).toContain("web_browse");
    expect(names).not.toContain("web_form_fill");
    expect(names).not.toContain("web_form_submit");
  });
});

describe("web actions: Browser Use provider (mocked API)", () => {
  const BASE = "https://api.browser-use.test/api/v2";
  const provider = createBrowserUseProvider({ apiKey: "bu_test_key", baseUrl: BASE });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  type Call = { method: string; path: string; body?: Record<string, unknown>; headers: Record<string, string> };

  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  function fakeApi(route: (c: Call) => Response | undefined): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const c: Call = {
          method: init?.method ?? "GET",
          path: url.startsWith(BASE) ? url.slice(BASE.length) : url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        };
        calls.push(c);
        return route(c) ?? json({ detail: `unexpected ${c.method} ${c.path}` }, 500);
      }),
    );
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fill: a keep-alive session, a task locked to the site, structured output, and a copied screenshot", async () => {
    const calls = fakeApi((c) => {
      if (c.method === "POST" && c.path === "/sessions") return json({ id: "sess_1", status: "active", liveUrl: "https://live.browser-use.test/sess_1" });
      if (c.method === "POST" && c.path === "/tasks") return json({ id: "task_1", sessionId: "sess_1" });
      if (c.path === "/tasks/task_1/status") {
        const output = { filled: [{ label: "Name", value: "Dana Rivera" }], readyToSubmit: true, pageUrl: "https://example.com/contact", pageTitle: "Contact us", blocker: "none" };
        return json({ id: "task_1", status: "finished", output: JSON.stringify(output), cost: "0.07" });
      }
      if (c.path === "/tasks/task_1") return json({ id: "task_1", status: "finished", steps: [{ number: 1, url: "https://example.com/contact", screenshotUrl: "https://shots.browser-use.test/1.png" }] });
      if (c.path === "https://shots.browser-use.test/1.png") return new Response(png, { headers: { "content-type": "application/octet-stream" } });
      return undefined;
    });
    const res = await provider.fill({ url: "https://example.com/contact", site: "example.com", fields: [{ field: "Name", value: "Dana Rivera" }] });
    expect(res).toMatchObject({
      ok: true,
      providerSessionId: "sess_1",
      url: "https://example.com/contact",
      title: "Contact us",
      filled: [{ label: "Name", value: "Dana Rivera" }],
      liveUrl: "https://live.browser-use.test/sess_1",
      costUsd: 0.07,
    });
    expect(res.ok && res.screenshot?.contentType).toBe("image/png");

    const [session, task] = calls;
    expect(session.headers["x-browser-use-api-key"]).toBe("bu_test_key");
    expect(session.body).toMatchObject({ keepAlive: true, persistMemory: true, startUrl: "https://example.com/contact" });
    expect(task.body).toMatchObject({ sessionId: "sess_1", startUrl: "https://example.com/contact", allowedDomains: ["example.com", "*.example.com"] });
    expect(JSON.parse(String(task.body?.structuredOutput)).required).toContain("readyToSubmit");
    expect(task.body?.systemPromptExtension).toMatch(/Never pay/);
    expect(task.body?.systemPromptExtension).toMatch(/Never press the button that sends the form/);
    expect(task.body?.task).toContain('"Name" → "Dana Rivera"');
    // Left open for the submit step.
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("fill: a login wall stops and closes the browser", async () => {
    const calls = fakeApi((c) => {
      if (c.method === "POST" && c.path === "/sessions") return json({ id: "sess_2", status: "active" });
      if (c.method === "POST" && c.path === "/tasks") return json({ id: "task_2", sessionId: "sess_2" });
      if (c.path === "/tasks/task_2/status") return json({ id: "task_2", status: "finished", output: JSON.stringify({ filled: [], readyToSubmit: false, blocker: "login" }) });
      if (c.method === "PATCH" && c.path === "/sessions/sess_2") return json({ id: "sess_2", status: "stopped" });
      return undefined;
    });
    const res = await provider.fill({ url: "https://example.com/apply", site: "example.com", fields: [{ field: "Name", value: "Dana" }] });
    expect(res).toMatchObject({ ok: false, blocker: "login" });
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "/sessions/sess_2", body: { action: "stop" } });
  });

  it("submit: a follow-up task in the same session re-checks the values, sends once, then closes", async () => {
    const calls = fakeApi((c) => {
      if (c.method === "GET" && c.path === "/sessions/sess_1") return json({ id: "sess_1", status: "active" });
      if (c.method === "POST" && c.path === "/tasks") return json({ id: "task_3", sessionId: "sess_1" });
      if (c.path === "/tasks/task_3/status") return json({ id: "task_3", status: "finished", output: JSON.stringify({ submitted: true, confirmation: "Thanks! We got it.", blocker: "none" }) });
      if (c.method === "PATCH" && c.path === "/sessions/sess_1") return json({ id: "sess_1", status: "stopped" });
      return undefined;
    });
    const res = await provider.submit({ providerSessionId: "sess_1", url: "https://example.com/contact", site: "example.com", fields: [{ label: "Name", value: "Dana Rivera" }] });
    expect(res).toMatchObject({ ok: true, confirmation: "Thanks! We got it.", url: "https://example.com/contact" });
    const task = calls.find((c) => c.method === "POST")!;
    expect(task.body).toMatchObject({ sessionId: "sess_1", allowedDomains: ["example.com", "*.example.com"] });
    expect(task.body).not.toHaveProperty("startUrl");
    expect(task.body?.task).toContain('"Name" → "Dana Rivera"');
    expect(task.body?.systemPromptExtension).toMatch(/at most once/);
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "/sessions/sess_1", body: { action: "stop" } });
  });

  it("submit: a closed browser sends nothing", async () => {
    const calls = fakeApi((c) => (c.method === "GET" && c.path === "/sessions/sess_9" ? json({ id: "sess_9", status: "stopped" }) : undefined));
    const res = await provider.submit({ providerSessionId: "sess_9", url: "https://example.com/contact", site: "example.com", fields: [{ label: "Name", value: "Dana" }] });
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/closed.*nothing was sent/i) });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("read: retries a rate limit, ignores off-site links in the answer, and closes the browser", async () => {
    let posts = 0;
    const calls = fakeApi((c) => {
      if (c.method === "POST" && c.path === "/tasks") return ++posts === 1 ? json({ detail: "slow down" }, 429) : json({ id: "task_4", sessionId: "sess_4" });
      if (c.path === "/tasks/task_4/status") {
        return json({ id: "task_4", status: "finished", output: JSON.stringify({ found: true, answer: "Open 9am–5pm on weekdays.", pageUrl: "https://elsewhere.test/hours", blocker: "none" }) });
      }
      if (c.method === "PATCH" && c.path === "/sessions/sess_4") return json({ id: "sess_4", status: "stopped" });
      return undefined;
    });
    const res = await provider.read({ url: "https://example.com/", site: "example.com", task: "opening hours" });
    expect(res).toMatchObject({ ok: true, found: true, answer: "Open 9am–5pm on weekdays.", url: "https://example.com/" });
    const task = calls.filter((c) => c.method === "POST")[1];
    expect(task.body).toMatchObject({ startUrl: "https://example.com/", allowedDomains: ["example.com", "*.example.com"] });
    expect(task.body).not.toHaveProperty("sessionId");
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "/sessions/sess_4" });
  });
});
