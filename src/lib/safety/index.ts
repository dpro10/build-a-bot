/**
 * Safety helpers enforced in code (not left to the model):
 *  - STOP / START / HELP commands from any channel.
 *  - Crisis detection with a 988 referral appended to the reply (published protocol: /safety).
 *  - AI disclosure at the start of a conversation and every 3 hours (CA SB 243, NY GBL Art. 47).
 */

export type OwnerCommand = "stop" | "start" | "help" | "status" | null;

export function parseOwnerCommand(text: string): OwnerCommand {
  const t = text.trim().toLowerCase().replace(/^\//, "").replace(/[.!]+$/, "");
  if (["stop", "pause", "stop all", "halt", "emergency stop", "stopall"].includes(t)) return "stop";
  if (["start", "resume", "unpause", "go", "wake up"].includes(t)) return "start";
  if (["help", "commands", "info"].includes(t)) return "help";
  if (["status", "are you on", "are you paused"].includes(t)) return "status";
  return null;
}

/** Carrier opt-out words a non-owner may send (TCPA): we must stop messaging them. */
export function isOptOut(text: string): boolean {
  return /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out|revoke)\s*$/i.test(text);
}

const CRISIS_PATTERNS: RegExp[] = [
  /\b(kill|hurt|harm)\s+(myself|me)\b/i,
  /\bsuicid(e|al)\b/i,
  /\bend\s+(my|it all|my life)\b/i,
  /\b(don'?t|do not)\s+want\s+to\s+(live|be alive|exist)\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bself[-\s]?harm\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
  /\boverdose\b/i,
];

export function detectCrisis(text: string): boolean {
  return CRISIS_PATTERNS.some((re) => re.test(text));
}

export const CRISIS_GUIDANCE =
  "The owner's message may indicate they're in crisis or thinking about self-harm. Respond with warmth and care, take it seriously, don't lecture, and encourage them to reach out to a person now. Make sure they know they can call or text 988 (Suicide & Crisis Lifeline, US) any time, or their local emergency number.";

export const CRISIS_FOOTER =
  "If you're thinking about hurting yourself, you don't have to go through it alone: call or text 988 (Suicide & Crisis Lifeline, US, 24/7), or text HOME to 741741. Outside the US, findahelpline.com lists local lines. If you're in immediate danger, call 911.";

export const DISCLOSURE_INTERVAL_MS = 3 * 60 * 60 * 1000;

/** Chat apps that tag a bot as an app on every message it sends. */
const TAGGED_AS_APP = new Set(["slack", "telegram", "discord"]);

/**
 * Say it's an AI at first contact, then every 3 hours. The web app says so in its UI. The bot's
 * owner on Slack, Telegram or Discord hears it once: those apps tag the bot on every message
 * (Diego, 2026-10-15).
 */
export function needsDisclosure(lastDisclosureAt: Date | null, to: { channel: string; owner: boolean }, now = new Date()): boolean {
  if (to.channel === "web") return false;
  if (!lastDisclosureAt) return true;
  if (to.owner && TAGGED_AS_APP.has(to.channel)) return false;
  return now.getTime() - lastDisclosureAt.getTime() >= DISCLOSURE_INTERVAL_MS;
}

export function disclosureLine(botName: string): string {
  return `(${botName} is an AI assistant, not a person.)`;
}

export const HELP_TEXT = (botName: string) =>
  `${botName} commands:\n• STOP — pause me everywhere, instantly\n• START — wake me back up\n• STATUS — am I on?\nEverything else: just talk to me. I'm an AI assistant.`;
