/**
 * Classify third-party tools (MCP / Composio) into effects + risk for the policy
 * engine. A name's verb says what a tool does: get_, list_, search_, fetch_… only
 * read, whatever they read (emails, messages, comments, orders). Annotations are
 * hints from the server: they count where the name has no verb, and when they say a
 * tool changes things. When unsure, we pick the more careful classification.
 */
import type { Effect, Risk } from "../types";

const SEND = /(^|_)(send|post|reply|comment|message|email|invite|share|publish|tweet|notify|forward|dm|broadcast|mention)(_|s?$)/i;
const DELETE = /(^|_)(deletes?|removes?|archive|trash|destroy|purge|cancel|unsubscribe|revoke|close)(_|$)/i;
const SPEND = /(^|_)(pay|charge|purchase|buy|order|refund|transfer|payout|checkout|subscribe)(_|$)/i;
const ADMIN = /(^|_)(permission|permissions|admin|role|roles|member|members|settings|configure|config|grant|sharing|collaborator|webhook)(_|$)/i;

/** Verbs that only read (and "who", as in who_am_i). */
const READS = new Set(
  "get gets list lists search searches find finds read reads fetch fetches query queries lookup look view show describe check count retrieve retrieves download export summarize browse preview who".split(" "),
);
/** Verbs that change something (the rules below say how carefully to treat it). Plurals only where they can't be nouns. */
const CHANGES = new Set(
  (
    "send sends post reply forward share publish tweet notify broadcast invite delete deletes remove removes archive trash destroy purge cancel " +
    "unsubscribe revoke close clear reset pay charge purchase buy order refund transfer payout checkout subscribe create creates add adds insert " +
    "update patch edit modify set put write upload move copy rename duplicate star unstar mark assign unassign schedule reschedule book reserve " +
    "start stop run execute perform trigger invoke call approve merge accept decline reject enable disable grant configure import sync restore " +
    "untrash apply save submit upsert replace append link unlink attach detach pin unpin follow unfollow like react vote join leave kick ban mute " +
    "unmute unblock lock unlock push watch generate convert translate request rerequest"
  ).split(" "),
);

function words(name: string): string[] {
  return name.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[-.\s]/g, "_").toLowerCase().split("_").filter(Boolean);
}

/**
 * A name's verb: its first word if that's a verb ("send_email"), else its last ("events_list",
 * Google's style), else the first verb in it ("outlook_list_messages", after an app's name).
 */
function verbOf(w: string[]): string | undefined {
  const isVerb = (x: string | undefined) => x !== undefined && (READS.has(x) || CHANGES.has(x));
  if (isVerb(w[0])) return w[0];
  if (isVerb(w[w.length - 1])) return w[w.length - 1];
  return w.find(isVerb);
}

export function classifyTool(
  name: string,
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean },
): { effect: Effect; risk: Risk } {
  const w = words(name);
  const n = w.join("_");
  const verb = verbOf(w);
  // A server that says a tool changes things is believed over a name that says it reads.
  const changes = annotations?.readOnlyHint === false || annotations?.destructiveHint === true;
  if (!changes && (verb ? READS.has(verb) : annotations?.readOnlyHint === true)) return { effect: "read", risk: "low" };
  if (SPEND.test(n)) return { effect: "spend", risk: "high" };
  if (DELETE.test(n)) return { effect: "delete", risk: "high" };
  if (ADMIN.test(n)) return { effect: "admin", risk: "high" };
  if (SEND.test(n)) return { effect: "send", risk: /email|mail|message|dm/.test(n) ? "high" : "medium" };
  if (annotations?.destructiveHint === true) return { effect: "write", risk: "high" };
  return { effect: "write", risk: "medium" };
}

/** Tools that tune the app itself rather than do the work: settings, access lists, keys, filters, watches. */
const PLUMBING = /(^|_)(settings?|acl|cse|smime|keypairs?|identities|vacation|imap|pop|forwarding|filters?|send_as|delegates?|webhooks?|watch|colors|quota|language|calendar_list|buildings)(_|$)/;
/** The verbs of everyday work, by how soon a bot needs them: finding and sending first, then other reads and making things, then changing them. */
const EVERYDAY = new Map<string, number>();
for (const v of [...READS, "create", "creates", "add", "adds", "schedule"]) EVERYDAY.set(v, 1);
for (const v of ["update", "patch", "edit"]) EVERYDAY.set(v, 2);
for (const v of ["fetch", "fetches", "list", "lists", "search", "searches", "find", "finds", "send", "sends", "reply", "forward", "post"]) EVERYDAY.set(v, 0);

/**
 * Which of an app's tools a bot gets when it can't have them all (Gmail has 61): half that read
 * and half that act, where there are enough of each; everyday work first (fetch, search, send,
 * reply, then create, then update), then the rest, then tools that tune the app itself. Ties
 * keep the app's own order (Composio lists the most important first). The list comes back best
 * first, so a shorter share of it is still a good mix.
 */
export function pickTools<T>(tools: T[], max: number, about: (t: T) => { name: string; effect: Effect }): T[] {
  const ranked = tools
    .map((t, i) => {
      const { name, effect } = about(t);
      const w = words(name);
      const tier = PLUMBING.test(w.join("_")) ? 9 : (EVERYDAY.get(verbOf(w) ?? "") ?? 5);
      return { t, i, tier, read: effect === "read" };
    })
    .sort((a, b) => a.tier - b.tier || a.i - b.i);
  const reads = ranked.filter((x) => x.read);
  const acts = ranked.filter((x) => !x.read);
  const out: T[] = [];
  while (out.length < max) {
    const next = out.length % 2 ? (acts.shift() ?? reads.shift()) : (reads.shift() ?? acts.shift());
    if (!next) break;
    out.push(next.t);
  }
  return out;
}

// recipient_email and extra_recipients are how Composio's Gmail tools take theirs.
const RECIPIENT_KEYS = /^(to|cc|bcc|recipient|recipients|recipient_email|extra_recipients|email|emails|attendees|invitees|participants|user_email|share_with|emailaddress|email_address)$/i;

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
