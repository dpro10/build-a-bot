/**
 * The policy engine: decides, in code, whether a tool call may run.
 *
 * Inputs describe the action (its effect, risk, recipients, amount...) and the run
 * (trust level, paused, whether it has read content the owner didn't write).
 * Output is allow / ask / deny with machine-readable reasons and a sentence the
 * model and the owner can read.
 *
 * Design rules (docs/research-2026-10-13.md, "Minimum to ship"):
 *  1. Rules live outside the model and survive prompt injection, memory loss and model swaps.
 *  2. After a run reads content the owner didn't write ("tainted"), it cannot send to
 *     someone new without approval. This holds even under full faith.
 *  3. Money is off unless the owner set a cap; the cap is never exceeded.
 *  4. Secrets never leave.
 *  5. STOP (paused) beats everything.
 *  6. Some actions always wait for the owner's tap, at every trust level (a tool's
 *     `alwaysAsk`, e.g. submitting a form on a website after showing a preview).
 */
import type { Effect, Risk } from "@/lib/connectors/types";
import type { TrustLevel } from "@/lib/trust";

export type Verdict = "allow" | "ask" | "deny";

export type ReasonCode =
  | "paused"
  | "look_only"
  | "owner_rule_deny"
  | "owner_rule_ask"
  | "needs_approval"
  | "high_risk"
  | "sensitive_app"
  | "tainted_send_new_recipient"
  | "new_recipient"
  | "quiet_hours"
  | "money_off"
  | "over_spend_cap"
  | "bulk_delete"
  | "daily_action_cap"
  | "secret_in_payload"
  | "always_ask";

export type Recipient = {
  address: string;
  kind: string; // email | phone | telegram | slack | discord | github | ...
  isOwner: boolean;
  isKnownContact: boolean;
};

export type ActionContext = {
  trust: TrustLevel;
  paused: boolean;
  effect: Effect;
  risk: Risk;
  /** Money, health or identity connector. */
  sensitive?: boolean;
  /** The owner's per-connection rule for this capability, if any. */
  ownerRule?: "allow" | "ask" | "deny";
  /** The run has read content not written by the owner (web pages, other people's emails...). */
  tainted: boolean;
  recipients?: Recipient[];
  amountUsd?: number;
  spendCapUsd?: number;
  spentThisMonthUsd?: number;
  actionsToday: number;
  dailyActionCap?: number;
  itemCount?: number;
  /** Text that would leave (email body, message, file contents) — scanned for secrets. */
  outboundText?: string;
  inQuietHours?: boolean;
  /** The tool always needs the owner's tap, whatever the trust level or owner rules (only STOP or an owner's "off" beat it). */
  alwaysAsk?: boolean;
};

export type Decision = {
  verdict: Verdict;
  reasons: ReasonCode[];
  message: string;
};

export const BULK_DELETE_THRESHOLD = 10;

const REASON_TEXT: Record<ReasonCode, string> = {
  paused: "The bot is paused (STOP). Nothing runs until the owner resumes it.",
  look_only: "This bot is set to Look only, so it can read but not act.",
  owner_rule_deny: "The owner turned this action off for this app.",
  owner_rule_ask: "The owner asked to approve this action every time.",
  needs_approval: "This trust level needs the owner's tap before acting.",
  high_risk: "High-stakes action: the owner approves these.",
  sensitive_app: "This app holds money, health or identity data, so changes need the owner's tap.",
  tainted_send_new_recipient:
    "This run read outside content, so sending to someone new needs the owner's OK (prompt-injection guard).",
  new_recipient: "First message to someone new needs the owner's OK.",
  quiet_hours: "It's the owner's quiet hours; messages to other people wait for approval.",
  money_off: "Spending is off. The owner can turn it on with a monthly cap.",
  over_spend_cap: "This would go over the owner's monthly spending cap.",
  bulk_delete: `Deleting more than ${BULK_DELETE_THRESHOLD} items at once needs the owner's OK.`,
  daily_action_cap: "The bot hit its daily limit of unattended actions; the owner can approve more.",
  secret_in_payload: "This looks like it contains a password or API key. Secrets never leave.",
  always_ask: "This kind of action always waits for the owner's OK, at every trust level (like sending a form on a website after a preview).",
};

/** Patterns for credentials that must never be sent anywhere. */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{20,}\b/, // OpenAI / Anthropic / Stripe-style secret keys
  /\b(?:rk|sk)_(?:live|test)_[A-Za-z0-9]{16,}\b/, // Stripe
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, // Slack tokens
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API keys
  /\btvly-[A-Za-z0-9-]{16,}\b/, // Tavily
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\b\d{3}-\d{2}-\d{4}\b(?=[^\n]{0,40}\b(?:ssn|social security)\b)/i,
];

export function containsSecret(text: string | undefined): boolean {
  if (!text) return false;
  return SECRET_PATTERNS.some((re) => re.test(text));
}

function decide(verdict: Verdict, reasons: ReasonCode[]): Decision {
  const unique = [...new Set(reasons)];
  const message = unique.length ? unique.map((r) => REASON_TEXT[r]).join(" ") : verdict === "allow" ? "Allowed." : "";
  return { verdict, reasons: unique, message };
}

/** The verdict ordering used when combining rules: deny > ask > allow. */
function strongest(a: Verdict, b: Verdict): Verdict {
  const rank = { allow: 0, ask: 1, deny: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

export function evaluate(ctx: ActionContext): Decision {
  // 1. STOP beats everything.
  if (ctx.paused) return decide("deny", ["paused"]);

  // 2. The owner's explicit per-app rule. "deny" and "ask" can only tighten.
  if (ctx.ownerRule === "deny") return decide("deny", ["owner_rule_deny"]);

  // 3. Reading is allowed at every level (it can still be turned off per app above).
  if (ctx.effect === "read") {
    const asks: ReasonCode[] = [];
    if (ctx.alwaysAsk) asks.push("always_ask");
    if (ctx.ownerRule === "ask") asks.push("owner_rule_ask");
    return asks.length ? decide("ask", asks) : decide("allow", []);
  }

  // 4. Look only: nothing but reads.
  if (ctx.trust === "look") return decide("deny", ["look_only"]);

  let verdict = "allow" as Verdict;
  const reasons: ReasonCode[] = [];
  const bump = (v: Verdict, r: ReasonCode) => {
    verdict = strongest(verdict, v);
    reasons.push(r);
  };

  const externalRecipients = (ctx.recipients ?? []).filter((r) => !r.isOwner);
  const newRecipients = externalRecipients.filter((r) => !r.isKnownContact);

  // 5. Hard floors — apply at every trust level, including full faith.
  if (ctx.alwaysAsk) bump("ask", "always_ask");

  if (containsSecret(ctx.outboundText)) {
    // Even to the owner we ask; to anyone else, never.
    bump(externalRecipients.length ? "deny" : "ask", "secret_in_payload");
  }

  if (ctx.effect === "spend") {
    if (!ctx.spendCapUsd || ctx.spendCapUsd <= 0) {
      bump("deny", "money_off");
    } else if (ctx.amountUsd === undefined) {
      // The app doesn't say what it costs: the owner sees the purchase and decides.
      bump("ask", "needs_approval");
    } else if ((ctx.spentThisMonthUsd ?? 0) + ctx.amountUsd > ctx.spendCapUsd) {
      bump("deny", "over_spend_cap");
    } else if (ctx.trust !== "full") {
      bump("ask", "needs_approval");
    }
  }

  if (newRecipients.length > 0 && ctx.tainted) bump("ask", "tainted_send_new_recipient");
  // Money, health and identity apps: changes always need a tap (the catalog promises "never auto-allowed").
  if (ctx.sensitive && ctx.effect !== "spend") bump("ask", "sensitive_app");
  if (externalRecipients.length > 0 && ctx.inQuietHours) bump("ask", "quiet_hours");
  if (ctx.effect === "delete" && (ctx.itemCount ?? 1) > BULK_DELETE_THRESHOLD) bump("ask", "bulk_delete");

  const cap = ctx.dailyActionCap;
  if (cap !== undefined && ctx.actionsToday >= cap && ctx.trust !== "ask") bump("ask", "daily_action_cap");

  if (ctx.ownerRule === "ask") bump("ask", "owner_rule_ask");

  // 6. The trust matrix for everything else.
  switch (ctx.trust) {
    case "ask":
      if (ctx.effect !== "spend") bump("ask", "needs_approval");
      break;
    case "trusted": {
      if (ctx.effect === "delete" || ctx.effect === "admin") bump("ask", "needs_approval");
      if (ctx.risk === "high") bump("ask", "high_risk");
      if (newRecipients.length > 0) bump("ask", "new_recipient");
      break;
    }
    case "full":
      break;
  }

  // An owner "allow" rule relaxes the trust matrix, never the hard floors.
  if (ctx.ownerRule === "allow" && verdict === "ask") {
    const floors: ReasonCode[] = [
      "always_ask",
      "secret_in_payload",
      "tainted_send_new_recipient",
      "quiet_hours",
      "bulk_delete",
      "daily_action_cap",
      "sensitive_app",
      "needs_approval",
    ];
    const remaining = reasons.filter((r) => floors.includes(r) && !(r === "needs_approval" && ctx.effect !== "spend"));
    if (remaining.length === 0) return decide("allow", []);
    return decide("ask", remaining);
  }

  return decide(verdict, verdict === "allow" ? [] : reasons);
}

/** Tools whose output may carry instructions from someone other than the owner. */
export function taintsRun(effect: Effect, opts: { taints?: boolean }): boolean {
  if (typeof opts.taints === "boolean") return opts.taints;
  return effect === "read";
}
