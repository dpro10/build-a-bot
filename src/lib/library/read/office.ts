/**
 * Word (.docx) and PowerPoint (.pptx) files are zipped XML. Only the parts with words in them are
 * unpacked, each with a size cap, so a booby-trapped file can't blow up memory.
 *
 * Word: paragraphs, with headings as "#" and list items as "-", tables as "a | b" rows, split into
 * pages where Word recorded its page breaks. PowerPoint: each slide in the deck's order, its title
 * first, then its text, then its speaker notes.
 */
import { unzipSync } from "fflate";
import type { ReadPage } from "./types";

/** One XML part, unpacked: at most 40 MB. */
const MAX_PART_BYTES = 40 * 1024 * 1024;
/** Everything unpacked from one file: at most 200 MB. */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export class OfficeError extends Error {}

/** The zip's entries that `want` picks, inflated, with caps. */
function unpack(bytes: Uint8Array, want: (name: string) => boolean): Record<string, string> {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (!want(f.name)) return false;
        if (f.originalSize > MAX_PART_BYTES) throw new OfficeError("A part of this file is too big to read.");
        total += f.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new OfficeError("This file unpacks to too much to read.");
        return true;
      },
    });
  } catch (err) {
    if (err instanceof OfficeError) throw err;
    throw new OfficeError("The file looks damaged, so it couldn't be opened.");
  }
  const out: Record<string, string> = {};
  const decoder = new TextDecoder("utf-8");
  for (const [name, data] of Object.entries(files)) out[name] = decoder.decode(data);
  return out;
}

/** XML text → plain text (&amp; and friends, numeric references). */
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, code: string) => {
    const c = code.toLowerCase();
    if (c === "amp") return "&";
    if (c === "lt") return "<";
    if (c === "gt") return ">";
    if (c === "quot") return '"';
    if (c === "apos") return "'";
    const n = c.startsWith("#x") ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
  });
}

const tidy = (s: string) =>
  s
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// ---------------------------------------------------------------------------
// Word

/** A Word document's text, by page when Word recorded page breaks, else as one page. */
export function readDocx(bytes: Uint8Array): ReadPage[] {
  const parts = unpack(bytes, (n) => n === "word/document.xml" || n === "word/footnotes.xml");
  const xml = parts["word/document.xml"];
  if (!xml) throw new OfficeError("The document's text is missing.");
  const pages: string[][] = [[]];
  let para = "";
  let style = "";
  let list = false;
  let cells: string[] | null = null;
  let cell = "";
  const tokens = /<w:(p|tc|tr)\b[^>]*?(\/?)>|<\/w:(p|tc|tr)>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(tab|br|cr|lastRenderedPageBreak)\b([^>]*)\/>|<w:pStyle\b[^>]*w:val="([^"]+)"|<w:numPr\b/g;
  const flushPara = () => {
    const text = para.trim();
    if (cells) {
      cell += (cell ? " " : "") + text;
    } else if (text) {
      const heading = /^(heading(\d)|title)$/i.exec(style);
      const level = heading ? (heading[2] ? Math.min(Number(heading[2]), 4) : 1) : 0;
      pages[pages.length - 1].push(level ? `${"#".repeat(level)} ${text}` : list ? `- ${text}` : text);
    }
    para = "";
    style = "";
    list = false;
  };
  for (const m of xml.matchAll(tokens)) {
    const [, open, selfClose, close, t, inline, inlineAttrs, pStyle] = m;
    if (open === "p") {
      if (selfClose) flushPara();
      continue;
    }
    if (close === "p") flushPara();
    else if (open === "tr") cells = [];
    else if (open === "tc") cell = "";
    else if (close === "tc") cells?.push(cell.trim());
    else if (close === "tr") {
      if (cells?.some(Boolean)) pages[pages.length - 1].push(cells.join(" | "));
      cells = null;
    } else if (t !== undefined) para += unescapeXml(t);
    else if (inline === "tab") para += "\t";
    else if (inline === "br" || inline === "cr") {
      if (/w:type="page"/.test(inlineAttrs ?? "")) {
        flushPara();
        pages.push([]);
      } else para += "\n";
    } else if (inline === "lastRenderedPageBreak") {
      // Where Word last laid out a new page: the next words start it (a paragraph split across
      // pages keeps its style on both).
      if (!cells && (para.trim() || pages[pages.length - 1].length)) {
        const keep: { style: string; list: boolean } = { style, list };
        if (para.trim()) flushPara();
        pages.push([]);
        ({ style, list } = keep);
      }
    } else if (pStyle) style = pStyle;
    else if (m[0].startsWith("<w:numPr")) list = true;
  }
  flushPara();
  const footnotes = parts["word/footnotes.xml"];
  if (footnotes) {
    const notes = [...footnotes.matchAll(/<w:footnote\b[^>]*w:id="(\d+)"[^>]*>([\s\S]*?)<\/w:footnote>/g)]
      .filter(([, id]) => Number(id) > 0)
      .map(([, id, body]) => `[${id}] ${tidy([...body.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((x) => unescapeXml(x[1])).join(""))}`)
      .filter((n) => n.length > 4);
    if (notes.length) pages[pages.length - 1].push(`Footnotes:\n${notes.join("\n")}`);
  }
  const out = pages.map((lines) => tidy(lines.join("\n"))).filter(Boolean);
  // One page means Word didn't record page breaks: say "Part" rather than claim a page number.
  if (out.length <= 1) return out.map((text) => ({ page: 0, label: "Document", text }));
  return out.map((text, i) => ({ page: i + 1, label: `Page ${i + 1}`, text }));
}

// ---------------------------------------------------------------------------
// PowerPoint

/** The text of a slide's (or notes page's) shapes, a line per paragraph, titles first. */
function shapesText(xml: string, opts: { notes?: boolean } = {}): { title: string; body: string[] } {
  let title = "";
  const body: string[] = [];
  for (const [shape] of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    const ph = /<p:ph\b[^>]*>/.exec(shape)?.[0];
    const type = ph ? (/\btype="([^"]+)"/.exec(ph)?.[1] ?? "body") : "";
    // Slide numbers, dates and footers aren't content; on a notes page the slide picture isn't either.
    if (/^(sldNum|dt|ftr|hdr)$/.test(type) || (opts.notes && type === "sldImg")) continue;
    const lines: string[] = [];
    for (const [, p] of shape.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
      const text = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g)].map((x) => (x[1] === undefined ? "\n" : unescapeXml(x[1]))).join("");
      const level = /<a:pPr\b[^>]*lvl="(\d)"/.exec(p)?.[1];
      if (text.trim()) lines.push((level && Number(level) > 0 ? "  ".repeat(Number(level)) : "") + text.trim());
    }
    if (!lines.length) continue;
    if (!opts.notes && !title && /^(title|ctrTitle)$/.test(type)) title = lines.join(" ");
    else body.push(...lines);
  }
  // Tables on a slide: rows of cells.
  for (const [, row] of xml.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)) {
    const cells = [...row.matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map(([, c]) => [...c.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => unescapeXml(x[1])).join(" ").trim());
    if (cells.some(Boolean)) body.push(cells.join(" | "));
  }
  return { title, body };
}

/** Relationship id → target, from a .rels part. */
function rels(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const [, attrs] of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (id && target) map.set(id, target);
  }
  return map;
}

/** "../notesSlides/notesSlide3.xml" from "ppt/slides" → "ppt/notesSlides/notesSlide3.xml" */
function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/");
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** A deck's slides in order: title, text and speaker notes for each. */
export function readPptx(bytes: Uint8Array): ReadPage[] {
  const parts = unpack(
    bytes,
    (n) =>
      n === "ppt/presentation.xml" ||
      n === "ppt/_rels/presentation.xml.rels" ||
      /^ppt\/slides\/slide\d+\.xml$/.test(n) ||
      /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(n) ||
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n),
  );
  // The deck's order: presentation.xml lists the slides by relationship id.
  const presRels = rels(parts["ppt/_rels/presentation.xml.rels"]);
  let order = [...(parts["ppt/presentation.xml"] ?? "").matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)]
    .map(([, rid]) => presRels.get(rid))
    .filter((t): t is string => Boolean(t))
    .map((t) => resolvePart("ppt", t));
  if (!order.length) {
    order = Object.keys(parts)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  }
  const pages: ReadPage[] = [];
  order.forEach((slidePath, i) => {
    const xml = parts[slidePath];
    if (!xml) return;
    const { title, body } = shapesText(xml);
    const file = slidePath.split("/").pop()!;
    const notesTarget = [...rels(parts[`ppt/slides/_rels/${file}.rels`]).values()].find((t) => /notesSlide\d+\.xml$/.test(t));
    const notesXml = notesTarget ? parts[resolvePart("ppt/slides", notesTarget)] : undefined;
    const notes = notesXml ? shapesText(notesXml, { notes: true }).body.filter((l) => !/^\d+$/.test(l.trim())) : [];
    const text = tidy(
      [title ? `# ${title}` : "", body.map((l) => (l.startsWith(" ") ? `${l.replace(/^( +)/, "$1- ")}` : `- ${l}`)).join("\n"), notes.length ? `Speaker notes:\n${notes.join("\n")}` : ""]
        .filter(Boolean)
        .join("\n"),
    );
    pages.push({ page: i + 1, label: `Slide ${i + 1}`, text: text || "(No text on this slide.)", empty: !text });
  });
  if (!pages.length) throw new OfficeError("No slides found in this file.");
  return pages;
}
