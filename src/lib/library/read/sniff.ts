/**
 * What a file really is, from its bytes (never just its name): PDF, Word, PowerPoint, a photo, or
 * text. Zips are looked into without unpacking them, so a zip bomb costs nothing here.
 */
import { unzipSync } from "fflate";
import type { FileKind } from "../limits";

export type Sniffed = { kind: FileKind; mime: string } | { error: string };

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Names inside a zip, read from its directory only (nothing is inflated). */
export function zipEntries(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    return [];
  }
  return names;
}

/** Text if it's valid UTF-8 (or UTF-16 with a byte-order mark) with no binary bytes in it. */
export function decodeText(bytes: Uint8Array): string | null {
  if (starts(bytes, [0xff, 0xfe]) || starts(bytes, [0xfe, 0xff])) {
    try {
      return new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be", { fatal: true }).decode(bytes.subarray(2));
    } catch {
      return null;
    }
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (text.includes("\u0000")) return null;
  return text.replace(/^﻿/, "");
}

export function sniff(bytes: Uint8Array, name: string): Sniffed {
  if (!bytes.length) return { error: "The file is empty." };
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: "pdf", mime: "application/pdf" };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", mime: "image/png" };
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg" };
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", mime: "image/gif" };
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { kind: "image", mime: "image/webp" };
  // HEIC/HEIF (iPhone photos saved as files): "ftypheic" and friends at byte 4.
  if (starts(bytes, [0x66, 0x74, 0x79, 0x70], 4) && /^(heic|heix|hevc|mif1|msf1|heif)$/.test(String.fromCharCode(...bytes.subarray(8, 12)))) {
    return { error: "iPhone photos saved as HEIC can't be read yet. Share it as a JPEG (or take a screenshot) and send that." };
  }
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipEntries(bytes);
    if (names.includes("word/document.xml")) return { kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    if (names.includes("ppt/presentation.xml")) return { kind: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
    if (names.includes("xl/workbook.xml")) return { error: "Spreadsheets can't be read yet. Save it as a CSV and send that." };
    // An Office file whose insides can't be read is damaged, not a zip someone meant to send.
    if (!names.length || /\.(docx|pptx|xlsx|odt|odp|ods|epub)$/i.test(name)) return { error: "This file looks damaged, so it couldn't be opened. Try saving it again, or as a PDF." };
    return { error: "That's a zip file. Unzip it and send the files inside." };
  }
  // Old Office files (.doc, .ppt, .xls) are one compound file.
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { error: "That's an older Office file. Save it as .docx, .pptx or PDF and send that." };
  }
  const text = decodeText(bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024)));
  if (text !== null) {
    const lower = name.toLowerCase();
    const mime = /\.(md|markdown)$/.test(lower)
      ? "text/markdown"
      : /\.csv$/.test(lower)
        ? "text/csv"
        : /\.html?$/.test(lower) || /^\s*<(!doctype html|html)\b/i.test(text)
          ? "text/html"
          : /\.json$/.test(lower)
            ? "application/json"
            : "text/plain";
    return { kind: "text", mime };
  }
  return { error: "I can't read this kind of file yet. PDFs, Word, PowerPoint, text files and photos work." };
}
