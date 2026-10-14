/**
 * The simulated browser for demo mode (no BROWSER_USE_API_KEY): realistic, clearly
 * labelled results, so the whole read → fill → preview → approve → submit flow can be
 * tried without a vendor account. Nothing here touches the network.
 */
import { newId, truncate } from "@/lib/utils";
import type { FilledField, WebActionsProvider, WebField } from "./types";

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** "shop.acme-dental.co.uk" → "Acme Dental". */
export function brandOf(site: string): string {
  const labels = site.split(".").filter(Boolean);
  let i = Math.max(0, labels.length - 2);
  if (labels.length >= 3 && SECOND_LEVEL.has(labels[i])) i -= 1;
  const word = labels[i] ?? site;
  return word
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function titleCase(label: string): string {
  const s = label.trim().replace(/[_-]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function demoAnswer(task: string, site: string): string {
  const brand = brandOf(site);
  const t = task.toLowerCase();
  if (/\b(hours?|open|opening|close|closing)\b/.test(t)) {
    return `${brand} is open Monday–Friday 9:00 am–6:00 pm and Saturday 10:00 am–4:00 pm. Closed Sundays and public holidays.`;
  }
  if (/\b(appointments?|book|booking|availability|available|slots?)\b/.test(t)) {
    return `Next open appointments at ${brand}: Thursday 10:30 am, Thursday 2:00 pm and Friday 9:15 am.`;
  }
  if (/\b(price|prices|pricing|cost|costs|fee|fees|how much|rates?)\b/.test(t)) {
    return `${brand}'s prices page lists Basic at $19/month and Plus at $39/month; the first consultation is free.`;
  }
  if (/\b(phone|call|contact|email|reach)\b/.test(t)) {
    return `Phone (555) 010-4477, email hello@${site}, or the contact form at ${site}/contact.`;
  }
  if (/\b(address|where|location|located|directions|parking)\b/.test(t)) {
    return `${brand} is at 123 Main Street, Suite 4, Springfield. Free parking behind the building.`;
  }
  if (/\b(return|refund|shipping|delivery|policy)\b/.test(t)) {
    return `Returns are accepted within 30 days with a receipt; shipping is free on orders over $50.`;
  }
  if (/\b(menu|dish|dishes|specials?|food)\b/.test(t)) {
    return `Today's specials at ${brand}: tomato soup, a grilled cheese melt and a seasonal salad.`;
  }
  return `${brand}'s site covers this on its main pages: ${truncate(task.trim().replace(/[?.!]+$/, ""), 120)}. (A real browser would quote the exact text here.)`;
}

// ---------------------------------------------------------------------------
// The drawn preview: a browser window with the filled form and an unpressed Send button.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function wrap(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = word.length > width ? `${word.slice(0, width - 1)}…` : word;
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = last.length >= width - 1 ? `${last.slice(0, width - 2)}…` : `${last} …`;
    return kept;
  }
  return lines;
}

export function renderFormPreviewSvg(input: { url: string; site: string; title: string; fields: FilledField[] }): string {
  const W = 640;
  const pad = 32;
  const inner = W - pad * 2;
  const rows: string[] = [];
  let y = 150;
  for (const f of input.fields.slice(0, 12)) {
    const lines = wrap(f.value || " ", 66, 4);
    const boxH = lines.length > 1 ? 18 + lines.length * 20 : 38;
    rows.push(
      `<text x="${pad}" y="${y}" font-size="13" font-weight="600" fill="#334155">${esc(truncate(f.label, 60))}</text>`,
      `<rect x="${pad}" y="${y + 8}" width="${inner}" height="${boxH}" rx="8" fill="#FFFFFF" stroke="#CBD5E1"/>`,
      ...lines.map(
        (line, i) => `<text x="${pad + 12}" y="${y + 32 + i * 20}" font-size="14" fill="#0F172A">${esc(line)}</text>`,
      ),
    );
    y += boxH + 40;
  }
  const H = y + 70;
  const btnY = y - 8;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif">`,
    `<title>Preview of the filled form on ${esc(input.site)} (not sent)</title>`,
    `<rect width="${W}" height="${H}" rx="14" fill="#F8FAFC" stroke="#E2E8F0"/>`,
    `<path d="M0 14a14 14 0 0 1 14-14h${W - 28}a14 14 0 0 1 14 14v30H0z" fill="#E2E8F0"/>`,
    `<circle cx="22" cy="22" r="5" fill="#F87171"/><circle cx="40" cy="22" r="5" fill="#FBBF24"/><circle cx="58" cy="22" r="5" fill="#34D399"/>`,
    `<rect x="78" y="10" width="${W - 96}" height="24" rx="12" fill="#FFFFFF"/>`,
    `<text x="92" y="27" font-size="12" fill="#475569">${esc(truncate(input.url, 78))}</text>`,
    `<text x="${pad}" y="88" font-size="22" font-weight="700" fill="#0F172A">${esc(truncate(input.title, 44))}</text>`,
    `<text x="${pad}" y="112" font-size="13" fill="#64748B">${esc(input.site)}</text>`,
    `<rect x="${W - pad - 168}" y="70" width="168" height="26" rx="13" fill="#FEF3C7" stroke="#F59E0B"/>`,
    `<text x="${W - pad - 84}" y="88" font-size="12" font-weight="700" fill="#92400E" text-anchor="middle">Preview · not sent yet</text>`,
    ...rows,
    `<rect x="${pad}" y="${btnY}" width="120" height="40" rx="10" fill="#FFFFFF" stroke="#6366F1" stroke-width="2" stroke-dasharray="6 4"/>`,
    `<text x="${pad + 60}" y="${btnY + 25}" font-size="14" font-weight="700" fill="#4F46E5" text-anchor="middle">Send</text>`,
    `<text x="${pad + 136}" y="${btnY + 25}" font-size="12" fill="#64748B">Waiting for your OK · simulated in demo mode</text>`,
    `</svg>`,
  ].join("");
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

// ---------------------------------------------------------------------------

export function createDemoWebProvider(): WebActionsProvider {
  return {
    id: "demo",
    label: "Simulated browser (demo mode)",
    simulated: true,
    sessionTtlMs: 60 * 60_000,

    async read({ url, site, task }) {
      return {
        ok: true,
        answer: demoAnswer(task, site),
        found: true,
        url,
        title: `${brandOf(site)} (simulated page)`,
      };
    },

    async fill({ url, site, fields }) {
      if (/\/(account|my-account|profile)(\/|$)/i.test(new URL(url).pathname)) {
        return { ok: false, error: `${site} asks you to sign in first, so I stopped. I never type your passwords.`, blocker: "login" };
      }
      const filled = fields.map((f: WebField) => ({ label: titleCase(f.field), value: f.value }));
      const isContact = /contact|support|help/i.test(url) || fields.some((f) => /message|comment|question|enquiry|inquiry/i.test(f.field));
      const title = isContact ? `Contact ${brandOf(site)}` : `${brandOf(site)} · form`;
      return {
        ok: true,
        providerSessionId: newId("demo"),
        url,
        title,
        filled,
        previewDataUrl: svgDataUrl(renderFormPreviewSvg({ url, site, title, fields: filled })),
      };
    },

    async submit({ site, fields }) {
      const name = fields.find((f) => /name/i.test(f.label))?.value.split(/\s+/)[0];
      const ref = newId("ref").slice(4, 10).toUpperCase();
      return {
        ok: true,
        confirmation: `Thanks${name ? `, ${name}` : ""}! ${brandOf(site)} received your form and will reply within 1–2 business days. Reference #${ref}.`,
      };
    },

    async discard() {},
  };
}
