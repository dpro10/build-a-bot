/**
 * Connector catalog types.
 *
 * A connector is something a bot can be given access to (Gmail, GitHub, a calendar,
 * a custom MCP server...). The catalog (./catalog.ts) is data only; runtime code
 * decides how to actually connect based on `via` and what's configured:
 *
 *  - builtin    runs on our servers with no user auth (web search, weather, reminders).
 *  - mcp        an official remote MCP server (Streamable HTTP). OAuth via the MCP
 *               authorization spec, or a token the user pastes (bearer).
 *  - composio   managed OAuth + tools through Composio (needs COMPOSIO_API_KEY).
 *  - custom_mcp the user pastes any MCP server URL.
 */
import type { live } from "@/lib/env";

export type Effect = "read" | "write" | "send" | "delete" | "spend" | "admin";
export type Risk = "low" | "medium" | "high";

export type ConnectorCategory =
  | "essentials"
  | "email"
  | "calendar"
  | "messaging"
  | "files"
  | "notes"
  | "tasks"
  | "dev"
  | "design"
  | "social"
  | "crm"
  | "support"
  | "finance"
  | "commerce"
  | "travel"
  | "maps"
  | "music"
  | "video"
  | "health"
  | "smart_home"
  | "data"
  | "marketing"
  | "ai"
  | "web"
  | "learning"
  | "news"
  | "automation"
  | "custom";

export type JobId =
  | "inbox"
  | "calendar"
  | "meetings"
  | "reminders"
  | "research"
  | "errands"
  | "school"
  | "coding"
  | "work"
  | "money"
  | "health"
  | "home"
  | "social"
  | "shopping"
  | "travel"
  | "other";

/** What a bot's apps let it see, for ideas that only make sense with one (see appKinds()). */
export type AppKind = "email" | "calendar" | "code" | "smart_home";

export type ConnectorVia =
  | { kind: "builtin" }
  | {
      kind: "mcp";
      url: string;
      auth: "oauth" | "bearer" | "none";
      /** For bearer: where the user creates a token, and what to call it. */
      tokenUrl?: string;
      tokenLabel?: string;
      /** Extra headers some servers want. */
      headers?: Record<string, string>;
      verified?: boolean;
      /** Regex (case-insensitive) over tool names, when several connectors share one server. */
      toolFilter?: string;
    }
  | { kind: "composio"; toolkit: string; toolFilter?: string }
  | { kind: "custom_mcp" };

export type Capability = {
  /** Stable id within the connector, e.g. "read_email", "send_email". */
  id: string;
  label: string;
  effect: Effect;
  risk: Risk;
};

export type ConnectorIcon = {
  /** simple-icons slug (CC0 brand glyphs), e.g. "gmail". Verified to exist in simple-icons@16. */
  simpleIcon?: string;
  /** Brand hex without '#'. Falls back to the simple-icons color. */
  color?: string;
  /** Lucide icon name for generic/builtin connectors, e.g. "search". */
  lucide?: string;
  /** Fallback monogram. */
  letter?: string;
};

export type ConnectorDef = {
  id: string;
  name: string;
  category: ConnectorCategory;
  /** One short line, sentence case, no trailing period: "Read, search and send email". */
  description: string;
  icon: ConnectorIcon;
  /** Ordered by preference; the runtime picks the first that's usable. */
  via: ConnectorVia[];
  capabilities: Capability[];
  popular?: boolean;
  jobs?: JobId[];
  status?: "available" | "beta" | "soon";
  keywords?: string[];
  /** Money, health or identity data: extra warning in the UI, never auto-allowed. */
  sensitive?: boolean;
  /** Short note shown under the connector (e.g. "Uses Google's audited access"). */
  note?: string;
  /** A built-in that needs a service set up on this server (or demo mode); until then it's coming soon. */
  requires?: keyof typeof live;
};

export const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  essentials: "Essentials",
  email: "Email",
  calendar: "Calendar",
  messaging: "Messaging & chat",
  files: "Files & docs",
  notes: "Notes & knowledge",
  tasks: "Tasks & projects",
  dev: "Developer",
  design: "Design",
  social: "Social",
  crm: "CRM & sales",
  support: "Customer support",
  finance: "Money & finance",
  commerce: "Shopping & commerce",
  travel: "Travel",
  maps: "Maps & places",
  music: "Music & audio",
  video: "Video",
  health: "Health & fitness",
  smart_home: "Smart home",
  data: "Data & analytics",
  marketing: "Marketing",
  ai: "AI & models",
  web: "Web & research",
  learning: "Learning",
  news: "News & reading",
  automation: "Automation",
  custom: "Custom",
};
