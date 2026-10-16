/**
 * How a receipt looks: icon, tone, status badge, and its `detail` JSON as
 * readable label/value rows. Pure presentation, safe for the browser.
 */
import * as React from "react";
import {
  BadgeCheck,
  Ban,
  CalendarClock,
  CirclePause,
  CircleX,
  Hand,
  PartyPopper,
  Play,
  Radio,
  Send,
  Settings2,
  ShieldX,
  Sparkles,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { BrandTile, type IconSpec } from "@/components/brand/icons";
import { Badge } from "@/components/ui/badge";
import { CHANNEL_BY_KIND, type ChannelKind } from "@/lib/channels/catalog";
import { INCLUDED_MODELS, PROVIDER_BY_ID, type ProviderId } from "@/lib/models/catalog";
import { TRUST, isTrustLevel } from "@/lib/trust";
import { AVATARS, isAvatarId } from "@/lib/avatars";
import { JOB_BY_ID } from "@/lib/jobs";
import { formatUsdMicros, maskPhone } from "@/lib/utils";
import type { AppInfo, ReceiptView } from "./types";

export type Tone = "primary" | "success" | "warning" | "danger" | "neutral";

export const TONE_TILE: Record<Tone, string> = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-muted text-muted-foreground",
};

/** Plain-language reasons from the policy engine (src/lib/policy/engine.ts). */
export const REASON_LABEL: Record<string, string> = {
  paused: "It was paused (STOP)",
  look_only: "Set to Look only",
  owner_rule_deny: "You turned this off for this app",
  owner_rule_ask: "Your rule for this app: ask first",
  needs_approval: "Your trust level asks first",
  high_risk: "High-stakes action",
  sensitive_app: "Money, health or identity app",
  tainted_send_new_recipient: "Read outside content first (prompt-injection guard)",
  new_recipient: "First message to this person",
  quiet_hours: "Your quiet hours",
  money_off: "Spending is off",
  over_spend_cap: "Over your monthly spending cap",
  bulk_delete: "Deletes a lot at once",
  daily_action_cap: "Over today's limit of unattended actions",
  secret_in_payload: "Looked like it contained a password or key",
  always_ask: "Always needs your OK, at any trust level",
};

const TOOL_LABEL: Record<string, string> = {
  web_search: "Web search",
  read_webpage: "Read a web page",
  news_headlines: "News headlines",
  wikipedia_lookup: "Wikipedia lookup",
  get_weather: "Weather forecast",
  create_reminder: "Set a reminder",
  schedule_routine: "Schedule a routine",
  list_reminders: "List reminders",
  cancel_reminder: "Cancel a reminder",
  remember: "Remember a fact",
  recall: "Check memory",
  message_owner: "Message you",
  read_inbox: "Read its own inbox",
  send_email: "Send an email",
  write_note: "Write a note",
  read_note: "Read a note",
  list_notes: "List notes",
  convert_currency: "Convert currency",
  calculate: "Calculate",
};

export function toolLabel(name: string): string {
  if (TOOL_LABEL[name]) return TOOL_LABEL[name];
  const bare = name.includes("__") ? name.slice(name.lastIndexOf("__") + 2) : name;
  if (TOOL_LABEL[bare]) return TOOL_LABEL[bare];
  const words = bare.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export function channelName(kind: string): string {
  if (kind === "web") return "Chat in the app";
  return CHANNEL_BY_KIND[kind as ChannelKind]?.name ?? humanizeKey(kind);
}

export function channelIcon(kind: string): IconSpec {
  const def = CHANNEL_BY_KIND[kind as ChannelKind];
  if (!def) return { lucide: "MessageCircle", color: "7C5CFF" };
  return def.brand ? { simpleIcon: def.icon, letter: def.name[0], color: def.color } : { lucide: def.icon, color: def.color };
}

export function modelLabel(model: string): string {
  const inc = INCLUDED_MODELS.find((m) => m.id === model);
  if (inc) return inc.label;
  for (const p of Object.values(PROVIDER_BY_ID)) {
    const m = p.models.find((x) => x.id === model);
    if (m) return m.label;
  }
  return model;
}

function brainText(b: Record<string, unknown>): string {
  const kind = String(b.kind ?? "");
  const provider = String(b.provider ?? "");
  const model = String(b.model ?? "");
  if (kind === "subscription") return provider === "codex" ? "Your ChatGPT, via the Bridge" : "Your Claude, via the Bridge";
  if (kind === "byok") return `${modelLabel(model)} · your ${PROVIDER_BY_ID[provider as ProviderId]?.name ?? provider} key`;
  return `${modelLabel(model)} · included`;
}

function looksLikePhone(v: string) {
  return /^\+\d{8,15}$/.test(v);
}

export function displayAddress(v: string): string {
  return looksLikePhone(v) ? maskPhone(v) : v;
}

/** Receipt titles sometimes carry raw times ("at 2026-10-14T18:00", "at 08:00"); show them the friendly way. */
export function prettyTitle(title: string): string {
  return title
    .replace(/\b(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})\b/g, (_m, y, mo, d, h, mi) => {
      const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
      return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(date);
    })
    .replace(/\bat (\d{2}):(\d{2})\b/g, (_m, h, mi) => {
      const date = new Date(Date.UTC(2000, 0, 1, Number(h), Number(mi)));
      return `at ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(date)}`;
    });
}

export type ReceiptLook = {
  icon: LucideIcon;
  tone: Tone;
  /** A brand/app tile to use instead of the lucide icon. */
  tile?: IconSpec;
  badge: { label: string; tone: "success" | "warning" | "danger" | "neutral" | "primary" } | null;
  compact: boolean;
  app?: { id: string; info?: AppInfo };
  channel?: string;
};

export function receiptLook(r: ReceiptView, apps: Record<string, AppInfo>): ReceiptLook {
  const d = r.detail ?? {};
  const appId = typeof d.connector === "string" ? d.connector : typeof d.connectorId === "string" ? d.connectorId : undefined;
  const app = appId ? { id: appId, info: apps[appId] } : undefined;
  const channel = typeof d.channel === "string" && d.channel !== "web" ? d.channel : undefined;

  let badge: ReceiptLook["badge"] =
    r.status === "pending"
      ? { label: "Asked you", tone: "warning" }
      : r.status === "blocked"
        ? { label: "Blocked", tone: "danger" }
        : r.status === "error"
          ? { label: "Failed", tone: "danger" }
          : { label: "Done", tone: "success" };

  let icon: LucideIcon = Settings2;
  let tone: Tone = "neutral";
  let tile: IconSpec | undefined;
  let compact = false;

  switch (r.kind) {
    case "tool":
      icon = d.approvalId ? BadgeCheck : Wrench;
      tone = r.status === "error" ? "danger" : d.approvalId ? "success" : "primary";
      if (app?.info && r.status !== "error") tile = app.info.icon;
      if (r.status === "ok" && d.approvalId) badge = { label: "Approved", tone: "success" };
      break;
    case "policy":
      icon = ShieldX;
      tone = "danger";
      break;
    case "approval":
      if (r.status === "pending") {
        icon = Hand;
        tone = "warning";
      } else {
        icon = CircleX;
        tone = "neutral";
        if (r.status === "ok") badge = { label: "Declined", tone: "neutral" };
      }
      break;
    case "message":
      icon = Send;
      tone = r.status === "error" ? "danger" : "primary";
      if (r.status !== "error" && typeof d.channel === "string") tile = channelIcon(d.channel);
      if (r.status === "ok") badge = d.status === "simulated" ? { label: "Simulated", tone: "neutral" } : { label: "Sent", tone: "success" };
      break;
    case "billing":
      icon = Sparkles;
      tone = r.status === "error" ? "danger" : "neutral";
      compact = r.status !== "error";
      if (r.status === "ok") badge = null;
      break;
    case "routine":
      icon = CalendarClock;
      tone = r.status === "blocked" ? "warning" : "primary";
      if (r.status === "blocked") badge = { label: "Skipped", tone: "warning" };
      else if (r.status === "ok") badge = { label: "Ran", tone: "success" };
      break;
    case "stop": {
      const paused = /pause|stop/i.test(r.title);
      icon = paused ? CirclePause : Play;
      tone = paused ? "warning" : "success";
      badge = { label: paused ? "Paused" : "Resumed", tone: paused ? "warning" : "success" };
      break;
    }
    case "channel":
      icon = Radio;
      tone = r.status === "error" ? "danger" : "primary";
      break;
    case "system":
    default:
      if (r.status === "error") {
        icon = TriangleAlert;
        tone = "danger";
      } else if (/ was born$/.test(r.title)) {
        icon = PartyPopper;
        tone = "primary";
        badge = { label: "Hello!", tone: "primary" };
      } else {
        icon = Settings2;
        tone = "neutral";
        if (app?.info) tile = app.info.icon;
        if (r.status === "ok") badge = { label: "Saved", tone: "neutral" };
      }
      break;
  }
  if (r.status === "blocked" && r.kind !== "routine") icon = r.kind === "policy" ? ShieldX : Ban;
  return { icon, tone, tile, badge, compact, app, channel };
}

export function ReceiptIcon({ look, size = 36 }: { look: ReceiptLook; size?: number }) {
  if (look.tile) return <BrandTile icon={look.tile} size={size} variant="soft" className="rounded-2xl" />;
  const Icon = look.icon;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-2xl ${TONE_TILE[look.tone]}`} style={{ width: size, height: size }} aria-hidden>
      <Icon className="size-[45%]" strokeWidth={2.2} />
    </span>
  );
}

export function StatusBadge({ look, className }: { look: ReceiptLook; className?: string }) {
  if (!look.badge) return null;
  return (
    <Badge tone={look.badge.tone} className={className}>
      {look.badge.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// detail → label/value rows
// ---------------------------------------------------------------------------

export type DetailRow = { key: string; label: string; value: React.ReactNode };

const EFFECT_TEXT: Record<string, string> = {
  read: "Looked something up (read only)",
  write: "Created or changed something",
  send: "Sent something",
  delete: "Deleted something",
  spend: "Spent money",
  admin: "Changed account settings",
};

const CHANGED_TEXT: Record<string, string> = {
  name: "Name",
  avatar: "Look",
  color: "Colors",
  instructions: "Custom instructions",
  jobs: "What it helps with",
  trust: "Trust level",
  vibe: "Personality",
  limits: "Limits",
  brain: "Brain",
  // Single limits (src/lib/bots/labels.ts names them in the receipt's title too).
  dailyActions: "Actions per day",
  spendCapUsd: "Spending cap",
  quietHours: "Quiet hours",
  transcriptDays: "Keep transcripts",
};

const PAID_BY: Record<string, string> = {
  credit: "Your credit, at cost",
  // Receipts from before there was credit.
  plan: "Your plan",
  "owner's key": "Your own API key",
  "your subscription": "Your subscription",
};

const MODE_TEXT: Record<string, string> = {
  builtin: "Built in",
  mcp: "Official app connection (MCP)",
  composio: "Managed sign-in",
  demo: "Demo (simulated)",
  custom_mcp: "Your own MCP server",
};

const RULE_TEXT: Record<string, string> = { allow: "Allowed", ask: "Ask first", deny: "Off" };

function Chips({ items }: { items: React.ReactNode[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-0.5 text-xs font-medium ring-1 ring-border">
          {it}
        </span>
      ))}
    </span>
  );
}

function AppChip({ id, info }: { id: string; info?: AppInfo }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {info ? <BrandTile icon={info.icon} size={16} variant="tile" className="rounded-[5px]" /> : null}
      {info?.name ?? humanizeKey(id)}
    </span>
  );
}

function ChannelChip({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <BrandTile icon={channelIcon(kind)} size={16} variant="tile" className="rounded-[5px]" />
      {channelName(kind)}
    </span>
  );
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
}

function genericValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string" || typeof x === "number")) return <Chips items={v.map((x) => String(x))} />;
    return (
      <span className="flex flex-col gap-1">
        {v.map((x, i) => (
          <span key={i}>{genericValue(x)}</span>
        ))}
      </span>
    );
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="flex flex-col gap-0.5">
        {entries.map(([k, x]) => (
          <span key={k}>
            <span className="text-muted-foreground">{humanizeKey(k)}:</span>{" "}
            {typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)}
          </span>
        ))}
      </span>
    );
  }
  return String(v);
}

/** Turn a receipt's detail JSON into readable rows. Unknown keys still show, humanized. */
export function detailRows(r: ReceiptView, apps: Record<string, AppInfo>): DetailRow[] {
  const d = { ...(r.detail ?? {}) } as Record<string, unknown>;
  const rows: DetailRow[] = [];
  const take = (key: string) => {
    const v = d[key];
    delete d[key];
    return v;
  };
  const push = (key: string, label: string, value: React.ReactNode) => rows.push({ key, label, value });

  const tool = take("tool");
  if (typeof tool === "string") push("tool", "Tool", toolLabel(tool));
  for (const key of ["connector", "connectorId"]) {
    const v = take(key);
    if (typeof v === "string") push(key, "App", <AppChip id={v} info={apps[v]} />);
  }
  const effect = take("effect");
  if (typeof effect === "string") push("effect", "What it did", EFFECT_TEXT[effect] ?? humanizeKey(effect));
  const risk = take("risk");
  if (typeof risk === "string")
    push("risk", "Risk", <Badge tone={risk === "high" ? "danger" : risk === "medium" ? "warning" : "neutral"}>{humanizeKey(risk)}</Badge>);
  const channel = take("channel");
  if (typeof channel === "string") push("channel", r.kind === "message" ? "Sent on" : r.kind === "tool" && d.scheduleId ? "Delivered on" : "Asked in", <ChannelChip kind={channel} />);
  const to = take("to");
  if (typeof to === "string") push("to", "To", displayAddress(to));
  const preview = take("preview");
  if (typeof preview === "string")
    push(
      "preview",
      "Message",
      <span className="block rounded-xl border-l-2 border-primary/40 bg-card px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">{preview}</span>,
    );
  const status = take("status");
  if (typeof status === "string")
    push("status", "Delivery", status === "simulated" ? "Simulated (demo mode, nothing really sent)" : status === "failed" ? "Failed" : status === "sent" ? "Sent" : humanizeKey(status));
  const result = take("result");
  if (typeof result === "string" && result) push("result", "Result", <span className="whitespace-pre-wrap">{result}</span>);
  const error = take("error");
  if (error) push("error", "Error", <span className="whitespace-pre-wrap text-danger">{String(error)}</span>);
  const message = take("message");
  if (typeof message === "string" && message) push("message", "Why", message);
  const reasons = take("reasons");
  if (Array.isArray(reasons) && reasons.length)
    push("reasons", r.status === "blocked" ? "Blocked because" : "Why it asked", <Chips items={reasons.map((x) => REASON_LABEL[String(x)] ?? humanizeKey(String(x)))} />);
  const approvalId = take("approvalId");
  if (typeof approvalId === "string") push("approvalId", "Approval", <span className="font-mono text-xs">{approvalId}</span>);
  const via = take("via");
  if (typeof via === "string") push("via", "Decided from", via === "web" ? "The app" : channelName(via));
  const scheduleId = take("scheduleId");
  if (typeof scheduleId === "string") push("scheduleId", "Schedule", <span className="font-mono text-xs">{scheduleId}</span>);
  const cap = take("cap");
  if (cap !== undefined) push("cap", "Daily limit", `${num(cap)} scheduled runs a day`);

  const changed = take("changed");
  if (Array.isArray(changed) && changed.length) push("changed", "What changed", <Chips items={changed.map((c) => CHANGED_TEXT[String(c)] ?? humanizeKey(String(c)))} />);
  const trust = take("trust");
  if (typeof trust === "string") push("trust", "Trust level", isTrustLevel(trust) ? `${TRUST[trust].emoji} ${TRUST[trust].name}` : trust);
  const brain = take("brain");
  if (brain && typeof brain === "object") push("brain", "Brain", brainText(brain as Record<string, unknown>));
  const avatar = take("avatar");
  if (typeof avatar === "string") push("avatar", "Look", isAvatarId(avatar) ? `${AVATARS[avatar].character} the ${AVATARS[avatar].species}` : avatar);
  const jobs = take("jobs");
  if (Array.isArray(jobs) && jobs.length)
    push("jobs", "Helps with", <Chips items={jobs.map((j) => JOB_BY_ID[String(j) as keyof typeof JOB_BY_ID]?.label ?? humanizeKey(String(j)))} />);
  const channels = take("channels");
  if (Array.isArray(channels) && channels.length) push("channels", "Channels", <Chips items={channels.map((c) => <ChannelChip key={String(c)} kind={String(c)} />)} />);
  const connectors = take("connectors");
  if (Array.isArray(connectors) && connectors.length)
    push("connectors", "Apps", <Chips items={connectors.map((c) => <AppChip key={String(c)} id={String(c)} info={apps[String(c)]} />)} />);
  const permissions = take("permissions");
  if (permissions && typeof permissions === "object") {
    const entries = Object.entries(permissions as Record<string, unknown>);
    if (entries.length)
      push(
        "permissions",
        "Permissions",
        <span className="flex flex-col gap-0.5">
          {entries.map(([k, v]) => (
            <span key={k}>
              {humanizeKey(k)}: <span className="font-medium">{RULE_TEXT[String(v)] ?? String(v)}</span>
            </span>
          ))}
        </span>,
      );
  }
  const mode = take("mode");
  if (typeof mode === "string") push("mode", "Connection", MODE_TEXT[mode] ?? humanizeKey(mode));
  const reason = take("reason");
  if (typeof reason === "string") push("reason", "Reason", reason);
  const slug = take("slug");
  if (typeof slug === "string")
    push(
      "slug",
      "Share link",
      <a href={`/r/${slug}`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
        /r/{slug}
      </a>,
    );

  // Brain usage
  const model = take("model");
  const servedBy = take("servedBy");
  if (typeof model === "string" && model) push("model", "Model", modelLabel(model));
  if (typeof servedBy === "string" && servedBy && servedBy !== model)
    push("servedBy", "Answered by", servedBy === "demo" ? "The demo brain (no real model in demo mode)" : modelLabel(servedBy));
  const tin = take("inputTokens");
  const tout = take("outputTokens");
  const cached = take("cachedInputTokens");
  if (tin !== undefined || tout !== undefined) {
    const parts = [`${num(tin).toLocaleString("en-US")} read`, `${num(tout).toLocaleString("en-US")} written`];
    if (num(cached) > 0) parts.push(`${num(cached).toLocaleString("en-US")} from cache`);
    push("tokens", "Tokens", parts.join(" · "));
  }
  const paidBy = take("paidBy");
  if (typeof paidBy === "string") push("paidBy", "Paid by", PAID_BY[paidBy] ?? paidBy);
  if (r.kind === "billing" || r.costMicros > 0) push("cost", "Cost", r.costMicros > 0 ? formatUsdMicros(r.costMicros) : "Nothing extra");
  const cliCost = take("costUsdReportedByCli");
  if (cliCost !== undefined && cliCost !== null) push("cliCost", "Cost your computer reported", `$${num(cliCost).toFixed(4)}`);
  const jobId = take("jobId");
  if (typeof jobId === "string") push("jobId", "Bridge job", <span className="font-mono text-xs">{jobId}</span>);

  for (const [k, v] of Object.entries(d)) push(k, humanizeKey(k), genericValue(v));
  return rows;
}
