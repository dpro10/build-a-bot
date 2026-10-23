/**
 * The bot does what it says, or says it didn't.
 *  - An included model thinks before any answer that can use tools, whatever the effort: with its
 *    thinking off, Nemotron Lightning said "I'll remind you at 6" without setting anything.
 *  - An answer that says it set a reminder, saved something, added an event or sent a message,
 *    when no tool did that this turn, is checked once: the model does it or says it can't, and
 *    that answer replaces the first. If it still claims it, the owner is told plainly.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.DATA_DIR = "memory";
process.env.DEMO_MODE = "1";
process.env.TOKEN_FACTORY_API_KEY = "tf-test-key";
delete process.env.DATABASE_URL;

const { getDb, resetDbForTests, schema } = await import("@/lib/db");
const { createBot } = await import("@/lib/bots/create");
const { runTurn } = await import("@/lib/agent/run");
const { unbackedClaims, withClaimTruth } = await import("@/lib/agent/claims");
const { ensureConversation } = await import("@/lib/channels/outbound");
const { INCLUDED_MODELS, includedRequestOptions } = await import("@/lib/models/catalog");
import type { Bot, MessagePart, User } from "@/lib/db/schema";

const model = (id: string) => INCLUDED_MODELS.find((m) => m.id === id)!;

describe("thinking, by effort and by whether the request offers tools", () => {
  it("Nemotron Lightning: Quick answers without thinking only when there are no tools", () => {
    const lightning = model("nvidia/Nemotron-3_5-Lightning");
    expect(includedRequestOptions(lightning, "low")).toEqual({ extra: { reasoning_effort: "none" }, maxTokens: 4096 });
    expect(includedRequestOptions(lightning, "low", { tools: true })).toEqual({ extra: { reasoning_effort: "high" }, maxTokens: 8192 });
    expect(includedRequestOptions(lightning, "medium", { tools: true })).toEqual({ extra: { reasoning_effort: "high" }, maxTokens: 8192 });
    expect(includedRequestOptions(lightning, "high")).toEqual({ extra: { reasoning_effort: "high" }, maxTokens: 16384 });
  });

  it("other models take their lightest thinking; a model that can't think is left alone", () => {
    expect(includedRequestOptions(model("deepseek-ai/DeepSeek-V4-Flash-0731"), "low", { tools: true }).extra).toEqual({ reasoning_effort: "low" });
    expect(includedRequestOptions(model("moonshotai/Kimi-K3"), "low", { tools: true }).extra).toEqual({ reasoning_effort: "low" });
    expect(includedRequestOptions(model("nvidia/nemotron-3-super-120b-a12b"), "low", { tools: true }).extra).toEqual({ chat_template_kwargs: { enable_thinking: true } });
    expect(includedRequestOptions(model("nvidia/nemotron-3-super-120b-a12b"), "low").extra).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(includedRequestOptions(model("Qwen/Qwen3-30B-A3B-Instruct-2507"), "low", { tools: true })).toEqual({ extra: {}, maxTokens: 4096 });
  });
});

// ---------------------------------------------------------------------------

const TOOLS = {
  byName: new Map(
    [
      { name: "create_reminder", effect: "write", connectorId: "reminders" },
      { name: "schedule_routine", effect: "write", connectorId: "reminders" },
      { name: "list_reminders", effect: "read", connectorId: "reminders" },
      { name: "cancel_reminder", effect: "write", connectorId: "reminders" },
      { name: "remember", effect: "write", connectorId: "memory" },
      { name: "recall", effect: "read", connectorId: "memory" },
      { name: "message_owner", effect: "send", connectorId: "memory" },
    ].map((t) => [t.name, t as never]),
  ),
};
const WITH_CALENDAR = {
  byName: new Map([...TOOLS.byName, ["GOOGLECALENDAR_CREATE_EVENT", { name: "GOOGLECALENDAR_CREATE_EVENT", effect: "write", connectorId: "google_calendar" } as never], ["GOOGLECALENDAR_FIND_EVENT", { name: "GOOGLECALENDAR_FIND_EVENT", effect: "read", connectorId: "google_calendar" } as never]]),
};
const ran = (...results: [string, string][]): MessagePart[] => results.map(([name, status], i) => ({ type: "tool_result", id: String(i), name, status }) as MessagePart);
const kinds = (answer: string, asked: string | null = null, parts: MessagePart[] = [], tools = TOOLS) => unbackedClaims(answer, asked, parts, tools).map((u) => u.kind);

describe("what counts as saying it was done", () => {
  it("reminders it says it set (Nemotron's own words, and others)", () => {
    for (const answer of [
      "Got it! I'll remind you to call your mom at 6:00 PM.",
      "Done. I've set a reminder for 6 PM to call your mom.",
      "I set up a daily routine to send you the weather at 8 AM.",
      "Your reminder is all set for 6 PM.",
      "Reminder set: call Mom, 6:00 PM.",
      "You'll get a reminder at 6 PM.",
      "I’ll text you at 6 PM so you don’t forget.",
      "After your 5 PM meeting, I'll remind you to call Sam.",
    ]) {
      expect(kinds(answer), answer).toEqual(["schedule"]);
    }
  });

  it("…but not a question back, a can't, an offer, or one the tool backs", () => {
    for (const answer of [
      "What time should I remind you?",
      "6:00 PM today has already passed. Would you like me to set this reminder for tomorrow at 6:00 PM instead?",
      "I can't set reminders right now.",
      "If you tell me the time, I'll remind you.",
      "I'll remind you if you give me a time.",
      "Want me to set a reminder for that?",
      "To be clear: no reminder was set.",
    ]) {
      expect(kinds(answer), answer).toEqual([]);
    }
    expect(kinds("Done. I've set a reminder for 6 PM.", null, ran(["create_reminder", "ok"]))).toEqual([]);
    expect(kinds("That time passed, so I set it for tomorrow at 6 PM instead.", null, ran(["create_reminder", "error"], ["create_reminder", "ok"]))).toEqual([]);
    // A reminder that failed backs nothing.
    expect(kinds("Done. I've set a reminder for 6 PM.", null, ran(["create_reminder", "error"]))).toEqual(["schedule"]);
  });

  it("describing what's there after listing it isn't a claim; saying it set one still is", () => {
    expect(kinds("You have one: your reminder to call Mom is set for 6 PM.", null, ran(["list_reminders", "ok"]))).toEqual([]);
    expect(kinds("I've set a reminder for 6 PM.", null, ran(["list_reminders", "ok"]))).toEqual(["schedule"]);
  });

  it("saved, noted, remembered", () => {
    expect(kinds("Got it. I've noted that you need to buy milk and eggs. I'll keep this in mind.")).toEqual(["memory"]);
    expect(kinds("Noted! Your sister's birthday is May 4.")).toEqual(["memory"]);
    expect(kinds("I'll remember that.")).toEqual(["memory"]);
    expect(kinds("Got it. I've saved that your sister's birthday is May 4.", null, ran(["remember", "ok"]))).toEqual([]);
    expect(kinds("Your sister's birthday is May 4, as you told me in March.", null, ran(["recall", "ok"]))).toEqual([]);
    expect(kinds("I've saved your file to the Library, so I can read it any time.")).toEqual([]);
  });

  it("the calendar: with no calendar app, any “added to your calendar” is untrue", () => {
    expect(kinds("I've added the dentist appointment on Friday at 3 PM to your calendar.")).toEqual(["calendar"]);
    expect(kinds("Done! It's on your calendar for Friday at 3.")).toEqual(["calendar"]);
    expect(kinds("I don't have a tool to add events to your calendar. Want a reminder instead?")).toEqual([]);
    expect(kinds("Once you connect Google Calendar, anything I schedule will be added to your calendar.")).toEqual([]);
    expect(kinds("I've added it to your calendar for Friday at 3 PM.", null, ran(["GOOGLECALENDAR_CREATE_EVENT", "ok"]), WITH_CALENDAR)).toEqual([]);
    expect(kinds("Here's what is on your calendar Friday: the dentist at 3.", null, ran(["GOOGLECALENDAR_FIND_EVENT", "ok"]), WITH_CALENDAR)).toEqual([]);
    expect(kinds("I've added it to your calendar.", null, ran(["GOOGLECALENDAR_FIND_EVENT", "ok"]), WITH_CALENDAR)).toEqual(["calendar"]);
    expect(kinds("Scheduled on your calendar this week: the dentist, Friday at 3.", null, ran(["GOOGLECALENDAR_FIND_EVENT", "ok"]), WITH_CALENDAR)).toEqual([]);
  });

  it("what it quotes is someone else's words, not a claim", () => {
    expect(kinds("From the call:\n[0:30] Dana: I'll set up a check-in for next Tuesday.\n\nWant reminders for any of them?")).toEqual([]);
    expect(kinds('Here\'s a draft: "Hi Sam, I\'ve sent the deck and set a reminder for Friday." Want me to send it?')).toEqual([]);
    expect(kinds("> I've added the launch to your calendar.\n\nThat's what Priya wrote.")).toEqual([]);
    expect(kinds("<untrusted_content source=\"Gmail\">I've emailed the team.</untrusted_content>\nThat's the latest email.")).toEqual([]);
  });

  it("sends and cancels", () => {
    expect(kinds("I've texted Sam that you're running late.")).toEqual(["send"]);
    expect(kinds("I've let Diego know.", null, ran(["message_owner", "ok"]))).toEqual([]);
    expect(kinds("I've cancelled your 6 PM reminder.")).toEqual(["cancel"]);
    expect(kinds("I've cancelled your 6 PM reminder.", null, ran(["cancel_reminder", "ok"]))).toEqual([]);
  });

  it("an answer that goes without doing what was plainly asked", () => {
    expect(kinds("Okay, 6 PM, call Mom. Talk soon!", "Remind me to call my mom at 6:00 PM.")).toEqual(["schedule"]);
    expect(kinds("Sure thing.", "Set a timer for 10 minutes.")).toEqual(["schedule"]);
    expect(kinds("Sounds good!", "Every weekday at 8am, send me the weather in Austin.")).toEqual(["schedule"]);
    expect(kinds("Milk and eggs, got it.", "Take a note: buy milk and eggs.")).toEqual(["memory"]);
    expect(kinds("What time works?", "Remind me to call my mom.")).toEqual([]);
    expect(kinds("I can't set reminders here.", "Remind me at 6 to call mom")).toEqual([]);
    expect(kinds("We talked about your trip to Lisbon.", "Remind me what we talked about yesterday")).toEqual([]);
    expect(kinds("Your dentist appointment is Friday at 3.", "Remind me what's on my calendar this week")).toEqual([]);
    expect(kinds("Okay!", "Remind me about the dentist on Friday")).toEqual(["schedule"]);
    expect(kinds("Okay!", "remind me in 20 minutes to check the oven")).toEqual(["schedule"]);
    expect(kinds("Yes: May 4.", "Do you remember my sister's birthday?")).toEqual([]);
    expect(kinds("Okay!", "Can you remind me at 6 to call mom?")).toEqual(["schedule"]);
    expect(kinds("She wants the forms by Friday.", 'Summarize this: "Hi! Please remind me to send the forms by Friday. Thanks, Ana"')).toEqual([]);
  });

  it("the truth is added once, and only what's untrue", () => {
    const answer = "Done! I'll remind you at 6 PM and it's on your calendar.";
    const truth = withClaimTruth(answer, unbackedClaims(answer, null, [], TOOLS));
    expect(truth).toBe(`${answer}\n\nTo be clear: no reminder was set. To be clear: nothing was added to your calendar.`);
    expect(withClaimTruth(truth, unbackedClaims(truth, null, [], TOOLS))).toBe(truth);
  });
});

// ---------------------------------------------------------------------------

type Body = { messages: { role: string; content: string }[]; tools?: unknown[]; reasoning_effort?: string };
type Step = { text?: string; tool?: { name: string; args: unknown } };

/** The included model, played here: OpenAI-style streaming, text or a tool call. */
function stubModel(script: (body: Body, n: number) => Step) {
  const bodies: Body[] = [];
  vi.stubGlobal("fetch", async (_input: unknown, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Body;
    bodies.push(body);
    const step = script(body, bodies.length);
    const events = step.tool
      ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${bodies.length}`, type: "function", function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] } }] }, { choices: [{ delta: {}, finish_reason: "tool_calls" }] }]
      : [{ choices: [{ delta: { content: step.text ?? "" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }];
    const sse = [...events, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  });
  return bodies;
}

const lastUser = (body: Body) => body.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
const checked = (body: Body) => /Check your answer against what really happened/.test(lastUser(body));

let db: Awaited<ReturnType<typeof getDb>>;
let owner: User;

async function makeBot(name: string): Promise<Bot> {
  const res = await createBot(db, owner, {
    avatar: "otto", color: "mint", name, jobs: [], brain: { kind: "included", model: "nvidia/Nemotron-3_5-Lightning" },
    connectors: [], trust: "ask", channels: [], contact: {}, ageConfirmed: true, timezone: "America/Chicago",
  });
  if (!res.ok) throw new Error(res.error);
  return res.bot;
}

async function say(bot: Bot, text: string) {
  const conversation = await ensureConversation(db, bot.id, "web", "owner");
  return runTurn({ db, bot, owner, conversation, channelKind: "web", message: { text, author: "owner" } });
}

const reminders = (botId: string) => db.select().from(schema.schedules).where(and(eq(schema.schedules.botId, botId)));
/** Tomorrow at 6 PM in Chicago, as the reminder tool wants it. */
function tomorrowAt6(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `${day}T18:00`;
}

beforeAll(async () => {
  await resetDbForTests();
  db = await getDb();
  [owner] = await db.insert(schema.users).values({ id: "usr_claims", email: "dana@example.com", name: "Dana", emailVerifiedAt: new Date(), timezone: "America/Chicago" }).returning();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await resetDbForTests();
});

describe("a turn, with the included brain", () => {
  it("thinks when it can use tools (Quick included), and not for a greeting", async () => {
    const bot = await makeBot("Thinker");
    const bodies = stubModel(() => ({ text: "Hi Dana!" }));
    await say(bot, "Hi");
    expect(bodies[0].tools?.length).toBeGreaterThan(0);
    expect(bodies[0].reasoning_effort).toBe("high");
    const conversation = await ensureConversation(db, bot.id, "web", "owner");
    await runTurn({ db, bot, owner, conversation, channelKind: "web", message: null, directive: "Say hello.", noTools: true });
    expect(bodies[1].tools).toBeUndefined();
    expect(bodies[1].reasoning_effort).toBe("none");
  });

  it("says it set a reminder without setting one: is asked once, sets it, and only the true answer is kept", async () => {
    const bot = await makeBot("Remy");
    const at = tomorrowAt6();
    const bodies = stubModel((body) => {
      if (body.messages.at(-1)?.role === "tool") return { text: "Reminder set for tomorrow at 6 PM: call Mom." };
      if (checked(body)) return { tool: { name: "create_reminder", args: { text: "Call Mom", at } } };
      return { text: "Got it! I'll remind you to call your mom tomorrow at 6 PM." };
    });
    const out = await say(bot, "Remind me to call my mom tomorrow at 6 PM.");
    expect(bodies).toHaveLength(3);
    expect(out.text).toBe("Reminder set for tomorrow at 6 PM: call Mom.");
    expect(await reminders(bot.id)).toHaveLength(1);
  });

  it("still says so after being asked: the owner is told plainly it wasn't done", async () => {
    const bot = await makeBot("Stubborn");
    const bodies = stubModel(() => ({ text: "All done, I'll remind you at 6 PM!" }));
    const out = await say(bot, "Remind me to call my mom at 6 PM.");
    expect(bodies).toHaveLength(2);
    expect(out.text).toBe("All done, I'll remind you at 6 PM!\n\nTo be clear: no reminder was set.");
    expect(await reminders(bot.id)).toHaveLength(0);
  });

  it("a calendar it can't reach: asked once, and the honest answer replaces the claim", async () => {
    const bot = await makeBot("Cal");
    const bodies = stubModel((body) =>
      checked(body)
        ? { text: "I can't add events to your calendar: no calendar app is connected. I can set a reminder for Friday at 3 PM instead." }
        : { text: "I've added the dentist appointment on Friday at 3 PM to your calendar." },
    );
    const out = await say(bot, "Add a dentist appointment on Friday at 3pm to my calendar.");
    expect(bodies).toHaveLength(2);
    expect(out.text).toMatch(/^I can't add events to your calendar/);
    expect(out.text).not.toMatch(/I've added/);
  });

  it("left alone when the tool ran, or when it asks a question back", async () => {
    const bot = await makeBot("Fine");
    const at = tomorrowAt6();
    let bodies = stubModel((body) => (body.messages.at(-1)?.role === "tool" ? { text: "Done. I've set a reminder for tomorrow at 6 PM." } : { tool: { name: "create_reminder", args: { text: "Call Mom", at } } }));
    let out = await say(bot, "Remind me to call my mom tomorrow at 6 PM.");
    expect(bodies).toHaveLength(2);
    expect(out.text).toBe("Done. I've set a reminder for tomorrow at 6 PM.");
    bodies = stubModel(() => ({ text: "Sure! What time should I remind you?" }));
    out = await say(bot, "Remind me to call my mom.");
    expect(bodies).toHaveLength(1);
    expect(out.text).toBe("Sure! What time should I remind you?");
  });
});
