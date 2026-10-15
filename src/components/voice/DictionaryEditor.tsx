"use client";
/**
 * Your words for voice typing: names and terms spelled your way (and what speech-to-text writes
 * instead), and snippets you say to type something longer. Shared with the desktop app.
 */
import * as React from "react";
import { BookA, Plus, Quote, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type DictEntry = { id: string; kind: "word" | "snippet"; text: string; heard: string[]; source: string; updatedAt: string };

async function send(method: string, url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: "I can't reach Build-a-bot. Check your internet and try again." } };
  }
}

export function DictionaryEditor({ initial, fromMemories }: { initial: DictEntry[]; fromMemories: string[] }) {
  const [entries, setEntries] = React.useState(initial);
  const [word, setWord] = React.useState("");
  const [heard, setHeard] = React.useState("");
  const [wordError, setWordError] = React.useState<string | null>(null);
  const [phrase, setPhrase] = React.useState("");
  const [snippet, setSnippet] = React.useState("");
  const [snippetError, setSnippetError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const words = entries.filter((e) => e.kind === "word");
  const snippets = entries.filter((e) => e.kind === "snippet");

  async function addWord(e: React.FormEvent) {
    e.preventDefault();
    if (!word.trim()) return setWordError("Type the word.");
    setBusy(true);
    const r = await send("POST", "/api/voice/dictionary", { kind: "word", text: word.trim(), heard: heard.trim() ? [heard.trim()] : [] });
    setBusy(false);
    if (!r.ok) return setWordError(String(r.data.error ?? "That didn't work. Try again."));
    const entry = r.data.entry as DictEntry;
    setEntries((list) => [entry, ...list.filter((x) => x.id !== entry.id)]);
    setWord("");
    setHeard("");
    setWordError(null);
  }

  async function addSnippet(e: React.FormEvent) {
    e.preventDefault();
    if (!phrase.trim()) return setSnippetError("Type the phrase you'll say.");
    if (!snippet.trim()) return setSnippetError("Type what it should type.");
    setBusy(true);
    const r = await send("POST", "/api/voice/dictionary", { kind: "snippet", text: snippet, heard: [phrase.trim()] });
    setBusy(false);
    if (!r.ok) return setSnippetError(String(r.data.error ?? "That didn't work. Try again."));
    setEntries((list) => [r.data.entry as DictEntry, ...list]);
    setPhrase("");
    setSnippet("");
    setSnippetError(null);
  }

  async function remove(id: string) {
    const before = entries;
    setEntries((list) => list.filter((x) => x.id !== id));
    const r = await send("DELETE", `/api/voice/dictionary/${encodeURIComponent(id)}`);
    if (!r.ok && r.data.error !== "That word isn't in your dictionary anymore.") setEntries(before);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-labelledby="words-title" className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <h3 id="words-title" className="flex items-center gap-2 font-semibold">
          <BookA className="size-4 text-primary" aria-hidden="true" /> Your words
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Names and terms it should always spell your way. Add what it writes instead, if you've seen it get it wrong.</p>
        <form onSubmit={addWord} className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" noValidate>
          <label className="sr-only" htmlFor="dict-word">
            Word
          </label>
          <Input id="dict-word" value={word} onChange={(e) => setWord(e.target.value)} placeholder="Prozzi" maxLength={80} className="h-10 rounded-xl text-sm" autoComplete="off" />
          <label className="sr-only" htmlFor="dict-heard">
            It writes instead (optional)
          </label>
          <Input id="dict-heard" value={heard} onChange={(e) => setHeard(e.target.value)} placeholder="It writes instead (optional)" maxLength={80} className="h-10 rounded-xl text-sm" autoComplete="off" />
          <Button type="submit" size="md" disabled={busy}>
            <Plus /> Add
          </Button>
        </form>
        {wordError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {wordError}
          </p>
        ) : null}
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Your words">
          {words.length ? (
            words.map((w) => (
              <li key={w.id} className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-3 text-sm font-semibold text-primary">
                {w.text}
                {w.heard.length ? <span className="font-normal opacity-80">(not “{w.heard.join("”, “")}”)</span> : null}
                {w.source === "correction" ? <span className="sr-only">learned from a fix</span> : null}
                <button type="button" onClick={() => void remove(w.id)} className="flex size-6 items-center justify-center rounded-full hover:bg-primary/15" aria-label={`Remove ${w.text}`}>
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))
          ) : (
            <li className="text-sm text-muted-foreground">No words yet.</li>
          )}
        </ul>
        {fromMemories.length ? (
          <div className="mt-5 rounded-2xl bg-muted/60 p-3 text-sm">
            <div className="font-semibold">It already knows these, from what your bots remember:</div>
            <p className="mt-1 text-muted-foreground">{fromMemories.join(", ")}</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="snippets-title" className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <h3 id="snippets-title" className="flex items-center gap-2 font-semibold">
          <Quote className="size-4 text-primary" aria-hidden="true" /> Snippets
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Say a phrase and it types something longer: your address, a booking link, a sign-off. Pick a phrase you wouldn't say otherwise.</p>
        <form onSubmit={addSnippet} className="mt-4 grid gap-2" noValidate>
          <label className="text-sm font-medium" htmlFor="snip-phrase">
            When I say
          </label>
          <Input id="snip-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="my booking link" maxLength={60} className="h-10 rounded-xl text-sm" autoComplete="off" />
          <label className="text-sm font-medium" htmlFor="snip-text">
            Type this
          </label>
          <Textarea id="snip-text" value={snippet} onChange={(e) => setSnippet(e.target.value)} placeholder="https://cal.com/you" maxLength={4000} className="min-h-20 rounded-xl text-sm" />
          <Button type="submit" variant="soft" className="justify-self-start" disabled={busy}>
            <Plus /> Add snippet
          </Button>
        </form>
        {snippetError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {snippetError}
          </p>
        ) : null}
        <ul className="mt-4 grid gap-2" aria-label="Your snippets">
          {snippets.map((s) => (
            <li key={s.id} className={cn("flex items-start gap-3 rounded-2xl border border-border px-3 py-2 text-sm")}>
              <span className="shrink-0 font-semibold">“{s.heard[0]}”</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-muted-foreground">{s.text}</span>
              <button type="button" onClick={() => void remove(s.id)} className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Delete the snippet for ${s.heard[0]}`}>
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
