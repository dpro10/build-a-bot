/**
 * Plain-language "why is my bot asking?" lines for the policy engine's reason codes
 * (src/lib/policy/engine.ts → ReasonCode). Shown on the Approvals page.
 */
import { BULK_DELETE_THRESHOLD, type ReasonCode } from "@/lib/policy/engine";

export type ReasonTone = "neutral" | "warning" | "danger";
export type ReasonIcon = "trust" | "stakes" | "person" | "guard" | "sensitive" | "delete" | "limit" | "moon" | "rule" | "secret" | "money" | "pause" | "eye";

export type ReasonCopy = { label: string; text: string; tone: ReasonTone; icon: ReasonIcon };

const REASONS: Record<ReasonCode, ReasonCopy> = {
  always_ask: {
    label: "Always asks first",
    text: "Sending a form on a website always waits for your OK, at every trust level. Check the preview of what will be submitted.",
    tone: "warning",
    icon: "eye",
  },
  needs_approval: {
    label: "Your trust setting",
    text: "This bot's trust level says to check with you before doing this.",
    tone: "neutral",
    icon: "trust",
  },
  high_risk: {
    label: "High stakes",
    text: "This is a high-stakes action, so you make the call.",
    tone: "warning",
    icon: "stakes",
  },
  new_recipient: {
    label: "Someone new",
    text: "It's the first time it would message this person.",
    tone: "neutral",
    icon: "person",
  },
  tainted_send_new_recipient: {
    label: "Prompt-injection guard",
    text: "It read outside content (like a web page or someone else's email) and now wants to message someone new — a common prompt-injection trick. Make sure this is really what you asked for.",
    tone: "danger",
    icon: "guard",
  },
  sensitive_app: {
    label: "Sensitive app",
    text: "This app holds money, health or identity info, so changes always need your tap.",
    tone: "warning",
    icon: "sensitive",
  },
  bulk_delete: {
    label: "Bulk delete",
    text: `It wants to delete more than ${BULK_DELETE_THRESHOLD} things at once.`,
    tone: "warning",
    icon: "delete",
  },
  daily_action_cap: {
    label: "Daily limit reached",
    text: "It already did its daily share of things on its own today. Approve this one to let it keep going.",
    tone: "neutral",
    icon: "limit",
  },
  quiet_hours: {
    label: "Quiet hours",
    text: "It's your quiet hours, so messages to other people wait for your OK.",
    tone: "neutral",
    icon: "moon",
  },
  owner_rule_ask: {
    label: "Your rule",
    text: "You asked to approve this action every time for this app.",
    tone: "neutral",
    icon: "rule",
  },
  secret_in_payload: {
    label: "Possible secret",
    text: "This looks like it contains a password or API key. Check it carefully — secrets should never leave.",
    tone: "danger",
    icon: "secret",
  },
  over_spend_cap: {
    label: "Over your spending cap",
    text: "This would go over the monthly spending cap you set.",
    tone: "danger",
    icon: "money",
  },
  money_off: {
    label: "Spending is off",
    text: "Spending is turned off for this bot. Set a monthly cap in its settings to allow it.",
    tone: "warning",
    icon: "money",
  },
  owner_rule_deny: {
    label: "Turned off",
    text: "You turned this action off for this app.",
    tone: "warning",
    icon: "rule",
  },
  look_only: {
    label: "Look only",
    text: "This bot is set to Look only, so it can read but not act.",
    tone: "neutral",
    icon: "eye",
  },
  paused: {
    label: "Paused",
    text: "This bot is paused. Nothing runs until you resume it.",
    tone: "neutral",
    icon: "pause",
  },
};

export function reasonCopy(code: string): ReasonCopy {
  const known = REASONS[code as ReasonCode];
  if (known) return known;
  const label = code.replace(/_/g, " ");
  return { label: label.charAt(0).toUpperCase() + label.slice(1), text: "Your bot's safety rules want your OK for this one.", tone: "neutral", icon: "trust" };
}
