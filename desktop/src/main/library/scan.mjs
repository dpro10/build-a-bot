/**
 * The files in the folder the owner gave their bot that the Library can read: PDFs, Word,
 * PowerPoint, text and photos, up to 25 MB each. Hidden files, app folders (node_modules, .git),
 * Office's "~$" lock files and links are skipped, and nothing outside the folder is ever opened.
 */
import fs from "node:fs";
import path from "node:path";

export const EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".html", ".htm", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Files synced from one folder, at most. */
export const MAX_FILES = 300;
const MAX_DEPTH = 8;
const SKIP_DIRS = new Set(["node_modules", "__pycache__", "venv", ".venv", "dist", "build", "target", "$recycle.bin", "system volume information"]);

/** @typedef {{ rel: string, abs: string, size: number, mtimeMs: number }} FolderFile */

/**
 * @param {string} root
 * @returns {Promise<{ files: FolderFile[], skipped: { tooBig: number, tooMany: number } }>}
 */
export async function scanFolder(root) {
  /** @type {FolderFile[]} */
  const files = [];
  const skipped = { tooBig: 0, tooMany: 0 };
  /** @param {string} dir @param {number} depth */
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable (permissions): skip it
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name.startsWith("~$") || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(abs, depth + 1);
        continue;
      }
      if (!e.isFile() || !EXTENSIONS.has(path.extname(e.name).toLowerCase())) continue;
      let st;
      try {
        st = await fs.promises.lstat(abs);
      } catch {
        continue;
      }
      if (st.size === 0) continue;
      if (st.size > MAX_FILE_BYTES) {
        skipped.tooBig += 1;
        continue;
      }
      if (files.length >= MAX_FILES) {
        skipped.tooMany += 1;
        continue;
      }
      files.push({ rel: path.relative(root, abs).split(path.sep).join("/"), abs, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
    }
  }
  await walk(root, 0);
  return { files, skipped };
}
