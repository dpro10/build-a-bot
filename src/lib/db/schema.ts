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
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Shared JSON shapes
// ---------------------------------------------------------------------------

export type BrainConfig = {
  /** included = our open-weight models (Nebius Token Factory); byok = the user's API key;
   *  subscription = the user's own Claude Code / Codex via the Bridge on their computer. */
  kind: "included" | "byok" | "subscription";
  provider: string; // "nebius" | "anthropic" | "openai" | "google" | "openrouter" | ... | "claude-code" | "codex" | "demo"
  model: string;
  credentialId?: string | null;
  baseUrl?: string | null;
  /** What to do when a subscription brain's computer is asleep. Opt-in fallback only. */
  whenOffline?: "wait" | "included";
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
    plan: text("plan").notNull().default("free"), // free | plus | pro
    planStatus: text("plan_status").notNull().default("active"), // active | trialing | past_due | canceled
    planRenewsAt: timestamp("plan_renews_at", { withTimezone: true }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
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
    /** sha256 of the bearer token for this bot's MCP endpoint (Bridge + MCP clients). */
    mcpTokenHash: text("mcp_token_hash"),
    recipeId: text("recipe_id"),
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
    /** The bot's address on this channel (its phone number, email address, @handle). */
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
  | { type: "notice"; tone: "info" | "warn" | "danger"; text: string };

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
    source: text("source").notNull().default("bot"), // owner | bot
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("memories_bot_idx").on(t.botId)],
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
    smsSegments: integer("sms_segments").notNull().default(0),
    emailsSent: integer("emails_sent").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("usage_user_period_uq").on(t.userId, t.period)],
);

// ---------------------------------------------------------------------------
// Bridge (subscription brains on the user's own computer)
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
    clis: jsonb("clis").$type<Record<string, string | null>>().notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("bridge_devices_owner_idx").on(t.ownerId), uniqueIndex("bridge_devices_token_uq").on(t.tokenHash)],
);

export const bridgeJobs = pgTable(
  "bridge_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id"),
    deviceId: text("device_id"),
    status: text("status").notNull().default("queued"), // queued | running | done | failed | expired | canceled
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    progress: text("progress"),
    error: text("error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("bridge_jobs_owner_status_idx").on(t.ownerId, t.status)],
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
export type Note = typeof notes.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
export type Usage = typeof usage.$inferSelect;
export type BridgeDevice = typeof bridgeDevices.$inferSelect;
export type BridgeJob = typeof bridgeJobs.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
