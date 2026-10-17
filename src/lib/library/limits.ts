/**
 * The Library's limits and the kinds of files it reads. No server-only imports: the upload
 * button, the Library page and the chat use these too.
 */

/** One file, at most. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Everything one owner keeps, across their bots. */
export const MAX_OWNER_BYTES = 500 * 1024 * 1024;
/** Files one owner keeps, across their bots. */
export const MAX_OWNER_FILES = 1000;
/** Pages or slides read from one file. */
export const MAX_PAGES = 600;
/** Scanned pages (or photos) one file sends to the vision model. */
export const MAX_VISION_PAGES = 40;
/** Text kept from one file (about 300,000 words). */
export const MAX_FILE_CHARS = 2_000_000;
/** A passage is about a page: what search returns and what's quoted back. */
export const PASSAGE_CHARS = 1800;
/** Files attached to one chat message. */
export const MAX_ATTACHMENTS = 10;

/** What the file picker offers (photos from a phone camera arrive as JPEG). */
export const ACCEPT = [
  ".pdf",
  ".docx",
  ".pptx",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  "application/pdf",
  "image/*",
  "text/*",
].join(",");

export type FileKind = "pdf" | "docx" | "pptx" | "text" | "image";

export const KIND_LABEL: Record<FileKind | "unknown", string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "Slides",
  text: "Text",
  image: "Photo",
  unknown: "File",
};

/** "12.4 MB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "6 pages", "24 slides", "1 photo" */
export function pagesLabel(kind: string, pages: number): string {
  if (kind === "image") return pages > 1 ? `${pages} photos` : "Photo";
  if (kind === "pptx") return `${pages} slide${pages === 1 ? "" : "s"}`;
  if (kind === "text") return pages > 1 ? `${pages} parts` : "Text";
  return `${pages} page${pages === 1 ? "" : "s"}`;
}

/** A name that's safe in a storage path and a download header, keeping it readable. */
export function safeFileName(name: string): string {
  const base = String(name ?? "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return base || "file";
}
