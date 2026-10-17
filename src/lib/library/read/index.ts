/**
 * Reading a file: its bytes → its text, page by page (or slide by slide), with where each part
 * came from. PDFs keep their pages; pages with no text (scans) and photos go to the vision model,
 * a few at a time, while the owner has credit.
 */
import { MAX_PAGES, MAX_VISION_PAGES, type FileKind } from "../limits";
import { OfficeError, readDocx, readPptx } from "./office";
import { encodePng } from "./png";
import { decodeText } from "./sniff";
import type { ReadPage, ReadResult } from "./types";
import { readImage } from "./vision";

export type { ReadPage, ReadResult } from "./types";

export class ReadError extends Error {}

export type ReadOptions = {
  /** May the vision model be paid for (the owner has credit)? */
  canPayForVision: boolean;
  signal?: AbortSignal;
  /** Tests: stands in for the vision model. */
  vision?: typeof readImage;
};

/** Run `fn` over `items`, `limit` at a time, in order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** HTML → its readable text (scripts and styles dropped, blocks on their own lines). */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readPdf(bytes: Uint8Array, opts: ReadOptions): Promise<ReadResult> {
  const { getDocumentProxy, extractText, extractImages } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), { stopAtErrors: false });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (/password/i.test(msg)) throw new ReadError("This PDF is password-protected. Save a copy without the password and send that.");
    throw new ReadError("This PDF looks damaged, so it couldn't be opened.");
  }
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const count = Math.min(totalPages, MAX_PAGES);
    const pages: ReadPage[] = [];
    for (let i = 0; i < count; i++) {
      const t = (text[i] ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      pages.push({ page: i + 1, label: `Page ${i + 1}`, text: t, empty: t.replace(/\s/g, "").length < 20 });
    }
    // Pages with (almost) no text are scans or photos of pages: the vision model reads their image.
    const scans = pages.filter((p) => p.empty);
    let costMicros = 0;
    let note: string | undefined;
    if (scans.length) {
      if (!opts.canPayForVision) note = `${scans.length} scanned page${scans.length === 1 ? "" : "s"} couldn't be read: reading scans needs credit.`;
      const toRead = opts.canPayForVision ? scans.slice(0, MAX_VISION_PAGES) : [];
      if (scans.length > toRead.length && opts.canPayForVision) note = `Read the first ${toRead.length} scanned pages; ${scans.length - toRead.length} more weren't (a file can have up to ${MAX_VISION_PAGES} read).`;
      const vision = opts.vision ?? readImage;
      const failures: number[] = [];
      await pool(toRead, 4, async (p) => {
        if (opts.signal?.aborted) return;
        let images: Awaited<ReturnType<typeof extractImages>> = [];
        try {
          images = await extractImages(pdf, p.page);
        } catch {
          images = [];
        }
        // The page's scan is its biggest image.
        const scan = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (!scan || scan.width * scan.height < 200 * 200) return;
        const png = encodePng(scan);
        const r = await vision(png, "image/png", { what: `page ${p.page} of a scanned document`, signal: opts.signal });
        if ("error" in r) {
          failures.push(p.page);
          return;
        }
        costMicros += r.costMicros;
        p.text = r.text;
        p.empty = !r.text.trim();
      });
      if (failures.length && !note) note = `${failures.length} scanned page${failures.length === 1 ? "" : "s"} couldn't be read right now. Try reading the file again later.`;
    }
    const more = totalPages > count ? `Only the first ${count} of ${totalPages} pages were read.` : undefined;
    return { pages, pageCount: totalPages, costMicros, note: [note, more].filter(Boolean).join(" ") || undefined };
  } finally {
    // Frees PDF.js's worker memory (named cleanup or destroy depending on the build).
    const doc = pdf as unknown as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> };
    await (doc.destroy ?? doc.cleanup)?.call(doc).catch(() => {});
  }
}

/** Text, Markdown, CSV, JSON or HTML: one "page", split into parts later. */
function readTextFile(bytes: Uint8Array, mime: string): ReadResult {
  const raw = decodeText(bytes);
  if (raw === null) throw new ReadError("This file isn't text I can read.");
  const text = mime === "text/html" ? htmlText(raw) : raw.replace(/\r\n?/g, "\n").trim();
  return { pages: [{ page: 0, label: "Text", text }], pageCount: 1, costMicros: 0 };
}

async function readPhoto(bytes: Uint8Array, mime: string, opts: ReadOptions): Promise<ReadResult> {
  if (!opts.canPayForVision) throw new ReadError("Reading photos needs credit. Add some on Credit & usage, then try again.");
  const r = await (opts.vision ?? readImage)(bytes, mime, { what: "this photo", signal: opts.signal });
  if ("error" in r) throw new ReadError(`${r.error} Try again in a moment.`);
  return { pages: [{ page: 1, label: "Photo", text: r.text || "(No text in this photo.)", empty: !r.text }], pageCount: 1, costMicros: r.costMicros };
}

export async function readFileBytes(bytes: Uint8Array, kind: FileKind, mime: string, opts: ReadOptions): Promise<ReadResult> {
  try {
    if (kind === "pdf") return await readPdf(bytes, opts);
    if (kind === "docx") {
      const pages = readDocx(bytes);
      return { pages, pageCount: pages.length, costMicros: 0 };
    }
    if (kind === "pptx") {
      const pages = readPptx(bytes).slice(0, MAX_PAGES);
      return { pages, pageCount: pages.length, costMicros: 0 };
    }
    if (kind === "image") return await readPhoto(bytes, mime, opts);
    return readTextFile(bytes, mime);
  } catch (err) {
    if (err instanceof ReadError) throw err;
    if (err instanceof OfficeError) throw new ReadError(err.message);
    throw new ReadError("Something went wrong reading this file.");
  }
}
