"use client";
import * as React from "react";
import { NotebookPen, Plus, SearchX, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { ago } from "@/components/bot/activity/time";
import { usePendingDelete } from "./use-pending-delete";
import { matches, type NoteItem } from "./types";

const NEW = "__new__";

export function NotesPanel({
  botId,
  botName,
  items,
  setItems,
  query,
  now,
}: {
  botId: string;
  botName: string;
  items: NoteItem[];
  setItems: React.Dispatch<React.SetStateAction<NoteItem[]>>;
  query: string;
  now: Date;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const scheduleDelete = usePendingDelete();
  const shown = items.filter((n) => matches(query, n.title, n.body));

  const create = async (title: string, body: string) => {
    const res = await api<{ note: NoteItem }>(`/api/bots/${botId}/notes`, { method: "POST", body: { title, body } });
    setItems((cur) => [res.note, ...cur]);
    setOpen((cur) => (cur === NEW ? null : cur));
    toast.success("Note saved");
  };

  const update = async (n: NoteItem, title: string, body: string) => {
    const res = await api<{ note: NoteItem }>(`/api/bots/${botId}/notes/${n.id}`, { method: "PATCH", body: { title, body } });
    setItems((cur) => [res.note, ...cur.filter((x) => x.id !== n.id)]);
    setOpen((cur) => (cur === n.id ? null : cur));
    toast.success("Note saved");
  };

  const remove = (n: NoteItem) => {
    const index = items.findIndex((x) => x.id === n.id);
    setOpen(null);
    setItems((cur) => cur.filter((x) => x.id !== n.id));
    scheduleDelete(`note:${n.id}`, `/api/bots/${botId}/notes/${n.id}`, {
      message: `Deleted “${n.title}”`,
      onUndo: () =>
        setItems((cur) => {
          if (cur.some((x) => x.id === n.id)) return cur;
          const next = [...cur];
          next.splice(Math.min(index, next.length), 0, n);
          return next;
        }),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Lists and notes {botName} keeps for you, like a shared notebook.</p>
        {open !== NEW ? (
          <Button variant="soft" size="sm" onClick={() => setOpen(NEW)}>
            <Plus /> New note
          </Button>
        ) : null}
      </div>

      {open === NEW ? <NoteEditor onCancel={() => setOpen(null)} onSave={create} autoFocus /> : null}

      {!items.length && open !== NEW ? (
        <EmptyState
          icon={<NotebookPen className="size-8" />}
          title="No notes yet"
          action={
            <Button variant="soft" onClick={() => setOpen(NEW)}>
              <Plus /> Write the first one
            </Button>
          }
          className="bg-card/50"
        >
          {botName} keeps lists and notes here. Try asking it to “add milk to my grocery list.”
        </EmptyState>
      ) : items.length && !shown.length ? (
        <EmptyState icon={<SearchX className="size-8" />} title="No matches" className="bg-card/50">
          No note mentions “{query}”.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((n) =>
            open === n.id ? (
              <li key={n.id} className="sm:col-span-2">
                <NoteEditor note={n} onCancel={() => setOpen(null)} onSave={(t, b) => update(n, t, b)} onDelete={() => remove(n)} autoFocus />
              </li>
            ) : (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setOpen(n.id)}
                  className="flex h-full w-full flex-col gap-2 rounded-3xl border border-border bg-card p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lift sm:p-5"
                >
                  <span className="flex items-start gap-2">
                    <NotebookPen className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{n.title}</span>
                  </span>
                  {n.body ? (
                    <span className="line-clamp-5 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{n.body}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">Empty note</span>
                  )}
                  <span className="mt-auto pt-1 text-xs text-muted-foreground">Edited {ago(n.updatedAt, now)}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function NoteEditor({
  note,
  onSave,
  onCancel,
  onDelete,
  autoFocus,
}: {
  note?: NoteItem;
  onSave: (title: string, body: string) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  autoFocus?: boolean;
}) {
  const [title, setTitle] = React.useState(note?.title ?? "");
  const [body, setBody] = React.useState(note?.body ?? "");
  const [saving, setSaving] = React.useState(false);
  const id = note?.id ?? "new";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Give the note a title.");
    setSaving(true);
    try {
      await onSave(title.trim(), body);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't save the note.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className={cn("flex flex-col gap-3 rounded-3xl border border-primary/30 bg-card p-4 shadow-lift ring-4 ring-primary/10 sm:p-5")}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`note-title-${id}`}>Title</Label>
        <Input id={`note-title-${id}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Groceries" autoFocus={autoFocus} className="h-11" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`note-body-${id}`}>Note</Label>
        <Textarea id={`note-body-${id}`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} rows={8} placeholder={"- Milk\n- Eggs\n- Coffee beans"} className="text-sm leading-relaxed" />
        <FieldHint className="text-right tabular-nums">{body.length}/8000</FieldHint>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={saving}>
          Save note
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {onDelete ? (
          <Button type="button" variant="danger-soft" onClick={onDelete} className="ml-auto">
            <Trash2 /> Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}
