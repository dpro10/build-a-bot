/**
 * "What should it help with?" — job chips. Picking jobs pre-selects connectors
 * and shapes the bot's first message and system prompt. The #1 reason people
 * abandon personal agents is not knowing what to use them for (research, 10-13).
 */
import type { JobId } from "@/lib/connectors/types";

export type JobDef = {
  id: JobId;
  label: string;
  emoji: string;
  blurb: string;
  /** Added to the system prompt when the job is picked. */
  prompt: string;
  /** Ideas the bot offers in its first message. */
  starters: string[];
  /** Built-in connectors this job turns on. Third-party suggestions come from the catalog. */
  builtins: string[];
};

export const JOBS: JobDef[] = [
  {
    id: "inbox",
    label: "Inbox",
    emoji: "📬",
    blurb: "Triage, summarize, draft replies",
    prompt:
      "Help the owner get through email: summarize what matters, flag what needs a reply, and draft replies in their voice.",
    starters: ["Summarize what came in today", "Draft a polite no to that meeting", "What needs a reply from me?"],
    builtins: ["bot_inbox"],
  },
  {
    id: "calendar",
    label: "Calendar",
    emoji: "🗓️",
    blurb: "Plan your day, find time, prep meetings",
    prompt: "Help the owner plan their days: what's coming up, conflicts, prep for meetings, and finding free time.",
    starters: ["What's on my plate tomorrow?", "Find an hour for deep work this week", "Prep me for my next meeting"],
    builtins: [],
  },
  {
    id: "reminders",
    label: "Reminders",
    emoji: "⏰",
    blurb: "Nudges, follow-ups, daily briefs",
    prompt:
      "Keep the owner on track with reminders and follow-ups. Offer to set a reminder whenever they mention something they need to do later.",
    starters: ["Remind me to call mom at 6pm", "Send me a brief every morning at 8", "Nudge me to drink water"],
    builtins: ["reminders"],
  },
  {
    id: "research",
    label: "Research",
    emoji: "🔎",
    blurb: "Find answers, compare options, cite sources",
    prompt:
      "Research thoroughly: search, read sources, compare options and cite where facts came from. Be clear about uncertainty.",
    starters: ["Compare the 3 best budget laptops", "What changed in the news today?", "Explain this topic like I'm new"],
    builtins: ["web_search", "web_reader", "wikipedia", "news"],
  },
  {
    id: "errands",
    label: "Errands",
    emoji: "🛒",
    blurb: "Lists, bookings, chores, logistics",
    prompt:
      "Help with errands and logistics: lists, comparing options, planning trips around town, and keeping track of what's done.",
    starters: ["Make a grocery list for tacos for 6", "What's open near me right now?", "Plan my Saturday errands"],
    builtins: ["web_search", "weather", "notes"],
  },
  {
    id: "school",
    label: "School",
    emoji: "🎓",
    blurb: "Study plans, explanations, deadlines",
    prompt:
      "Help the owner learn: explain concepts step by step, quiz them, make study plans and track deadlines. Never write graded work for them to submit as their own; coach instead.",
    starters: ["Quiz me on chapter 4", "Make a study plan for my exam Friday", "Explain derivatives simply"],
    builtins: ["web_search", "wikipedia", "reminders"],
  },
  {
    id: "coding",
    label: "Coding",
    emoji: "💻",
    blurb: "GitHub, issues, PRs, code questions",
    prompt:
      "Help with software work: GitHub issues and pull requests, explaining code, writing small scripts, and keeping projects tidy.",
    starters: ["What PRs need my review?", "Open an issue for this bug", "Explain this error message"],
    builtins: ["web_search", "web_reader"],
  },
  {
    id: "work",
    label: "Work",
    emoji: "💼",
    blurb: "Docs, tasks, meetings, follow-ups",
    prompt: "Help with work: tasks, docs, meeting notes and follow-ups. Be concise and action-oriented.",
    starters: ["What's on my task list?", "Turn these notes into action items", "Draft a status update"],
    builtins: ["notes", "reminders"],
  },
  {
    id: "money",
    label: "Money",
    emoji: "💸",
    blurb: "Budgets, bills, subscriptions",
    prompt:
      "Help the owner understand and organize their money: budgets, bills, subscriptions and spending. Never move money without explicit approval.",
    starters: ["When are my bills due?", "Convert 200 euros to dollars", "Help me make a monthly budget"],
    builtins: ["currency", "reminders"],
  },
  {
    id: "health",
    label: "Health & habits",
    emoji: "🌱",
    blurb: "Habits, workouts, gentle check-ins",
    prompt:
      "Support healthy habits with gentle, encouraging check-ins. You are not a doctor: for medical questions, give general information and suggest a professional.",
    starters: ["Check in on my habits every evening", "Plan a 20-minute workout", "Remind me to stretch"],
    builtins: ["reminders", "weather"],
  },
  {
    id: "home",
    label: "Home",
    emoji: "🏡",
    blurb: "Chores, smart home, family logistics",
    prompt: "Help run the household: chores, family logistics, shopping lists and smart-home routines.",
    starters: ["Make a weekly chore chart", "Who's picking up the kids Thursday?", "Turn off the lights at 11"],
    builtins: ["notes", "reminders"],
  },
  {
    id: "travel",
    label: "Travel",
    emoji: "✈️",
    blurb: "Trips, itineraries, packing",
    prompt: "Help plan travel: itineraries, packing lists, weather, and keeping bookings organized.",
    starters: ["Plan 3 days in Mexico City", "What's the weather in Tokyo next week?", "Make me a packing list"],
    builtins: ["web_search", "weather", "currency"],
  },
  {
    id: "social",
    label: "Social",
    emoji: "💬",
    blurb: "Posts, replies, staying in touch",
    prompt: "Help with social life and posting: draft posts, remember birthdays, and keep in touch with people.",
    starters: ["Draft a post about my new job", "Remind me of birthdays", "Help me reply to this message"],
    builtins: ["reminders", "notes"],
  },
  {
    id: "other",
    label: "Something else",
    emoji: "✨",
    blurb: "Tell it in your own words",
    prompt: "",
    starters: ["Here's what I need help with…"],
    builtins: [],
  },
];

export const JOB_BY_ID = Object.fromEntries(JOBS.map((j) => [j.id, j])) as Record<JobId, JobDef>;

export function isJobId(value: unknown): value is JobId {
  return typeof value === "string" && value in JOB_BY_ID;
}
