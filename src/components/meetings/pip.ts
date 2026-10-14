/**
 * Document Picture-in-Picture: a small always-on-top window the page fills with its
 * own markup. The browser recorder only listens while this window is open, so the bot
 * stays visible over the call (Chrome/Edge 116+, Firefox 151+; not Safari).
 */

type DocumentPip = {
  requestWindow(opts?: { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>;
  readonly window: Window | null;
};

function api(): DocumentPip | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture;
}

export function pipSupported(): boolean {
  try {
    return Boolean(api()) && window.top === window;
  } catch {
    return false;
  }
}

/**
 * Open the floating window. Call it straight from a click handler, before any `await`:
 * the browser only allows it right after a tap (and uses the tap up).
 */
export function openPipWindow(opts: { width: number; height: number; title: string }): Promise<{ win: Window; root: HTMLElement }> {
  const dpip = api();
  if (!dpip) return Promise.reject(new DOMException("Picture-in-picture isn't available in this browser.", "NotSupportedError"));
  let request: Promise<Window>;
  try {
    request = dpip.requestWindow({ width: opts.width, height: opts.height, preferInitialWindowPlacement: true });
  } catch (err) {
    return Promise.reject(err);
  }
  return request.then((win) => ({ win, root: prepare(win, opts.title) }));
}

/** Bring the page's styles, fonts and theme into the new window, and keep the theme in sync. */
function prepare(win: Window, title: string): HTMLElement {
  const doc = win.document;
  doc.title = title;
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      // Copied rules lose their stylesheet's address, so relative url()s (the fonts) would
      // resolve against the page instead: make them absolute first.
      const base = sheet.href ?? document.baseURI;
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n")
        .replace(/url\(\s*(["']?)(?!data:|blob:|https?:|\/\/|#)([^"')]+)\1\s*\)/g, (whole, quote: string, url: string) => {
          try {
            return `url(${quote}${new URL(url, base).href}${quote})`;
          } catch {
            return whole;
          }
        });
      const style = doc.createElement("style");
      if (sheet.media?.mediaText) style.media = sheet.media.mediaText;
      style.textContent = css;
      doc.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = doc.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        doc.head.appendChild(link);
      }
    }
  }
  const meta = doc.createElement("meta");
  meta.name = "color-scheme";
  meta.content = "light dark";
  doc.head.appendChild(meta);

  const sync = () => {
    const from = document.documentElement;
    const to = doc.documentElement;
    for (const attr of ["data-theme", "class", "lang"]) {
      const v = from.getAttribute(attr);
      if (v === null) to.removeAttribute(attr);
      else to.setAttribute(attr, v);
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  win.addEventListener("pagehide", () => observer.disconnect(), { once: true });

  doc.documentElement.style.height = "100%";
  doc.body.className = "bg-background text-foreground antialiased";
  doc.body.style.margin = "0";
  doc.body.style.height = "100%";
  doc.body.style.overflow = "hidden";
  const root = doc.createElement("div");
  root.id = "bab-pip-root";
  root.style.height = "100%";
  doc.body.appendChild(root);
  return root;
}
