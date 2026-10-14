/**
 * Recipes: a bot as a portable, shareable blueprint (persona, jobs, apps, channels,
 * trust, routines). Never includes secrets, memories, contacts or messages.
 * "Clone my bot" links grow the product; exports answer "the labs keep killing my bot".
 */
import { z } from "zod";
import type { Bot, Connection, Channel, ScheduleRow } from "@/lib/db/schema";
import { AVATAR_IDS, COLORWAY_IDS, type AvatarId, type ColorwayId } from "@/lib/avatars";
import { TRUST_LEVELS, type TrustLevel } from "@/lib/trust";

export const recipeSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(32),
  avatar: z.enum(AVATAR_IDS),
  color: z.enum(COLORWAY_IDS),
  tagline: z.string().max(140).optional(),
  jobs: z.array(z.string()).max(12),
  instructions: z.string().max(4000),
  trust: z.enum(TRUST_LEVELS),
  connectors: z.array(z.string()).max(60),
  channels: z.array(z.string()).max(12),
  vibe: z.object({ verbosity: z.enum(["brief", "balanced", "detailed"]).optional(), emoji: z.boolean().optional() }).optional(),
  routines: z
    .array(z.object({ title: z.string().max(120), instruction: z.string().max(2000), time: z.string().regex(/^\d{2}:\d{2}$/), days: z.array(z.number().int().min(0).max(6)).optional() }))
    .max(10)
    .optional(),
});

export type RecipeData = z.infer<typeof recipeSchema>;

export function botToRecipe(bot: Bot, connections: Connection[], channels: Channel[], schedules: ScheduleRow[]): RecipeData {
  return {
    version: 1,
    name: bot.name,
    avatar: bot.avatar as AvatarId,
    color: bot.color as ColorwayId,
    jobs: bot.jobs ?? [],
    instructions: bot.instructions ?? "",
    trust: bot.trust as TrustLevel,
    connectors: connections.filter((c) => !c.connectorId.startsWith("custom_mcp:")).map((c) => c.connectorId),
    channels: channels.filter((c) => c.kind !== "web").map((c) => c.kind),
    vibe: { verbosity: bot.vibe?.verbosity, emoji: bot.vibe?.emoji },
    routines: schedules
      .filter((s) => s.kind === "routine" && s.schedule.type === "daily")
      .map((s) => ({ title: s.title, instruction: s.prompt, time: (s.schedule as { time: string }).time, days: (s.schedule as { days?: number[] }).days })),
  };
}

export type FeaturedRecipe = RecipeData & { slug: string; tagline: string; who: string; highlights: string[] };

export const FEATURED_RECIPES: FeaturedRecipe[] = [
  {
    version: 1,
    slug: "inbox-zero",
    name: "Nimbus",
    avatar: "nimbus",
    color: "sky",
    tagline: "Triage email, draft replies, never miss what matters.",
    who: "Busy people drowning in email",
    jobs: ["inbox", "calendar", "reminders"],
    instructions: "Every reply you draft should sound like me: short, warm, no corporate fluff. Flag anything from my manager or family as urgent.",
    trust: "ask",
    connectors: ["gmail", "google_calendar"],
    channels: ["telegram", "email"],
    routines: [{ title: "Morning inbox brief", instruction: "Summarize what came in overnight: what needs a reply today, what can wait, and anything urgent.", time: "08:00", days: [1, 2, 3, 4, 5] }],
    highlights: ["Morning inbox brief on weekdays", "Drafts replies in your voice", "Asks before sending anything"],
  },
  {
    version: 1,
    slug: "meeting-buddy",
    name: "Otto",
    avatar: "otto",
    color: "grape",
    tagline: "Takes notes in your calls and turns them into action items.",
    who: "People who live in meetings",
    jobs: ["meetings", "calendar", "work"],
    instructions:
      "After each meeting, lead with decisions and action items, then a short summary. Use people's names when they're said. Offer to draft a recap email, but never send it without showing me first.",
    trust: "ask",
    connectors: ["meetings", "google_calendar", "notion"],
    channels: ["telegram", "email"],
    routines: [
      {
        title: "Friday follow-ups",
        instruction: "Look at this week's meetings and list the action items still open, grouped by person, with the meeting each came from.",
        time: "16:00",
        days: [5],
      },
    ],
    highlights: ["Asks before it listens", "Notes, decisions and action items", "Friday list of open follow-ups"],
  },
  {
    version: 1,
    slug: "study-buddy",
    name: "Sprout",
    avatar: "sprout",
    color: "mint",
    tagline: "Quizzes you, plans your week, keeps deadlines in sight.",
    who: "Students",
    jobs: ["school", "reminders", "research"],
    instructions: "Coach me; don't do my homework. Quiz me with one question at a time and explain mistakes kindly.",
    trust: "trusted",
    connectors: ["google_calendar", "notion"],
    channels: ["telegram", "sms"],
    routines: [{ title: "Evening study check-in", instruction: "Ask what I studied today and what's due this week. Suggest one 25-minute focus block for tomorrow.", time: "20:30" }],
    highlights: ["Quizzes on anything", "Evening study check-ins", "Deadline reminders by text"],
  },
  {
    version: 1,
    slug: "pr-patrol",
    name: "Blip",
    avatar: "blip",
    color: "ocean",
    tagline: "Watches your GitHub, summarizes PRs, files issues for you.",
    who: "Developers",
    jobs: ["coding", "work"],
    instructions: "Be terse. Link every PR/issue you mention. Never merge anything.",
    trust: "trusted",
    connectors: ["github", "linear", "slack"],
    channels: ["slack", "discord"],
    routines: [{ title: "Daily dev digest", instruction: "List PRs waiting on my review, failing checks on my PRs, and new issues assigned to me.", time: "09:15", days: [1, 2, 3, 4, 5] }],
    highlights: ["Daily review queue", "Opens issues from chat", "Never merges on its own"],
  },
  {
    version: 1,
    slug: "errand-runner",
    name: "Ember",
    avatar: "ember",
    color: "coral",
    tagline: "Lists, plans and logistics — gets your Saturday done.",
    who: "Anyone with a to-do list",
    jobs: ["errands", "reminders"],
    instructions: "Group errands by location and suggest the fastest order. Keep my grocery list in a note called Groceries.",
    trust: "trusted",
    connectors: ["google_maps", "todoist"],
    channels: ["sms", "voice"],
    highlights: ["Shared grocery list", "Route-optimized errands", "Call it hands-free in the car"],
  },
  {
    version: 1,
    slug: "deep-researcher",
    name: "Otto",
    avatar: "otto",
    color: "grape",
    tagline: "Digs for the real answer and cites every source.",
    who: "Curious people, analysts, founders",
    jobs: ["research", "work"],
    instructions: "Always cite sources with links. Separate facts from opinions. Say when sources disagree.",
    trust: "look",
    connectors: ["notion", "google_drive"],
    channels: ["telegram", "email"],
    highlights: ["Cited answers", "Searches your Notion and Drive too", "Look only, so it can't change anything"],
  },
  {
    version: 1,
    slug: "family-hub",
    name: "Nimbus",
    avatar: "nimbus",
    color: "rose",
    tagline: "Family logistics: pickups, birthdays, groceries, chores.",
    who: "Parents and roommates",
    jobs: ["home", "calendar", "reminders"],
    instructions: "Keep a shared chore chart and grocery list. Remind me of birthdays a week ahead.",
    trust: "ask",
    connectors: ["google_calendar", "todoist"],
    channels: ["sms", "telegram"],
    routines: [{ title: "Sunday week-ahead", instruction: "Summarize next week's family calendar, who's driving where, and birthdays coming up.", time: "18:00", days: [0] }],
    highlights: ["Sunday week-ahead plan", "Birthday reminders", "Chore chart"],
  },
  {
    version: 1,
    slug: "habit-coach",
    name: "Sprout",
    avatar: "sprout",
    color: "sunny",
    tagline: "Gentle daily check-ins that actually stick.",
    who: "People building habits",
    jobs: ["health", "reminders"],
    instructions: "Be encouraging, never preachy. Track my streaks in a note called Habits.",
    trust: "trusted",
    connectors: ["google_calendar", "exist", "notes"],
    channels: ["sms", "telegram"],
    routines: [{ title: "Evening habit check-in", instruction: "Ask how today's habits went (water, walk, reading). Update the Habits note and cheer the streak.", time: "21:00" }],
    highlights: ["Daily check-ins by text", "Streak tracking in a note", "Encouraging, never preachy"],
  },
  {
    version: 1,
    slug: "job-hunt",
    name: "Ember",
    avatar: "ember",
    color: "sunny",
    tagline: "Finds roles, tailors cover letters, tracks applications.",
    who: "Job seekers",
    jobs: ["research", "work", "reminders"],
    instructions: "Track every application in a note called Applications with company, role, date and next step.",
    trust: "ask",
    connectors: ["gmail", "linkedin", "google_docs"],
    channels: ["email", "telegram"],
    highlights: ["Application tracker", "Tailored cover letters", "Follow-up reminders"],
  },
  {
    version: 1,
    slug: "travel-planner",
    name: "Otto",
    avatar: "otto",
    color: "coral",
    tagline: "Itineraries, packing lists and weather — trip handled.",
    who: "Travelers",
    jobs: ["travel", "research"],
    instructions: "Plan realistic days (no more than 3 big things per day). Always check the weather.",
    trust: "trusted",
    connectors: ["google_calendar", "google_maps", "tripadvisor"],
    channels: ["telegram", "voice"],
    highlights: ["Day-by-day itineraries", "Weather-aware packing lists", "Currency help"],
  },
];

export function findFeatured(slug: string) {
  return FEATURED_RECIPES.find((r) => r.slug === slug);
}
