/**
 * Trust levels: how much the owner lets their bot do on its own.
 * The policy engine (src/lib/policy/engine.ts) enforces these in code; the model
 * is told about them but never relied on to follow them.
 */

export const TRUST_LEVELS = ["look", "ask", "trusted", "full"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export type TrustDef = {
  id: TrustLevel;
  name: string;
  emoji: string;
  short: string;
  long: string;
  /** Plain-language bullets for the builder's live preview. */
  can: string[];
  asks: string[];
  never: string[];
  /** Default cap on actions per day that run without asking. */
  dailyActions: number;
};

export const TRUST: Record<TrustLevel, TrustDef> = {
  look: {
    id: "look",
    name: "Look only",
    emoji: "👀",
    short: "Reads and researches. Never acts.",
    long: "Your bot can read, search and summarize, but it can't send, post, buy, change or delete anything.",
    can: ["Read and search your connected apps", "Research the web", "Summarize, explain and plan"],
    asks: [],
    never: ["Send, post or reply", "Create, change or delete anything", "Spend money"],
    dailyActions: 0,
  },
  ask: {
    id: "ask",
    name: "Ask me first",
    emoji: "✋",
    short: "Drafts anything. Acts only after your tap.",
    long: "Your bot prepares everything (emails, events, issues) and waits for your tap before anything happens.",
    can: ["Everything in Look only", "Draft replies, events and tasks", "Message you"],
    asks: ["Before every send, post, change or delete"],
    never: ["Spend money"],
    dailyActions: 0,
  },
  trusted: {
    id: "trusted",
    name: "Trusted helper",
    emoji: "🤝",
    short: "Handles routine stuff. Asks before anything big.",
    long: "Your bot handles low-risk chores on its own and asks before anything high-stakes: new people, deletions, big changes.",
    can: ["Everything in Ask me first", "Create events, tasks and drafts", "Reply to people you've approved"],
    asks: ["Messaging someone new", "Deleting anything", "High-risk changes"],
    never: ["Spend money unless you set a cap"],
    dailyActions: 25,
  },
  full: {
    id: "full",
    name: "Full faith",
    emoji: "🚀",
    short: "Acts for you across your apps without asking.",
    long: "Your bot works on autopilot across everything you connect: email, GitHub, Drive and more. A few hard limits always apply, and you get a receipt for every action.",
    can: ["Everything in Trusted helper", "Send, post, update and delete on your behalf", "Reach out to new people for you"],
    asks: [
      "Anything that would send your data to someone new right after reading outside content (prompt-injection guard)",
      "Sending a form on a website (you see exactly what it filled in first)",
      "Changes in money, health or identity apps",
      "Bulk deletes (more than 10 items)",
    ],
    never: ["Share your passwords or keys", "Pretend to be human"],
    dailyActions: 100,
  },
};

export function isTrustLevel(value: unknown): value is TrustLevel {
  return typeof value === "string" && (TRUST_LEVELS as readonly string[]).includes(value);
}

/** Hard limits that no trust level can turn off. Shown in the UI and enforced in code. */
export const HARD_LIMITS = [
  "STOP works from every channel and the app, instantly.",
  "It won't email or message your data to someone new right after reading outside content (a common prompt-injection trick) without your OK.",
  "It never sends passwords, API keys or other secrets anywhere.",
  "Money is off unless you set a monthly cap, and it can never exceed it.",
  "Changes in money, health or identity apps, and forms sent on websites, always wait for your tap.",
  "It only listens to a meeting after you say yes, and it stays on your screen the whole time it's listening.",
  "Messages it sends to other people are labeled as coming from your AI assistant.",
  "Every action gets a receipt you can review.",
] as const;
