/**
 * Ways to talk to a bot. Multiple can be on at once; web chat is always on.
 * Availability reflects platform rules checked 2026-10-13 (docs/research-2026-10-13.md).
 */
import type { live } from "@/lib/env";
import { joinList } from "@/lib/utils";

export const CHANNEL_KINDS = [
  "web",
  "voice",
  "sms",
  "email",
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "imessage",
  "teams",
  "google_chat",
  "signal",
] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export type ChannelDef = {
  kind: ChannelKind;
  name: string;
  /** The name reads as a plural ("Phone calls are…"). */
  plural?: boolean;
  tagline: string;
  description: string;
  /** lucide icon name, or simple-icons slug when `brand` is true. */
  icon: string;
  brand?: boolean;
  color: string;
  availability: "available" | "beta" | "waitlist" | "soon";
  /** What we need from the owner in the builder. */
  needs: "none" | "phone" | "email";
  /** Integration that must be configured (or demo mode) for this to work. */
  requires?: keyof typeof live;
  /** How it's formatted when the bot writes on this channel. */
  style: "rich" | "plain" | "voice" | "email";
  note?: string;
};

export const CHANNELS: ChannelDef[] = [
  {
    kind: "web",
    name: "Web & app",
    tagline: "Always on",
    description: "Chat in your browser or add it to your home screen.",
    icon: "MessageCircle",
    color: "#7C5CFF",
    availability: "available",
    needs: "none",
    style: "rich",
  },
  {
    kind: "voice",
    name: "Phone calls",
    plural: true,
    tagline: "Call it, or let it call you",
    description: "Talk out loud. It can also call you with your morning brief.",
    icon: "Phone",
    color: "#19B57A",
    availability: "available",
    needs: "phone",
    requires: "twilio",
    style: "voice",
    note: "US & Canada numbers to start.",
  },
  {
    kind: "sms",
    name: "Text messages",
    plural: true,
    tagline: "Plain old SMS",
    description: "Text it like a friend. Works on any phone.",
    icon: "MessageSquareText",
    color: "#0EA5E9",
    availability: "available",
    needs: "phone",
    requires: "twilio",
    style: "plain",
    note: "US & Canada numbers to start.",
  },
  {
    kind: "email",
    name: "Email",
    tagline: "Its own email address",
    description: "Email it or forward things to it. It replies from its own address.",
    icon: "Mail",
    color: "#F59E0B",
    availability: "available",
    needs: "email",
    requires: "botEmail",
    style: "email",
  },
  {
    kind: "telegram",
    name: "Telegram",
    tagline: "Your own named bot, one tap",
    description: "Get a Telegram bot with your bot's name. Free and instant.",
    icon: "telegram",
    brand: true,
    color: "#26A5E4",
    availability: "available",
    needs: "none",
    style: "rich",
  },
  {
    kind: "discord",
    name: "Discord",
    tagline: "DMs and servers",
    description: "Add it to Discord and chat with /ask anywhere.",
    icon: "discord",
    brand: true,
    color: "#5865F2",
    availability: "available",
    needs: "none",
    requires: "discord",
    style: "rich",
  },
  {
    kind: "slack",
    name: "Slack",
    tagline: "DM it at work",
    description: "Add it to your Slack workspace and DM it like a teammate.",
    icon: "slack",
    brand: true,
    color: "#4A154B",
    availability: "available",
    needs: "none",
    style: "rich",
  },
  {
    kind: "whatsapp",
    name: "WhatsApp",
    tagline: "EU only for now",
    description: "Meta's rules block general AI assistants on WhatsApp in the US.",
    icon: "whatsapp",
    brand: true,
    color: "#25D366",
    availability: "waitlist",
    needs: "phone",
    style: "plain",
  },
  {
    kind: "imessage",
    name: "iMessage",
    tagline: "Blue bubbles",
    description: "Text it from your iPhone's Messages app.",
    icon: "imessage",
    brand: true,
    color: "#34C759",
    availability: "waitlist",
    needs: "phone",
    style: "plain",
  },
  {
    kind: "teams",
    name: "Microsoft Teams",
    tagline: "For work chats",
    description: "Chat with it inside Teams.",
    icon: "Users",
    color: "#6264A7",
    availability: "soon",
    needs: "none",
    style: "rich",
  },
  {
    kind: "google_chat",
    name: "Google Chat",
    tagline: "For Google Workspace",
    description: "Chat with it inside Google Chat.",
    icon: "googlechat",
    brand: true,
    color: "#00AC47",
    availability: "soon",
    needs: "none",
    style: "rich",
  },
  {
    kind: "signal",
    name: "Signal",
    tagline: "Private messaging",
    description: "Chat with it on Signal.",
    icon: "signal",
    brand: true,
    color: "#3A76F0",
    availability: "soon",
    needs: "phone",
    style: "plain",
  },
];

export const CHANNEL_BY_KIND = Object.fromEntries(CHANNELS.map((c) => [c.kind, c])) as Record<ChannelKind, ChannelDef>;

export function isChannelKind(value: unknown): value is ChannelKind {
  return typeof value === "string" && (CHANNEL_KINDS as readonly string[]).includes(value);
}

/** The `live` flags (src/lib/env.ts), as server pages hand them to the browser. */
export type LiveFlags = Partial<Record<keyof typeof live, boolean>>;

/**
 * Where a channel stands on this server. The catalog's waitlist and soon stand. Outside demo
 * mode (which simulates everything), a channel whose integration isn't configured is coming soon.
 */
export function channelAvailability(def: ChannelDef, demo: boolean, flags: LiveFlags): ChannelDef["availability"] {
  if (def.availability === "waitlist" || def.availability === "soon") return def.availability;
  if (def.requires && !demo && !flags[def.requires]) return "soon";
  return def.availability;
}

/** The channel can be turned on here: for real, or simulated in demo mode. */
export function channelUsable(def: ChannelDef, demo: boolean, flags: LiveFlags): boolean {
  const availability = channelAvailability(def, demo, flags);
  return availability === "available" || availability === "beta";
}

/** "Text messages are coming soon." / "Email is coming soon." */
export function comingSoonNote(def: ChannelDef): string {
  return `${def.name} ${def.plural ? "are" : "is"} coming soon.`;
}

/** The talk-anywhere channels, as they read in a sentence. */
const CHANNEL_WORDS: [ChannelKind, string][] = [
  ["voice", "calls"],
  ["sms", "texts"],
  ["email", "email"],
  ["telegram", "Telegram"],
  ["discord", "Discord"],
  ["slack", "Slack"],
];

/** For public copy: the talk-anywhere channels that work here, and the ones coming soon. */
export function talkChannels(demo: boolean, flags: LiveFlags): { ready: string[]; soon: string[] } {
  const ready: string[] = [];
  const soon: string[] = [];
  for (const [kind, word] of CHANNEL_WORDS) (channelUsable(CHANNEL_BY_KIND[kind], demo, flags) ? ready : soon).push(word);
  return { ready, soon };
}

/** ["calls", "texts", "email"] → "Calls, texts and email are coming soon." */
export function comingSoonLine(words: string[]): string {
  if (!words.length) return "";
  const list = joinList(words);
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${words.length === 1 ? "is" : "are"} coming soon.`;
}
