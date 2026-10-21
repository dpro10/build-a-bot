"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUp, Brain, FileUp, Paperclip, Sparkles, Square } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useBotLive } from "@/components/app/live-state";
import { ApprovalCard, type ApprovalView } from "./ApprovalCard";
import { Markdown } from "./Markdown";
import { ToolChip, type ToolView } from "./ToolChip";
import { mergeServerMessages, toChatMessage, type ChatMessage } from "./messages";
import { ChatMeetingNotes } from "@/components/meetings/ChatNotes";
import { ChatCall } from "@/components/call/ChatCall";
import { AttachmentChips, MessageFiles, useAttachments } from "@/components/library/Attachments";
import { StudySetCard } from "@/components/library/StudySet";
import { ACCEPT } from "@/lib/library/limits";
import type { StudySetSummary } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";



type ServerEvent =
  | { type: "status"; state: "thinking" | "working" | "waiting" | "done"; label?: string }
  | { type: "text"; delta: string }
  | ({ type: "tool" } & ToolView & { approvalId?: string })
  | { type: "approval"; approval: ApprovalView }
  | { type: "notice"; tone: "info" | "warn" | "danger"; text: string; href?: string }
  | { type: "study_set"; set: StudySetSummary }
  | { type: "done"; messageId: string | null; text: string; status: string }
  | { type: "error"; message: string };

const TOOL_ACTIVITY: Record<string, string> = {
  web_search: "Searching the web",
  check_facts: "Checking the facts",
  find_course_sources: "Looking up the course",
  news_headlines: "Checking the news",
  read_webpage: "Reading the page",
  get_weather: "Checking the weather",
  create_reminder: "Setting a reminder",
  schedule_routine: "Scheduling a routine",
  remember: "Making a note to remember",
  send_email: "Preparing an email",
  wikipedia_lookup: "Looking it up",
  search_files: "Searching your files",
  read_file: "Reading your file",
  list_files: "Looking through your Library",
  make_flashcards: "Making flashcards",
  make_quiz: "Writing a quiz",
};

async function* readEvents(res: Response): AsyncGenerator<ServerEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (!data) continue;
      try {
        yield JSON.parse(data) as ServerEvent;
      } catch {
        /* ignore malformed */
      }
    }
  }
}

export function ChatView({
  botId,
  botName,
  avatar,
  color,
  initialMessages,
  initialApprovals,
  starters,
  memoryInvite = false,
  needsGreeting,
  brainLabel,
  initialInput,
  canAttach = false,
}: {
  botId: string;
  botName: string;
  avatar: AvatarId;
  color: ColorwayId;
  initialMessages: ChatMessage[];
  initialApprovals: ApprovalView[];
  starters: string[];
  /** The bot barely knows its owner yet: offer "Bring my memories" with the starters. */
  memoryInvite?: boolean;
  needsGreeting: boolean;
  brainLabel: string;
  /** Prefilled message (e.g. "Ask Inky about this meeting" links), not sent until the owner says so. */
  initialInput?: string;
  /** Files can be attached (the Library is set up here). */
  canAttach?: boolean;
}) {
  const live = useBotLive();
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages);
  const [approvals, setApprovals] = React.useState<Record<string, ApprovalView>>(() => Object.fromEntries(initialApprovals.map((a) => [a.id, a])));
  const [input, setInput] = React.useState(initialInput ?? "");
  const [streaming, setStreaming] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);
  const greeted = React.useRef(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments(botId, canAttach);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);
  /** Fetches what arrived outside the stream (set below); `force` runs it even mid-stream. */
  const syncRef = React.useRef<(force?: boolean) => Promise<void>>(async () => {});

  const scrollToBottom = React.useCallback((smooth = true) => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  React.useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  // A prefilled question: put the cursor at the end, and drop it from the URL so a reload doesn't bring it back.
  React.useEffect(() => {
    if (!initialInput) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has("ask")) {
      url.searchParams.delete("ask");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, [initialInput]);

  React.useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const patchLast = React.useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].pending) {
          next[i] = fn(next[i]);
          break;
        }
      }
      return next;
    });
  }, []);

  const runStream = React.useCallback(
    async (url: string, body?: unknown) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      live.setMood("thinking");
      live.setActivity("Thinking");
      const pendingId = `pending-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: pendingId, key: pendingId, clientClock: true, role: "assistant", text: "", createdAt: new Date().toISOString(), tools: [], approvals: [], notices: [], pending: true },
      ]);
      let finalStatus = "ok";
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          patchLast((m) => ({ ...m, pending: false, notices: [...m.notices, { tone: "danger", text: data.error ?? "Something went wrong." }] }));
          return;
        }
        for await (const ev of readEvents(res)) {
          switch (ev.type) {
            case "status":
              if (ev.state === "thinking") live.setMood("thinking");
              if (ev.state === "working") live.setMood("working");
              if (ev.state === "waiting") live.setMood("alert");
              if (ev.label) live.setActivity(ev.label);
              break;
            case "text":
              live.setActivity(null);
              patchLast((m) => ({ ...m, text: m.text + ev.delta }));
              break;
            case "tool": {
              const view: ToolView = { id: ev.id, name: ev.name, title: ev.title, summary: ev.summary, state: ev.state, detail: ev.detail, sources: ev.sources };
              if (ev.state === "running") {
                live.setMood("working");
                live.setActivity(TOOL_ACTIVITY[ev.name] ?? ev.title);
              }
              patchLast((m) => {
                const tools = m.tools.some((t) => t.id === ev.id) ? m.tools.map((t) => (t.id === ev.id ? view : t)) : [...m.tools, view];
                return { ...m, tools };
              });
              break;
            }
            case "approval":
              setApprovals((prev) => ({ ...prev, [ev.approval.id]: { ...ev.approval, status: "pending" } }));
              live.setPendingApprovals((n) => n + 1);
              patchLast((m) => ({ ...m, approvals: [...m.approvals, ev.approval.id] }));
              break;
            case "notice":
              patchLast((m) => ({ ...m, notices: [...m.notices, { tone: ev.tone, text: ev.text, href: ev.href }] }));
              break;
            case "study_set":
              patchLast((m) => ({ ...m, studySets: [...(m.studySets ?? []).filter((x) => x.id !== ev.set.id), ev.set] }));
              break;
            case "done":
              finalStatus = ev.status;
              patchLast((m) => ({ ...m, id: ev.messageId ?? m.id, text: ev.text || m.text, pending: false }));
              break;
            case "error":
              patchLast((m) => ({ ...m, notices: [...m.notices, { tone: "danger", text: ev.message }] }));
              break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patchLast((m) => ({ ...m, notices: [...m.notices, { tone: "danger", text: "Connection lost. Try again." }] }));
        }
      } finally {
        patchLast((m) => ({ ...m, pending: false }));
        setStreaming(false);
        live.setActivity(null);
        abortRef.current = null;
        // No happy bounce for a turn that couldn't be answered (no brain, a limit, a brain error).
        const failed = finalStatus === "unavailable" || finalStatus === "limited" || finalStatus === "error";
        live.setMood(failed ? "idle" : "happy");
        if (!failed) setTimeout(() => live.setMood("idle"), 2400);
        // STOP / START typed in the chat: show the new state in the header right away.
        if (finalStatus === "command" || finalStatus === "paused") setTimeout(() => void syncRef.current(true), 0);
      }
    },
    [live, patchLast],
  );

  // The bot talks first.
  React.useEffect(() => {
    if (needsGreeting && !greeted.current) {
      greeted.current = true;
      void runStream(`/api/bots/${botId}/greet`);
    }
  }, [needsGreeting, botId, runStream]);

  // Pick up messages that arrive without a stream (texts and calls, reminders, approval follow-ups),
  // and the bot's paused state (STOP from another channel). The latest tick lives in a ref so the
  // timer isn't restarted by every message, and a chat command can sync right away.
  React.useEffect(() => {
    syncRef.current = async (force = false) => {
      if ((streaming && !force) || document.visibilityState !== "visible") return;
      // Cursor: the newest message the server has confirmed (optimistic ones carry browser clocks).
      const confirmed = messages.filter((m) => !m.pending && !m.clientClock && !m.id.startsWith("local-") && !m.id.startsWith("pending-"));
      const after = confirmed.reduce((max, m) => (m.createdAt > max ? m.createdAt : max), new Date(0).toISOString());
      try {
        const res = await fetch(`/api/bots/${botId}/messages?after=${encodeURIComponent(after)}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages: { id: string; role: string; author: string; text: string; createdAt: string; parts: unknown[]; meta: Record<string, unknown> }[];
          approvals: (ApprovalView & { status: string })[];
          botStatus: string;
        };
        live.setPaused(data.botStatus === "paused");
        setApprovals((prev) => {
          const next = { ...prev };
          for (const a of data.approvals) next[a.id] = { ...next[a.id], ...a };
          return next;
        });
        live.setPendingApprovals(data.approvals.filter((a) => a.status === "pending").length);
        const incoming = data.messages.filter((m) => m.role === "user" || m.role === "assistant").map(toChatMessage);
        const fresh = incoming.filter((m) => !messages.some((x) => x.id === m.id));
        if (fresh.length || incoming.length) {
          setMessages((prev) => mergeServerMessages(prev, incoming));
        }
        if (fresh.some((m) => m.role === "assistant" && !messages.some((x) => x.id.startsWith("local-") && x.text.trim() === m.text.trim()))) {
          live.setMood("happy");
          setTimeout(() => live.setMood("idle"), 2400);
        }
      } catch {
        /* offline */
      }
    };
  }, [botId, messages, streaming, live]);
  // Once on open: a reply may have landed since the page was rendered.
  React.useEffect(() => {
    const t = setTimeout(() => void syncRef.current(), 400);
    return () => clearTimeout(t);
  }, []);
  React.useEffect(() => {
    const interval = setInterval(() => void syncRef.current(), 6000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const send = async (text: string, opts: { withFiles?: boolean } = {}) => {
    const t = text.trim();
    const files = opts.withFiles === false ? [] : attachments.ready.map((a) => a.file!);
    if ((!t && !files.length) || streaming || (opts.withFiles !== false && attachments.busy)) return;
    setInput("");
    if (opts.withFiles !== false) attachments.clear();
    stickToBottom.current = true;
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        key: `local-${Date.now()}`,
        role: "user",
        text: t,
        createdAt: new Date().toISOString(),
        tools: [],
        approvals: [],
        notices: [],
        ...(files.length ? { files: files.map((f) => ({ id: f.id, name: f.name, kind: f.kind, pages: f.pages, status: f.status, note: f.note })) } : {}),
      },
    ]);
    await runStream(`/api/bots/${botId}/chat`, files.length ? { text: t, fileIds: files.map((f) => f.id) } : { text: t });
    inputRef.current?.focus();
  };

  // Files dropped anywhere on the chat go to the Library and onto the message.
  const dropProps = canAttach
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (e: React.DragEvent) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          attachments.add([...e.dataTransfer.files]);
          inputRef.current?.focus();
        },
      }
    : {};

  const onDecided = (a: ApprovalView, followUp: string | null) => {
    setApprovals((prev) => ({ ...prev, [a.id]: a }));
    live.setPendingApprovals((n) => Math.max(0, n - 1));
    if (followUp) {
      setMessages((prev) => [
        ...prev,
        { id: `local-followup-${Date.now()}`, key: `local-followup-${Date.now()}`, role: "assistant", text: followUp, createdAt: new Date().toISOString(), tools: [], approvals: [], notices: [] },
      ]);
    }
    live.setMood(a.status === "denied" ? "idle" : "happy");
  };

  const showStarters = !streaming && messages.filter((m) => m.role === "user").length < 2 && starters.length > 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropProps}>
      {dragging ? (
        <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-primary bg-primary-soft/80 text-primary backdrop-blur-sm animate-pop">
          <FileUp className="size-10" aria-hidden />
          <div className="font-display text-lg font-semibold">Drop files for {botName}</div>
          <div className="text-sm">PDFs, Word, PowerPoint, text and photos · up to 25 MB each</div>
        </div>
      ) : null}
      {/* Focusable so keyboard users can scroll the conversation even when it has no links. */}
      <div
        ref={listRef}
        onScroll={onScroll}
        tabIndex={0}
        role="region"
        aria-label={`Conversation with ${botName}`}
        className="scrollbar-thin flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-6 pb-8 sm:px-6">
          {messages.length === 0 && !streaming ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Avatar avatar={avatar} color={color} size={120} mood="happy" />
              <div className="font-display text-xl font-semibold">Say hi to {botName}</div>
              <p className="text-sm text-muted-foreground">Running on {brainLabel}.</p>
            </div>
          ) : null}
          {messages.map((m) => (
            <MessageRow
              key={m.key ?? m.id}
              botId={botId}
              message={m}
              avatar={avatar}
              color={color}
              approvals={approvals}
              onDecided={onDecided}
              activity={m.pending ? live.activity : null}
              botName={botName}
              onAsk={(text) => void send(text, { withFiles: false })}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto w-full max-w-3xl px-3 pt-3 pb-3 sm:px-6">
          {showStarters ? (
            <div className="no-scrollbar -mx-1 mb-2.5 flex gap-2 overflow-x-auto px-1 sm:flex-wrap">
              {memoryInvite ? (
                <Link
                  href={`/app/bots/${botId}/memory?import=1`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft/60 px-3.5 py-1.5 text-sm font-medium text-primary shadow-soft transition hover:border-primary/50"
                >
                  <Brain className="size-3.5" aria-hidden />
                  Bring my memories from ChatGPT
                </Link>
              ) : null}
              {starters.slice(0, 5).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground/90 shadow-soft transition hover:border-primary/40 hover:text-primary"
                >
                  <Sparkles className="size-3.5 text-primary" />
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <AttachmentChips items={attachments.items} onRemove={attachments.remove} />
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            streaming={streaming}
            onStop={() => abortRef.current?.abort()}
            inputRef={inputRef}
            placeholder={live.paused ? `Paused — say START to wake ${botName}` : attachments.items.length ? `Ask ${botName} about ${attachments.items.length === 1 ? "it" : "them"}…` : `Message ${botName}…`}
            onFiles={canAttach ? attachments.add : undefined}
            hasFiles={attachments.ready.length > 0}
            waiting={attachments.busy}
          />
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            {botName} is an AI and can make mistakes. Actions follow your trust settings — every one gets a receipt.
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  botId,
  message: m,
  avatar,
  color,
  approvals,
  onDecided,
  activity,
  botName,
  onAsk,
}: {
  botId: string;
  message: ChatMessage;
  avatar: AvatarId;
  color: ColorwayId;
  approvals: Record<string, ApprovalView>;
  onDecided: (a: ApprovalView, followUp: string | null) => void;
  activity: string | null;
  botName: string;
  onAsk: (text: string) => void;
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-bubble-owner px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-bubble-owner-foreground shadow-[0_6px_18px_-8px_rgb(109_77_255/0.55)]">
          {m.text}
          {m.files?.length ? <MessageFiles botId={botId} files={m.files} /> : null}
          {m.selection ? (
            // Sent by voice with text they had selected on their screen.
            <figure className="mt-2 border-l-2 border-current/40 pl-3 text-[13px] opacity-90">
              <figcaption className="text-[11px] font-semibold tracking-wide uppercase">With the text you selected</figcaption>
              <blockquote className="mt-0.5 line-clamp-4 break-words">{m.selection}</blockquote>
            </figure>
          ) : null}
        </div>
      </div>
    );
  }
  const empty = !m.text && m.pending;
  return (
    <div className="flex gap-3 animate-fade-up">
      <div className="shrink-0 pt-0.5">
        <Avatar avatar={avatar} color={color} size={34} animated={false} title={botName} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {m.proactive && !m.meeting ? <div className="text-[11px] font-semibold tracking-wide text-primary uppercase">{botName} reached out</div> : null}
        {m.tools.length ? (
          <div className="flex flex-col gap-1.5">
            {m.tools.map((t) => (
              <ToolChip key={t.id} tool={t} />
            ))}
          </div>
        ) : null}
        {empty ? (
          <div className="flex items-center gap-2 py-2">
            <span className="flex gap-1">
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground/50" />
            </span>
            {activity ? <span className="shimmer-text text-sm font-medium">{activity}…</span> : null}
          </div>
        ) : m.call ? (
          <ChatCall call={m.call} botName={botName} />
        ) : m.text && m.meeting ? (
          <ChatMeetingNotes botId={botId} text={m.text} meeting={m.meeting} />
        ) : m.text ? (
          <div className="max-w-full self-start rounded-3xl rounded-tl-lg border border-border bg-bubble-bot px-4 py-3 text-[15px] shadow-soft">
            <Markdown text={m.text} />
          </div>
        ) : null}
        {m.studySets?.map((set) => (
          <StudySetCard key={set.id} botId={botId} set={set} botName={botName} onAsk={onAsk} />
        ))}
        {m.notices.map((n, i) => {
          const tone = cn(
            "self-start rounded-2xl px-3 py-2 text-sm",
            n.tone === "danger" ? "bg-danger-soft text-danger" : n.tone === "warn" ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary",
          );
          return n.href ? (
            <Link key={i} href={n.href} className={cn(tone, "font-medium underline-offset-2 hover:underline")}>
              {n.text}
            </Link>
          ) : (
            <div key={i} className={tone}>
              {n.text}
            </div>
          );
        })}
        {m.approvals.map((id) =>
          approvals[id] ? (
            <div key={id} className="max-w-xl">
              <ApprovalCard approval={approvals[id]} onDecided={onDecided} />
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  streaming,
  onStop,
  inputRef,
  placeholder,
  onFiles,
  hasFiles = false,
  waiting = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  streaming: boolean;
  onStop: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  /** Attach files (the paperclip and pasting); absent when files can't be added here. */
  onFiles?: (files: File[]) => void;
  /** Read files are attached: they can be sent without words. */
  hasFiles?: boolean;
  /** Attached files are still uploading or being read: sending waits. */
  waiting?: boolean;
}) {
  // No microphone here: a browser's speech recognition sends the audio to its maker, and voice typing
  // lives in the desktop app (which types into this box too). Phone keyboards dictate on their own.
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value, inputRef]);

  return (
    <div className={cn("flex items-end gap-2 rounded-[28px] border border-input bg-card p-1.5 shadow-soft transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15", onFiles ? "pl-1.5" : "pl-4")}>
      {onFiles ? (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Attach files"
            title="Attach files (PDF, Word, PowerPoint, text, photos)"
          >
            <Paperclip className="size-5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) onFiles([...e.target.files]);
              e.target.value = "";
            }}
          />
        </>
      ) : null}
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
        onPaste={(e) => {
          if (onFiles && e.clipboardData.files.length) {
            e.preventDefault();
            onFiles([...e.clipboardData.files]);
          }
        }}
        rows={1}
        placeholder={placeholder}
        className="max-h-[180px] min-h-[40px] min-w-0 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap placeholder:text-muted-foreground/70"
        aria-label="Message"
      />
      {streaming ? (
        <button type="button" onClick={onStop} className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background" aria-label="Stop">
          <Square className="size-4 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onSend}
          disabled={(!value.trim() && !hasFiles) || waiting}
          title={waiting ? "Waiting for your files to be read" : undefined}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:bg-muted disabled:text-muted-foreground"
          aria-label="Send"
        >
          <ArrowUp className="size-5" />
        </button>
      )}
    </div>
  );
}

