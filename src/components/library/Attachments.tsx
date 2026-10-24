"use client";
/**
 * Files attached in the chat: the paperclip, dropping files on the chat, or pasting a screenshot.
 * Each goes into the bot's Library right away (uploaded, then read), shown as a chip above the
 * message box with how far it's got. The message can be sent once they're all read.
 */
import * as React from "react";
import { AlertCircle, Check, LoaderCircle, X } from "lucide-react";
import type { FileView } from "@/lib/library";
import type { AttachedFile } from "@/lib/library/attachments";
import { MAX_ATTACHMENTS, pagesLabel } from "@/lib/library/limits";
import { cn } from "@/lib/utils";
import { FileIcon, kindFromName } from "./FileIcon";
import { uploadToLibrary, type UploadPhase } from "./upload";

export type Attachment = {
  key: string;
  name: string;
  phase: UploadPhase;
  progress: number;
  file?: FileView;
  error?: string;
  duplicate?: boolean;
  abort: AbortController;
};

export function useAttachments(botId: string, enabled: boolean) {
  const [items, setItems] = React.useState<Attachment[]>([]);
  const patch = React.useCallback((key: string, p: Partial<Attachment>) => setItems((list) => list.map((a) => (a.key === key ? { ...a, ...p } : a))), []);

  const itemsRef = React.useRef<Attachment[]>([]);
  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const add = React.useCallback(
    (files: File[]) => {
      if (!enabled || !files.length) return;
      const room = Math.max(0, MAX_ATTACHMENTS - itemsRef.current.length);
      const fresh = files.slice(0, room).map((f, n) => {
        // A pasted screenshot has no name.
        const name = f.name || `Pasted image ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.png`;
        return { key: `${Date.now()}-${n}-${name}`, name, file: f.name ? f : new File([f], name, { type: f.type }), abort: new AbortController() };
      });
      itemsRef.current = [...itemsRef.current, ...fresh.map((f) => ({ key: f.key, name: f.name, phase: "hashing" as UploadPhase, progress: 0, abort: f.abort }))];
      setItems(itemsRef.current);
      for (const f of fresh) {
        uploadToLibrary(
          botId,
          f.file,
          (u) => patch(f.key, { phase: u.phase, progress: u.progress ?? 0, ...(u.file ? { file: u.file } : {}), ...(u.error ? { error: u.error } : {}), ...(u.duplicate ? { duplicate: true } : {}) }),
          f.abort.signal,
        ).catch(() => {});
      }
    },
    [botId, enabled, patch],
  );

  const remove = React.useCallback((key: string) => {
    setItems((list) => {
      list.find((a) => a.key === key)?.abort.abort();
      return list.filter((a) => a.key !== key);
    });
  }, []);

  const clear = React.useCallback(() => setItems([]), []);
  const busy = items.some((a) => a.phase !== "ready" && a.phase !== "failed");
  const ready = items.filter((a) => a.phase === "ready" && a.file);
  return { items, add, remove, clear, busy, ready };
}

/** The chips above the message box. */
export function AttachmentChips({ items, onRemove }: { items: Attachment[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="no-scrollbar mb-2 flex gap-2 overflow-x-auto px-0.5 pb-0.5" aria-label="Attached files">
      {items.map((a) => {
        const kind = a.file?.status === "ready" ? a.file.kind : kindFromName(a.name);
        const status =
          a.phase === "failed"
            ? a.error ?? "Couldn't read it"
            : a.phase === "ready"
              ? a.duplicate
                ? "Already added"
                : a.file
                  ? pagesLabel(a.file.kind, a.file.pages)
                  : "Ready"
              : a.phase === "uploading"
                ? `Uploading ${Math.round(a.progress * 100)}%`
                : a.phase === "reading"
                  ? "Reading…"
                  : "Getting ready…";
        return (
          <li
            key={a.key}
            className={cn(
              "relative flex w-56 shrink-0 items-center gap-2.5 overflow-hidden rounded-2xl border bg-card py-2 pr-8 pl-2 shadow-soft animate-pop",
              a.phase === "failed" ? "border-danger/40" : "border-border",
            )}
            title={a.phase === "failed" ? a.error : a.name}
          >
            <FileIcon kind={kind} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{a.name}</div>
              <div className={cn("flex items-center gap-1 truncate text-xs", a.phase === "failed" ? "text-danger" : "text-muted-foreground")} role="status">
                {a.phase === "ready" ? <Check className="size-3 shrink-0 text-success" aria-hidden /> : a.phase === "failed" ? <AlertCircle className="size-3 shrink-0" aria-hidden /> : <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden />}
                <span className={cn("truncate", a.phase === "reading" && "shimmer-text")}>{status}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(a.key)}
              className="absolute top-1.5 right-1.5 rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label={`Remove ${a.name}`}
            >
              <X className="size-3.5" />
            </button>
            {a.phase === "uploading" ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/15" aria-hidden>
                <span className="block h-full bg-primary transition-[width] duration-200" style={{ width: `${a.progress * 100}%` }} />
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Files on a sent message (in the owner's bubble): open the original in a new tab. */
export function MessageFiles({ botId, files }: { botId: string; files: AttachedFile[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 first:mt-0">
      {files.map((f) => (
        <a
          key={f.id}
          href={`/api/bots/${botId}/files/${f.id}/content`}
          target="_blank"
          rel="noreferrer"
          className="flex max-w-[16rem] items-center gap-2 rounded-xl bg-white/15 py-1.5 pr-3 pl-1.5 text-left text-[13px] transition hover:bg-white/25"
          title={f.status === "failed" ? `Couldn't read it: ${f.note ?? ""}` : `Open ${f.name}`}
        >
          <FileIcon kind={f.kind} size="sm" className="bg-white/90 dark:bg-white/90" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{f.name}</span>
            <span className="block truncate text-[11px] opacity-80">{f.status === "failed" ? "Couldn't read it" : pagesLabel(f.kind, f.pages)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
