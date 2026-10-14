/**
 * View model for the Channels page. Pure helpers: used by the server page to shape
 * data and by the client to read API responses.
 */
import { CHANNEL_BY_KIND, isChannelKind, type ChannelDef, type ChannelKind } from "@/lib/channels/catalog";
import { getPlan, planAllowsChannel } from "@/lib/billing/plans";

export type ChannelStatus = "active" | "pending" | "needs_setup" | "disabled" | "error" | "waitlist";

export type ChannelView = {
  id: string;
  kind: ChannelKind;
  status: ChannelStatus;
  /** The bot's address on this channel (its @handle, number, email address). */
  address: string | null;
  /** The owner's verified identity (phone, email; opaque ids for chat apps). */
  ownerAddress: string | null;
  ownerVerified: boolean;
  /** A bot token or app keys are stored (never sent to the browser). */
  hasCredential: boolean;
  error: string | null;
  simulated: boolean;
  locked: boolean;
  /** What the owner typed in the builder (their phone or email), to prefill verification. */
  pendingOwnerAddress: string | null;
  username: string | null;
};

const STATUSES: ChannelStatus[] = ["active", "pending", "needs_setup", "disabled", "error", "waitlist"];

export function toChannelView(row: {
  id: string;
  kind: string;
  status: string;
  address?: string | null;
  ownerAddress?: string | null;
  ownerVerifiedAt?: Date | string | null;
  credentialId?: string | null;
  error?: string | null;
  config?: unknown;
}): ChannelView | null {
  if (!isChannelKind(row.kind)) return null;
  const c = (row.config ?? {}) as { simulated?: boolean; locked?: boolean; pendingOwnerAddress?: unknown; username?: unknown };
  return {
    id: row.id,
    kind: row.kind,
    status: (STATUSES as string[]).includes(row.status) ? (row.status as ChannelStatus) : "needs_setup",
    address: row.address ?? null,
    ownerAddress: row.ownerAddress ?? null,
    ownerVerified: Boolean(row.ownerVerifiedAt),
    hasCredential: Boolean(row.credentialId),
    error: row.error ?? null,
    simulated: Boolean(c.simulated),
    locked: Boolean(c.locked),
    pendingOwnerAddress: typeof c.pendingOwnerAddress === "string" ? c.pendingOwnerAddress : null,
    username: typeof c.username === "string" ? c.username : null,
  };
}

export function channelDef(kind: ChannelKind): ChannelDef {
  return CHANNEL_BY_KIND[kind];
}

/** Plan name a channel needs, when the owner's plan doesn't include it (and we're not in demo mode). */
export function planGate(kind: ChannelKind, planId: string, demo: boolean): string | null {
  if (demo) return null;
  const def = CHANNEL_BY_KIND[kind];
  if (planAllowsChannel(getPlan(planId), kind)) return null;
  return def.minPlan === "pro" ? "Pro" : "Plus";
}

export function minPlanLabel(def: ChannelDef): string | null {
  return def.minPlan === "free" ? null : def.minPlan === "pro" ? "Pro" : "Plus";
}

/** "+15125550123" → "+1 (512) 555-0123" (other countries stay as typed). */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** A pasted-token bot or Slack app that's waiting for its owner to prove it's them. */
export function isWaitingForOwner(ch: ChannelView): boolean {
  return ch.status === "pending" || (ch.status === "needs_setup" && ch.hasCredential && !ch.ownerVerified);
}

export const CHANNEL_ORDER: ChannelKind[] = ["web", "telegram", "sms", "voice", "email", "discord", "slack", "whatsapp", "imessage", "teams", "google_chat", "signal"];

export function sortChannels<T extends { kind: ChannelKind }>(list: T[]): T[] {
  return [...list].sort((a, b) => CHANNEL_ORDER.indexOf(a.kind) - CHANNEL_ORDER.indexOf(b.kind));
}
