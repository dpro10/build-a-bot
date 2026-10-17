/**
 * Files the owner sends their bot on a chat app (Telegram, Discord): fetched, put in the bot's
 * Library and read, then the message goes on with them attached, like the web chat's paperclip.
 * Files from anyone else aren't kept.
 */
import type { Db } from "@/lib/db";
import type { Bot, User } from "@/lib/db/schema";
import { available } from "@/lib/env";
import { addFileBytes, fileView, type FileSource } from "./index";
import type { AttachedFile } from "./attachments";
import { MAX_FILE_BYTES, formatBytes } from "./limits";

export type ChannelFile = { name: string; size?: number; fetch: () => Promise<Uint8Array | null> };

/** Fetch a URL's bytes, at most `max` (null when it's bigger or the fetch fails). */
export async function fetchCapped(url: string, max = MAX_FILE_BYTES, init?: RequestInit): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    if (!res.ok || !res.body) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > max) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

export async function takeChannelFile(db: Db, input: { bot: Bot; owner: User; file: ChannelFile; source: FileSource }): Promise<{ attached: AttachedFile } | { error: string }> {
  if (!available("library")) return { error: "I can't take files here yet." };
  if (input.file.size && input.file.size > MAX_FILE_BYTES) return { error: `${input.file.name} is ${formatBytes(input.file.size)}; files can be up to ${formatBytes(MAX_FILE_BYTES)}.` };
  const bytes = await input.file.fetch();
  if (!bytes) return { error: `I couldn't download ${input.file.name}. Files can be up to ${formatBytes(MAX_FILE_BYTES)}.` };
  const out = await addFileBytes(db, { bot: input.bot, owner: input.owner, name: input.file.name, bytes, source: input.source });
  if ("error" in out) return { error: out.error };
  const v = fileView(out.file);
  return { attached: { id: v.id, name: v.name, kind: v.kind, pages: v.pages, status: v.status, note: v.note } };
}
