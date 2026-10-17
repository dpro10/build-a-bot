/**
 * Where the Library's files are kept. With BLOB_READ_WRITE_TOKEN: a private Vercel Blob store.
 * Browsers upload straight to it with a short-lived token for one exact path (Vercel functions take
 * at most 4.5 MB), and nothing in it is ever public: files are read back by the server, which
 * checks who's asking. Without it (running it yourself, tests): files under DATA_DIR/library, or
 * in memory when DATA_DIR=memory.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/env";
import { MAX_FILE_BYTES, safeFileName } from "./limits";

export type StorageMode = "blob" | "local";

export function storageMode(): StorageMode {
  return config.library.blobToken ? "blob" : "local";
}

/** library/<owner>/<bot>/<file>/<name>: one file per path, never reused. */
export function storageKey(ownerId: string, botId: string, fileId: string, name: string): string {
  const safe = safeFileName(name).replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s/g, "_");
  return `library/${ownerId}/${botId}/${fileId}/${safe}`;
}

const memory = new Map<string, Uint8Array>();

function localPath(key: string): string | null {
  const dir = process.env.DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
  if (dir === "memory") return null;
  const root = path.resolve(/* turbopackIgnore: true */ dir, "library");
  const file = path.resolve(root, key.replace(/^library\//, ""));
  if (!file.startsWith(root + path.sep)) throw new Error("Bad storage key");
  return file;
}

/** Store bytes the server has (a file sent on Telegram, a local upload). */
export async function putBytes(key: string, bytes: Uint8Array, mime: string): Promise<void> {
  if (storageMode() === "blob") {
    const { put } = await import("@vercel/blob");
    await put(key, Buffer.from(bytes), { access: "private", contentType: mime, addRandomSuffix: false, allowOverwrite: true, token: config.library.blobToken });
    return;
  }
  const file = localPath(key);
  if (!file) {
    memory.set(key, bytes);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { mode: 0o600 });
}

/** A file's bytes, or null when they aren't there (yet). */
export async function readBytes(key: string): Promise<Uint8Array | null> {
  if (storageMode() === "blob") {
    const { get } = await import("@vercel/blob");
    try {
      const res = await get(key, { access: "private", token: config.library.blobToken, useCache: false });
      if (!res?.stream) return null;
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = res.stream.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        // A file bigger than any upload allows didn't come through us: don't hold it in memory.
        if (size > MAX_FILE_BYTES + 1024 * 1024) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (/not.?found|404/i.test(String((err as Error)?.message ?? err))) return null;
      throw err;
    }
  }
  const file = localPath(key);
  if (!file) return memory.get(key) ?? null;
  try {
    return new Uint8Array(fs.readFileSync(file));
  } catch {
    return null;
  }
}

export async function removeBytes(key: string): Promise<void> {
  if (storageMode() === "blob") {
    const { del } = await import("@vercel/blob");
    await del(key, { token: config.library.blobToken }).catch(() => {});
    return;
  }
  const file = localPath(key);
  if (!file) {
    memory.delete(key);
    return;
  }
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

/**
 * A token that lets a browser upload one file to one path, privately, up to `maxBytes`, within the
 * next 15 minutes. Blob storage only (local mode uploads through the server).
 */
export async function uploadToken(key: string, maxBytes: number): Promise<string> {
  const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
  return generateClientTokenFromReadWriteToken({
    token: config.library.blobToken,
    pathname: key,
    maximumSizeInBytes: maxBytes,
    validUntil: Date.now() + 15 * 60_000,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
}
