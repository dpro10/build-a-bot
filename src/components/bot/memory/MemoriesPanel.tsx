"use client";
import * as React from "react";
import { Brain, Check, DownloadCloud, Pencil, Pin, Plus, SearchX, Trash2, UserRound, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { ago } from "@/components/bot/activity/time";
import { usePendingDelete } from "./use-pending-delete";
import { ImportMemories } from "./ImportMemories";
import { matches, type MemoryItem } from "./types";

const MAX_MEMORIES = 2000;
const MAX_PINNED = 15;

export function MemoriesPanel({
  botId,
  botName,
  avatar,
  color,
  items,
  setItems,
  query,
  now,
  importOpen,
  setImportOpen,
}: {
  botId: string;
  botName: string;
  avatar: AvatarId;
  color: ColorwayId;
  items: MemoryItem[];
  setItems: React.Dispatch<React.SetStateAction<MemoryItem[]>>;
  query: string;
  now: Date;
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const scheduleDelete = usePendingDelete();
  // Pinned first (always on the bot's mind), then newest.
  const shown = items.filter((m) => matches(query, m.text)).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const pinnedCount = items.filter((m) => m.pinned).length;
  // The big invite is for a bot that barely knows its owner; after an import, a quiet link is enough.
  const invite = items.length < 10 && !items.some((m) => m.source === "import");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text.length < 2) return;
    if (items.some((m) => m.text.trim().toLowerCase() === text.toLowerCase())) {
      setDraft("");
      return toast(`${botName} already remembers that`);
    }
    setAdding(true);
    try {
      const res = await api<{ memory: MemoryItem | null; already?: string }>(`/api/bots/${botId}/memories`, { method: "POST", body: { text } });
      setDraft("");
      if (!res.memory) return toast(`${botName} already remembers that`, { description: res.already });
      const added = normalize(res.memory);
      setItems((cur) => [added, ...cur]);
      toast.success(`${botName} will remember that`);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't save that.");
    } finally {
      setAdding(false);
    }
  };

  const save = async (m: MemoryItem, text: string) => {
    const clean = text.trim();
    if (clean === m.text) return setEditing(null);
    if (clean.length < 2) return toast.error("That's a bit short to remember.");
    const before = items;
    setItems((cur) => cur.map((x) => (x.id === m.id ? { ...x, text: clean, source: "owner" } : x)));
    setEditing(null);
    try {
      const res = await api<{ memory: MemoryItem }>(`/api/bots/${botId}/memories/${m.id}`, { method: "PATCH", body: { text: clean } });
      setItems((cur) => cur.map((x) => (x.id === m.id ? normalize(res.memory) : x)));
      toast.success("Updated");
    } catch (err) {
      setItems(before);
      toast.error((err as Error).message || "Couldn't save that.");
    }
  };

  const togglePin = async (m: MemoryItem) => {
    if (!m.pinned && pinnedCount >= MAX_PINNED) return toast.error(`You can pin up to ${MAX_PINNED}. Unpin one first.`);
    setItems((cur) => cur.map((x) => (x.id === m.id ? { ...x, pinned: !m.pinned } : x)));
    try {
      await api(`/api/bots/${botId}/memories/${m.id}`, { method: "PATCH", body: { pinned: !m.pinned } });
      toast.success(m.pinned ? "Unpinned" : `Pinned: always on ${botName}'s mind`);
    } catch (err) {
      setItems((cur) => cur.map((x) => (x.id === m.id ? { ...x, pinned: m.pinned } : x)));
      toast.error((err as Error).message || "Couldn't change that.");
    }
  };

  const imported = (memories: MemoryItem[]) => setItems((cur) => [...memories.map(normalize), ...cur]);

  const remove = (m: MemoryItem) => {
    const index = items.findIndex((x) => x.id === m.id);
    setItems((cur) => cur.filter((x) => x.id !== m.id));
    scheduleDelete(`mem:${m.id}`, `/api/bots/${botId}/memories/${m.id}`, {
      message: "Memory deleted",
      description: `${botName} won't use it anymore.`,
      onUndo: () =>
        setItems((cur) => {
          if (cur.some((x) => x.id === m.id)) return cur;
          const next = [...cur];
          next.splice(Math.min(index, next.length), 0, m);
          return next;
        }),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {invite ? (
        <div className="flex flex-col gap-3 rounded-3xl border border-primary/20 bg-primary-soft/40 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card text-primary shadow-soft" aria-hidden>
            <DownloadCloud className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Already use ChatGPT, Claude or Gemini?</p>
            <p className="text-sm text-muted-foreground">Bring what they know about you, so {botName} knows you from day one. It takes a minute.</p>
          </div>
          <Button onClick={() => setImportOpen(true)} className="w-fit shrink-0">
            Bring my memories
          </Button>
        </div>
      ) : null}
      <ImportMemories botId={botId} botName={botName} open={importOpen} onOpenChange={setImportOpen} onSaved={imported} />
      <form onSubmit={add} className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <label htmlFor="mem-add" className="sr-only">
            Add a memory
          </label>
          <Input
            id="mem-add"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={300}
            placeholder="Add a memory…"
            autoComplete="off"
            className="h-11 flex-1"
          />
          <Button type="submit" loading={adding} disabled={draft.trim().length < 2} className="h-11 shrink-0">
            {adding ? null : <Plus />} <span className="hidden sm:inline">Remember</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>
        <FieldHint>Short facts work best: “I'm vegetarian”, “My partner is Sam”. Never passwords or keys.</FieldHint>
      </form>

      {!items.length ? (
        <EmptyState icon={<Brain className="size-8" />} title="Nothing remembered yet" className="bg-card/50">
          {botName} saves facts when you say things like “Remember that I'm vegetarian.” You can add some here too.
        </EmptyState>
      ) : !shown.length ? (
        <EmptyState icon={<SearchX className="size-8" />} title="No matches" className="bg-card/50">
          Nothing in memory mentions “{query}”.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((m) => (
            <MemoryRow
              key={m.id}
              m={m}
              botName={botName}
              avatar={avatar}
              color={color}
              now={now}
              editing={editing === m.id}
              onEdit={() => setEditing(m.id)}
              onCancel={() => setEditing(null)}
              onSave={(text) => save(m, text)}
              onDelete={() => remove(m)}
              onPin={() => void togglePin(m)}
            />
          ))}
        </ul>
      )}
      {items.length ? (
        <div className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground">
          <p>
            {items.length.toLocaleString("en-US")} {items.length === 1 ? "memory" : "memories"} · {botName} can keep up to {MAX_MEMORIES.toLocaleString("en-US")} and
            uses the ones that matter for each message. Pinned ones are always on its mind.
          </p>
          {!invite ? (
            <button type="button" onClick={() => setImportOpen(true)} className="font-medium text-primary hover:underline">
              Bring more memories from ChatGPT, Claude or Gemini
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function normalize(m: MemoryItem): MemoryItem {
  return { id: m.id, text: m.text, source: m.source, pinned: Boolean(m.pinned), createdAt: String(m.createdAt), updatedAt: String(m.updatedAt) };
}

const hoverOnly = "transition sm:opacity-0 sm:focus-visible:opacity-100 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100";

function origin(m: MemoryItem, botName: string): string {
  if (m.source === "bot") return `${botName} learned this`;
  if (m.source === "import") return "You brought this";
  return "You added this";
}

function MemoryRow({
  m,
  botName,
  avatar,
  color,
  now,
  editing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  onPin,
}: {
  m: MemoryItem;
  botName: string;
  avatar: AvatarId;
  color: ColorwayId;
  now: Date;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (text: string) => void;
  onDelete: () => void;
  onPin: () => void;
}) {
  const [text, setText] = React.useState(m.text);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (editing) {
      setText(m.text);
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.setSelectionRange(m.text.length, m.text.length);
      });
    }
  }, [editing, m.text]);
  const byBot = m.source === "bot";
  return (
    <li className={cn("group flex items-start gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 shadow-soft transition sm:px-4", editing && "ring-4 ring-primary/10")}>
      <span className="mt-0.5 shrink-0" aria-hidden>
        {byBot ? (
          <Avatar avatar={avatar} color={color} size={32} animated={false} />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserRound className="size-4" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSave(text);
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor={`mem-${m.id}`} className="sr-only">
              Edit memory
            </label>
            <Textarea
              id={`mem-${m.id}`}
              ref={ref}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              rows={2}
              className="min-h-0 px-3 py-2 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSave(text);
                }
              }}
            />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm">
                <Check /> Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                <X /> Cancel
              </Button>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{text.length}/300</span>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{m.text}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {m.pinned ? (
                <>
                  <span className="font-medium text-primary">
                    <Pin className="mr-1 inline size-3 -translate-y-px fill-current" aria-hidden />
                    Pinned
                  </span>{" "}
                  ·{" "}
                </>
              ) : null}
              {origin(m, botName)} · {ago(m.updatedAt || m.createdAt, now)}
            </p>
          </>
        )}
      </div>
      {editing ? null : (
        <div className="flex shrink-0 gap-0.5">
          {/* A pinned memory keeps its filled pin in view; the other buttons show on hover on wide screens. */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onPin}
            aria-label={`Pin memory: ${m.text}`}
            aria-pressed={m.pinned}
            title={m.pinned ? "Pinned. Click to unpin" : `Pin: always on ${botName}'s mind`}
            className={m.pinned ? "text-primary" : hoverOnly}
          >
            <Pin className={m.pinned ? "fill-current" : undefined} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit memory: ${m.text}`} title="Edit" className={hoverOnly}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete memory: ${m.text}`} title="Delete" className={cn(hoverOnly, "hover:text-danger")}>
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}
