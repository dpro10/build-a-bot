/**
 * HTML versions of outgoing emails (the plain-text part is always sent too).
 * Inline styles only, tables for layout, no external CSS: what email clients
 * actually render.
 */
import { appUrl } from "@/lib/env";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A small, safe subset of Markdown: paragraphs, line breaks, **bold**, `code`, links and bullet lists. */
export function markdownToEmailHtml(markdown: string): string {
  const inline = (line: string) =>
    esc(line)
      .replace(/`([^`\n]+)`/g, '<code style="font-family:ui-monospace,Menlo,monospace;background:#f1ede6;padding:1px 5px;border-radius:5px">$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="color:#6d4dff">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" style="color:#6d4dff">$2</a>');
  return markdown
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        return `<ul style="margin:0 0 14px;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 4px">${inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        return `<ol style="margin:0 0 14px;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 4px">${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
      }
      const heading = /^#{1,6}\s+(.+)$/.exec(lines[0]);
      if (heading && lines.length === 1) return `<p style="margin:0 0 10px;font-weight:700">${inline(heading[1])}</p>`;
      return `<p style="margin:0 0 14px">${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

function shell(inner: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#fbf9f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf9f6;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e8e2d8;border-radius:20px">
<tr><td style="padding:24px 24px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#16151c">${inner}</td></tr>
</table>
<p style="max-width:560px;margin:14px auto 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#6a6677">${footer}</p>
</td></tr></table></body></html>`;
}

/** A message from a bot, wearing its face. */
export function botEmailHtml(input: { botName: string; avatar: string; color: string; text: string; ownerName?: string | null; toOwner: boolean }): string {
  const img = `${appUrl()}/avatars/${encodeURIComponent(input.avatar)}-${encodeURIComponent(input.color)}.jpg`;
  const header = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr>
<td style="padding-right:12px"><img src="${img}" width="44" height="44" alt="" style="display:block;border-radius:50%;border:0"></td>
<td style="font-weight:700;font-size:16px">${esc(input.botName)}<br><span style="font-weight:400;font-size:12px;color:#6a6677">AI assistant</span></td>
</tr></table>`;
  const footer = input.toOwner
    ? `${esc(input.botName)} is your AI assistant. Reply to this email to talk to it, or reply STOP to pause it.`
    : `${esc(input.botName)} is an AI assistant${input.ownerName ? ` working for ${esc(input.ownerName)}` : ""}, not a person.`;
  return shell(header + markdownToEmailHtml(input.text), footer);
}

/** The product's own sign-in email. */
export function loginEmailHtml(link: string): string {
  const inner = `<p style="margin:0 0 16px;font-size:18px;font-weight:700">Sign in to Build-a-bot</p>
<p style="margin:0 0 20px">Tap the button to sign in. The link works once and expires in 20 minutes.</p>
<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#6d4dff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Sign in</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#6a6677">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>`;
  return shell(inner, "If you didn't ask for this, you can ignore it — nobody can sign in without the link.");
}
