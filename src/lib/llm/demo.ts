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

type Plan = { calls: LlmToolCall[] } | { text: string };

function planFromUser(text: string, tools: Set<string>, p: Persona, system: string): Plan {
  const t = text.toLowerCase();
  const f = FLAVOR[p.species] ?? FLAVOR.robot;

  // Platform directives (greeting, routines, approvals).
  if (t.includes("<system_directive>")) {
    if (t.includes("very first message")) {
      const ideas = /Ideas you can offer: (.+?)(?:\n|$)/.exec(text)?.[1]?.split(" | ").slice(0, 3) ?? [];
      const ideaText = ideas.length ? ` I can already ${ideas.map((i) => `“${i.replace(/\.$/, "")}”`).join(", ")} — just ask.` : "";
      return {
        text: `${f.hi} I'm ${p.name}, your new AI assistant.${ideaText} (I'm running on the demo brain right now — connect a real one anytime in Settings.) What should we tackle first?`,
      };
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
      case "search_email":
      case "read_inbox": {
        const emails = [...content.matchAll(/From: (.+?) \| Subject: (.+?)\n/g)];
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

      if (last?.role === "tool") {
        const results: { name: string; content: string; isError?: boolean }[] = [];
        for (let i = req.messages.length - 1; i >= 0; i--) {
          const m = req.messages[i];
          if (m.role !== "tool") break;
          results.unshift({ name: m.name, content: m.content, isError: m.isError });
        }
        const userText = lastUserText(req.messages);
        const injected = results.map((r) => /forward[^\n]*?to ([^\s,]+@[^\s,.]+\.[a-z]+)/i.exec(r.content)?.[1]).find(Boolean);
        const sendTool = findTool(tools, "send_email");
        const alreadySent = req.messages.some((m) => m.role === "assistant" && m.toolCalls?.some((c) => c.name.endsWith("send_email")));
        if (/\b(do what|follow|act on)\b/i.test(userText) && injected && sendTool && !alreadySent) {
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
