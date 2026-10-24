/**
 * Chat message view model and helpers, shared by the server page (initial
 * messages) and the client chat (polling). No "use client": server components
 * may call these.
 */
import type { ToolView } from "./ToolChip";
import type { StudySetSummary } from "@/lib/db/schema";
import { filesOf, type AttachedFile } from "@/lib/library/attachments";

export type ChatMessage = {
  id: string;
  /** Stable React key: survives the optimistic id being swapped for the server's. */
  key?: string;
  /** createdAt came from this browser's clock (not yet confirmed by the server). */
  clientClock?: boolean;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  tools: ToolView[];
  approvals: string[];
  /** `href`: a page in the app the notice links to (e.g. Credit & usage, to add credit). */
  notices: { tone: "info" | "warn" | "danger"; text: string; href?: string }[];
  pending?: boolean;
  /** The stream ended before the reply was done (Stop, a dropped connection): the server's copy replaces it. */
  cutOff?: boolean;
  proactive?: boolean;
  via?: string;
  /** Text the owner selected on their screen and sent with a request by voice. */
  selection?: string;
  /** Notes from a meeting (shown with a header and a link to the meeting page). */
  meeting?: { id: string; app?: string; inPerson?: boolean; gone?: boolean };
  /** Files the owner attached (shown as chips in their bubble). */
  files?: AttachedFile[];
  /** Flashcards or quizzes the bot made (shown as cards to study). */
  studySets?: StudySetSummary[];
  /** A voice call with the bot (shown as a card with its transcript). */
  call?: { kind: "web" | "phone"; durationS: number; latencyP50Ms: number | null; turns: { role: "caller" | "bot"; text: string; interrupted?: boolean }[] };
};

/**
 * Fold server messages into the list without reordering it: known ids get the
 * server's timestamp, optimistic copies (same role and text) are replaced in
 * place, and only genuinely new messages are appended.
 */
export function mergeServerMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const next = [...prev];
  const append: ChatMessage[] = [];
  for (const m of incoming) {
    const same = next.findIndex((x) => x.id === m.id);
    if (same >= 0) {
      if (next[same].createdAt !== m.createdAt || next[same].clientClock) next[same] = { ...next[same], createdAt: m.createdAt, clientClock: false };
      continue;
    }
    const local = next.findIndex((x) => x.id.startsWith("local-") && x.role === m.role && x.text.trim() === m.text.trim());
    if (local >= 0) {
      next[local] = { ...m, key: next[local].key ?? next[local].id, proactive: next[local].role === "assistant" ? false : m.proactive };
      continue;
    }
    // A reply cut off here (Stop, a dropped connection) was saved under the server's own id, maybe
    // longer or shorter than what was shown: the next reply from the server is that one.
    const cut = m.role === "assistant" ? next.findIndex((x) => x.cutOff && x.role === "assistant") : -1;
    if (cut >= 0) {
      next[cut] = { ...m, key: next[cut].key ?? next[cut].id };
      continue;
    }
    if (append.some((x) => x.id === m.id)) continue;
    append.push(m);
  }
  return append.length || next.some((x, i) => x !== prev[i]) ? [...next, ...append] : prev;
}

/** Convert a stored message (server) into the chat's view model. */
export function toChatMessage(m: {
  id: string;
  role: string;
  text: string;
  createdAt: string | Date;
  parts: unknown[];
  meta?: Record<string, unknown>;
}): ChatMessage {
  const parts = (m.parts ?? []) as (
    | { type: "tool_call"; id: string; name: string; title?: string; summary?: string }
    | { type: "tool_result"; id: string; name: string; status: ToolView["state"]; summary?: string; approvalId?: string }
    | { type: "approval"; approvalId: string }
    | { type: "notice"; tone: "info" | "warn" | "danger"; text: string; href?: string }
    | { type: "study_set"; set: StudySetSummary }
  )[];
  const tools: ToolView[] = [];
  const approvals: string[] = [];
  const notices: ChatMessage["notices"] = [];
  const studySets: StudySetSummary[] = [];
  for (const p of parts) {
    if (p.type === "study_set" && p.set?.id) studySets.push(p.set);
    if (p.type === "tool_call") tools.push({ id: p.id, name: p.name, title: p.title ?? p.name, summary: p.summary ?? p.title ?? p.name, state: "ok" });
    if (p.type === "tool_result") {
      const t = tools.find((x) => x.id === p.id);
      if (t) {
        t.state = p.status;
        if (p.status !== "ok") t.detail = p.summary;
      }
    }
    if (p.type === "approval") approvals.push(p.approvalId);
    if (p.type === "notice") notices.push({ tone: p.tone, text: p.text, ...(p.href ? { href: p.href } : {}) });
  }
  return {
    id: m.id,
    role: m.role === "user" ? "user" : "assistant",
    text: m.text,
    createdAt: new Date(m.createdAt).toISOString(),
    tools,
    approvals,
    notices,
    // Routines and reminders "reach out"; greetings and replies to an approval don't need a label.
    proactive: Boolean(m.meta?.proactive) && m.role === "assistant" && m.meta?.trigger !== "greeting" && m.meta?.trigger !== "approval",
    via: typeof m.meta?.via === "string" ? (m.meta.via as string) : undefined,
    selection: m.role === "user" && typeof m.meta?.selection === "string" && m.meta.selection.trim() ? (m.meta.selection as string) : undefined,
    ...(m.role === "user" && filesOf(m.meta).length ? { files: filesOf(m.meta) } : {}),
    ...(studySets.length ? { studySets } : {}),
    ...(m.meta?.kind === "call" && Array.isArray(m.meta.turns)
      ? {
          call: {
            kind: m.meta.callKind === "phone" ? ("phone" as const) : ("web" as const),
            durationS: Number(m.meta.durationS) || 0,
            latencyP50Ms: typeof m.meta.latencyP50Ms === "number" ? m.meta.latencyP50Ms : null,
            turns: (m.meta.turns as { role?: string; text?: string; interrupted?: boolean }[])
              .filter((t) => (t.role === "caller" || t.role === "bot") && typeof t.text === "string")
              .map((t) => ({ role: t.role as "caller" | "bot", text: t.text as string, ...(t.interrupted ? { interrupted: true } : {}) })),
          },
        }
      : {}),
    ...(m.meta?.kind === "meeting_notes" && typeof m.meta.meetingId === "string"
      ? {
          meeting: {
            id: m.meta.meetingId,
            app: typeof m.meta.meetingApp === "string" ? m.meta.meetingApp : undefined,
            inPerson: m.meta.meetingInPerson === true,
            gone: m.meta.meetingGone === true,
          },
        }
      : {}),
  };
}
