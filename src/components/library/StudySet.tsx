"use client";
/**
 * Flashcards and practice quizzes, studied right where they were made (a card in the chat) or from
 * the Library. One focused window: a card that flips, or one question at a time.
 *
 * Keys: flashcards — Space flips, 1 "Again", 2 "Got it". Quiz — 1–6 pick a choice, Enter goes on.
 */
import * as React from "react";
import { ArrowRight, Check, Download, Layers, ListChecks, LoaderCircle, MessageCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import type { QuizQuestion, StudySetSummary } from "@/lib/db/schema";
import type { StudySetView } from "@/lib/library/views";
import { cn } from "@/lib/utils";

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

/** The card a bot's reply carries: what it made, and a button to start. */
export function StudySetCard({ botId, set, botName, onAsk }: { botId: string; set: StudySetSummary; botName: string; onAsk?: (text: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const quiz = set.kind === "quiz";
  return (
    <>
      <div className="group flex w-full max-w-md items-center gap-3.5 self-start rounded-3xl border border-border bg-card p-3.5 pr-4 shadow-soft transition hover:border-primary/40 hover:shadow-lift">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_8px_20px_-8px_rgb(109_77_255/0.7)]",
            quiz ? "bg-gradient-to-br from-[#F59E0B] to-[#EF4444]" : "bg-gradient-to-br from-[#8B5CF6] to-[#6366F1]",
          )}
          aria-hidden
        >
          {quiz ? <ListChecks className="size-6" /> : <Layers className="size-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{set.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {quiz ? `${set.count}-question quiz` : `${set.count} flashcards`}
            {set.sources.length ? ` · from ${set.sources.join(", ")}` : ""}
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          {quiz ? "Start" : "Study"}
        </Button>
      </div>
      <StudyDialog botId={botId} setId={set.id} open={open} onOpenChange={setOpen} botName={botName} onAsk={onAsk} />
    </>
  );
}

export function StudyDialog({
  botId,
  setId,
  open,
  onOpenChange,
  botName,
  onAsk,
  onChanged,
}: {
  botId: string;
  setId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botName: string;
  /** Send a message to the bot (in the chat), or open the chat with it. */
  onAsk?: (text: string) => void;
  /** Progress was saved (the Library refreshes its counts). */
  onChanged?: () => void;
}) {
  const [set, setSet] = React.useState<StudySetView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    call<{ set: StudySetView }>(`/api/bots/${botId}/study-sets/${setId}`)
      .then((r) => live && setSet(r.set))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [open, botId, setId]);
  const ask = onAsk ?? ((text: string) => window.location.assign(`/app/bots/${botId}?ask=${encodeURIComponent(text)}`));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(680px,calc(100vw-16px))]" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{set?.title ?? "Study"}</DialogTitle>
        {error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : !set ? (
          <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" aria-hidden /> Opening…
          </div>
        ) : set.kind === "flashcards" ? (
          <Flashcards
            botId={botId}
            set={set}
            onSaved={(s) => {
              setSet(s);
              onChanged?.();
            }}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <Quiz
            botId={botId}
            set={set}
            botName={botName}
            onSaved={(s) => {
              setSet(s);
              onChanged?.();
            }}
            onAsk={(text) => {
              onOpenChange(false);
              ask(text);
            }}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Header({ title, at, total, kind, action }: { title: string; at: number; total: number; kind: "flashcards" | "quiz"; action?: React.ReactNode }) {
  return (
    <div className="pt-5 pr-14 pl-5 sm:pl-6">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-primary uppercase">
        {kind === "quiz" ? <ListChecks className="size-3.5" aria-hidden /> : <Layers className="size-3.5" aria-hidden />}
        {kind === "quiz" ? "Practice quiz" : "Flashcards"}
        <span className="ml-auto flex items-center gap-2 font-medium tracking-normal text-muted-foreground normal-case">{action}</span>
      </div>
      <h2 className="mt-1 truncate font-display text-lg font-semibold">{title}</h2>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={at} aria-label="Progress">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${total ? (at / total) * 100 : 0}%` }} />
        </div>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          {Math.min(at + 1, total)} / {total}
        </span>
      </div>
    </div>
  );
}

function ExportLink({ botId, setId }: { botId: string; setId: string }) {
  return (
    <a href={`/api/bots/${botId}/study-sets/${setId}/export`} className="inline-flex items-center gap-1 hover:text-foreground" title="Export as CSV (Anki and Quizlet import it)">
      <Download className="size-3.5" aria-hidden /> CSV
    </a>
  );
}

// ---------------------------------------------------------------------------
// Flashcards

function Flashcards({ botId, set, onSaved, onDone }: { botId: string; set: StudySetView; onSaved: (s: StudySetView) => void; onDone: () => void }) {
  // Due cards first; with none due, the whole set.
  const [deck, setDeck] = React.useState(() => (set.dueIds.length ? set.dueIds : set.cards.map((c) => c.id)));
  const [i, setI] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [results, setResults] = React.useState<Record<string, "got_it" | "again">>({});
  const card = set.cards.find((c) => c.id === deck[i]);
  const finished = i >= deck.length;

  const answer = React.useCallback(
    (result: "got_it" | "again") => {
      if (!card) return;
      setResults((r) => ({ ...r, [card.id]: result }));
      setFlipped(false);
      setI((n) => n + 1);
      call<{ set: StudySetView }>(`/api/bots/${botId}/study-sets/${set.id}/review`, { cardId: card.id, result })
        .then((r) => onSaved(r.set))
        .catch(() => toast.error("Couldn't save that card. Check your connection."));
    },
    [botId, card, onSaved, set.id],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && e.key === "1") answer("again");
      else if (flipped && e.key === "2") answer("got_it");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, finished, flipped]);

  if (finished) {
    const again = deck.filter((id) => results[id] === "again");
    const got = deck.length - again.length;
    return (
      <div className="flex flex-col items-center px-6 pt-10 pb-8 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success animate-pop">
          <Sparkles className="size-8" aria-hidden />
        </span>
        <h2 className="mt-4 font-display text-2xl font-semibold">{again.length ? "Nice work" : "All of them!"}</h2>
        <p className="mt-1 text-muted-foreground">
          You knew {got} of {deck.length}.{" "}
          {again.length ? `${again.length === 1 ? "That one comes" : `Those ${again.length} come`} back in 10 minutes; the rest when they're due.` : "They'll come back for review in a few days."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {again.length ? (
            <Button
              variant="outline"
              onClick={() => {
                setDeck(again);
                setI(0);
                setResults({});
              }}
            >
              <RotateCcw /> Go over the {again.length} again
            </Button>
          ) : null}
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  if (!card) return null;
  return (
    <div className="flex flex-col pb-5">
      <Header title={set.title} at={i} total={deck.length} kind="flashcards" action={<ExportLink botId={botId} setId={set.id} />} />
      <div className="px-5 pt-5 sm:px-6">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          className="group block w-full rounded-3xl text-left perspective-distant focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          aria-label={flipped ? "Show the front" : "Show the answer"}
        >
          <div className={cn("relative min-h-[240px] transition-transform duration-500 transform-3d sm:min-h-[280px]", flipped && "rotate-y-180")}>
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl border border-border bg-gradient-to-br from-card to-primary-soft/40 p-6 text-center shadow-soft backface-hidden">
              <p className="text-xl leading-snug font-semibold text-balance sm:text-2xl">{card.front}</p>
              <span className="absolute bottom-4 text-xs text-muted-foreground">Tap or press Space to flip</span>
            </div>
            <div className="absolute inset-0 flex rotate-y-180 flex-col items-center justify-center rounded-3xl border border-primary/30 bg-card p-6 text-center shadow-soft backface-hidden" aria-live="polite">
              <p className="text-lg leading-relaxed text-balance whitespace-pre-wrap sm:text-xl">{flipped ? card.back : ""}</p>
              {card.source ? <span className="absolute bottom-4 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{card.source}</span> : null}
            </div>
          </div>
        </button>
      </div>
      <div className="mt-5 flex justify-center gap-3 px-5 sm:px-6">
        {flipped ? (
          <>
            <Button variant="danger-soft" size="lg" className="min-w-36" onClick={() => answer("again")}>
              <RotateCcw /> Again <kbd className="ml-1 hidden rounded bg-black/5 px-1.5 text-xs opacity-70 sm:inline dark:bg-white/10">1</kbd>
            </Button>
            <Button size="lg" className="min-w-36" onClick={() => answer("got_it")}>
              <Check /> Got it <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 text-xs opacity-80 sm:inline">2</kbd>
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="lg" className="min-w-48" onClick={() => setFlipped(true)}>
            Show answer
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz

type Answer = { given: string; right: boolean };

function Quiz({
  botId,
  set,
  botName,
  onSaved,
  onAsk,
  onDone,
}: {
  botId: string;
  set: StudySetView;
  botName: string;
  onSaved: (s: StudySetView) => void;
  onAsk: (text: string) => void;
  onDone: () => void;
}) {
  const qs = set.questions;
  const [i, setI] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, Answer>>({});
  const [draft, setDraft] = React.useState("");
  const [revealed, setRevealed] = React.useState(false);
  const saved = React.useRef(false);
  const q = qs[i];
  const done = i >= qs.length;
  const current = q ? answers[q.id] : undefined;

  const pick = React.useCallback(
    (choice: string) => {
      if (!q || answers[q.id]) return;
      setAnswers((a) => ({ ...a, [q.id]: { given: choice, right: sameAnswer(choice, q.answer) } }));
    },
    [answers, q],
  );
  const next = React.useCallback(() => {
    setDraft("");
    setRevealed(false);
    setI((n) => n + 1);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done || !q || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (/^[1-6]$/.test(e.key) && q.choices && !current) {
        const c = q.choices[Number(e.key) - 1];
        if (c) pick(c);
      } else if (e.key === "Enter" && current) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, done, next, pick, q]);

  // Finished: save the attempt once.
  React.useEffect(() => {
    if (!done || saved.current || !qs.length) return;
    saved.current = true;
    const missed = qs.filter((x) => !answers[x.id]?.right).map((x) => x.id);
    call<{ set: StudySetView }>(`/api/bots/${botId}/study-sets/${set.id}/attempt`, { score: qs.length - missed.length, total: qs.length, missed })
      .then((r) => onSaved(r.set))
      .catch(() => toast.error("Couldn't save your score. Check your connection."));
  }, [answers, botId, done, onSaved, qs, set.id]);

  if (done) {
    const missed = qs.filter((x) => !answers[x.id]?.right);
    const score = qs.length - missed.length;
    const pct = qs.length ? score / qs.length : 0;
    const askText = missed.length
      ? `I just took the quiz "${set.title}" and got ${score} of ${qs.length}. Go over what I missed:\n${missed
          .map((x) => `- ${x.question} (I said "${answers[x.id]?.given || "nothing"}"; the answer is "${x.answer}")`)
          .join("\n")}`
      : "";
    return (
      <div className="flex flex-col px-5 pt-8 pb-6 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <ScoreRing value={pct} label={`${score}/${qs.length}`} />
          <h2 className="mt-3 font-display text-2xl font-semibold">{pct === 1 ? "Perfect score!" : pct >= 0.8 ? "Great job" : pct >= 0.5 ? "Good start" : "Keep going"}</h2>
          <p className="mt-1 text-muted-foreground">{missed.length ? `${missed.length} to go over.` : "You got every one."}</p>
        </div>
        {missed.length ? (
          <ul className="scrollbar-thin mt-5 flex max-h-[38dvh] flex-col gap-2 overflow-y-auto">
            {missed.map((x) => (
              <li key={x.id} className="rounded-2xl border border-border bg-background-2 px-4 py-3 text-sm">
                <div className="font-medium">{x.question}</div>
                <div className="mt-1 text-muted-foreground">
                  <span className="text-danger line-through decoration-danger/50">{answers[x.id]?.given || "No answer"}</span> → <span className="font-medium text-success">{x.answer}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {missed.length ? (
            <Button onClick={() => onAsk(askText)}>
              <MessageCircle /> Go over them with {botName}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              setAnswers({});
              setI(0);
              setDraft("");
              setRevealed(false);
              saved.current = false;
            }}
          >
            <RotateCcw /> Retake
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (!q) return null;
  return (
    <div className="flex flex-col pb-5">
      <Header title={set.title} at={i} total={qs.length} kind="quiz" action={<ExportLink botId={botId} setId={set.id} />} />
      <div className="px-5 pt-5 sm:px-6">
        <p className="text-lg leading-snug font-semibold text-balance">{q.question}</p>
        {q.type === "short_answer" ? (
          <ShortAnswer q={q} draft={draft} setDraft={setDraft} revealed={revealed} setRevealed={setRevealed} answered={current} onGrade={(right) => setAnswers((a) => ({ ...a, [q.id]: { given: draft.trim(), right } }))} />
        ) : (
          <div className={cn("mt-4 grid gap-2", q.type === "true_false" && "grid-cols-2")}>
            {(q.choices ?? []).map((c, n) => {
              const chosen = current?.given === c;
              const isRight = sameAnswer(c, q.answer);
              const state = !current ? "idle" : isRight ? "right" : chosen ? "wrong" : "dim";
              return (
                <button
                  key={c}
                  type="button"
                  disabled={Boolean(current)}
                  onClick={() => pick(c)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-[15px] transition",
                    state === "idle" && "border-border bg-card hover:border-primary/50 hover:bg-primary-soft/40",
                    state === "right" && "border-success bg-success-soft text-foreground",
                    state === "wrong" && "border-danger bg-danger-soft text-foreground",
                    state === "dim" && "border-border bg-card opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      state === "right" ? "bg-success text-white" : state === "wrong" ? "bg-danger text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {state === "right" ? <Check className="size-4" /> : state === "wrong" ? <X className="size-4" /> : q.type === "true_false" ? c[0] : String.fromCharCode(65 + n)}
                  </span>
                  <span className="min-w-0 flex-1">{c}</span>
                </button>
              );
            })}
          </div>
        )}
        {current ? <Explanation q={q} right={current.right} /> : null}
      </div>
      {current ? (
        <div className="mt-5 flex justify-end px-5 sm:px-6">
          <Button onClick={next}>
            {i + 1 < qs.length ? "Next" : "See my score"} <ArrowRight />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ShortAnswer({
  q,
  draft,
  setDraft,
  revealed,
  setRevealed,
  answered,
  onGrade,
}: {
  q: QuizQuestion;
  draft: string;
  setDraft: (s: string) => void;
  revealed: boolean;
  setRevealed: (b: boolean) => void;
  answered?: Answer;
  onGrade: (right: boolean) => void;
}) {
  return (
    <div className="mt-4">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={revealed}
        rows={3}
        placeholder="Your answer"
        aria-label="Your answer"
        className="w-full resize-none rounded-2xl border border-input bg-card px-4 py-3 text-[15px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-80"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !revealed) setRevealed(true);
        }}
      />
      {!revealed ? (
        <div className="mt-2 flex justify-end">
          <Button variant="secondary" onClick={() => setRevealed(true)}>
            Check
          </Button>
        </div>
      ) : !answered ? (
        <div className="mt-3 rounded-2xl border border-primary/30 bg-primary-soft/40 p-4">
          <div className="text-xs font-semibold tracking-wide text-primary uppercase">The answer</div>
          <p className="mt-1 text-[15px]">{q.answer}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Did you get it?</span>
            <Button size="sm" variant="danger-soft" onClick={() => onGrade(false)}>
              <X /> Not quite
            </Button>
            <Button size="sm" onClick={() => onGrade(true)}>
              <Check /> I got it
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Explanation({ q, right }: { q: QuizQuestion; right: boolean }) {
  return (
    <div className={cn("mt-4 rounded-2xl px-4 py-3 text-sm animate-fade-up", right ? "bg-success-soft" : "bg-danger-soft")} role="status">
      <div className={cn("font-semibold", right ? "text-success" : "text-danger")}>{right ? "Right!" : `Not quite. The answer is: ${q.answer}`}</div>
      {q.explanation ? <p className="mt-1 text-foreground/90">{q.explanation}</p> : null}
      {q.source && !q.explanation?.includes(q.source) ? <p className="mt-1.5 text-xs text-muted-foreground">{q.source}</p> : null}
    </div>
  );
}

function ScoreRing({ value, label }: { value: number; label: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-28 animate-pop">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value)}
          className={cn("transition-[stroke-dashoffset] duration-700", value >= 0.8 ? "stroke-success" : value >= 0.5 ? "stroke-primary" : "stroke-warning")}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-2xl font-bold tabular-nums">{label}</span>
    </div>
  );
}

/** Same rule as the server: case, spacing and punctuation don't matter. */
function sameAnswer(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s.,;:!?'"()]+/g, " ").trim();
  return norm(a) === norm(b);
}
