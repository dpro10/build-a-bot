/**
 * The app's own pages (pairing, the hidden capture page, voice typing's pill and settings) are served from a private
 * scheme, bab-app://<page>/…, instead of file://, so each gets a real origin, a strict
 * Content-Security-Policy and nothing else on disk is reachable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEME = "bab-app";
const ROOT = fileURLToPath(new URL("../renderer/", import.meta.url));

const CSP = {
  pairing: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  capture: "default-src 'none'; script-src 'self'; worker-src 'self'; media-src 'self' blob: mediastream:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  dictation: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob: mediastream:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  voice: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

/** The URL of a local page. */
export function pageUrl(page, file = "index.html") {
  return `${SCHEME}://${page}/${file}`;
}

/** @param {string} url @param {string} page */
export function isPage(url, page) {
  try {
    const u = new URL(url);
    return u.protocol === `${SCHEME}:` && u.hostname === page;
  } catch {
    return false;
  }
}

/** Register the bab-app:// handler on a session (each session needs its own). */
export function serveLocalPages(ses, pages) {
  ses.protocol.handle(SCHEME, async (request) => {
    const u = new URL(request.url);
    const page = u.hostname;
    if (!pages.includes(page) || !(page in CSP)) return new Response("Not found", { status: 404 });
    const base = path.join(ROOT, page);
    let rel = decodeURIComponent(u.pathname);
    if (rel === "/" || !rel) rel = "/index.html";
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base + path.sep)) return new Response("Not found", { status: 404 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, {
        headers: {
          "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
          "content-security-policy": CSP[/** @type {keyof typeof CSP} */ (page)],
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
