/**
 * Classify third-party tools (MCP / Composio) into effects + risk for the policy
 * engine. Annotations are hints from the server; names are a second signal. When
 * unsure, we pick the more careful classification.
 */
import type { Effect, Risk } from "../types";

const READ = /^(get|list|search|find|read|fetch|query|lookup|look_up|view|show|describe|check|count|retrieve|download|export|summarize|browse|preview)(_|$)|_(get|list|search|find|read|fetch|retrieve)(_|$)/i;
const SEND = /(^|_)(send|post|reply|comment|message|email|invite|share|publish|tweet|notify|forward|dm|broadcast|mention)(_|s?$)/i;
const DELETE = /(^|_)(delete|remove|archive|trash|destroy|purge|cancel|unsubscribe|revoke|close)(_|$)/i;
const SPEND = /(^|_)(pay|charge|purchase|buy|order|refund|transfer|payout|checkout|subscribe)(_|$)/i;
const ADMIN = /(^|_)(permission|permissions|admin|role|roles|member|members|settings|configure|config|grant|sharing|collaborator|webhook)(_|$)/i;

export function classifyTool(
  name: string,
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean },
): { effect: Effect; risk: Risk } {
  const n = name.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-.\s]/g, "_").toLowerCase();
  if (SPEND.test(n)) return { effect: "spend", risk: "high" };
  if (DELETE.test(n)) return { effect: "delete", risk: "high" };
  if (ADMIN.test(n) && !READ.test(n)) return { effect: "admin", risk: "high" };
  if (SEND.test(n)) return { effect: "send", risk: /email|mail|message|dm/.test(n) ? "high" : "medium" };
  if (annotations?.readOnlyHint === true || READ.test(n)) return { effect: "read", risk: "low" };
  if (annotations?.destructiveHint === true) return { effect: "write", risk: "high" };
  return { effect: "write", risk: "medium" };
}

const RECIPIENT_KEYS = /^(to|cc|bcc|recipient|recipients|email|emails|attendees|invitees|participants|user_email|share_with|emailaddress|email_address)$/i;

/** Pull email-like recipients out of arbitrary tool arguments. */
export function extractEmails(args: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const visit = (key: string, value: unknown, depth: number) => {
    if (depth > 3 || value == null) return;
    if (typeof value === "string") {
      if (RECIPIENT_KEYS.test(key)) for (const m of value.matchAll(/[^\s,;<>"]+@[^\s,;<>"]+\.[a-z]{2,}/gi)) out.add(m[0].toLowerCase());
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(key, v, depth + 1);
      return;
    }
    if (typeof value === "object") for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(RECIPIENT_KEYS.test(key) ? key : k, v, depth + 1);
  };
  for (const [k, v] of Object.entries(args)) visit(k, v, 0);
  return [...out];
}
