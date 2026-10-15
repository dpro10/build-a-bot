"use client";
import * as React from "react";
import { ArrowLeft, ExternalLink, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { IMPORT_PROMPT } from "@/lib/memory/prompt";
import type { MemoryItem } from "./types";

type Fact = { text: string; pinned: boolean };
type Read = { facts: Fact[]; alreadyKnown: number; tidied: boolean };

const ASSISTANTS = [
  { name: "ChatGPT", href: "https://chatgpt.com/" },
  { name: "Claude", href: "https://claude.ai/new" },
  { name: "Gemini", href: "https://gemini.google.com/app" },
];

/**
 * "Bring my memories": copy one message into ChatGPT, Claude or Gemini, paste the answer back,
 * untick anything to leave out, save. Two screens, no files, no settings.
 */
export function ImportMemories({
  botId,
  botName,
  open,
  onOpenChange,
  onSaved,
}: {
  botId: string;
  botName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (memories: MemoryItem[]) => void;
}) {
  const [text, setText] = React.useState("");
  const [read, setRead] = React.useState<Read | null>(null);
  const [keep, setKeep] = React.useState<boolean[]>([]);
  const [busy, setBusy] = React.useState<"read" | "save" | null>(null);
  const pasteId = React.useId();

  React.useEffect(() => {
    if (!open) {
      // Start fresh next time, but keep a pasted answer if the dialog was closed by mistake mid-review.
      setRead(null);
      setBusy(null);
    }
  }, [open]);

  const readIt = async () => {
    setBusy("read");
    try {
      const res = await api<Read>(`/api/bots/${botId}/memories/import`, { method: "POST", body: { step: "read", text } });
      setRead(res);
      setKeep(res.facts.map(() => true));
    } catch (err) {
      toast.error((err as Error).message || "Couldn't read that. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const chosen = read ? read.facts.filter((_, i) => keep[i]) : [];

  const save = async () => {
    if (!chosen.length) return;
    setBusy("save");
    try {
      const res = await api<{ memories: MemoryItem[] }>(`/api/bots/${botId}/memories/import`, { method: "POST", body: { step: "save", facts: chosen } });
      onSaved(res.memories);
      setText("");
      onOpenChange(false);
      const n = res.memories.length;
      toast.success(n ? `${botName} now knows ${n} more ${n === 1 ? "thing" : "things"} about you` : `${botName} already knew all of that`);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't save those. Try again.");
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => busy !== "save" && onOpenChange(o)}>
      <DialogContent side="bottom">
        {!read ? (
          <>
            <DialogHeader>
              <DialogTitle>Bring your memories</DialogTitle>
              <DialogDescription>Teach {botName} what ChatGPT, Claude or Gemini already knows about you. It takes a minute.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-5">
              <Step n={1} title="Copy this message">
                <div className="flex flex-col gap-2 rounded-2xl border border-border bg-background-2/70 p-3">
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{IMPORT_PROMPT}</p>
                  <CopyButton value={IMPORT_PROMPT} label="Copy message" className="w-fit" />
                </div>
              </Step>
              <Step n={2} title="Send it to the AI you use">
                <div className="flex flex-wrap gap-2">
                  {ASSISTANTS.map((a) => (
                    <Button key={a.name} asChild variant="soft" size="sm">
                      <a href={a.href} target="_blank" rel="noreferrer">
                        {a.name} <ExternalLink className="opacity-70" />
                      </a>
                    </Button>
                  ))}
                </div>
              </Step>
              <Step n={3} title="Paste its whole answer here" htmlFor={pasteId}>
                <Textarea
                  id={pasteId}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  placeholder="Paste the answer…"
                  className="text-sm"
                  maxLength={40_000}
                />
              </Step>
            </DialogBody>
            <DialogFooter>
              {busy === "read" ? <span className="mr-auto text-xs text-muted-foreground">Reading it… this takes a few seconds.</span> : null}
              <Button onClick={() => void readIt()} loading={busy === "read"} disabled={text.trim().length < 20}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{read.facts.length ? `Here's what ${botName} will remember` : "Nothing new to add"}</DialogTitle>
              <DialogDescription>
                {read.facts.length
                  ? `Untick anything you'd rather ${botName} didn't know.`
                  : read.alreadyKnown
                    ? `${botName} already knows all of this.`
                    : "We couldn't find facts about you in that. Go back and paste the whole answer."}
                {read.facts.length && read.alreadyKnown ? ` ${read.alreadyKnown} ${read.alreadyKnown === 1 ? "thing it already knew was" : "things it already knew were"} left out.` : ""}
              </DialogDescription>
            </DialogHeader>
            {read.facts.length ? (
              <DialogBody className="flex flex-col gap-1">
                <div className="flex items-center justify-between pb-1 text-xs text-muted-foreground">
                  <span>
                    {chosen.length} of {read.facts.length} ticked
                  </span>
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => setKeep(read.facts.map(() => chosen.length !== read.facts.length))}
                  >
                    {chosen.length === read.facts.length ? "Untick all" : "Tick all"}
                  </button>
                </div>
                <ul className="-mx-2 flex flex-col">
                  {read.facts.map((f, i) => (
                    <li key={i}>
                      <label className="flex cursor-pointer gap-3 rounded-2xl px-2 py-2.5 transition hover:bg-muted/60">
                        <input
                          type="checkbox"
                          checked={keep[i] ?? false}
                          onChange={(e) => setKeep((k) => k.map((v, j) => (j === i ? e.target.checked : v)))}
                          className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-[var(--primary)]"
                        />
                        <span className={keep[i] ? "min-w-0 flex-1 text-sm leading-snug" : "min-w-0 flex-1 text-sm leading-snug text-muted-foreground line-through"}>{f.text}</span>
                        {f.pinned ? (
                          <span className="mt-0.5 shrink-0 text-primary" title={`Always on ${botName}'s mind`}>
                            <Pin className="size-3.5" aria-label={`Always on ${botName}'s mind`} />
                          </span>
                        ) : null}
                      </label>
                    </li>
                  ))}
                </ul>
                {read.facts.some((f) => f.pinned) ? (
                  <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                    <Pin className="size-3 text-primary" aria-hidden /> Always on {botName}&apos;s mind. You can change this later.
                  </p>
                ) : null}
              </DialogBody>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRead(null)} disabled={busy === "save"} className="mr-auto">
                <ArrowLeft /> Back
              </Button>
              {read.facts.length ? (
                <Button onClick={() => void save()} loading={busy === "save"} disabled={!chosen.length}>
                  Save {chosen.length} {chosen.length === 1 ? "memory" : "memories"}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, title, htmlFor, children }: { n: number; title: string; htmlFor?: string; children: React.ReactNode }) {
  const Title = htmlFor ? "label" : "p";
  return (
    <div className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary" aria-hidden>
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Title {...(htmlFor ? { htmlFor } : {})} className="text-sm font-semibold">
          {title}
        </Title>
        {children}
      </div>
    </div>
  );
}
