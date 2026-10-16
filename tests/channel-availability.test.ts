/**
 * What a server offers: outside demo mode, a channel whose service isn't set up is coming
 * soon; bots' own inboxes need their domain and a way to receive mail (a Resend key for
 * sign-in links isn't one); recipes and saved drafts only bring channels that work here;
 * starter ideas and the morning brief only mention apps the bot has.
 */
import { describe, expect, it } from "vitest";
import { CHANNEL_BY_KIND, channelAvailability, channelUsable, comingSoonLine, talkChannels } from "@/lib/channels/catalog";
import { appKinds, unavailableConnectors } from "@/lib/connectors";
import { botEmailProvider } from "@/lib/env";
import { briefParts, startersFor } from "@/lib/jobs";
import { FEATURED_RECIPES, findFeatured } from "@/lib/recipes";
import { initialState, STEPS, stepError, usableChannels, withDraft, type BuilderContext } from "@/components/builder/state";
import { templatesFor } from "@/components/bot/routines/schedule";

/** The live site: Telegram's manager bot, Discord, a Resend key for sign-in, web search and speech-to-text; no Twilio, bot inboxes or Stripe. */
const LIVE_SITE = { telegramManaged: true, discord: true, email: true, webSearch: true, transcription: true };

describe("channel availability", () => {
  it("outside demo mode, a channel whose service isn't set up is coming soon", () => {
    for (const kind of ["sms", "voice", "email"] as const) expect(channelAvailability(CHANNEL_BY_KIND[kind], false, LIVE_SITE)).toBe("soon");
    expect(channelAvailability(CHANNEL_BY_KIND.discord, false, {})).toBe("soon");
    for (const kind of ["web", "telegram", "discord", "slack"] as const) expect(channelUsable(CHANNEL_BY_KIND[kind], false, LIVE_SITE)).toBe(true);
    expect(channelAvailability(CHANNEL_BY_KIND.sms, false, { ...LIVE_SITE, twilio: true })).toBe("available");
  });

  it("the sign-in email key doesn't turn on the Email channel; bots' own inboxes do", () => {
    expect(channelUsable(CHANNEL_BY_KIND.email, false, { email: true })).toBe(false);
    expect(channelUsable(CHANNEL_BY_KIND.email, false, { botEmail: true })).toBe(true);
  });

  it("demo mode simulates whatever isn't set up", () => {
    for (const kind of ["sms", "voice", "email", "discord"] as const) expect(channelAvailability(CHANNEL_BY_KIND[kind], true, {})).toBe("available");
  });

  it("waitlists and channels we haven't built stay as they are in both modes", () => {
    for (const demo of [true, false]) {
      expect(channelAvailability(CHANNEL_BY_KIND.whatsapp, demo, { twilio: true })).toBe("waitlist");
      expect(channelAvailability(CHANNEL_BY_KIND.teams, demo, {})).toBe("soon");
      expect(channelUsable(CHANNEL_BY_KIND.whatsapp, demo, { twilio: true })).toBe(false);
    }
  });

  it("public copy names what works and marks the rest coming soon", () => {
    const here = talkChannels(false, LIVE_SITE);
    expect(here).toEqual({ ready: ["Telegram", "Discord", "Slack"], soon: ["calls", "texts", "email"] });
    expect(comingSoonLine(here.soon)).toBe("Calls, texts and email are coming soon.");
    expect(comingSoonLine(["email"])).toBe("Email is coming soon.");
    expect(talkChannels(true, {}).soon).toEqual([]);
  });
});

describe("bots' own inboxes", () => {
  const domain = "bots.example";

  it("a Resend key for sign-in links isn't enough", () => {
    expect(botEmailProvider({ resendKey: "re_x" })).toBeNull();
    expect(botEmailProvider({ resendKey: "re_x", botDomain: domain })).toBeNull();
    expect(botEmailProvider({ resendKey: "re_x", resendWebhookSecret: "whsec_x" })).toBeNull();
  });

  it("they need the domain and a provider that takes in mail", () => {
    expect(botEmailProvider({ botDomain: domain, resendKey: "re_x", resendWebhookSecret: "whsec_x" })).toBe("resend");
    expect(botEmailProvider({ botDomain: domain, agentmailKey: "am_x", agentmailWebhookSecret: "whsec_y" })).toBe("agentmail");
    expect(botEmailProvider({ botDomain: domain, agentmailKey: "am_x" })).toBeNull();
    // Resend only for sign-in, AgentMail for the bots: the bots' mail goes through AgentMail.
    expect(botEmailProvider({ botDomain: domain, resendKey: "re_x", agentmailKey: "am_x", agentmailWebhookSecret: "whsec_y" })).toBe("agentmail");
  });

  it("its own inbox is coming soon until then (demo mode simulates it)", () => {
    expect(unavailableConnectors(false, LIVE_SITE)).toContain("bot_inbox");
    expect(unavailableConnectors(false, { ...LIVE_SITE, botEmail: true })).not.toContain("bot_inbox");
    expect(unavailableConnectors(true, {})).toEqual([]);
  });
});

describe("recipes and drafts in the builder", () => {
  const live: BuilderContext = { demo: false, live: LIVE_SITE, comingSoon: unavailableConnectors(false, LIVE_SITE), ownerEmail: "dana@example.com" };
  const demo: BuilderContext = { demo: true, live: {}, comingSoon: [], ownerEmail: null };
  const noKey = { apiKey: "", keyStatus: "idle" as const };

  it("outside demo mode, every featured recipe can be made: channels that aren't set up are left out", () => {
    for (const recipe of FEATURED_RECIPES) {
      const state = initialState(recipe, live);
      expect(state.channels.filter((c) => c === "sms" || c === "voice" || c === "email"), recipe.slug).toEqual([]);
      for (const step of STEPS) if (step.id !== "review") expect(stepError(step.id, state, noKey), `${recipe.slug}: ${step.id}`).toBeNull();
    }
    expect(initialState(findFeatured("study-buddy"), live).channels).toEqual(["telegram"]);
    expect(initialState(findFeatured("errand-runner"), live).channels).toEqual([]);
    expect(initialState(findFeatured("pr-patrol"), live).channels).toEqual(["slack", "discord"]);
  });

  it("demo mode keeps them, and still asks for the number a recipe can't bring", () => {
    const state = initialState(findFeatured("study-buddy"), demo);
    expect(state.channels).toEqual(["telegram", "sms"]);
    expect(stepError("channels", state, noKey)).toBe("Add your mobile number for texts and calls");
  });

  it("the Inbox job brings its own inbox only when bots can have one", () => {
    expect(initialState(findFeatured("inbox-zero"), live).connectors).not.toContain("bot_inbox");
    expect(initialState(findFeatured("inbox-zero"), demo).connectors).toContain("bot_inbox");
  });

  it("the account's email fills in the Email channel's address", () => {
    expect(initialState(null, live).email).toBe("dana@example.com");
    expect(initialState(null, demo).email).toBe("");
  });

  it("a saved draft is checked the same way", () => {
    const draft = withDraft(initialState(null, live), { name: "Juniper", email: "", channels: ["sms", "telegram", "email"], connectors: ["bot_inbox", "web_search"] }, live);
    expect(draft).toMatchObject({ name: "Juniper", channels: ["telegram"], connectors: ["web_search"], email: "dana@example.com", ageConfirmed: false });
    // Whatever was stored, the channels come back as a list of real ones.
    expect(withDraft(initialState(null, live), { channels: "sms" as never }, live).channels).toEqual([]);
    expect(withDraft(initialState(null, demo), { channels: ["sms", "web", "fax" as never] }, demo).channels).toEqual(["sms"]);
  });

  it("texts and calls come along once they're set up here (they're paid from credit, not a plan)", () => {
    expect(usableChannels(["sms", "telegram", "whatsapp"], live)).toEqual(["telegram", "whatsapp"]);
    const withTwilio = { ...live, live: { ...LIVE_SITE, twilio: true } };
    expect(usableChannels(["sms", "voice", "telegram", "whatsapp"], withTwilio)).toEqual(["sms", "voice", "telegram", "whatsapp"]);
  });
});

describe("starter ideas and the morning brief follow the bot's apps", () => {
  it("knows what apps can see", () => {
    expect([...appKinds(["gmail"])]).toEqual(["email"]);
    expect([...appKinds(["google_contacts"])]).toEqual([]);
    expect([...appKinds(["outlook_calendar", "github", "home_assistant"])].sort()).toEqual(["calendar", "code", "smart_home"]);
    // Apps we haven't built yet see nothing.
    expect([...appKinds(["icloud_mail"])]).toEqual([]);
  });

  it("ideas about email or a calendar wait for an app that can see them", () => {
    expect(startersFor(["inbox", "calendar"], new Set())).toEqual(["Draft a polite no to that meeting"]);
    expect(startersFor(["inbox"], appKinds(["gmail"]))).toContain("What needs a reply from me?");
    expect(startersFor(["calendar"], appKinds(["google_calendar"]))).toHaveLength(3);
    expect(startersFor(["coding"], new Set())).toEqual(["Explain this error message"]);
    expect(startersFor(["home"], new Set())).toEqual(["Make a weekly chore chart"]);
    // Each idea shows once.
    expect(startersFor(["health", "health"], new Set())).toEqual(["Check in on my habits every evening", "Plan a 20-minute workout", "Remind me to stretch"]);
  });

  it("the morning brief only covers the calendar and email when the bot can see them", () => {
    expect(briefParts(["calendar", "inbox"], new Set())).toEqual(["reminders", "weather"]);
    expect(briefParts(["calendar", "inbox"], appKinds(["google_calendar", "gmail"]))).toEqual(["calendar", "email", "weather"]);
    expect(briefParts(["research"], appKinds(["gmail"]))).toEqual(["reminders", "headline", "weather"]);
  });

  it("routine templates don't send the bot looking through an inbox or calendar it can't see", () => {
    const bare = templatesFor(new Set());
    expect(bare.map((t) => t.id)).toEqual(["morning-brief", "weekly-review", "wind-down", "habit-check-in"]);
    expect(bare[0].prompt).toBe("Give me a short morning brief: today's weather and one thing I shouldn't forget.");
    const full = templatesFor(appKinds(["gmail", "google_calendar"]));
    expect(full.map((t) => t.id)).toContain("inbox-sweep");
    expect(full[0].prompt).toBe("Give me a short morning brief: today's weather, what's on my calendar, anything urgent in my inbox and one thing I shouldn't forget.");
    expect(full.find((t) => t.id === "bill-check")?.prompt).toMatch(/^Look for bills and subscriptions due this month in my email and calendar\./);
  });
});
