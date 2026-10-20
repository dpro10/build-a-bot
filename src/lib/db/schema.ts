/**
 * Database schema (Postgres via Drizzle).
 *
 * Production runs on a managed Postgres (DATABASE_URL); local dev, tests and demo
 * previews run on PGlite (Postgres compiled to WASM) with the same SQL.
 *
 * Access-control rule (the Moltbook lesson): browsers never talk to the database.
 * Every query goes through server code that scopes rows by owner, and RLS is
 * enabled on every table with no public policies (see drizzle/0001_safety.sql).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Postgres full-text search vectors (the Library's passages). */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Shared JSON shapes
// ---------------------------------------------------------------------------

export type BrainConfig = {
  /** included = our open-weight models (Nebius Token Factory); byok = the user's API key. */
  kind: "included" | "byok";
  provider: string; // "nebius" | "anthropic" | "openai" | "google" | "openrouter" | ... | "demo"
  model: string;
  credentialId?: string | null;
  baseUrl?: string | null;
  /** Thinking depth for models that support it. */
  effort?: "low" | "medium" | "high";
};

export type BotVibe = {
  tone?: string; // from the avatar's default personality unless the owner changes it
  verbosity?: "brief" | "balanced" | "detailed";
  emoji?: boolean;
};

export type BotLimits = {
  /** Max actions (writes/sends) per day that run without asking, even under full faith. */
  dailyActions?: number;
  /** Money is off by default. When on, a hard monthly cap in USD. */
  spendCapUsd?: number;
  quietHours?: { start: string; end: string } | null;
  /** How long meeting transcripts are kept: days, null = forever, unset = 90 days. Notes are kept until deleted. */
  transcriptDays?: number | null;
};

export type ConnectionPermissions = {
  /** Per-capability overrides the owner set on this connection. */
  [capability: string]: "allow" | "ask" | "deny";
};

export type Schedule =
  | { type: "once"; at: string }
  | { type: "daily"; time: string; days?: number[] } // days: 0=Sun..6=Sat; omitted = every day
  | { type: "interval"; minutes: number }
  | { type: "cron"; expr: string };

// ---------------------------------------------------------------------------
// People & sessions
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    name: text("name"),
    timezone: text("timezone").notNull().default("UTC"),
    ageConfirmedAt: timestamp("age_confirmed_at", { withTimezone: true }),
    // Plans are gone (people pay for what they use: src/lib/billing/credit.ts). These four columns are
    // from before and unused; they stay so no data is dropped.
    plan: text("plan").notNull().default("free"),
    planStatus: text("plan_status").notNull().default("active"),
    planRenewsAt: timestamp("plan_renews_at", { withTimezone: true }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** scrypt hash of the PIN that proves it's the owner on a phone call (src/lib/calls/pin.ts). */
    phonePinHash: text("phone_pin_hash"),
    /** Wrong PINs in a row; five lock phone PINs for 15 minutes. */
    phonePinFailures: integer("phone_pin_failures").notNull().default(0),
    phonePinLockedUntil: timestamp("phone_pin_locked_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token); the raw token only lives in the cookie
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginTokens = pgTable("login_tokens", {
  id: text("id").primaryKey(), // sha256(token)
  email: text("email").notNull(),
  /** The anonymous account that asked for the link; its bots move to the verified account. */
  userId: text("user_id"),
  /**
   * sha256 of a random value in a cookie on the browser that asked for the link. Only that browser
   * can bring the anonymous account along; opened anywhere else, the link only signs in.
   */
  browserHash: text("browser_hash"),
  redirectTo: text("redirect_to"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

export const bots = pgTable(
  "bots",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    avatar: text("avatar").notNull(),
    color: text("color").notNull(),
    vibe: jsonb("vibe").$type<BotVibe>().notNull().default({}),
    jobs: jsonb("jobs").$type<string[]>().notNull().default([]),
    instructions: text("instructions").notNull().default(""),
    brain: jsonb("brain").$type<BrainConfig>().notNull(),
    trust: text("trust").notNull().default("ask"), // look | ask | trusted | full
    limits: jsonb("limits").$type<BotLimits>().notNull().default({}),
    status: text("status").notNull().default("active"), // active | paused
    pausedReason: text("paused_reason"),
    /** Brand-free handle used for the bot's own email address etc. (rename insurance). */
    handle: text("handle").notNull(),
    /** sha256 of the bearer token for this bot's MCP endpoint (other AI apps the owner connects). */
    mcpTokenHash: text("mcp_token_hash"),
    recipeId: text("recipe_id"),
    /** A ready-made role (src/lib/roles.ts): "tutor", "job_applier"…; null for a general assistant. */
    role: text("role"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bots_owner_idx").on(t.ownerId), uniqueIndex("bots_handle_uq").on(t.handle)],
);

/** Secrets at rest: API keys, OAuth tokens, bot tokens. Always AES-256-GCM encrypted. */
export const credentials = pgTable(
  "credentials",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // api_key | oauth | bot_token | secret
    provider: text("provider").notNull(),
    label: text("label"),
    secret: text("secret").notNull(), // encrypted envelope, never sent to a browser
    hint: text("hint"), // e.g. "…a1b2"
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("credentials_owner_idx").on(t.ownerId)],
);

/** A tool connector attached to a bot (Gmail, GitHub, a custom MCP server, ...). */
export const connections = pgTable(
  "connections",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    connectorId: text("connector_id").notNull(),
    status: text("status").notNull().default("needs_auth"), // connected | needs_auth | error | demo | disabled
    mode: text("mode").notNull(), // builtin | mcp | composio | demo
    credentialId: text("credential_id"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    permissions: jsonb("permissions").$type<ConnectionPermissions>().notNull().default({}),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("connections_bot_idx").on(t.botId),
    uniqueIndex("connections_bot_connector_uq").on(t.botId, t.connectorId),
  ],
);

/** A way to talk to the bot (web, phone call, SMS, email, Telegram, Discord, Slack, ...). */
export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("needs_setup"), // active | pending | needs_setup | disabled | error | waitlist
    /**
     * The bot's address on this channel (its email address, @handle). For texts and calls it's the
     * number the bot sends from, usually the shared one: a number of the bot's own is marked
     * `config.ownNumber` (see routeTwilio).
     */
    address: text("address"),
    /** The owner's verified identity on this channel. Only this identity can give commands. */
    ownerAddress: text("owner_address"),
    ownerVerifiedAt: timestamp("owner_verified_at", { withTimezone: true }),
    credentialId: text("credential_id"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("channels_bot_idx").on(t.botId),
    uniqueIndex("channels_bot_kind_uq").on(t.botId, t.kind),
    index("channels_address_idx").on(t.kind, t.address),
  ],
);

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    channelKind: text("channel_kind").notNull(),
    /** Chat id / phone number / email thread / "owner" for web. */
    externalId: text("external_id").notNull(),
    title: text("title"),
    lastDisclosureAt: timestamp("last_disclosure_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("conversations_bot_channel_ext_uq").on(t.botId, t.channelKind, t.externalId)],
);

export type MessagePart =
  | { type: "tool_call"; id: string; name: string; title?: string; summary?: string; args: unknown }
  | {
      type: "tool_result";
      id: string;
      name: string;
      status: "ok" | "error" | "blocked" | "pending_approval";
      summary?: string;
      approvalId?: string;
    }
  | { type: "approval"; approvalId: string }
  | { type: "notice"; tone: "info" | "warn" | "danger"; text: string }
  /** Flashcards or a quiz the bot made: shown as a card to study. */
  | { type: "study_set"; set: StudySetSummary };

/** What a chat card shows of a study set (the items load when it's opened). */
export type StudySetSummary = { id: string; kind: "flashcards" | "quiz"; title: string; count: number; sources: string[] };

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant | tool | event
    author: text("author").notNull(), // owner | contact | bot | system
    text: text("text").notNull().default(""),
    parts: jsonb("parts").$type<MessagePart[]>().notNull().default([]),
    channelKind: text("channel_kind").notNull(),
    /** Provider-native transcript items for faithful replay within the same model. */
    transcript: jsonb("transcript").$type<unknown[]>(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("messages_bot_idx").on(t.botId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Safety: approvals, receipts, contacts
// ---------------------------------------------------------------------------

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id"),
    toolCallId: text("tool_call_id"),
    tool: text("tool").notNull(),
    connectorId: text("connector_id"),
    args: jsonb("args").$type<Record<string, unknown>>().notNull().default({}),
    title: text("title").notNull(),
    detail: text("detail"),
    risk: text("risk").notNull(), // low | medium | high
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("pending"), // pending | approved | denied | expired | executed | failed
    result: jsonb("result").$type<unknown>(),
    decidedVia: text("decided_via"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_owner_status_idx").on(t.ownerId, t.status), index("approvals_bot_idx").on(t.botId)],
);

/** Append-only log of everything a bot did and every cent it cost. UPDATE is blocked by a trigger. */
export const receipts = pgTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(), // tool | message | approval | policy | billing | channel | system | stop
    status: text("status").notNull().default("ok"), // ok | blocked | pending | error
    title: text("title").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("receipts_bot_idx").on(t.botId, t.createdAt), index("receipts_owner_idx").on(t.ownerId, t.createdAt)],
);

/** People (other than the owner) a bot has been approved to contact. */
export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // email | phone | telegram | slack | discord
    address: text("address").notNull(),
    name: text("name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contacts_bot_kind_addr_uq").on(t.botId, t.kind, t.address)],
);

/** Every outbound message on a real channel (or simulated in demo mode). */
export const deliveries = pgTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    channelKind: text("channel_kind").notNull(),
    to: text("to").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status").notNull(), // sent | simulated | failed
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("deliveries_bot_idx").on(t.botId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Memory & schedules
// ---------------------------------------------------------------------------

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    source: text("source").notNull().default("bot"), // owner | bot | import
    /** Always sent to the model, whatever the conversation is about (the owner's basics). */
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("memories_bot_idx").on(t.botId)],
);

/**
 * Voice typing's personal dictionary: the owner's own words, so speech-to-text spells them
 * right, and snippets they can say to type something longer. It belongs to the person, not a
 * bot: voice typing works in every app. Never holds what they dictated (that isn't kept).
 */
export const dictionary = pgTable(
  "dictionary",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** word: a name or term to spell right; snippet: something to type when they say its phrase. */
    kind: text("kind").notNull().default("word"),
    /** The word as written ("Prozzi", "GitHub"), or what the snippet types. */
    text: text("text").notNull(),
    /** word: what speech-to-text writes instead ("pro zee"); snippet: the phrases that type it. */
    heard: jsonb("heard").$type<string[]>().notNull().default([]),
    /** manual (added by the owner) | correction (from fixing a dictation) */
    source: text("source").notNull().default("manual"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("dictionary_owner_idx").on(t.ownerId)],
);

export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("notes_bot_title_uq").on(t.botId, t.title)],
);

export const schedules = pgTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // reminder | routine
    title: text("title").notNull(),
    /** For reminders: the text to deliver. For routines: the instruction the bot runs. */
    prompt: text("prompt").notNull(),
    schedule: jsonb("schedule").$type<Schedule>().notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    /** Channel kind to deliver on; "auto" = the owner's primary channel. */
    deliverOn: text("deliver_on").notNull().default("auto"),
    active: boolean("active").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    runCount: integer("run_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("schedules_due_idx").on(t.active, t.nextRunAt), index("schedules_bot_idx").on(t.botId)],
);

// ---------------------------------------------------------------------------
// Meetings (meeting notes: recorded only after the owner says yes; audio is never stored)
// ---------------------------------------------------------------------------

export type MeetingActionItem = { text: string; owner?: string; due?: string; done?: boolean };

export const meetings = pgTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Where it happened: zoom | meet | teams | webex | slack | discord | facetime | browser | other */
    app: text("app").notNull().default("other"),
    /** How it was captured: browser | desktop */
    source: text("source").notNull(),
    deviceId: text("device_id"),
    status: text("status").notNull().default("recording"), // recording | processing | ready | failed
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Seconds of audio received (the longest track). */
    durationSec: integer("duration_sec").notNull().default(0),
    /** One short paragraph, written by the bot after the meeting. */
    summary: text("summary"),
    /** The full notes in Markdown (summary, decisions, action items, follow-ups). */
    notes: text("notes"),
    actionItems: jsonb("action_items").$type<MeetingActionItem[]>().notNull().default([]),
    error: text("error"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("meetings_bot_idx").on(t.botId, t.startedAt), index("meetings_owner_status_idx").on(t.ownerId, t.status)],
);

/** Transcript lines. One audio chunk (about 30 seconds of one track) becomes zero or more segments. */
export const meetingSegments = pgTable(
  "meeting_segments",
  {
    id: text("id").primaryKey(), // time-sortable: clients poll for ids after the last one they saw
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    /** mic = the owner ("You"); system = everyone else in the call. */
    track: text("track").notNull(),
    chunk: integer("chunk").notNull(),
    /** Position within the chunk; -1 marks a chunk that had no speech (so retries are idempotent). */
    idx: integer("idx").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    speaker: text("speaker").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("meeting_segments_meeting_idx").on(t.meetingId, t.startMs),
    uniqueIndex("meeting_segments_chunk_uq").on(t.meetingId, t.track, t.chunk, t.idx),
  ],
);

// ---------------------------------------------------------------------------
// The Library: the owner's files, read once and searchable, and study sets made from them
// ---------------------------------------------------------------------------

export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** What it turned out to be: pdf | docx | pptx | text | image */
    kind: text("kind").notNull().default("unknown"),
    mime: text("mime").notNull().default("application/octet-stream"),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    /** Where the bytes are: a private Vercel Blob pathname, or a file under DATA_DIR. */
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256"),
    status: text("status").notNull().default("uploading"), // uploading | reading | ready | failed
    error: text("error"),
    /** Pages (PDF, Word sections), slides, or 1 for a photo or a text file. */
    pages: integer("pages").notNull().default(0),
    chars: integer("chars").notNull().default(0),
    /** How it came in: upload | telegram | discord | desktop */
    source: text("source").notNull().default("upload"),
    /** The desktop app's path for a synced folder's file (so a change replaces it). */
    sourceRef: text("source_ref"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("files_bot_idx").on(t.botId, t.createdAt),
    index("files_owner_idx").on(t.ownerId),
    uniqueIndex("files_source_ref_uq").on(t.botId, t.sourceRef),
  ],
);

/** A file's text, about a page at a time, each with where it came from (page or slide). */
export const filePassages = pgTable(
  "file_passages",
  {
    id: text("id").primaryKey(),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    /** 1-based page or slide (0 when the file has none). */
    page: integer("page").notNull().default(0),
    /** "Page 3", "Slide 4", "Part 2". */
    label: text("label").notNull(),
    text: text("text").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', "text")`),
  },
  (t) => [
    index("file_passages_file_idx").on(t.fileId, t.idx),
    index("file_passages_bot_idx").on(t.botId),
    index("file_passages_tsv_idx").using("gin", t.tsv),
  ],
);

/** `source`: where it's from, in words ("Bio 101 syllabus, page 2"); `sourceUrl`: a web page the bot checked it against. */
export type StudyCard = { id: string; front: string; back: string; source?: string; sourceUrl?: string };
export type QuizQuestion = {
  id: string;
  type: "multiple_choice" | "true_false" | "short_answer";
  question: string;
  choices?: string[];
  answer: string;
  explanation?: string;
  source?: string;
  sourceUrl?: string;
};
/** Per card (flashcards): its Leitner box and when it's due; per question (quizzes): the last answer. */
export type StudyProgress = {
  cards?: Record<string, { box: number; due: string; seen: number; missed: number }>;
  attempts?: Array<{ at: string; score: number; total: number; missed: string[] }>;
};

export const studySets = pgTable(
  "study_sets",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // flashcards | quiz
    title: text("title").notNull(),
    items: jsonb("items").$type<StudyCard[] | QuizQuestion[]>().notNull().default([]),
    progress: jsonb("progress").$type<StudyProgress>().notNull().default({}),
    /** Library files it was made from. */
    fileIds: jsonb("file_ids").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("study_sets_bot_idx").on(t.botId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Billing & usage
// ---------------------------------------------------------------------------

export const usage = pgTable(
  "usage",
  {
    id: text("id").primaryKey(), // `${userId}:${period}`
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // YYYY-MM (UTC)
    messages: integer("messages").notNull().default(0),
    includedMessages: integer("included_messages").notNull().default(0),
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
    searches: integer("searches").notNull().default(0),
    actions: integer("actions").notNull().default(0),
    voiceSeconds: integer("voice_seconds").notNull().default(0),
    /** Seconds of meeting audio transcribed (meeting notes). */
    meetingSeconds: integer("meeting_seconds").notNull().default(0),
    /** Words typed by voice (voice typing in the desktop app and on the Voice typing page). */
    dictationWords: integer("dictation_words").notNull().default(0),
    smsSegments: integer("sms_segments").notNull().default(0),
    emailsSent: integer("emails_sent").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("usage_user_period_uq").on(t.userId, t.period)],
);

/**
 * Credit added to an account (src/lib/billing/credit.ts). People pay for what they use, at cost:
 * the balance is the starter credit plus these rows, minus what `usage.cost_micros` adds up to.
 */
export const credits = pgTable(
  "credits",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** topup (paid with Stripe) | demo (demo mode, nothing paid) | gift (added by hand) | refund (taken back) */
    kind: text("kind").notNull(),
    /** Credit added, in micro-dollars (negative takes it back). */
    amountMicros: bigint("amount_micros", { mode: "number" }).notNull(),
    /** What the card was charged, in cents (the credit plus Stripe's fee). */
    paidCents: integer("paid_cents"),
    /** The Stripe Checkout session that paid for it: a payment is credited once. */
    stripeSessionId: text("stripe_session_id"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("credits_user_idx").on(t.userId, t.createdAt), uniqueIndex("credits_stripe_session_uq").on(t.stripeSessionId)],
);

// ---------------------------------------------------------------------------
// Paired computers: the desktop app (meeting notes, voice typing, the Library)
// ---------------------------------------------------------------------------

export const bridgeDevices = pgTable(
  "bridge_devices",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    platform: text("platform"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("bridge_devices_owner_idx").on(t.ownerId), uniqueIndex("bridge_devices_token_uq").on(t.tokenHash)],
);

// ---------------------------------------------------------------------------
// Short-lived codes & OAuth state
// ---------------------------------------------------------------------------

export const pairingCodes = pgTable(
  "pairing_codes",
  {
    code: text("code").primaryKey(),
    purpose: text("purpose").notNull(), // bridge | telegram | discord | slack | sms | voice | email
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    botId: text("bot_id"),
    channelId: text("channel_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("pairing_codes_owner_idx").on(t.ownerId)],
);

export const oauthStates = pgTable("oauth_states", {
  id: text("id").primaryKey(), // the `state` parameter
  ownerId: text("owner_id").notNull(),
  botId: text("bot_id"),
  connectorId: text("connector_id"),
  kind: text("kind").notNull(), // mcp | composio | slack | discord
  codeVerifier: text("code_verifier"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  redirectTo: text("redirect_to"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Recipes (portable, shareable bots) & growth
// ---------------------------------------------------------------------------

export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    public: boolean("public").notNull().default(true),
    clones: integer("clones").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("recipes_slug_uq").on(t.slug)],
);

export const waitlist = pgTable(
  "waitlist",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    feature: text("feature").notNull(),
    userId: text("user_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("waitlist_email_feature_uq").on(t.email, t.feature)],
);

/** One spoken entry in a call's transcript. */
export type CallTurn = { role: "caller" | "bot"; text: string; at: number; interrupted?: boolean };

/**
 * A voice call with a bot: from the app's Call button (web) or a phone line (phone), handled by
 * the voice server (voice/). The app decides who's calling; the voice server reports the call.
 */
export const calls = pgTable(
  "calls",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // web | phone
    direction: text("direction").notNull().default("inbound"), // inbound | outbound
    /**
     * pending (token issued) → active (the voice server took it) → ended | failed (the stream dropped
     * and the simpler line carried on). line: the simpler line answered it (no voice server).
     */
    status: text("status").notNull().default("pending"),
    /** Who's on the line: owner | unverified (the owner's number, not yet proven) | contact */
    speaker: text("speaker").notNull().default("owner"),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    /** Twilio's CallSid for phone calls. */
    callSid: text("call_sid"),
    conversationId: text("conversation_id"),
    transcript: jsonb("transcript").$type<CallTurn[]>().notNull().default([]),
    /** What the voice server reported at the end: latency, model usage, who hung up. */
    report: jsonb("report").$type<Record<string, unknown>>(),
    durationS: integer("duration_s"),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("calls_bot_idx").on(t.botId, t.createdAt),
    index("calls_owner_idx").on(t.ownerId, t.createdAt),
    uniqueIndex("calls_call_sid_uq").on(t.callSid),
  ],
);

/** Results of work that finishes after a webhook already answered (voice turns, slow channels). */
export const asyncResults = pgTable("async_results", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // voice_turn | ...
  status: text("status").notNull().default("pending"), // pending | done | error
  result: jsonb("result").$type<Record<string, unknown>>(),
  polls: integer("polls").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Inbound webhook dedupe (Slack event_id, Telegram update_id, Twilio MessageSid...). */
export const inboundEvents = pgTable("inbound_events", {
  id: text("id").primaryKey(), // `${source}:${externalId}`
  createdAt: createdAt(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export type User = typeof users.$inferSelect;
export type Bot = typeof bots.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type DictionaryEntry = typeof dictionary.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
export type Usage = typeof usage.$inferSelect;
export type CreditRow = typeof credits.$inferSelect;
export type BridgeDevice = typeof bridgeDevices.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type MeetingSegment = typeof meetingSegments.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type LibraryFile = typeof files.$inferSelect;
export type FilePassage = typeof filePassages.$inferSelect;
export type StudySet = typeof studySets.$inferSelect;
