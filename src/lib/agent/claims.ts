/**
 * Never a claim the tools don't back. A model sometimes tells the owner it set a reminder, saved
 * something or added an event without calling the tool, or after the call failed. The turn loop
 * (run.ts) checks each answer against what really ran: once per turn it asks the model to do it or
 * say it can't, and if the final answer still claims it, the owner is told plainly it wasn't done.
 *
 * What counts, each checked against this turn's tool results:
 *  - the answer says it did it: "I've set a reminder", "I'll remind you", "added to your calendar";
 *  - it says so less directly ("your reminder is set", "Noted!"), unless a tool of the kind ran
 *    (listing reminders, reading the calendar), when that's likely describing what's already there;
 *  - the owner plainly asked for a reminder, or for something to be remembered, and the answer
 *    (not a question back, not a "can't") goes without anything being set or saved.
 * Sending is checked too; honestAboutSends (run.ts) still strips made-up "[message sent …]" notes.
 */
import type { MessagePart } from "@/lib/db/schema";
import { getConnector } from "@/lib/connectors";
import type { AnyToolSpec } from "@/lib/tools/types";

export type ClaimKind = "schedule" | "cancel" | "memory" | "calendar" | "send";

type ToolInfo = Pick<AnyToolSpec, "name" | "effect" | "connectorId">;
type Tools = { byName: Map<string, ToolInfo> };

type Rule = {
  kind: ClaimKind;
  /** What the answer says was done, as the model is told ("set a reminder"). */
  did: string;
  /** Said outright, in the first person. Always needs a tool that backs it. */
  strong: RegExp[];
  /** Said less directly. Doesn't count when a tool of this kind ran (it may describe what's there). */
  weak: RegExp[];
  /** The owner plainly asked for it (only for what every bot has a tool for). */
  asked?: RegExp;
  /** A tool that, having worked (or waiting for the owner's OK), backs the claim. */
  backs: (t: ToolInfo) => boolean;
  /** Tools of this kind that don't back a claim but show the answer is about what's there. */
  related?: (t: ToolInfo) => boolean;
  /** The plain truth for the owner when the final answer still claims it. */
  truth: string;
};

// "I've", "I have", "I just", "I already", "I also", or a plain "I".
const I_DID = String.raw`\bI(?:'ve| have| just| already| also|'ve also|'ve just| have also)?\s+`;
const I_WILL = String.raw`\bI(?:'ll| will)\s+`;
const SOME = String.raw`(?:(?:a|an|the|your|that|this|those|these|two|three|both|them|it|one|another)\s+)?(?:[\w-]+\s+){0,3}?`;
const SCHEDULED = String.raw`(?:reminders?|routines?|check-?ins?|alarms?|timers?)`;
const WHEN = String.raw`(?:at|on|by|tomorrow|tonight|today|in \d+|in an?|every|each|this (?:morning|afternoon|evening)|next)\b`;
const DAY = String.raw`(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend)`;
/** A time in a request: "at 6", "6:30 pm", "tomorrow", "on Friday", "in 10 minutes", "every …". */
const TIME = String.raw`(?:at \d|at (?:noon|midnight)|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|tomorrow|tonight|this (?:morning|afternoon|evening|weekend)|next (?:week|month|${DAY})|on (?:${DAY}|the \d)|in (?:\d+|an?|one|two|three|five|ten|fifteen|twenty|thirty|a few|a couple of) (?:sec|min|minute|hour|day|week)|every|each|noon|midnight)`;

const isCalendar = (t: ToolInfo) => getConnector(t.connectorId)?.category === "calendar" || /calendar/i.test(t.name);

export const NOTHING_SENT = "To be clear: nothing has been sent.";

const RULES: Rule[] = [
  {
    kind: "schedule",
    did: "set a reminder or a routine",
    strong: [
      new RegExp(`${I_DID}(?:set(?: up)?|scheduled|created|added|made|saved|booked|put in)\\s+${SOME}${SCHEDULED}\\b`, "i"),
      new RegExp(`${I_WILL}(?:set(?: up)?|schedule|create|add)\\s+${SOME}${SCHEDULED}\\b`, "i"),
      new RegExp(`${I_WILL}remind you\\b`, "i"),
      new RegExp(`${I_WILL}(?:ping|nudge|text|message|call|notify|alert)\\s+you\\b[^.!?\\n]{0,40}?\\b${WHEN}`, "i"),
    ],
    weak: [
      new RegExp(`\\b${SCHEDULED}\\b[^.!?\\n]{0,60}?\\b(?:is|are|has been|have been|was|were)\\s+(?:all\\s+|now\\s+)?(?:set|scheduled|created|added|saved|booked)\\b`, "i"),
      new RegExp(`\\b${SCHEDULED}\\s+(?:set|scheduled|created|added|saved)\\b`, "i"),
      /\byou(?:'ll| will)\s+(?:get|receive|hear)\s+(?:a\s+|an\s+|your\s+)?(?:reminder|notification|ping|nudge|alert)\b/i,
      /\byou(?:'ll| will) be reminded\b/i,
    ],
    asked: new RegExp(
      [
        `\\bremind (?:me|us) (?:to|that)\\b`,
        `\\bremind (?:me|us)\\b[^.!?\\n]{0,80}?\\b${TIME}`,
        `\\b(?:set|create|add|make|schedule|start)\\s+(?:me\\s+)?(?:a|an|my|the)\\s+(?:[\\w-]+\\s+){0,2}?(?:reminder|alarm|timer|routine|check-?in)\\b`,
        `\\b(?:alarm|timer) for\\b`,
        `\\bwake me up\\b`,
        `\\b(?:every|each) (?:day|morning|evening|night|weekday|weekend|week|month|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\\d+ (?:minutes|hours|days))\\b[^.!?\\n]{0,80}?\\b(?:send|remind|tell|text|message|give|check|ping|call)\\b`,
        `\\b(?:send|remind|tell|text|message|give|ping|call) me\\b[^.!?\\n]{0,80}?\\b(?:every|each) (?:day|morning|evening|night|weekday|weekend|week|month|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b`,
      ].join("|"),
      "i",
    ),
    backs: (t) => t.name === "create_reminder" || t.name === "schedule_routine",
    related: (t) => t.name === "list_reminders" || t.name === "cancel_reminder",
    truth: "To be clear: no reminder was set.",
  },
  {
    kind: "cancel",
    did: "cancelled a reminder or a routine",
    strong: [new RegExp(`${I_DID}(?:cancell?ed|deleted|removed|stopped|turned off|cleared|paused)\\s+${SOME}${SCHEDULED}\\b`, "i")],
    weak: [
      new RegExp(`\\b${SCHEDULED}\\b[^.!?\\n]{0,60}?\\b(?:is|are|has been|have been|was|were)\\s+(?:now\\s+)?(?:cancell?ed|deleted|removed|stopped|turned off|cleared|gone|paused)\\b`, "i"),
    ],
    backs: (t) => t.name === "cancel_reminder",
    related: (t) => t.name === "list_reminders",
    truth: "To be clear: nothing was cancelled.",
  },
  {
    kind: "memory",
    did: "saved it to memory or notes",
    strong: [
      new RegExp(`${I_DID}(?:saved|stored|noted|recorded|written down|jotted down|made a note of|taken note of|committed)\\s+(?:that|this|it|them|the fact|down)\\b`, "i"),
      new RegExp(`${I_DID}(?:made|taken|added|saved|created|written)\\s+(?:a|the|your)\\s+(?:quick\\s+)?note\\b`, "i"),
      new RegExp(`${I_WILL}(?:remember|keep (?:that|this|it|them) in mind|note (?:that|this|it))\\b`, "i"),
      /\b(?:saved|stored|added|written)\s+(?:it\s+|that\s+|this\s+)?(?:to|in|into)\s+(?:your\s+|my\s+)?(?:memory|notes)\b/i,
    ],
    weak: [/^\s*(?:got it[.!,]?\s*|okay[.!,]?\s*|ok[.!,]?\s*)?noted\b/im],
    asked: /\b(?:remember (?:that|this|my|to|when|where)|don't forget|(?:take|make|jot) (?:down )?(?:a )?note|note (?:that|this|down)|write (?:this|that|it) down|jot (?:this|that|it) down|save (?:this|that) (?:to|in) (?:your )?(?:memory|notes))\b/i,
    backs: (t) => t.name === "remember" || t.name === "write_note",
    related: (t) => t.name === "recall" || t.name === "forget" || t.name === "list_notes" || t.name === "read_note",
    truth: "To be clear: I didn't save that.",
  },
  {
    kind: "calendar",
    did: "added it to their calendar",
    strong: [
      new RegExp(`${I_DID}(?:added|put|scheduled|booked|saved|created|placed|blocked(?: off| out)?)\\b[^.!?\\n]{0,80}?\\b(?:to|on|in|into)\\s+(?:your|the)\\s+(?:[\\w-]+\\s+)?calendar\\b`, "i"),
      new RegExp(`${I_DID}(?:created|added|booked|scheduled|sent)\\s+(?:a|an|the|your)\\s+(?:calendar\\s+)?(?:event|invite|invitation|meeting|appointment)\\b`, "i"),
    ],
    weak: [
      /^\s*(?:done[.!,]?\s*|all set[.!,]?\s*)?(?:added|booked|scheduled|put)\b[^.!?\n]{0,80}?\b(?:to|on|in|into)\s+(?:your|the)\s+(?:[\w-]+\s+)?calendar\b/im,
      /\b(?:has been|have been|was|were|is now|are now)\s+(?:added|put|scheduled|booked|saved|created|placed)\b[^.!?\n]{0,60}?\b(?:to|on|in|into)\s+(?:your|the)\s+(?:[\w-]+\s+)?calendar\b/i,
      /\b(?:it's|it is|that's|that is|they're|they are)\s+(?:now\s+|all\s+)?(?:on|in)\s+your\s+(?:[\w-]+\s+)?calendar\b/i,
      /\bcalendar (?:event|invite|entry|hold)s?\b[^.!?\n]{0,40}?\b(?:created|added|set|scheduled|sent|booked)\b/i,
    ],
    backs: (t) => t.effect !== "read" && isCalendar(t),
    related: isCalendar,
    truth: "To be clear: nothing was added to your calendar.",
  },
  {
    kind: "send",
    did: "sent a message",
    strong: [
      /^[ \t]*\[(?:message|email|e-mail|text|sms|dm|reply)s?\s+(?:was\s+)?sent\b[^\]\n]*\]/im,
      /\bI(?:'ve| have| just)?\s+(?:emailed|e-mailed|texted|messaged)\b/i,
      /\bI(?:'ve| have| just)?\s+sent\s+(?:(?:the|your|an?|that|this|her|him|them|it)\s+)?(?:email|e-mail|message|text|reply|invite|invitation|note to)\b/i,
      /\b(?:email|e-mail|message|text|reply|invitation)\b[^.!?\n]{0,60}\b(?:has been|was|is now)\s+sent\b/i,
    ],
    weak: [],
    backs: (t) => t.effect === "send",
    truth: NOTHING_SENT,
  },
];

/** Before a claim, in its sentence: it's a "no", an "if", or an offer, not something done. */
const NOT_DONE_BEFORE =
  /(?:n't\b|\b(?:not|no|never|nothing|none|cannot|if|unless|(?:once|when|whenever|after|as soon as) you|just (?:tell|say|let)|tell me|let me know|want me to|would you like|should I|shall I|could I|can I)\b)/i;
/** …or after it: "I'll remind you if you like", "once you tell me the time". */
const OFFER_AFTER = /\b(?:if you|once you|whenever you|when you (?:tell|let|say|give|decide|confirm|pick)|just (?:tell|say|let) me)\b/i;
/** An answer that says it can't (or didn't): it claims nothing done. */
const CANT =
  /(?:can't|cannot|can not|unable|not able|couldn't|wasn't able|won't be able|didn't|haven't|don't have|do not have|doesn't have|isn't (?:possible|available)|not (?:yet )?(?:connected|set up|available|possible)|failed|no (?:tool|way|access))\b/i;

/** Straight quotes, so the patterns don't care how a model typed its apostrophes. */
function plainQuotes(text: string): string {
  return text.replace(/[’‘]/g, "'");
}

/**
 * The answer in the bot's own words: what it quotes ("Dana: I'll set up a check-in for Tuesday"
 * from a meeting, a drafted email, a transcript) is someone else's, not a claim.
 */
function ownWords(text: string): string {
  return text
    .replace(/<(untrusted_[a-z_]+|message_from_contact)\b[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[ \t]*>.*$/gm, " ")
    .replace(/^[ \t]*\[\d{1,2}:\d{2}(?::\d{2})?\].*$/gm, " ")
    .replace(/“[^”]{0,800}”|"[^"\n]{0,800}"/g, "“…”");
}

/** The sentences of a reply, each with its end mark ("Done!", "What time?"). */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Does a sentence say it was done (not "I can't…", not "if you like, I'll…", not a question)? */
function says(text: string, patterns: RegExp[]): boolean {
  for (const sentence of sentences(text)) {
    if (/\?\s*\**\s*$/.test(sentence)) continue;
    for (const re of patterns) {
      const m = re.exec(sentence);
      if (m && !NOT_DONE_BEFORE.test(sentence.slice(0, m.index)) && !OFFER_AFTER.test(sentence.slice(m.index + m[0].length))) return true;
    }
  }
  return false;
}

/** A request phrased as a question about the past ("did you remind me…?") asks for nothing new. */
function asksFor(ownerText: string, asked: RegExp | undefined): boolean {
  if (!asked || !asked.test(ownerText)) return false;
  const t = ownerText.trim();
  return !/\?\s*$/.test(t) || /^(?:hey\s+\w+[,!]?\s+)?(?:please\s+)?(?:can|could|would|will) you\b/i.test(t);
}

export type Unbacked = { kind: ClaimKind; did: string; truth: string; tools: string[] };

/**
 * What an answer says was done (or what the owner asked for and the answer went without) that no
 * tool backs in this turn. `ownerText` is the owner's message, when the turn answers one.
 */
export function unbackedClaims(answer: string, ownerText: string | null, parts: MessagePart[], tools: Tools): Unbacked[] {
  const text = ownWords(plainQuotes(answer));
  // A long message is mostly something pasted ("summarize this email: …remind me to…"), not a request.
  const asked = ownerText && ownerText.length <= 600 ? ownWords(plainQuotes(ownerText)) : "";
  const lastSentence = sentences(text).at(-1) ?? "";
  const answersWithoutDoing = /\?\s*\**\s*$/.test(lastSentence) || CANT.test(text);
  const ran = parts
    .filter((p): p is Extract<MessagePart, { type: "tool_result" }> => p.type === "tool_result" && (p.status === "ok" || p.status === "pending_approval"))
    .map((p) => tools.byName.get(p.name) ?? { name: p.name, effect: "read" as const, connectorId: "" });
  const out: Unbacked[] = [];
  for (const rule of RULES) {
    if (ran.some(rule.backs)) continue;
    const related = rule.related ? ran.some(rule.related) : false;
    const claimed = says(text, rule.strong) || (!related && says(text, rule.weak));
    const leftUndone = !claimed && !related && !answersWithoutDoing && asksFor(asked, rule.asked);
    if (!claimed && !leftUndone) continue;
    out.push({ kind: rule.kind, did: rule.did, truth: rule.truth, tools: [...tools.byName.values()].filter(rule.backs).map((t) => t.name) });
  }
  return out;
}

/** What the model hears, once, when its answer says more than its tools did. */
export function claimCheck(unbacked: Unbacked[]): string {
  const lines = unbacked.map((u) =>
    u.tools.length
      ? `- Your answer says or implies you ${u.did}, but no ${u.tools.join(" or ")} call worked in this turn.`
      : `- Your answer says or implies you ${u.did}, but you have no tool that does that.`,
  );
  return [
    "Check your answer against what really happened in this turn:",
    ...lines,
    "If the owner asked for it and you have the tool, call it now. If you can't (there's no tool for it, or it failed), say so plainly and offer what you can do. If it was already done earlier in this conversation, say that instead of doing it twice.",
    "Then write your whole answer to the owner again: it replaces the one you just gave.",
  ].join("\n");
}

/** The plain truth, added when the final answer still claims what didn't happen. */
export function withClaimTruth(text: string, unbacked: Unbacked[]): string {
  const truths = [...new Set(unbacked.map((u) => u.truth))].filter((t) => !text.includes(t));
  return truths.length ? `${text}\n\n${truths.join(" ")}` : text;
}
