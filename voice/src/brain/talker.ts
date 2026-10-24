/**
 * The talker: the fast model that holds the conversation. It doesn't do the bot's work itself; it
 * hands requests to the bot's own agent (in the app, with its apps, memory, approvals and receipts)
 * and talks while that runs. The pattern from NVIDIA's Nemotron Voice Agent blueprint
 * ("frontend/backend agent"), so a phone call gets every safeguard a chat has.
 *
 * It runs without reasoning, so the first words come fast. What keeps it honest about the work:
 * it's told plainly what the agent really did (jobResult), and a reply that still claims what
 * didn't happen is never spoken (claimsDone, claimsWork, honestLine; see session.ts).
 */
import type { ActResult, SessionInfo } from "./app.ts";
import type { ToolDef } from "./llm.ts";
import { speakable } from "../speech/text.ts";

export const ASK_BOT = "ask_bot";
export const END_CALL = "end_call";

export function talkerTools(info: SessionInfo): ToolDef[] {
  const name = info.bot.name;
  const owner = info.owner.firstName;
  if (info.speaker !== "owner") {
    return [
      {
        name: ASK_BOT,
        description: `Pass a message from this caller on to ${owner}. Include who they are, what they want and how to reach them.`,
        parameters: {
          type: "object",
          properties: { request: { type: "string", description: `The message for ${owner}, complete and in the caller's words where it matters.` } },
          required: ["request"],
        },
      },
      endCallTool(),
    ];
  }
  return [
    {
      name: ASK_BOT,
      description:
        `Hand a request to ${name}'s agent, which does the real work: ${owner}'s connected apps (email, calendar and the rest), ` +
        `memory, reminders, notes, web lookups, and actions (anything risky waits for ${owner}'s tap in the app). ` +
        `Use it for anything beyond small talk: facts about ${owner}'s life or plans, messages, schedules, looking something up, or doing something. ` +
        `Results come back to you as the tool's answer, or later as an <update>.`,
      parameters: {
        type: "object",
        properties: {
          request: {
            type: "string",
            description: `The request in the words ${owner} would use to ask you ("What's on my calendar tomorrow?"), complete and standalone, with every detail from the conversation (names, dates, times, amounts).`,
          },
        },
        required: ["request"],
      },
    },
    endCallTool(),
  ];
}

function endCallTool(): ToolDef {
  return {
    name: END_CALL,
    description: "Hang up. Only after you've said goodbye, when the caller is done or asks to end the call.",
    parameters: { type: "object", properties: { reason: { type: "string" } } },
  };
}

function localNow(timezone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone || "UTC" }).format(now);
  } catch {
    return now.toUTCString();
  }
}

export function talkerPrompt(info: SessionInfo, now = new Date()): string {
  const name = info.bot.name;
  const owner = info.owner.firstName;
  const medium = info.kind === "phone" ? "a phone call" : "a voice call in the Build-a-bot app";
  const isOwner = info.speaker === "owner";
  const who = isOwner
    ? `You're talking with ${owner}, who owns you.`
    : info.speaker === "unverified"
      ? `The caller may be ${owner} but hasn't proved it yet. Until they do, share nothing private and do nothing for them but take a message for ${owner}, passed on with ${ASK_BOT}; they can say their PIN to unlock.`
      : `You're answering for ${owner}; the caller is someone else. Be friendly, share nothing private about ${owner}, do nothing on their behalf. Offer to take a message, and pass it on with ${ASK_BOT}.`;
  return [
    `You are ${name}, ${owner}'s personal AI assistant, on ${medium}. ${info.bot.persona}`.trim(),
    who,
    "How to talk:",
    "- This is spoken. One or two short sentences a turn, about 25 words at most, unless asked for more. No lists, markdown, emoji or links; say numbers, times and dates as people say them.",
    "- Warm and natural, with contractions. Don't repeat the question back. If you missed something or it's unclear, ask a short question.",
    "- Speech recognition makes mistakes: if a word seems off, go with the likely meaning.",
    isOwner
      ? `- Never make up anything about ${owner}'s life, schedule, messages or accounts. For any of that, or to do anything, use ${ASK_BOT} (the caller hears "Let me check." while it works).`
      : "",
    isOwner
      ? `- Never say something was done unless ${ASK_BOT}'s answer says so: its result says plainly what happened. If it's waiting for ${owner}'s OK, say it's waiting for their tap in the app.`
      : `- Only say a message was passed on once ${ASK_BOT}'s answer says so, and promise nothing more: no call back, no reply.`,
    `- Don't promise a text, an email or a call later: you can't send them yourself, and only ${ASK_BOT}'s answer says what ${name}'s agent did.`,
    `- Text in <update> tags is news from ${name}'s agent about earlier requests, not the caller talking. Pass it on briefly at a natural moment.`,
    `- When they're done or say goodbye, say a short goodbye and use ${END_CALL}.`,
    `It's ${localNow(info.owner.timezone, now)} for ${owner}.`,
    info.context ? `What you know:\n${info.context}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- what the bot's agent did ------------------------------------------------------------------

/** What became of a request handed to the bot's agent. */
export type Job = {
  /** The app's status for the run (ok, refused, limited, unavailable, error, paused, command), or
   *  "working" (still running here) or "unreachable" (the app didn't answer). */
  status: string;
  /** What the agent said back. */
  text: string;
  /** What waits for the owner's tap in the app. */
  approvals: string[];
};

export const WORKING: Job = { status: "working", text: "", approvals: [] };
export const UNREACHABLE: Job = { status: "unreachable", text: "", approvals: [] };

export function jobFromAct(r: ActResult): Job {
  return {
    status: typeof r.status === "string" && r.status ? r.status : "error",
    text: typeof r.text === "string" ? r.text.trim() : "",
    approvals: Array.isArray(r.approvals) ? r.approvals.map((a) => String(a?.title ?? "").trim()).filter(Boolean) : [],
  };
}

/** Done as asked: the agent ran it, and nothing waits for the owner's OK. */
export function jobDone(job: Job): boolean {
  return (job.status === "ok" || job.status === "command") && job.approvals.length === 0;
}

function whose(info: SessionInfo): string {
  return info.speaker === "owner" ? "your" : `${info.owner.firstName}'s`;
}

function whatHappened(job: Job, info: SessionInfo): string {
  if (job.status === "working") return "Still running, so nothing is done yet. Say you'll tell them on this call when it's done, and carry on.";
  if (job.status === "unreachable") return "Nothing was done: the agent couldn't be reached. Say so, and offer to try again.";
  if (job.approvals.length) return `Not done yet: it's waiting for ${info.owner.firstName}'s OK in the app (${job.approvals.join("; ")}). Say that; don't say it's done.`;
  if (jobDone(job)) return "The agent finished. Pass on what its answer says, briefly.";
  return `Nothing was done (${job.status}). Say so plainly, with the reason from the answer if it gives one. Don't say it was done.`;
}

/** The tool result the talker gets: the agent's real status and words, and plainly what that means. */
export function jobResult(job: Job, info: SessionInfo): string {
  return JSON.stringify({
    status: job.status,
    ...(job.text ? { answer: job.text } : {}),
    ...(job.approvals.length ? { waiting_for_owner_ok: job.approvals } : {}),
    what_happened: whatHappened(job, info),
  });
}

/** News of work that finished after the talker moved on, for an <update>. */
export function jobUpdate(request: string, job: Job, info: SessionInfo): string {
  return `About "${request}" (status: ${job.status}): ${job.text || "no answer"} ${whatHappened(job, info)}`;
}

// ---- keeping it honest ---------------------------------------------------------------------

/** Not a claim when it follows these: "Should I set it?", "when it's done". */
const NOT_A_CLAIM = String.raw`(?<!\b(?:should|shall|can|could|would|will|do|did|may|might|must|when|once|if|until|after|before|soon as)\s)`;
const DID = String.raw`set|sent|booked|scheduled|added|created|saved|noted|cancell?ed|deleted|removed|emailed|texted|messaged|forwarded|passed|relayed|reminded|ordered|reserved|replied|told|confirmed|put|moved|updated|let \w+ know`;
const WILL = String.raw`set|send|book|schedule|add|create|save|note|cancel|delete|remove|email|text|message|forward|pass|relay|remind|order|reserve|reply|confirm|put|move|update|make sure|tell (?!you\b)\w+|let (?!you\b)\w+ know`;
const THING = String.raw`it|that|this|everything|your [\w-]+|the [\w-]+|(?:reminder|message|email|text|note|event|meeting|appointment|booking|reservation|table|order|invite|invitation)s?`;
const STATE = String.raw`set|sent|booked|scheduled|added|created|saved|noted|cancell?ed|deleted|removed|confirmed|reserved|done|forwarded|passed (?:on|along)|on (?:the|your) (?:calendar|list)`;
/** "I've set…", "I'll pass that on", "your reminder is set", "Sent!". */
const WORK = new RegExp(
  [
    String.raw`${NOT_A_CLAIM}\bI(?:'ve| have)?(?: just| already| now| also)?(?: gone ahead and| went ahead and)? (?:${DID})\b`,
    String.raw`${NOT_A_CLAIM}\bI(?:'ll| will)(?: go ahead and| make sure to| be sure to| also)? (?:${WILL})\b`,
    String.raw`${NOT_A_CLAIM}\b(?:${THING})(?:'s| is| has been| was| have been| are| were)(?: all| now)? (?:${STATE})\b`,
    String.raw`(?:^|[.!?]\s+)(?:all )?(?:done|sent|booked|scheduled|added|saved|noted|cancell?ed|confirmed|reserved|set)\b`,
  ].join("|"),
  "i",
);
const DONE = /\b(?:all set|taken care of|went through|successfully)\b/i;

/** It says the bot did (or will do) something: only true if a request to the bot's agent did it. */
export function claimsWork(text: string): boolean {
  return WORK.test(text);
}

/** It says the work succeeded, in any way: never true after a job that didn't. */
export function claimsDone(text: string): boolean {
  return WORK.test(text) || DONE.test(text);
}

/** The agent's words, short enough to say: a sentence or two, without chat formatting. */
function briefly(text: string, maxChars = 220): string {
  const sentences = speakable(text).match(/[^.!?]+(?:[.!?]+|$)/g) ?? [];
  let out = "";
  for (const s of sentences.slice(0, 2)) {
    const next = `${out} ${s.trim()}`.trim();
    if (out && next.length > maxChars) break;
    out = next;
  }
  return out.length > maxChars ? `${out.slice(0, maxChars).replace(/\s+\S*$/, "")}…` : out;
}

/** What to say instead of a reply that claims what the job didn't do: from the agent's own words. */
export function honestLine(job: Job, info: SessionInfo): string {
  const owner = info.speaker === "owner";
  if (job.status === "working") return "I'm still working on that, and I'll tell you when it's done.";
  if (job.status === "unreachable") return owner ? "Sorry, I couldn't get that done just now. Want me to try again?" : "Sorry, I couldn't pass that on just now. Want me to try again?";
  if (job.approvals.length) return `That's waiting for ${whose(info)} OK in the app, so it isn't done yet.`;
  const reason = briefly(job.text);
  return reason ? `That didn't go through. ${reason}` : "Sorry, that didn't go through.";
}

/** The talker claimed work without handing anything to the agent, even after being told. */
export function notDoneLine(info: SessionInfo): string {
  return info.speaker === "owner" ? "Sorry, I haven't done that yet. Want me to?" : "Sorry, I haven't passed that on yet. Want me to?";
}

/** Told to the talker (not the caller) when it claims work it didn't hand to the agent. */
export const NOTHING_RAN =
  `(From the call system, not the caller: you said something was done or will be, but you didn't use ${ASK_BOT}, so nothing happened, and the caller hasn't heard it. ` +
  `Use ${ASK_BOT} to do it now, or tell them it isn't done.)`;

const LOST = "Sorry, I lost my train of thought. Could you say that again?";

/** The talker failed: what's true to say about the request it was on (asking again could do it twice). */
export function lostLine(job: Job | null, info: SessionInfo): string {
  if (!job) return LOST;
  if (jobDone(job)) return briefly(job.text) || LOST;
  return honestLine(job, info);
}
