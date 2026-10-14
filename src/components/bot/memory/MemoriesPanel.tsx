"use client";
import * as React from "react";
import { Brain, Check, Pencil, Plus, SearchX, Trash2, UserRound, X } from "lucide-react";
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
import { matches, type MemoryItem } from "./types";

export function MemoriesPanel({
  botId,
  botName,
  avatar,
  color,
  items,
  setItems,
  query,
  now,
}: {
  botId: string;
  botName: string;
  avatar: AvatarId;
  color: ColorwayId;
  items: MemoryItem[];
  setItems: React.Dispatch<React.SetStateAction<MemoryItem[]>>;
  query: string;
  now: Date;
}) {
  const [draft, setDraft] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const scheduleDelete = usePendingDelete();
  const shown = items.filter((m) => matches(query, m.text));

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
      const res = await api<{ memory: MemoryItem }>(`/api/bots/${botId}/memories`, { method: "POST", body: { text } });
      setItems((cur) => [normalize(res.memory), ...cur]);
      setDraft("");
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
            />
          ))}
        </ul>
      )}
      {items.length ? (
        <p className="text-center text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? "memory" : "memories"} · {botName} can keep up to 200
        </p>
      ) : null}
    </div>
  );
}

function normalize(m: MemoryItem): MemoryItem {
  return { id: m.id, text: m.text, source: m.source, createdAt: String(m.createdAt), updatedAt: String(m.updatedAt) };
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
              {byBot ? `${botName} learned this` : "You added this"} · {ago(m.updatedAt || m.createdAt, now)}
            </p>
          </>
        )}
      </div>
      {editing ? null : (
        <div className="flex shrink-0 gap-0.5 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit memory: ${m.text}`} title="Edit">
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete memory: ${m.text}`} title="Delete" className="hover:text-danger">
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}
