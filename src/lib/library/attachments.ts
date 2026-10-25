/**
 * Files attached to a chat message (the paperclip, or a file sent on a chat app). They go into the
 * Library first; the message keeps a light copy (meta.files) to show them, and the model reads a
 * line saying they're there, then uses read_file or search_files like for any Library file.
 */
import { defuse } from "@/lib/agent/frames";
import { pagesLabel } from "./limits";

export type AttachedFile = { id: string; name: string; kind: string; pages: number; status: string; note?: string | null };

export function filesOf(meta: unknown): AttachedFile[] {
  const files = (meta as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  return files
    .filter((f): f is AttachedFile => Boolean(f) && typeof (f as AttachedFile).id === "string" && typeof (f as AttachedFile).name === "string")
    .slice(0, 20)
    .map((f) => ({ id: f.id, name: f.name, kind: String(f.kind ?? "unknown"), pages: Number(f.pages) || 0, status: String(f.status ?? "ready"), note: f.note ?? null }));
}

/** The owner's message as the model reads it, with a line naming the files they attached. */
export function withFiles(text: string, meta: unknown): string {
  const files = filesOf(meta);
  if (!files.length) return text;
  const list = files
    .map((f) =>
      // A file's name is whatever the sender called it: look-alike frames in it are defused too.
      f.status === "failed"
        ? `${defuse(f.name)} (couldn't be read: ${defuse(f.note ?? "unknown reason")})`
        : `${defuse(f.name)} (${f.kind === "image" ? "a photo; its text was already read, and read_file gives it to you" : pagesLabel(f.kind, f.pages)})`,
    )
    .join("; ");
  const ready = files.some((f) => f.status !== "failed");
  const line = `[Attached to this message${ready ? ", and now in your files" : ""}: ${list}.${ready ? " Read them with read_file or search_files before answering about them." : ""}]`;
  return text.trim() ? `${text}\n\n${line}` : `(Sent ${files.length === 1 ? "a file" : "files"}, no message.)\n\n${line}`;
}
