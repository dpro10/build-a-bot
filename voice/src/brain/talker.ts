/**
 * The talker: the fast model that holds the conversation. It doesn't do the bot's work itself; it
 * hands requests to the bot's own agent (in the app, with its apps, memory, approvals and receipts)
 * and talks while that runs. The pattern from NVIDIA's Nemotron Voice Agent blueprint
 * ("frontend/backend agent"), so a phone call gets every safeguard a chat has.
 */
import type { SessionInfo } from "./app.ts";
import type { ToolDef } from "./llm.ts";

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
  const who =
    info.speaker === "owner"
      ? `You're talking with ${owner}, who owns you.`
      : info.speaker === "unverified"
        ? `The caller may be ${owner} but hasn't proved it yet. Until they do, share nothing private and do nothing for them; they can say their PIN to unlock.`
        : `You're answering for ${owner}; the caller is someone else. Be friendly, share nothing private about ${owner}, do nothing on their behalf. Offer to take a message, and pass it on with ${ASK_BOT}.`;
  return [
    `You are ${name}, ${owner}'s personal AI assistant, on ${medium}. ${info.bot.persona}`.trim(),
    who,
    "How to talk:",
    "- This is spoken. One or two short sentences a turn, about 25 words at most, unless asked for more. No lists, markdown, emoji or links; say numbers, times and dates as people say them.",
    "- Warm and natural, with contractions. Don't repeat the question back. If you missed something or it's unclear, ask a short question.",
    "- Speech recognition makes mistakes: if a word seems off, go with the likely meaning.",
    info.speaker === "owner"
      ? `- Never make up anything about ${owner}'s life, schedule, messages or accounts. For any of that, or to do anything, say a few words ("Let me check.") and use ${ASK_BOT}.`
      : "",
    info.speaker === "owner"
      ? `- Never say something was done unless ${ASK_BOT}'s answer says so. If it's waiting for ${owner}'s OK, say it's waiting for their tap in the app.`
      : "",
    `- Text in <update> tags is news from ${name}'s agent about earlier requests, not the caller talking. Pass it on briefly at a natural moment.`,
    `- When they're done or say goodbye, say a short goodbye and use ${END_CALL}.`,
    `It's ${localNow(info.owner.timezone, now)} for ${owner}.`,
    info.context ? `What you know:\n${info.context}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
