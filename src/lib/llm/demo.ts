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
  if (message) fields.push({ field: "Message", value: message.charAt(0).toUpperCase() + message.slice(1) + (/[.!?]$/.test(message) ? "" : ".") });
  if (!fields.length) fields.push({ field: "Name", value: "{{my_name}}" }, { field: "Email", value: "{{my_email}}" });
  return fields;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * The owner's wall clock (from "(timezone …)" in the system prompt) as a Date whose
 * local fields read like their clock. Only for arithmetic and formatting below.
 */
function ownerClock(system: string, now = new Date()): Date {
  const tz = /\(timezone ([^)\s]+)\)/.exec(system)?.[1];
  if (!tz) return now;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
        .formatToParts(now)
        .map((x) => [x.type, x.value]),
    );
    return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  } catch {
    return now;
  }
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
    // In person, one microphone hears everyone ("Room"): "I'll…" there has no known owner.
    return `- [ ] ${who === "Room" ? "" : `${who} — `}${body}${due ? ` (by ${due})` : ""}`;
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

/** Connectors whose demo tools have their own sample data and inputs (connectors/demo-tools.ts). */
const SAMPLE_DATA_APPS = new Set(["gmail", "outlook", "outlook_mail", "google_calendar", "outlook_calendar", "github", "google_drive", "onedrive", "dropbox"]);

/** Lists the demo brain saves as notes when asked ("make a grocery list for tacos for 6"). */
const LISTS: { match: RegExp; title: string; example: string; items: string[] }[] = [
  {
    match: /\b(grocery|shopping) list\b.*\btacos?\b|\btacos?\b.*\b(grocery|shopping) list\b/,
    title: "Taco night",
    example: "napkins",
    items: ["24 small tortillas", "2 lb chicken thighs or ground beef", "1 white onion", "1 bunch cilantro", "4 limes", "2 avocados", "1 jar salsa", "Shredded cheese", "Sour cream", "Hot sauce"],
  },
  {
    match: /\bmake (?:me )?a (grocery|shopping) list\b/,
    title: "Groceries",
    example: "bananas",
    items: ["Milk", "Eggs", "Bread", "Fruit", "Veggies for the week", "Coffee"],
  },
  {
    match: /\bmake (?:me )?a packing list\b/,
    title: "Packing list",
    example: "sunscreen",
    items: ["ID or passport", "Phone charger and cables", "Toothbrush and toiletries", "Clothes for each day, plus one extra", "Comfy shoes", "Medications", "A light jacket", "Headphones"],
  },
  {
    match: /\bchore (chart|list)\b/,
    title: "Weekly chores",
    example: "water the plants",
    items: ["Mon: dishes and counters", "Tue: laundry", "Wed: vacuum", "Thu: bathroom", "Fri: trash and recycling", "Sat: change the sheets", "Sun: plan meals and groceries"],
  },
];

function capabilities(tools: Set<string>): string {
  const has = (name: string) => [...tools].some((n) => n === name || n.endsWith(`__${name}`));
  const can = [
    has("search_email") && "read your email, flag what matters and draft replies (you approve before anything is sent)",
    has("list_events") && "check your calendar and find free time",
    has("create_reminder") && "set reminders and routines, like a morning brief",
    has("read_meeting") && "take notes in your calls and answer questions about them",
    has("list_notifications") && "keep an eye on GitHub",
    has("web_search") && "search the web",
    has("web_browse") && "read websites and fill in forms (you approve before anything is sent)",
    has("get_weather") && "check the weather",
    has("write_note") && "keep notes and lists",
    has("remember") && "remember what matters to you",
  ].filter(Boolean);
  return `Here's what I can do for you right now:\n${can.map((c) => `- ${c}`).join("\n")}\n\nAdd more apps anytime in **Apps & trust**.`;
}

function trip(text: string): string {
  const days = /\b(\d+|two|three|four|five)\s+days?\b/i.exec(text)?.[1] ?? "3";
  const city = /\bin ([A-Z][\w .'-]+?)[.?!]*$/.exec(text.trim())?.[1] ?? "the city";
  if (/mexico city|cdmx/i.test(city)) {
    return [
      "Three days in Mexico City:",
      "- **Day 1, the center:** the Zócalo and the cathedral, Templo Mayor, then Bellas Artes at sunset and dinner in Roma.",
      "- **Day 2, Chapultepec:** the National Museum of Anthropology (give it 3 hours), a walk in the park, then tacos al pastor in Condesa.",
      "- **Day 3, the south:** the Frida Kahlo Museum in Coyoacán (book ahead), the market, then a trajinera boat in Xochimilco.",
      "",
      "Want the forecast? Ask “what's the weather in Mexico City?”",
    ].join("\n");
  }
  return `Here's a shape for ${days} days in ${city}:\n- **Day 1:** the historic center and a food market\n- **Day 2:** the big museum, then a park\n- **Day 3:** a neighborhood walk and a sunset spot\n\nOn a real brain I'll fill in actual places, hours and prices.`;
}

/** Starter ideas (src/lib/jobs.ts) that need a few words rather than a tool. */
const CANNED: [RegExp, (text: string, tools: Set<string>) => string][] = [
  [/\bwhat can you do\b|\bhow can you help\b/, (_t, tools) => capabilities(tools)],
  [
    /\bdraft a polite no\b/,
    () =>
      "Here's a polite no you can use:\n\n> Thanks so much for the invite! I can't make this one, but I'd love to hear how it goes. Could you send me the notes after?\n\nWant me to send it? Say who to, like “email Alex saying thanks for the invite, but I can't make it”.",
  ],
  [/\bthese notes\b|\bturn (?:my |the )?notes into\b/, () => "Paste the notes here and I'll pull out the action items: who does what, and by when."],
  [
    /\b(?:open|create|file) an? (?:issue|bug)(?: for (?:this|that|the) bug)?[.!?]*$/,
    () => "Tell me the repo and the bug in a sentence, like “open an issue in acme/app: login button does nothing on Safari”. You'll see it before it's opened.",
  ],
  [/\bexplain this error\b|\berror message\b/, () => "Paste the error (and the line of code that caused it, if you have it), and I'll explain what it means and how to fix it."],
  [/\bexplain this topic\b|\bexplain (?:it|this) like i'?m new\b/, () => "Sure! Which topic? Say something like “explain black holes simply” and I'll start from zero."],
  [
    /\bquiz me\b/,
    () => "Let's do it! Paste the key terms or a page of notes from the chapter, or just tell me the subject, and I'll ask one question at a time and tell you how you did.",
  ],
  [
    /\bstudy plan\b/,
    () =>
      "Here's a plan that works for most exams:\n1. **Today:** skim everything once and list what feels fuzzy.\n2. **Tomorrow:** practice problems on the fuzzy parts only.\n3. **The day before:** a timed practice test, then go over every mistake.\n4. **Exam morning:** a light review and a real breakfast. No cramming.\n\nWant a nudge? Say “remind me to study tomorrow at 7pm”.",
  ],
  [
    /\bstatus update\b/,
    () =>
      "Here's a shape to fill in:\n\n> **Status update**\n> **Done:** …\n> **In progress:** …\n> **Blocked on:** …\n> **Next:** …\n\nTell me what you worked on and I'll write it up.",
  ],
  [
    /\bbills?\b.*\bdue\b/,
    () => "I don't see any bills yet. Tell me one, like “remind me to pay the phone bill tomorrow at 9am”, and I'll make sure you don't miss it.",
  ],
  [
    /\bmonthly budget\b|\bmake (?:me )?a budget\b/,
    () =>
      "A simple way to start is 50/30/20:\n- **50%** for needs: rent, groceries, bills, getting around\n- **30%** for wants: eating out, fun, subscriptions\n- **20%** for savings and paying down debt\n\nTell me your monthly take-home pay and your big fixed costs, and I'll turn it into real numbers.",
  ],
  [
    /\bworkout\b/,
    () =>
      "A 20-minute workout, no equipment:\n- **4 min warm-up:** march in place, arm circles, easy squats\n- **12 min, twice through:** 45 seconds each of squats, push-ups (knees are fine), lunges, plank, glute bridges and jumping jacks, with 15 seconds of rest after each\n- **4 min cool-down:** slow stretches\n\nWant a nudge tomorrow? Say “remind me to work out tomorrow at 7am”.",
  ],
  [/\bpick(?:ing)? up the kids\b/, () => "I don't see a pickup on your calendar. Tell me who's doing it and I'll remember, like “remember that Alex picks up the kids on Thursdays”."],
  [/\bturn (?:off|on) the lights?\b/, () => "I can't control lights yet (smart-home apps are coming), but I can nudge you. Say “remind me to turn off the lights at 11pm”."],
  [/\bplan (?:\d+|two|three|four|five) days? in\b|\bitinerary\b/, (text) => trip(text)],
  [
    /\bdraft a post\b/,
    () =>
      "Here's a draft:\n\n> Some news: I'm starting a new job as [role] at [company]! Grateful to everyone who helped along the way, and excited to learn a ton. Here's to the next chapter. 🎉\n\nTell me the role and the company and I'll make it sound like you.",
  ],
  [
    /\bremind me (?:of|about) (?:\w+ )?birthdays?\b/,
    () => "Tell me whose birthday it is and when, like “remember that Mom's birthday is March 3”, and I'll keep track. For a nudge, say “remind me to call Mom tomorrow at 9am”.",
  ],
  [/\bhelp me reply\b|\breply to this message\b/, () => "Paste the message here and tell me the vibe (yes, no, or maybe later), and I'll draft a reply."],
  [
    /\bplan my (?:\w+ )?errands\b/,
    () =>
      "Here's an order that saves backtracking:\n1. **9:00** Groceries, while the store is quiet\n2. **10:00** Pharmacy and bank\n3. **11:00** Returns and drop-offs\n4. **12:00** Gas on the way home\n\nTell me your real stops, like “add groceries, pharmacy and dry cleaning to my errands list”, and I'll keep the list.",
  ],
];

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

  // Memory. Questions ("what do you remember about me?") recall; statements save.
  if (/what do you (know|remember) about me|\bdo you remember\b/.test(t) && tools.has("recall")) return { calls: [call("recall", {})] };
  const rememberMatch = /\bremember (?:that )?(.+)/i.exec(text);
  if (rememberMatch && !/\?\s*$/.test(text) && tools.has("remember")) {
    // Saved the way a model would write it: about the owner, not in their first person.
    const who = /^(there|your owner)$/i.test(p.owner) ? null : p.owner;
    const said = rememberMatch[1].replace(/[.!]+$/, "");
    const fact = who ? said.replace(/^(?:i'm|i am)\b/i, `${who} is`).replace(/^my\b/i, `${who}'s`) : said;
    return { calls: [call("remember", { fact })] };
  }

  // Starter ideas (src/lib/jobs.ts): lists it can save, and requests that need a few words, not a tool.
  if (!/\b(remind|nudge) me (to|at|in)\b/.test(t)) {
    const list = LISTS.find((l) => l.match.test(t));
    if (list && tools.has("write_note")) {
      return { calls: [call("write_note", { title: list.title, content: list.items.map((i) => `- [ ] ${i}`).join("\n"), mode: "replace" })] };
    }
    const canned = CANNED.find(([re]) => re.test(t));
    if (canned) return { text: canned[1](text, tools) };
  }

  // Routines & reminders.
  if (/\bevery (morning|evening|night|day|weekday)\b|\b(morning|daily) brief\b/.test(t) && tools.has("schedule_routine")) {
    const evening = /\b(evening|night)\b/.test(t);
    const time = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(t);
    let h = time ? Number(time[1]) : evening ? 20 : 8;
    if ((time?.[3] === "pm" || (evening && !time?.[3])) && h < 12) h += 12;
    const habits = /\bhabits?\b/.test(t);
    return {
      calls: [
        call("schedule_routine", {
          title: evening ? (habits ? "Evening habit check-in" : "Evening check-in") : "Morning brief",
          instruction: evening
            ? habits
              ? "Ask how today's habits went (water, movement, sleep), cheer the wins, and suggest one small thing for tomorrow."
              : "Ask how the day went and what's on for tomorrow."
            : "Send a short morning brief: today's weather, what's on the calendar, and anything urgent.",
          daily_time: `${pad(h)}:${time?.[2] ?? "00"}`,
          days: t.includes("weekday") ? [1, 2, 3, 4, 5] : undefined,
        }),
      ],
    };
  }
  if (/\b(remind|nudge) me\b/.test(t) && tools.has("create_reminder")) {
    const what = /(?:remind|nudge) me (?:to )?(.+?)(?:\s+(?:at|in|tomorrow|tonight)\b.*)?$/i.exec(text)?.[1] ?? "do the thing";
    // Times are the owner's local time (like a real model reading the system prompt), not the server's.
    const clock = ownerClock(system);
    const at = parseWhen(t, clock) ?? (/\bnudge me\b/.test(t) ? parseWhen("in 60 minutes", clock) : null);
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
  if (/\b(inbox|emails?|mail|gmail|outlook|unread)\b|\bcame in\b|\bneeds? a reply\b|\breply from me\b/.test(t) && searchEmail) {
    return { calls: [call(searchEmail, { query: "" })] };
  }
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
  // Any other connected app the owner names ("what's in my Notion?"): its first look-up tool.
  // (Apps with their own sample data are handled above, with their own inputs.)
  const appLookup = [...tools].find((name) => {
    const [prefix, cap] = name.split("__");
    if (!cap || SAMPLE_DATA_APPS.has(prefix) || prefix.length < 3) return false;
    return /^(search|read|list|get|find)/.test(cap) && new RegExp(`\\b${prefix.replace(/_/g, " ")}\\b`).test(t);
  });
  if (appLookup) return { calls: [call(appLookup, { request: text.trim() })] };
  const listEvents = findTool(tools, "list_events");
  if (/\b(calendar|schedule|meetings?|today|tomorrow|plate|deep work|free time)\b|\bfind (?:an|a free|some) (?:hour|time|slot)\b/.test(t) && !/\b(news|headlines)\b/.test(t) && listEvents) {
    return { calls: [call(listEvents, { days: 3 })] };
  }
  const newIssue = /\b(?:open|create|file) an? (?:issue|bug) in ([\w.-]+\/[\w.-]+)\s*[:,—-]\s*(.+)$/i.exec(text);
  const createIssue = findTool(tools, "create_issue");
  if (newIssue && createIssue) {
    const title = newIssue[2].trim().replace(/[.!]+$/, "");
    return { calls: [call(createIssue, { repo: newIssue[1], title: title.charAt(0).toUpperCase() + title.slice(1), body: `Reported by ${p.owner} through ${p.name}.` })] };
  }
  const gh = findTool(tools, "list_notifications");
  if (/\b(github|pull requests?|prs?|reviews?|issues?)\b/.test(t) && gh) return { calls: [call(gh, {})] };
  const files = findTool(tools, "search_files");
  if (/\b(files?|docs?|drive|document)\b/.test(t) && files) {
    return { calls: [call(files, { query: /(?:find|search)(?: for)? (.+)/i.exec(text)?.[1] ?? "recent" })] };
  }

  // Weather, money, math.
  const weatherMatch = /\bweather\b(?:.*?\b(?:in|for|at)\s+([a-z .,'-]+))?/i.exec(text);
  if (weatherMatch && tools.has("get_weather")) {
    const place = (weatherMatch[1] ?? "Austin, TX").replace(/[?.!]+$/, "").replace(/\s+(?:next week|this week(?:end)?|today|tomorrow|tonight|right now|now)$/i, "").trim();
    return { calls: [call("get_weather", { location: place || "Austin, TX", days: /\bweek\b/.test(t) ? 7 : 3 })] };
  }
  const money = t
    .replace(/\beuros?\b/g, "eur")
    .replace(/\b(?:us )?dollars?\b/g, "usd")
    .replace(/\b(?:british )?pounds?\b/g, "gbp")
    .replace(/\byen\b/g, "jpy")
    .replace(/\b(?:mexican )?pesos?\b/g, "mxn");
  const fx = /(\d+(?:\.\d+)?)\s*([a-z]{3})\s+(?:to|in|into)\s+([a-z]{3})\b/i.exec(money);
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
  if (/\b(my notes|my lists?|task list|to-?do(?: list)?|my tasks)\b/.test(t) && tools.has("list_notes")) return { calls: [call("list_notes", {})] };

  // "Explain derivatives simply" → an encyclopedia summary.
  const explain = /^(?:can you |please )?explain (.+?)(?: (?:simply|to me|like i'?m (?:new|five|5)))?[.?!]*$/i.exec(text.trim());
  if (explain && tools.has("wikipedia_lookup") && !/^(this|it|that|these)\b/i.test(explain[1])) {
    return { calls: [call("wikipedia_lookup", { topic: explain[1] })] };
  }

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
    const topic = text
      .replace(/.*\b(?:news|headlines)\b\s*(?:about|on|for)?\s*/i, "")
      .replace(/[?.!]+$/, "")
      .replace(/^(?:today|this morning|right now|lately)$/i, "")
      .trim();
    return { calls: [call("news_headlines", { topic: topic || "top stories" })] };
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
    if (status === "pending_approval" && /prompt-injection guard/.test(parsed?.message ?? "")) {
      const email = /approve: Email (\S+?): “(.+?)”/.exec(parsed?.message ?? "");
      const what = email ? `send “${email[2]}” to ${email[1]}` : "do something for someone I don't know";
      out.push(
        `⚠️ I stopped before doing that. Something I just read asked me to ${what}. Instructions inside outside content aren't yours, so I'm asking first (the prompt-injection guard). Tap **Deny** unless you really mean it.`,
      );
      continue;
    }
    if (status === "pending_approval") {
      // The approval card shows exactly what and why; the reply just says it's waiting on them.
      out.push("I've got that ready — it needs your OK first. Tap **Approve** and I'll go ahead, or **Deny** and nothing happens.");
      continue;
    }
    if (status === "blocked") {
      out.push(`I can't do that one: ${parsed?.message ?? "it's not allowed."}`);
      continue;
    }
    // Outside content arrives wrapped (see runTool); summarize what's inside.
    const content = unwrapUntrusted(parsed?.content ?? parsed?.error ?? r.content);
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
        out.push(content.split("\n").slice(0, /\bweek\b/i.test(userText) ? 9 : 3).join("\n"));
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
        if (/\b(reply|respond|answer)\b/i.test(userText)) {
          // People, not notifications, are the ones waiting on an answer.
          const people = normal.filter((m) => !/notifications?@|no-?reply@/i.test(m[1]));
          out.push(
            people.length
              ? `These look like they need a reply from you:\n${people.map((m) => `- **${m[1].replace(/<.+>/, "").trim()}** — ${m[2]}`).join("\n")}\n\nWant me to answer one? Say something like “reply to Sam saying yes, 12:30 works”.`
              : "Nothing's waiting on a reply from you.",
          );
          break;
        }
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
        out.push(`${f.done} ${content.replace(/\s*\(sch_[a-z0-9]+\)/, "").replace(/\s+/g, " ").trim()}`);
        break;
      case "list_reminders": {
        const rows = [...content.matchAll(/^- sch_\S+ \[(\w+)\] (.+?) — (.+)$/gm)];
        const line = (m: RegExpMatchArray) => `- **${m[2]}** — ${m[3]}`;
        const reminders = rows.filter((m) => m[1] !== "routine");
        const routines = rows.filter((m) => m[1] === "routine");
        out.push(
          rows.length
            ? [
                reminders.length ? `Your reminders:\n${reminders.map(line).join("\n")}` : "",
                routines.length ? `Your routines:\n${routines.map(line).join("\n")}` : "",
              ]
                .filter(Boolean)
                .join("\n\n")
            : "Nothing scheduled yet. Try “remind me to stretch in 20 minutes”.",
        );
        break;
      }
      case "list_events": {
        const rows = [...content.matchAll(/^- (.+?) → (.+?): (.+)$/gm)];
        const u = userText.toLowerCase();
        const slot = freeHour(content);
        if (rows.length && slot && /\b(find|free|open)\b[^?]*\b(hour|time|slot)\b|\bdeep work\b/.test(u)) {
          out.push(`You're free on **${slot.day}, ${clockLabel(slot.start)} to ${clockLabel(slot.start + 60)}**. Want it? Say “block it” and I'll hold it for you.`);
          break;
        }
        if (rows.length && /\bprep\b|\bnext meeting\b/.test(u)) {
          const next = rows.find((m) => /\b(1:1|standup|sync|meeting|call|interview|review)\b/i.test(m[3])) ?? rows[0];
          const start = clockMinutes(next[1]);
          const nudge = start !== null && start >= 10 ? ` Want a nudge first? Say “remind me to prep for ${next[3]} at ${clockLabel(start - 10).replace(" ", "").toLowerCase()}”.` : "";
          out.push(`Your next meeting is **${next[3]}**, ${next[1]} to ${next[2]}.${nudge}`);
          break;
        }
        // "What's on my plate tomorrow?" → just that day, when the dates line up.
        const day = /\btomorrow\b/.test(u) ? dayLabel(1) : /\btoday\b/.test(u) ? dayLabel(0) : null;
        const shown = day && rows.some((m) => m[1].startsWith(day)) ? rows.filter((m) => m[1].startsWith(day)) : rows;
        out.push(
          shown.length
            ? `${day && shown !== rows ? (/\btomorrow\b/.test(u) ? "Tomorrow" : "Today") + " you've got:" : "Here's what's coming up:"}\n${shown.map((m) => `- **${m[3]}** — ${day && shown !== rows ? m[1].slice(day.length).replace(/^,\s*/, "") : m[1]} to ${m[2]}`).join("\n")}${demoNote(content)}`
            : "Your calendar is clear.",
        );
        break;
      }
      case "list_notifications": {
        const rows = [...content.matchAll(/^- (.+)$/gm)];
        out.push(rows.length ? `Here's what's waiting on you on GitHub:\n${rows.map((m) => `- ${m[1]}`).join("\n")}${demoNote(content)}` : "Nothing's waiting on you on GitHub.");
        break;
      }
      case "search_files": {
        const rows = [...content.matchAll(/^- (.+)$/gm)];
        out.push(rows.length ? `I found these files:\n${rows.map((m) => `- ${m[1]}`).join("\n")}${demoNote(content)}` : "I didn't find any matching files.");
        break;
      }
      case "remember":
        out.push(content.startsWith("Already") ? "I already had that one noted. 👍" : "Got it — I'll remember that.");
        break;
      case "write_note": {
        const list = LISTS.find((l) => l.match.test(userText.toLowerCase()));
        const title = /“(.+?)”/.exec(content)?.[1] ?? list?.title ?? "your list";
        out.push(
          list
            ? `Done! I saved “${list.title}”:\n${list.items.map((i) => `- ${i}`).join("\n")}\n\nIt's under **Memory → Notes**. Add to it anytime: “add ${list.example} to my ${list.title.toLowerCase().replace(/ list$/, "")} list”.`
            : `${content.startsWith("Created") ? "Started" : "Updated"} your “${title}” list. It's under **Memory → Notes**.`,
        );
        break;
      }
      case "list_notes":
        out.push(
          content === "No notes yet."
            ? "Your lists are empty so far. Say “add call the bank and pay rent to my to-do list” and I'll start one."
            : `Here are your notes and lists:\n${content.replace(/- \[[ x]\] /g, "")}`,
        );
        break;
      case "wikipedia_lookup": {
        const [heading, extract, link] = content.split("\n");
        out.push(link?.startsWith("http") ? `**${heading}:** ${extract}\n\n[More on Wikipedia](${link})` : content);
        break;
      }
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
      default: {
        // Demo connections for apps without their own sample data.
        const demoApp = /^\(demo data\) (.+?) is connected in demo mode/.exec(content)?.[1];
        if (demoApp) {
          out.push(`${demoApp} is connected in demo mode, so there's nothing real to show yet. Once it's really connected, I'll look there for you.`);
          break;
        }
        const body = content.replace(/^\(demo data\)\s*/, "").trim();
        const text = body.length > 600 ? `${body.slice(0, 600)}…` : body;
        out.push(`${body.startsWith("- ") ? `Here's what I found:\n${text}` : text}${/^Simulated\b/.test(body) ? "" : demoNote(content)}`);
      }
    }
  }
  if (!out.length) return `${f.done}`;
  void userText;
  return out.join("\n\n");
}

/** "Wed, Oct 14, 10:00 AM" → minutes after midnight. */
function clockMinutes(s: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(s);
  return m ? ((Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]) : null;
}

function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${((h + 11) % 12) + 1}:${pad(minutes % 60)} ${h < 12 ? "AM" : "PM"}`;
}

/** The label the demo calendar uses for a day: "Wed, Oct 14". */
function dayLabel(offset: number, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** The first free hour between 9 and 5, after today, in the demo calendar's listing. */
function freeHour(content: string): { day: string; start: number } | null {
  const busy = new Map<string, [number, number][]>();
  for (const m of content.matchAll(/^- (.+?), (\d{1,2}:\d{2} [AP]M) → (.+?): .+$/gm)) {
    const start = clockMinutes(m[2]);
    const end = clockMinutes(m[3]);
    if (start === null || end === null) continue;
    busy.set(m[1], [...(busy.get(m[1]) ?? []), [start, end]]);
  }
  for (const [day, spans] of [...busy].slice(1)) {
    for (let start = 9 * 60; start <= 16 * 60; start += 60) {
      if (spans.every(([a, b]) => start + 60 <= a || start >= b)) return { day, start };
    }
  }
  return null;
}

/** "Block it" right after it offered a free hour: hold that hour on the calendar (the owner approves first). */
function holdSlot(userText: string, messages: LlmMessage[], tools: Set<string>): LlmToolCall | null {
  if (!/^(?:yes[,!. ]*)?(?:please )?(?:block|hold|book) (?:it|that)\b/i.test(userText.trim())) return null;
  const createEvent = findTool(tools, "create_event");
  const offered = [...messages].reverse().find((m) => m.role === "assistant" && /You're free on \*\*/.test(m.content));
  const slot = offered && /You're free on \*\*(.+?), (\d{1,2}:\d{2} [AP]M) to (\d{1,2}:\d{2} [AP]M)\*\*/.exec(offered.content);
  if (!createEvent || !slot) return null;
  const date = new Date(`${slot[1]} ${new Date().getFullYear()}`);
  const start = clockMinutes(slot[2]);
  const end = clockMinutes(slot[3]);
  if (Number.isNaN(date.getTime()) || start === null || end === null) return null;
  const at = (minutes: number) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  const deepWork = messages.some((m) => m.role === "user" && /\bdeep work\b/i.test(m.content));
  return call(createEvent, { title: deepWork ? "Deep work" : "Focus time", start: at(start), end: at(end) });
}

/** The inside of an <untrusted_content> envelope, or the text as it was. */
function unwrapUntrusted(text: string): string {
  const m = /^<untrusted_content[^>]*>\n([\s\S]*?)\n<\/untrusted_content>/.exec(text);
  return m ? m[1] : text;
}

function demoNote(content: string): string {
  return /^\(demo data\)/.test(content) ? "\n\n(Demo mode: this is sample data.)" : "";
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
        const held = holdSlot(lastUserText(req.messages), req.messages, tools);
        const plan: Plan = held ? { calls: [held] } : planFromUser(lastUserText(req.messages), tools, p, req.system);
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
