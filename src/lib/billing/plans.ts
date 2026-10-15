/**
 * Plans and limits (proposal — pricing is an open question for Diego; see
 * docs/DECISIONS.md). Limits are enforced in code: src/lib/billing/usage.ts.
 *
 * Cost model behind the numbers (docs/research-2026-10-13.md):
 *  - Included brain (Nemotron 3.5 Lightning, $0.06/$0.24 per 1M): ~$0.0004 per turn.
 *  - Web search (Tavily): $0.008 per credit after 1,000 free/month → the real cost driver.
 *  - SMS ~$0.013/segment, voice ~$0.02–0.09/min incl. speech recognition.
 *  - Meeting notes: speech-to-text per hour of audio (docs/research/meetings-2026-10-14.md)
 *    plus one notes call (~15K tokens in for an hour-long meeting).
 */
import type { TrustLevel } from "@/lib/trust";

export type PlanId = "free" | "plus" | "pro";

export type Plan = {
  id: PlanId;
  name: string;
  priceMonthly: number;
  priceYearly: number; // per month, billed yearly
  tagline: string;
  limits: {
    bots: number;
    /** Messages answered by our included brain per month (own key / subscription don't count). */
    includedMessages: number;
    /** Messages on the owner's own brain per month (fair use; costs us little). */
    byoMessages: number;
    searches: number;
    connectors: number; // third-party connectors per bot
    voiceMinutes: number;
    smsSegments: number;
    routines: number;
    /** Minutes of meetings the bot can take notes in per month. */
    meetingMinutes: number;
  };
  trust: TrustLevel[];
  includedModels: ("fast" | "balanced" | "smart")[];
  channels: string[];
  highlights: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    priceYearly: 0,
    tagline: "Make a bot and see what it can do.",
    limits: {
      bots: 1,
      includedMessages: 300,
      byoMessages: 2000,
      searches: 50,
      connectors: 3,
      voiceMinutes: 0,
      smsSegments: 0,
      routines: 2,
      meetingMinutes: 120,
    },
    trust: ["look", "ask", "trusted"],
    includedModels: ["fast"],
    channels: ["web", "email", "telegram", "discord", "slack"],
    highlights: [
      "1 bot",
      "300 messages/month on open models",
      "2,000 messages/month on your own key or subscription",
      "Web, Telegram, Discord, Slack",
      "3 app connections",
      "2 hours of meeting notes",
    ],
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceMonthly: 12,
    priceYearly: 10,
    tagline: "Your bot, everywhere, doing real work.",
    limits: {
      bots: 3,
      includedMessages: 3000,
      byoMessages: 20000,
      searches: 600,
      connectors: 50,
      voiceMinutes: 60,
      smsSegments: 300,
      routines: 25,
      meetingMinutes: 900,
    },
    trust: ["look", "ask", "trusted", "full"],
    includedModels: ["fast", "balanced"],
    channels: ["web", "email", "telegram", "discord", "slack", "sms", "voice"],
    highlights: [
      "3 bots",
      "3,000 messages/month on open models",
      "Phone calls (60 min) and texts (300)",
      "Up to 50 apps per bot",
      "Full faith mode",
      "25 routines (briefs, check-ins, reminders)",
      "15 hours of meeting notes",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 39,
    priceYearly: 32,
    tagline: "For people who run their life through their bots.",
    limits: {
      bots: 10,
      includedMessages: 15000,
      byoMessages: 100000,
      searches: 3000,
      connectors: 200,
      voiceMinutes: 300,
      smsSegments: 1500,
      routines: 200,
      meetingMinutes: 3000,
    },
    trust: ["look", "ask", "trusted", "full"],
    includedModels: ["fast", "balanced", "smart"],
    channels: ["web", "email", "telegram", "discord", "slack", "sms", "voice"],
    highlights: [
      "10 bots",
      "15,000 messages/month incl. our smartest open model",
      "300 call minutes, 1,500 texts",
      "Up to 200 apps per bot",
      "50 hours of meeting notes",
      "Early access to new features",
    ],
  },
};

export function getPlan(id: string | null | undefined): Plan {
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : "free"];
}

export function planAllowsTrust(plan: Plan, trust: TrustLevel): boolean {
  return plan.trust.includes(trust);
}

export function planAllowsChannel(plan: Plan, kind: string): boolean {
  return plan.channels.includes(kind);
}

export const PLAN_ORDER: PlanId[] = ["free", "plus", "pro"];

export function minPlanFor(predicate: (p: Plan) => boolean): PlanId | null {
  return PLAN_ORDER.find((id) => predicate(PLANS[id])) ?? null;
}

/** Whole-percent saving of yearly vs monthly billing, rounded down so it's never overstated. */
export function yearlySaving(p: Plan): number {
  if (!p.priceMonthly) return 0;
  return Math.floor(((p.priceMonthly - p.priceYearly) / p.priceMonthly) * 100);
}

/** "Save up to 17%": the best yearly saving of any plan. Pricing and Plan & usage both show this one number. */
export const MAX_YEARLY_SAVING = Math.max(...PLAN_ORDER.map((id) => yearlySaving(PLANS[id])));

/** What upgrade prompts say while paid plans can't be bought yet (no Stripe, outside demo mode). */
export const PAID_PLANS_SOON = "Paid plans are coming soon.";
