/**
 * The demo brain: a small, deterministic, scripted "model" used when no real brain
 * is configured (local dev, tests, previews). It streams text and calls tools the
 * same way real providers do, so every part of the product — tools, approvals, the
 * prompt-injection guard, receipts, channels — can be exercised end to end.
 *
 * It is intentionally honest: it says it's running in demo mode.
 */
import type { LlmEvent, LlmMessage, LlmProvider, LlmRequest, LlmToolCall } from "./types";

type Persona = { name: string; owner: string; species: string };

function persona(system: string): Persona {
  const m = /You are (.+?), a personal AI assistant for (.+?)\. Your avatar is \w+ the (\w+)\./.exec(system);
  return { name: m?.[1] ?? "your bot", owner: m?.[2] ?? "there", species: m?.[3] ?? "robot" };
}

const FLAVOR: Record<string, { hi: string; done: string; think: string }> = {
  robot: { hi: "Beep boop — kidding.", done: "Done and dusted.", think: "Crunching that…" },
  cloud: { hi: "Hi there, deep breath —", done: "All set, nice and calm.", think: "Let me gather that…" },
  seedling: { hi: "Hi! So happy to meet you 🌱", done: "Done — nice work getting that moving.", think: "On it…" },
  spark: { hi: "Hey hey! Let's go.", done: "Boom, done.", think: "On it, fast…" },
  octopus: { hi: "Hello from all eight arms!", done: "Juggled and done.", think: "Reaching into a few places…" },
};

function words(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

function lastUserText(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return m.content;
  }
  return "";
}

function call(name: string, args: Record<string, unknown>): LlmToolCall {
  return { id: `demo_${name}_${Math.random().toString(36).slice(2, 8)}`, name, args, argsText: JSON.stringify(args) };
}

function findTool(tools: Set<string>, suffix: string): string | undefined {
  if (tools.has(suffix)) return suffix;
  return [...tools].find((t) => t.endsWith(`__${suffix}`));
}

const WEB_TLDS = "com|org|net|edu|gov|io|co|ai|app|dev|us|uk|ca|de|fr|es|it|nl|au|info|biz|me|site|store|shop|online|xyz|tech";

/** The first link or bare domain in a message ("example.com/contact"), skipping email addresses. */
function findSite(text: string): string | null {
  const link = /(https?:\/\/[^\s<>"')]+)/i.exec(text)?.[1];
  if (link) return link.replace(/[).,!?]+$/, "");
  const re = new RegExp(`\\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${WEB_TLDS}))\\b(\\/[^\\s<>"')]*)?`, "gi");
  for (const m of text.matchAll(re)) {
    if (m.index && text[m.index - 1] === "@") continue;
    return `https://${m[1].toLowerCase()}${(m[2] ?? "").replace(/[).,!?]+$/, "")}`;
  }
  return null;
}

/** "fill out the contact form on example.com with my name and email saying I'd like a quote" → form fields. */
function formFields(text: string): { field: string; value: string }[] {
  const t = text.toLowerCase();
  const fields: { field: string; value: string }[] = [];
  if (/\bmy\b[^.,]{0,24}\bname\b/.test(t)) fields.push({ field: "Name", value: "{{my_name}}" });
  // An address typed in the message wins over the account's own email.
  const typedEmail = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(text)?.[0];
  if (typedEmail) fields.push({ field: "Email", value: typedEmail });
  else if (/\bmy\b[^.,]{0,24}\be-?mail\b/.test(t)) fields.push({ field: "Email", value: "{{my_email}}" });
  const message = /\b(?:saying|that says|with the message|message:?)\s+["“]?(.+?)["”]?\s*$/i.exec(text)?.[1];
  if (message) fields.push({ field: "Message", value: message.charAt(0).toUpperCase() + message.slice(1).replace(/[.!]*$/, ".") });
  if (!fields.length) fields.push({ field: "Name", value: "{{my_name}}" }, { field: "Email", value: "{{my_email}}" });
  return fields;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** "in 20 minutes", "at 5pm", "tomorrow at 9", "tonight" → local YYYY-MM-DDTHH:MM (best effort). */
function parseWhen(text: string, now = new Date()): string | null {
  const t = text.toLowerCase();
  const inMatch = /\bin (\d+)\s*(min|minute|minutes|hour|hours|hr|hrs)\b/.exec(t);
  const d = new Date(now);
  if (inMatch) {
    const n = Number(inMatch[1]);
    d.setMinutes(d.getMinutes() + (inMatch[2].startsWith("h") ? n * 60 : n));
  } else {
    const atMatch = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t) ?? /\bat\s+(\d{1,2})(?::(\d{2}))?\b/.exec(t);
    if (t.includes("tomorrow")) d.setDate(d.getDate() + 1);
    if (atMatch) {
      let h = Number(atMatch[1]);
      const m = Number(atMatch[2] ?? 0);
      const ap = atMatch[3];
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      d.setHours(h, m, 0, 0);
      if (!t.includes("tomorrow") && d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
    } else if (t.includes("tonight")) d.setHours(20, 0, 0, 0);
    else if (t.includes("tomorrow")) d.setHours(9, 0, 0, 0);
    else return null;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Meeting notes (demo): a careful-but-simple reading of the transcript, in the same
// format the real notes prompt asks for (src/lib/meetings/notes.ts).

const NOT_NAMES = new Set(
  "I Okay Ok Yes Yeah No Great Thanks Thank Let Let's Lets So Agreed Works Happy Quick Sounds Can Could Plus Pro Free Telegram Slack Zoom Google Teams Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December The We It That This And But Also Hi Hello Sure Right Okay".split(" "),
);
const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|next week|end of (?:the )?(?:day|week|month)";

function namesIn(text: string): string[] {
  const out: string[] = [];
  // Mid-sentence capitalized words ("send it to Priya"), plus a name someone is addressed by ("Sam, can you…").
  for (const m of text.matchAll(/[^.!?\s]\s+([A-Z][a-z]{2,})\b/g)) if (!NOT_NAMES.has(m[1])) out.push(m[1]);
  const lead = /^([A-Z][a-z]{2,}),\s/.exec(text)?.[1];
  if (lead && !NOT_NAMES.has(lead)) out.unshift(lead);
  return out;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function demoMeetingNotes(transcript: string): string {
  const rows = [...transcript.matchAll(/^\[[\d:]+\] ([^:\n]+): (.+)$/gm)].map((m) => ({ who: m[1].trim(), text: m[2].trim() }));
  if (!rows.length) return "Title: Meeting notes\n## Summary\nNothing was said that I could make out.\n## Decisions\n- None recorded.\n## Action items\n- None.";
  const owner = rows.find((r) => r.who !== "Others")?.who ?? "You";
  let lastName: string | null = null;
  const items: string[] = [];
  const decisions: string[] = [];
  let topic = "";
  let update = "";
  let decided = "";
  for (const r of rows) {
    const isOwner = r.who !== "Others";
    const speaker = isOwner ? owner : lastName ?? "Someone on the call";
    for (const sentence of r.text.split(/(?<=[.!?])\s+/)) {
      const st = sentence.trim();
      if (!st) continue;
      if (isOwner && !topic) {
        const t = /\b(?:go through|going through|talk about|discuss|review|plan)\s+(?:the\s+)?(.+?)[.!?]?$/i.exec(st)?.[1];
        if (t) topic = t;
      }
      if (!isOwner && !update && /\b(update|status)\b/i.test(st)) update = st.replace(/^quick update first:\s*/i, "");
      const ask = /^([A-Z][a-z]{2,}),\s*can you\s+(.+?)\??$/.exec(st);
      if (ask && !NOT_NAMES.has(ask[1])) {
        items.push(task(ask[1], ask[2]));
        continue;
      }
      const will = /\bI(?:'ll| will)\s+(.+?)[.!]?$/.exec(st);
      if (will) {
        items.push(task(speaker, will[1]));
        continue;
      }
      if (/\b(decided|we keep|stays as|we launch|agreed to|let's go with)\b/i.test(st) && st.length > 24) {
        const d = cap(st.replace(/^(?:so\s+)?(?:we're|we are)\s+decided:?\s*/i, "").replace(/^i think\s+/i, ""));
        decisions.push(d);
        if (/\bdecided\b/i.test(st)) decided = d;
      }
    }
    const mentioned = namesIn(r.text);
    if (isOwner && mentioned.length) lastName = mentioned[mentioned.length - 1];
  }
  function task(who: string, what: string) {
    let body = what.replace(/[.!?]+$/, "");
    let due = "";
    const d = new RegExp(`\\s+(?:by|before|on)\\s+((?:next\\s+)?(?:${DAYS}|the \\d{1,2}(?:st|nd|rd|th)))$`, "i").exec(body);
    if (d) {
      due = d[1];
      body = body.slice(0, d.index);
    }
    body = body.replace(/^have\s+/i, "get ");
    return `- [ ] ${who} — ${body}${due ? ` (by ${due})` : ""}`;
  }
  const title = topic ? cap(topic.split(/\s+/).slice(0, 8).join(" ")) : "Meeting notes";
  const summary = [
    topic ? `Went through the ${topic}.` : `A ${rows.length > 8 ? "longer" : "short"} conversation between ${owner} and the others on the call.`,
    update ? cap(update) : "",
    decisions.length ? `Decided: ${(decided || decisions[0]).charAt(0).toLowerCase()}${(decided || decisions[0]).slice(1)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [
    `Title: ${title}`,
    "## Summary",
    summary,
    "## Decisions",
    ...(decisions.length ? [...new Set(decisions)].map((d) => `- ${d}`) : ["- None recorded."]),
    "## Action items",
    ...(items.length ? items : ["- None."]),
  ].join("\n");
}

type Plan = { calls: LlmToolCall[] } | { text: string };

function planFromUser(text: string, tools: Set<string>, p: Persona, system: string): Plan {
  const t = text.toLowerCase();
  const f = FLAVOR[p.species] ?? FLAVOR.robot;

  // Platform directives (greeting, routines, approvals).
  if (t.includes("<system_directive>")) {
    if (t.includes("very first message")) {
      const ideas = /Ideas you can offer: (.+?)(?:\n|$)/.exec(text)?.[1]?.split(" | ").slice(0, 3) ?? [];
      const ideaText = ideas.length ? ` I can already ${ideas.map((i) => `“${i.replace(/\.$/, "")}”`).join(", ")} — just ask.` : "";
      const who = /very first message to (.+?), who just created you/i.exec(text)?.[1]?.trim();
      const name = who && who !== "your owner" ? who : null;
      const hello =
        {
          robot: `${name ? `Hi ${name}! ` : ""}Beep boop — kidding.`,
          cloud: `Hi ${name ?? "there"}, deep breath —`,
          seedling: `Hi${name ? ` ${name}` : ""}! So happy to meet you 🌱`,
          spark: `Hey hey${name ? `, ${name}` : ""}! Let's go.`,
          octopus: `Hello${name ? `, ${name},` : ""} from all eight arms!`,
        }[p.species] ?? f.hi;
      const apps = /\(connected: (.+?)\)/.exec(text)?.[1]?.split(", ") ?? [];
      const appText = apps.length ? ` Thanks for trusting me with ${apps.length > 2 ? `${apps.slice(0, -1).join(", ")} and ${apps.at(-1)}` : apps.join(" and ")}.` : "";
      return {
        text: `${hello} I'm ${p.name}, your new AI assistant.${appText}${ideaText} (I'm running on the demo brain right now — connect a real one anytime in Settings.) What should we tackle first?`,
      };
    }
    if (t.includes("the owner approved") && t.includes(", but it failed:")) {
      const why = /but it failed: (.+?)\. Tell them/is.exec(text)?.[1]?.trim() ?? "something went wrong";
      return { text: `Hmm, that didn't go through: ${why}` };
    }
    if (t.includes("the owner approved: send the form on")) {
      const site = /send the form on (\S+?)\. It ran/i.exec(text)?.[1] ?? "the site";
      const said = /The site said: “(.+?)”/.exec(text)?.[1];
      return { text: `Sent! ${site} replied: “${said ?? "got it"}”${/simulated/i.test(text) ? " (Simulated in demo mode: nothing really left.)" : ""}` };
    }
    if (t.includes("the owner approved: fill in the form on")) {
      const site = /fill in the form on (\S+?) \(not sent\)/i.exec(text)?.[1] ?? "the site";
      return { text: `Filled in the form on ${site}, and nothing's sent yet. Say “submit it” and I'll show you a preview to approve.` };
    }
    if (t.includes("the owner approved")) {
      const what = /approved: (.+?)\./i.exec(text)?.[1] ?? "that";
      return { text: `${f.done} ${what.charAt(0).toUpperCase() + what.slice(1)} — handled. (Demo mode.)` };
    }
    if (t.includes("the owner declined")) return { text: "Got it — I won't do that. Anything you'd like instead?" };
    if (t.includes("routine")) {
      const weather = findTool(tools, "get_weather");
      if (weather && /weather|brief|morning/.test(t)) return { calls: [call(weather, { location: "Austin, TX", days: 1 })] };
      return { text: `Here's your scheduled check-in from ${p.name}: everything's on track. (Demo routine.)` };
    }
    return { text: "On it." };
  }

  // Memory.
  const rememberMatch = /\bremember (?:that )?(.+)/i.exec(text);
  if (rememberMatch && tools.has("remember")) return { calls: [call("remember", { fact: rememberMatch[1].replace(/[.!]+$/, "") })] };
  if (/what do you (know|remember) about me/.test(t) && tools.has("recall")) return { calls: [call("recall", {})] };

  // Routines & reminders.
  if (/(every (morning|day|weekday)|morning brief|daily brief)/.test(t) && tools.has("schedule_routine")) {
    const time = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(t);
    let h = time ? Number(time[1]) : 8;
    if (time?.[3] === "pm" && h < 12) h += 12;
    return {
      calls: [
        call("schedule_routine", {
          title: "Morning brief",
          instruction: "Send a short morning brief: today's weather, what's on the calendar, and anything urgent.",
          daily_time: `${pad(h)}:${time?.[2] ?? "00"}`,
          days: t.includes("weekday") ? [1, 2, 3, 4, 5] : undefined,
        }),
      ],
    };
  }
  if (/\bremind me\b/.test(t) && tools.has("create_reminder")) {
    const what = /remind me (?:to )?(.+?)(?:\s+(?:at|in|tomorrow|tonight)\b.*)?$/i.exec(text)?.[1] ?? "do the thing";
    const at = parseWhen(t);
    if (!at) return { text: "Sure — when should I remind you? (e.g. “at 5pm” or “in 20 minutes”)" };
    return { calls: [call("create_reminder", { text: what.charAt(0).toUpperCase() + what.slice(1), at })] };
  }
  if (/\b(my reminders|what reminders|list reminders)\b/.test(t) && tools.has("list_reminders")) {
    return { calls: [call("list_reminders", {})] };
  }

  // Web actions (cloud browser): read a site, fill a form (sending always waits for a tap).
  const site = findSite(text);
  if (/\bsubmit\b|\bsend (the|that) form\b/.test(t) && tools.has("web_form_submit") && !/\bfill\b/.test(t)) {
    return { calls: [call("web_form_submit", {})] };
  }
  if (site && /\b(fill (out|in)|complete)\b[^.?!]*\bform\b/.test(t) && tools.has("web_form_fill")) {
    const url = /\bcontact\b/.test(t) && new URL(site).pathname === "/" ? `${site.replace(/\/$/, "")}/contact` : site;
    return { calls: [call("web_form_fill", { url, fields: formFields(text) })] };
  }
  if (site && /\b(find|check|look up|look for|get|what are|what's|what is|when|where|how much|does)\b/.test(t) && tools.has("web_browse")) {
    return { calls: [call("web_browse", { url: site, task: text.trim() })] };
  }

  // Email.
  const searchFirst = findTool(tools, "search_email");
  if (/\b(do what|follow|act on)\b.*\b(email|inbox|says|instructions)\b/i.test(text) && searchFirst) {
    return { calls: [call(searchFirst, { query: "" })] };
  }
  const forward = /\bforward\b.*?\bto\s+([^\s,]+@[^\s,]+)/i.exec(text);
  const sendTool = findTool(tools, "send_email");
  if (forward && sendTool) {
    return {
      calls: [call(sendTool, { to: [forward[1].replace(/[.!]+$/, "")], subject: "Fwd: your recent emails", body: "Forwarding as requested." })],
    };
  }
  const replyTo = /\b(?:reply to|email|tell)\s+(sam|mom|alex)\b(?:.*?(?:saying|that)\s+(.+))?/i.exec(text);
  if (replyTo && sendTool) {
    const who = replyTo[1].toLowerCase();
    const addr = { sam: "sam.rivera@example.com", mom: "mom@example.com", alex: "alex.chen@example.com" }[who]!;
    const body = replyTo[2]?.replace(/[.!]+$/, "") ?? "Sounds good!";
    return {
      calls: [call(sendTool, { to: [addr], subject: who === "sam" ? "Re: Lunch Thursday?" : "Hi!", body: `${body.charAt(0).toUpperCase() + body.slice(1)}.\n\n— ${p.owner}` })],
    };
  }
  const searchEmail = findTool(tools, "search_email");
  if (/\b(inbox|emails?|mail)\b/.test(t) && searchEmail) return { calls: [call(searchEmail, { query: "" })] };
  if (/\b(inbox|emails?)\b/.test(t) && tools.has("read_inbox")) return { calls: [call("read_inbox", {})] };

  // Meetings the bot took notes in.
  if (tools.has("read_meeting") && /\b(take notes|record|transcribe)\b.*\b(call|meeting|zoom|meet|teams)\b|\bnote-?taker\b/.test(t)) {
    return {
      text: `Happy to! Open the **Meetings** tab and press **Start** (in Chrome or Edge), or get the desktop app: it notices when a call starts and asks first. Either way I stay on your screen the whole time I listen, and I send you the notes when it ends.`,
    };
  }
  if (tools.has("read_meeting")) {
    const about = /\b(?:what did (?:\w+ )?(?:say|said) about|search (?:my )?meetings? for|when did we (?:talk|discuss) about|when did we (?:talk|discuss))\s+(.+?)\??$/i.exec(text)?.[1];
    if (about && tools.has("search_meetings")) return { calls: [call("search_meetings", { query: about.replace(/^the\s+/i, "") })] };
    if (/\b(last|latest|recent|previous|that)\s+(meeting|call)\b|\bmeeting notes\b|\baction items?\b|\bwhat did (?:we|they|i) (?:decide|agree)|\brecap\b/.test(t)) {
      return { calls: [call("read_meeting", { meeting_id: "latest" })] };
    }
    if (/\b(my|all|list|recent)\s+meetings\b|\bmeetings (?:this|last) week\b/.test(t) && tools.has("list_meetings")) return { calls: [call("list_meetings", {})] };
  }

  // Calendar, GitHub, files.
  const listEvents = findTool(tools, "list_events");
  if (/\b(calendar|schedule|meetings?|today|tomorrow|plate)\b/.test(t) && listEvents) return { calls: [call(listEvents, { days: 3 })] };
  const gh = findTool(tools, "list_notifications");
  if (/\b(github|pull requests?|prs?|reviews?|issues?)\b/.test(t) && gh) return { calls: [call(gh, {})] };
  const files = findTool(tools, "search_files");
  if (/\b(files?|docs?|drive|document)\b/.test(t) && files) {
    return { calls: [call(files, { query: /(?:find|search)(?: for)? (.+)/i.exec(text)?.[1] ?? "recent" })] };
  }

  // Weather, money, math.
  const weatherMatch = /\bweather\b(?:.*?\b(?:in|for|at)\s+([a-z .,'-]+))?/i.exec(text);
  if (weatherMatch && tools.has("get_weather")) {
    return { calls: [call("get_weather", { location: (weatherMatch[1] ?? "Austin, TX").replace(/[?.!]+$/, "").trim(), days: 3 })] };
  }
  const fx = /(\d+(?:\.\d+)?)\s*([a-z]{3})\s+(?:to|in|into)\s+([a-z]{3})\b/i.exec(text);
  if (fx && tools.has("convert_currency")) {
    return { calls: [call("convert_currency", { amount: Number(fx[1]), from: fx[2].toUpperCase(), to: fx[3].toUpperCase() })] };
  }
  const math = /^(?:what(?:'s| is)\s+)?([\d\s.+\-*/^()%]+)\??$/i.exec(text.trim());
  if (math && /\d\s*[+\-*/^%]\s*\d/.test(math[1]) && tools.has("calculate")) return { calls: [call("calculate", { expression: math[1].trim() })] };

  // Notes & lists.
  const listAdd = /\badd (.+?) to (?:my |the )?(.+?) list\b/i.exec(text);
  if (listAdd && tools.has("write_note")) {
    const title = listAdd[2].charAt(0).toUpperCase() + listAdd[2].slice(1);
    const items = listAdd[1].split(/,| and /).map((s) => `- [ ] ${s.trim()}`).join("\n");
    return { calls: [call("write_note", { title, content: items, mode: "append" })] };
  }
  if (/\b(my notes|my lists?)\b/.test(t) && tools.has("list_notes")) return { calls: [call("list_notes", {})] };

  // Reach me elsewhere.
  const reach = /\b(text|call|message) me\b(.*)/i.exec(text);
  if (reach && tools.has("message_owner")) {
    const channel = reach[1].toLowerCase() === "call" ? "voice" : reach[1].toLowerCase() === "text" ? "sms" : "auto";
    return { calls: [call("message_owner", { text: reach[2].trim() || `Hi ${p.owner}! It's ${p.name}.`, channel })] };
  }

  // Links & search.
  const url = /(https?:\/\/\S+)/.exec(text);
  if (url && tools.has("read_webpage")) return { calls: [call("read_webpage", { url: url[1].replace(/[).,!?]+$/, "") })] };
  if (/\b(news|headlines)\b/.test(t) && tools.has("news_headlines")) {
    return { calls: [call("news_headlines", { topic: text.replace(/.*\b(?:news|headlines)\b\s*(?:about|on|for)?\s*/i, "") || "today" })] };
  }
  if (
    /\b(search|look up|google|find|latest|who is|what is|what's|when is|where is|how (do|to|much|many)|compare|best)\b/.test(t) &&
    tools.has("web_search")
  ) {
    return { calls: [call("web_search", { query: text.replace(/^(please\s+)?(search( the web)? for|look up|google)\s+/i, "").replace(/\?$/, "") })] };
  }

  // Small talk.
  if (/^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/.test(t)) {
    return { text: `${f.hi} What can I help with? I can search the web, set reminders, check the weather, take notes${system.includes("Connected apps:") ? ", and work in your connected apps" : ""}.` };
  }
  if (/\b(thanks|thank you|ty)\b/.test(t)) return { text: "Anytime! 🙌" };
  if (/\bwho are you|what are you|are you (a )?(human|real|person|ai)\b/.test(t)) {
    return { text: `I'm ${p.name}, an AI assistant ${p.owner} set up — not a person. Right now I'm running on the demo brain.` };
  }
  return {
    text: `${f.think.replace(/…$/, "")} — I'm running on the demo brain, so I'm limited to the basics: searching, reminders, weather, notes, and your connected apps. Try “remind me to stretch in 20 minutes” or “what's in my inbox?”. Pick a real brain in Settings and I get a lot smarter.`,
  };
}

function summarizeResults(results: { name: string; content: string; isError?: boolean }[], p: Persona, userText: string): string {
  const f = FLAVOR[p.species] ?? FLAVOR.robot;
  const out: string[] = [];
  for (const r of results) {
    let parsed: { status?: string; message?: string; reasons?: string[]; content?: string; error?: string } | null = null;
    try {
      parsed = JSON.parse(r.content);
    } catch {
      parsed = null;
    }
    const status = parsed?.status;
    if (status === "pending_approval" && r.name === "web_form_submit") {
      out.push("The form is filled in but **not sent**. Check the preview and tap **Approve** to send it, or Deny and nothing goes out.");
      continue;
    }
    if (status === "pending_approval") {
      out.push(`I've got that ready — it needs your OK first. Tap **Approve** and I'll send it. (${parsed?.message ?? "Approval required."})`);
      continue;
    }
    if (status === "blocked") {
      out.push(`I can't do that one: ${parsed?.message ?? "it's not allowed."}`);
      continue;
    }
    const content = parsed?.content ?? parsed?.error ?? r.content;
    if (r.isError || status === "error") {
      out.push(`Hmm, that didn't work: ${content}`);
      continue;
    }
    const base = r.name.split("__").pop() ?? r.name;
    switch (base) {
      case "web_search":
      case "news_headlines": {
        const items = [...content.matchAll(/\[(\d+)\] (.+?)\n(https?:\/\/\S+)/g)].slice(0, 4);
        const summary = /Summary: (.+)/.exec(content)?.[1];
        out.push(
          `Here's what I found${summary ? `: ${summary}` : ":"}\n${items.map((m) => `- [${m[2]}](${m[3]})`).join("\n")}`,
        );
        break;
      }
      case "get_weather":
        out.push(content.split("\n").slice(0, 3).join("\n"));
        break;
      case "list_meetings": {
        const rows = [...content.matchAll(/^- (mtg_\S+) · “(.+?)” · (.+?) · (.+?) · (.+?)$/gm)];
        out.push(
          rows.length
            ? `Here are your recent meetings:\n${rows.map((m) => `- **${m[2]}** (${m[4]}, ${m[5].replace(/ · .*/, "")})`).join("\n")}\n\nWant the notes from one of them?`
            : content,
        );
        break;
      }
      case "read_meeting": {
        const title = /“(.+?)”/.exec(content)?.[1] ?? "your last meeting";
        const summaryText = /## Summary\n([\s\S]*?)(?:\n## |$)/.exec(content)?.[1]?.trim();
        const decisionsText = /## Decisions\n([\s\S]*?)(?:\n## |$)/.exec(content)?.[1]?.trim();
        const itemsText = /## Action items\n([\s\S]*?)(?:\n## |$)/.exec(content)?.[1]?.trim();
        const u = userText.toLowerCase();
        if (/^No meetings yet/.test(content)) {
          out.push("I haven't taken notes in any meetings yet. Start one from the **Meetings** tab, or with the desktop app (it offers when a call starts), and I'll have notes for you after.");
        } else if (!summaryText && !itemsText) {
          out.push(/still recording/.test(content) ? `“${title}” is still going. Here's the gist so far — ask me again when it ends for the full notes.` : `I have the transcript for “${title}”, but no notes yet.`);
        } else if (/\baction items?\b|\bto-?dos?\b|\bwhat do i (?:need|have) to do\b/.test(u)) {
          out.push(`Action items from **${title}**:\n${itemsText ?? "- None recorded."}\n\nWant reminders for any of them?`);
        } else if (/\b(decide|decided|decision|agree)\b/.test(u)) {
          out.push(`In **${title}** you decided:\n${decisionsText ?? "- Nothing final."}`);
        } else if (/\brecap\b|\bemail\b|\bdraft\b/.test(u)) {
          out.push(
            `Here's a recap you could send:\n\n> **Recap: ${title}**\n> ${summaryText ?? ""}\n>\n> **Next steps**\n${(itemsText ?? "").split("\n").map((l) => `> ${l.replace("- [ ] ", "- ")}`).join("\n")}\n\nTell me who to send it to and I'll email it (you'll get to approve it first).`,
          );
        } else {
          out.push(`**${title}**\n\n${summaryText ?? ""}${itemsText ? `\n\n**Action items**\n${itemsText}` : ""}`);
        }
        break;
      }
      case "search_meetings": {
        const hits = [...content.matchAll(/^- mtg_\S+ · “(.+?)” · (.+?) · \[([\d:]+)\] ([^:]+): (.+)$/gm)].slice(0, 5);
        out.push(hits.length ? `Here's what was said:\n${hits.map((h) => `- **${h[1]}** (${h[2]}, at ${h[3]}) — ${h[4]}: “${h[5]}”`).join("\n")}` : content);
        break;
      }
      case "search_email":
      case "read_inbox": {
        const emails = [...content.matchAll(/From: (.+?) \| Subject: (.+?)\n/g)];
        if (!emails.length) {
          out.push(
            base === "read_inbox"
              ? `Nothing in my own inbox yet. ${content.replace(/^No emails yet\.\s*/, "")} To let me read *your* inbox, connect Gmail or Outlook in Apps & trust.`
              : "Nothing in your inbox matched that.",
          );
          break;
        }
        const suspicious = emails.find((m) => /acc0unt|verify|urgent action/i.test(`${m[1]} ${m[2]}`));
        const normal = emails.filter((m) => m !== suspicious).slice(0, 4);
        out.push(
          `You've got ${emails.length} emails. The ones that matter:\n${normal
            .map((m) => `- **${m[1].replace(/<.+>/, "").trim()}** — ${m[2]}`)
            .join("\n")}${
            suspicious
              ? `\n\n⚠️ Heads up: “${suspicious[2]}” from ${suspicious[1].replace(/.*</, "").replace(">", "")} is a phishing / prompt-injection attempt — it tried to get me to forward your emails. I ignored it.`
              : ""
          }\n\nWant me to reply to any of these?`,
        );
        break;
      }
      case "create_reminder":
      case "schedule_routine":
        out.push(`${f.done} ${content.replace(/\(sch_[a-z0-9]+\)/, "").replace(/\s+/g, " ").trim()}`);
        break;
      case "remember":
        out.push(content.startsWith("Already") ? "I already had that one noted. 👍" : "Got it — I'll remember that.");
        break;
      case "web_browse": {
        const where = /^Site: (.+)$/m.exec(content)?.[1] ?? "the site";
        const answer = /^(?:Answer|Not found on the site): (.+)$/m.exec(content)?.[1];
        out.push(
          answer
            ? `Here's what ${where} says: ${answer}${/Simulated in demo mode/.test(content) ? " (Simulated: demo mode doesn't visit real sites.)" : ""}`
            : content.slice(0, 600),
        );
        break;
      }
      case "web_form_fill": {
        const where = /Filled in the form on (\S+?)\. /.exec(content)?.[1] ?? "the site";
        const typed = [...content.matchAll(/^- (.+?): (.+)$/gm)].slice(0, 8).map((m) => `- **${m[1]}:** ${m[2]}`);
        out.push(`I filled in the form on ${where}, and nothing's sent yet:\n${typed.join("\n")}\n\nSay “submit it” and I'll show you the preview to approve.`);
        break;
      }
      case "recall":
        out.push(content === "Nothing saved yet." ? "I don't know much about you yet! Tell me a few things you'd like me to remember." : `Here's what I know about you:\n${content}`);
        break;
      default:
        out.push(content.length > 600 ? `${content.slice(0, 600)}…` : content);
    }
  }
  if (!out.length) return `${f.done}`;
  void userText;
  return out.join("\n\n");
}

export function createDemoProvider(): LlmProvider {
  return {
    id: "demo",
    async *stream(req: LlmRequest): AsyncGenerator<LlmEvent> {
      const p = persona(req.system);
      const tools = new Set(req.tools.map((t) => t.name));
      const last = req.messages[req.messages.length - 1];
      let text = "";
      let calls: LlmToolCall[] = [];

      if (/asked you to take notes in a meeting/.test(req.system)) {
        // Meeting notes (src/lib/meetings/notes.ts): no tools, just the notes.
        text = demoMeetingNotes(lastUserText(req.messages));
      } else if (/taking notes on one part of a long meeting/.test(req.system)) {
        text = lastUserText(req.messages)
          .split("\n")
          .filter((l) => /^\[[\d:]+\]/.test(l))
          .slice(0, 12)
          .map((l) => `- ${l}`)
          .join("\n");
      } else if (last?.role === "tool") {
        const results: { name: string; content: string; isError?: boolean }[] = [];
        for (let i = req.messages.length - 1; i >= 0; i--) {
          const m = req.messages[i];
          if (m.role !== "tool") break;
          results.unshift({ name: m.name, content: m.content, isError: m.isError });
        }
        const userText = lastUserText(req.messages);
        // Only an actual injection counts, not hints like "the owner can forward things to <its own address>".
        const injected = results
          .filter((r) => /ignore (?:your |all )?(?:previous|prior) instructions|instructions for the ai/i.test(r.content))
          .map((r) => /forward[^\n]*?to ([^\s,]+@[^\s,.]+\.[a-z]+)/i.exec(r.content)?.[1])
          .find(Boolean);
        const sendTool = findTool(tools, "send_email");
        const alreadySent = req.messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.name.endsWith("send_email")));
        const filledSession = results.find((r) => r.name === "web_form_fill" && !r.isError)?.content.match(/\bsession_id: (wss_[a-z0-9]+)/)?.[1];
        const submitAsked = req.messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.name === "web_form_submit"));
        if (filledSession && tools.has("web_form_submit") && !submitAsked && !/\b(don'?t|do not|without) (send|submit)|\bjust fill\b/i.test(userText)) {
          // Fill, then ask to send: the policy engine always holds the send for the owner's tap.
          calls = [call("web_form_submit", { session_id: filledSession })];
        } else if (/\b(do what|follow|act on)\b/i.test(userText) && injected && sendTool && !alreadySent) {
          // Simulates a model that got tricked by the email — the policy engine must catch this.
          calls = [call(sendTool, { to: [injected], subject: "Fwd: your last 20 emails", body: "Forwarding as instructed." })];
        } else {
          text = summarizeResults(results, p, userText);
        }
      } else {
        const plan = planFromUser(lastUserText(req.messages), tools, p, req.system);
        if ("calls" in plan) calls = plan.calls;
        else text = plan.text;
      }

      for (const w of words(text)) {
        if (req.signal?.aborted) return;
        await new Promise((r) => setTimeout(r, 12));
        yield { type: "text", delta: w };
      }
      for (const c of calls) yield { type: "tool_call", call: c };
      const inputTokens = Math.ceil((req.system.length + JSON.stringify(req.messages).length) / 4);
      yield {
        type: "done",
        stopReason: calls.length ? "tool_calls" : "end",
        usage: { inputTokens, outputTokens: Math.ceil(text.length / 4) + calls.length * 20 },
        servedBy: "demo",
      };
    },
  };
}
