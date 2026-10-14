/**
 * A small, safe markdown renderer for chat: paragraphs, lists, headings, bold,
 * italics, inline code, code blocks and links. Produces React elements only
 * (no innerHTML), and only allows http(s)/mailto/tel links.
 */
import * as React from "react";

function safeHref(href: string): string | null {
  try {
    const u = new URL(href);
    return ["http:", "https:", "mailto:", "tel:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Tokens: `code`, **bold**, *italic*/_italic_, [text](url), bare URLs.
  // Underscores inside a word (TAVILY_API_KEY, snake_case) are not italics.
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|(?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_]))|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s)<>]+)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    const tok = m[0];
    if (m[1]) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}>{inline(tok.slice(2, -2), key)}</strong>);
    else if (m[3]) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    else if (m[4]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = safeHref(lm[2]);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {lm[1]}
          </a>
        ) : (
          lm[1]
        ),
      );
    } else if (m[5]) {
      const clean = tok.replace(/[.,!?;:]+$/, "");
      const href = safeHref(clean);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {clean.replace(/^https?:\/\//, "").slice(0, 60)}
          </a>
        ) : (
          clean
        ),
      );
      if (clean.length < tok.length) out.push(tok.slice(clean.length));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k++}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push(
        <ul key={k++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it.replace(/^\[( |x)\]\s*/i, (_m, c) => (c.toLowerCase() === "x" ? "☑ " : "☐ ")), `${k}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(
        <ol key={k++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${k}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      blocks.push(<h4 key={k++}>{inline(h[2], `h${k}`)}</h4>);
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(\s*[-*•]\s+|\s*\d+[.)]\s+|```|#{1,4}\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={k++}>
        {para.map((p, j) => (
          <React.Fragment key={j}>
            {j > 0 ? <br /> : null}
            {inline(p, `${k}-${j}`)}
          </React.Fragment>
        ))}
      </p>,
    );
  }
  return <div className={className ? `prose-chat ${className}` : "prose-chat"}>{blocks}</div>;
}
