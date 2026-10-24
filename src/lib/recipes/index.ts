/**
 * Recipes: a bot as a portable, shareable blueprint (persona, jobs, apps, channels,
 * trust, routines). Never includes secrets, memories, contacts or messages.
 * "Clone my bot" links grow the product; exports answer "the labs keep killing my bot".
 */
import { z } from "zod";
import type { Bot, Connection, Channel, ScheduleRow } from "@/lib/db/schema";
import { AVATAR_IDS, COLORWAY_IDS, type AvatarId, type ColorwayId } from "@/lib/avatars";
import { TRUST_LEVELS, type TrustLevel } from "@/lib/trust";
import { ROLE_IDS, isRoleId } from "@/lib/roles";

export const recipeSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(32),
  avatar: z.enum(AVATAR_IDS),
  color: z.enum(COLORWAY_IDS),
  tagline: z.string().max(140).optional(),
  /** A ready-made role (src/lib/roles.ts); left out for a general assistant. */
  role: z.enum(ROLE_IDS).optional(),
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
    ...(isRoleId(bot.role) ? { role: bot.role } : {}),
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
    slug: "tutor",
    name: "Otto",
    avatar: "otto",
    color: "midnight",
    role: "tutor",
    tagline: "Learn anything step by step, with quizzes and daily review.",
    who: "Anyone learning something new",
    jobs: ["school", "reminders"],
    instructions: "",
    trust: "ask",
    connectors: ["web_search", "web_reader", "wikipedia", "notes"],
    channels: ["discord", "slack"],
    routines: [
      {
        title: "Daily review",
        instruction: "Give me a short review quiz on what we covered recently, starting with my weak spots from the Learning log. One question at a time.",
        time: "19:00",
      },
    ],
    highlights: ["Asks what you're learning first", "One question at a time", "Daily review of what you missed"],
  },
  {
    version: 1,
    slug: "job-applier",
    name: "Blip",
    avatar: "blip",
    color: "sunny",
    role: "job_applier",
    tagline: "Finds jobs that fit, tailors every application, tracks follow-ups.",
    who: "Job seekers",
    jobs: ["work", "reminders"],
    instructions: "",
    trust: "trusted",
    // Web actions join once they're live: a simulated application must never pass for a real one.
    connectors: ["web_search", "web_reader", "notes", "gmail"],
    channels: ["discord", "slack"],
    routines: [
      {
        title: "Morning job finds",
        instruction: "Search for new openings that fit my targets, posted in the last few days. Skip ones already in my Applications note. Send me the best 3 to 5, each with the link and one line on why it fits.",
        time: "08:30",
        days: [1, 2, 3, 4, 5],
      },
      {
        title: "Friday follow-ups",
        instruction: "Check my Applications note for ones over a week old with no reply, and offer to draft a short follow-up for each.",
        time: "16:00",
        days: [5],
      },
    ],
    highlights: ["Daily matches with links", "Tailored cover letters, nothing made up", "Asks before anything is sent"],
  },
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
    channels: ["discord", "email"],
    routines: [{ title: "Morning inbox brief", instruction: "Summarize what came in overnight: what needs a reply today, what can wait, and anything urgent.", time: "08:00", days: [1, 2, 3, 4, 5] }],
    highlights: ["Morning inbox brief on weekdays", "Drafts replies in your voice", "Asks before sending anything"],
  },
  {
    version: 1,
    slug: "language-partner",
    name: "Nimbus",
    avatar: "nimbus",
    color: "mint",
    role: "language_partner",
    tagline: "Practice a new language in everyday chats, with gentle corrections.",
    who: "Language learners",
    jobs: ["school"],
    instructions: "",
    trust: "ask",
    connectors: ["notes"],
    channels: ["discord", "voice", "slack"],
    routines: [
      {
        title: "Daily chat",
        instruction: "Start a short, friendly conversation in the language I'm learning, at my level, using a few words from my Words note.",
        time: "19:30",
      },
    ],
    highlights: ["Chats at your level", "Corrects what matters", "A new chat every evening"],
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
    channels: ["discord", "email"],
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
    slug: "fitness-coach",
    name: "Ember",
    avatar: "ember",
    color: "midnight",
    role: "fitness_coach",
    tagline: "Workouts that fit your goal, your time and your gear.",
    who: "Anyone getting fitter",
    jobs: ["health"],
    instructions: "",
    trust: "ask",
    connectors: ["notes"],
    channels: ["discord", "sms", "slack"],
    routines: [
      {
        title: "Today's workout",
        instruction: "Send today's workout from my plan, adjusted for how the last one went. Keep it short.",
        time: "07:00",
        days: [1, 3, 5],
      },
    ],
    highlights: ["A plan built around you", "Gets harder as you get stronger", "Check-ins without guilt"],
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
    channels: ["discord", "email"],
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
    channels: ["sms", "discord"],
    routines: [{ title: "Sunday week-ahead", instruction: "Summarize next week's family calendar, who's driving where, and birthdays coming up.", time: "18:00", days: [0] }],
    highlights: ["Sunday week-ahead plan", "Birthday reminders", "Chore chart"],
  },
];

/** Old links to recipes that were renamed. */
const RENAMED: Record<string, string> = { "job-hunt": "job-applier" };

export function findFeatured(slug: string) {
  const want = RENAMED[slug] ?? slug;
  return FEATURED_RECIPES.find((r) => r.slug === want);
}
