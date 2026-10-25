"use client";
/**
 * Adding a file to a bot's Library from the browser:
 *
 *   hash it (the same bytes already there: done, nothing uploaded) → ask the server where it goes →
 *   upload it (straight to private storage, with progress) → ask the server to read it → wait
 *   until it's read (a scanned PDF can take a minute)
 *
 * Shared by the chat's paperclip and the Library page.
 */
import type { FileView } from "@/lib/library";
import { MAX_FILE_BYTES, formatBytes } from "@/lib/library/limits";

export type UploadPhase = "hashing" | "uploading" | "reading" | "ready" | "failed";
export type UploadUpdate = { phase: UploadPhase; progress?: number; file?: FileView; error?: string; duplicate?: boolean };

class UploadError extends Error {}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw Object.assign(new UploadError(data.error ?? "Something went wrong. Try again."), { status: res.status, code: data.code });
  return data;
}

async function sha256(file: File): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined; // no Web Crypto (an old browser, an insecure page): upload anyway
  }
}

/** A PUT with progress (fetch can't report upload progress). */
function putWithProgress(url: string, file: File, onProgress: (p: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError(xhr.status === 413 ? `Files can be up to ${formatBytes(MAX_FILE_BYTES)}.` : "The upload didn't go through. Try again.")));
    xhr.onerror = () => reject(new UploadError("The upload didn't go through. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the server has read the file (or given up on it). */
export async function waitUntilRead(botId: string, fileId: string, onUpdate: (u: UploadUpdate) => void, signal?: AbortSignal): Promise<FileView> {
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await sleep(i < 10 ? 700 : 2000);
    const { file } = await api<{ file: FileView }>(`/api/bots/${botId}/files/${fileId}`);
    if (file.status === "ready" || file.status === "failed") return file;
    onUpdate({ phase: "reading", file });
    if (Date.now() - t0 > 8 * 60_000) throw new UploadError("Reading this file is taking too long. It'll show up in Memory › Files when it's done.");
  }
}

export async function uploadToLibrary(botId: string, file: File, onUpdate: (u: UploadUpdate) => void, signal?: AbortSignal): Promise<FileView> {
  try {
    if (file.size > MAX_FILE_BYTES) throw new UploadError(`${file.name} is ${formatBytes(file.size)}. Files can be up to ${formatBytes(MAX_FILE_BYTES)}.`);
    if (file.size === 0) throw new UploadError(`${file.name} is empty.`);
    onUpdate({ phase: "hashing" });
    const hash = await sha256(file);
    const started = await api<{ file: FileView; duplicate?: boolean; upload?: { mode: "blob"; pathname: string; token: string } | { mode: "local"; url: string } }>(`/api/bots/${botId}/files`, {
      method: "POST",
      body: JSON.stringify({ name: file.name, size: file.size, sha256: hash }),
      signal,
    });
    if (started.duplicate) {
      onUpdate({ phase: "ready", file: started.file, duplicate: true, progress: 1 });
      return started.file;
    }
    const up = started.upload!;
    onUpdate({ phase: "uploading", progress: 0, file: started.file });
    if (up.mode === "blob") {
      const { put } = await import("@vercel/blob/client");
      await put(up.pathname, file, {
        access: "private",
        token: up.token,
        contentType: file.type || "application/octet-stream",
        multipart: file.size > 8 * 1024 * 1024,
        abortSignal: signal,
        onUploadProgress: ({ percentage }) => onUpdate({ phase: "uploading", progress: percentage / 100, file: started.file }),
      });
    } else {
      await putWithProgress(up.url, file, (p) => onUpdate({ phase: "uploading", progress: p, file: started.file }), signal);
    }
    onUpdate({ phase: "reading", file: started.file });
    await api(`/api/bots/${botId}/files/${started.file.id}/read`, { method: "POST", signal });
    const done = await waitUntilRead(botId, started.file.id, onUpdate, signal);
    onUpdate(done.status === "ready" ? { phase: "ready", file: done, progress: 1 } : { phase: "failed", file: done, error: done.note ?? "Couldn't read it." });
    return done;
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    const message = err instanceof UploadError ? err.message : "The upload didn't go through. Try again.";
    onUpdate({ phase: "failed", error: message });
    throw new UploadError(message);
  }
}
