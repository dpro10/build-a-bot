"use client";
/**
 * A bot's Library: the files it can read and the flashcards and quizzes it made from them.
 * Drop files anywhere on the page (or "Add files"); each is uploaded, read, and listed. A file's
 * menu asks the bot for flashcards, a quiz or a summary of it, in the chat.
 */
import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpenCheck,
  Download,
  ExternalLink,
  FileUp,
  Layers,
  ListChecks,
  LoaderCircle,
  MoreHorizontal,
  RotateCcw,
  ScrollText,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toaster";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import type { FileView } from "@/lib/library";
import { ACCEPT, formatBytes } from "@/lib/library/limits";
import type { StudySetListItem } from "@/lib/library/views";
import { cn } from "@/lib/utils";
import { FileIcon, kindFromName, kindLabel } from "./FileIcon";
import { StudyDialog } from "./StudySet";
import { uploadToLibrary, waitUntilRead, type UploadPhase } from "./upload";

type Upload = { key: string; name: string; phase: UploadPhase; progress: number; error?: string };

const SOURCE: Record<string, string> = { telegram: "from Telegram", discord: "from Discord", desktop: "synced from your computer" };

function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function LibraryView({
  botId,
  bot,
  canAdd,
  initialFiles,
  initialUsage,
  initialSets,
}: {
  botId: string;
  bot: { name: string; avatar: AvatarId; color: ColorwayId };
  /** Files can be added here (the Library's storage is set up). */
  canAdd: boolean;
  initialFiles: FileView[];
  initialUsage: { bytes: number; maxBytes: number };
  initialSets: StudySetListItem[];
}) {
  const [files, setFiles] = React.useState(initialFiles);
  const [usage, setUsage] = React.useState(initialUsage);
  const [sets, setSets] = React.useState(initialSets);
  const [uploads, setUploads] = React.useState<Upload[]>([]);
  const [studying, setStudying] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<FileView | null>(null);
  const [removingSet, setRemovingSet] = React.useState<StudySetListItem | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);
  const pickRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(async () => {
    try {
      const [f, s] = await Promise.all([fetch(`/api/bots/${botId}/files`).then((r) => r.json()), fetch(`/api/bots/${botId}/study-sets`).then((r) => r.json())]);
      if (f.files) {
        setFiles(f.files);
        setUsage({ bytes: f.usage.bytes, maxBytes: f.usage.maxBytes });
      }
      if (s.sets) setSets(s.sets);
    } catch {
      /* offline for a moment */
    }
  }, [botId]);

  // Files still being read (from Telegram, the desktop app, or a reload mid-read): keep checking.
  const reading = files.some((f) => f.status === "reading" || f.status === "uploading");
  React.useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [reading, refresh]);

  const add = React.useCallback(
    (picked: File[]) => {
      if (!canAdd) return;
      for (const [n, file] of picked.entries()) {
        const key = `${Date.now()}-${n}-${file.name}`;
        setUploads((u) => [...u, { key, name: file.name, phase: "hashing", progress: 0 }]);
        uploadToLibrary(botId, file, (up) =>
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, phase: up.phase, progress: up.progress ?? x.progress, error: up.error } : x))),
        )
          .then((done) => {
            if (done.status === "ready") toast.success(`${done.name} is in the Library`, { description: `${bot.name} can read it now.` });
            // Read or not, it's in the list now (a file that couldn't be read says why there).
            setUploads((u) => u.filter((x) => x.key !== key));
            void refresh();
          })
          .catch(() => void refresh());
      }
    },
    [bot.name, botId, canAdd, refresh],
  );

  const retry = async (f: FileView) => {
    setFiles((list) => list.map((x) => (x.id === f.id ? { ...x, status: "reading", detail: "Reading…", note: null } : x)));
    try {
      const res = await fetch(`/api/bots/${botId}/files/${f.id}/read`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't try again.");
      const done = await waitUntilRead(botId, f.id, () => {});
      setFiles((list) => list.map((x) => (x.id === f.id ? done : x)));
    } catch (err) {
      toast.error((err as Error).message);
      void refresh();
    }
  };

  const remove = async (f: FileView) => {
    setRemoving(null);
    setFiles((list) => list.filter((x) => x.id !== f.id));
    const res = await fetch(`/api/bots/${botId}/files/${f.id}`, { method: "DELETE" });
    if (!res.ok) toast.error("Couldn't delete it. Try again.");
    else toast(`${f.name} was deleted.`);
    void refresh();
  };

  const removeSet = async (s: StudySetListItem) => {
    setRemovingSet(null);
    setSets((list) => list.filter((x) => x.id !== s.id));
    const res = await fetch(`/api/bots/${botId}/study-sets/${s.id}`, { method: "DELETE" });
    if (!res.ok) toast.error("Couldn't delete it. Try again.");
    void refresh();
  };

  const ask = (text: string) => window.location.assign(`/app/bots/${botId}?ask=${encodeURIComponent(text)}`);
  const due = sets.reduce((n, s) => n + s.due, 0);
  const firstDue = sets.find((s) => s.due > 0);
  const empty = !files.length && !sets.length && !uploads.length;

  return (
    <div
      className="relative flex flex-col gap-9"
      onDragEnter={(e) => {
        if (!canAdd || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => canAdd && e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!canAdd || !e.dataTransfer.files.length) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        add([...e.dataTransfer.files]);
      }}
    >
      {dragging ? (
        <div className="pointer-events-none fixed inset-4 z-40 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-primary bg-primary-soft/85 text-primary backdrop-blur-sm animate-pop">
          <FileUp className="size-12" aria-hidden />
          <div className="font-display text-xl font-semibold">Drop to add to {bot.name}&apos;s Library</div>
        </div>
      ) : null}
      <input
        ref={pickRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) add([...e.target.files]);
          e.target.value = "";
        }}
      />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">Library</h1>
          <p className="mt-1 text-muted-foreground">Files {bot.name} can read, and the flashcards and quizzes it made from them.</p>
        </div>
        {canAdd && !empty ? (
          <Button onClick={() => pickRef.current?.click()}>
            <Upload /> Add files
          </Button>
        ) : null}
      </header>

      {!canAdd ? (
        <div className="rounded-3xl border border-dashed border-border px-6 py-5 text-sm text-muted-foreground">
          Adding files is coming soon here. {bot.name} can already make flashcards and quizzes from what you tell it in the chat.
        </div>
      ) : null}

      {uploads.length ? (
        <ul className="flex flex-col gap-2" aria-label="Uploads">
          {uploads.map((u) => (
            <li key={u.key} className={cn("flex items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 shadow-soft", u.phase === "failed" ? "border-danger/40" : "border-border")}>
              <FileIcon kind={kindFromName(u.name)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{u.name}</div>
                <div className={cn("text-xs", u.phase === "failed" ? "text-danger" : "text-muted-foreground")} role="status">
                  {u.phase === "failed" ? u.error : u.phase === "uploading" ? `Uploading ${Math.round(u.progress * 100)}%` : u.phase === "reading" ? <span className="shimmer-text">Reading it…</span> : "Getting ready…"}
                </div>
                {u.phase === "uploading" ? (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${u.progress * 100}%` }} />
                  </div>
                ) : null}
              </div>
              {u.phase === "failed" ? (
                <Button variant="ghost" size="sm" onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}>
                  Dismiss
                </Button>
              ) : (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {empty ? (
        <EmptyLibrary botId={botId} bot={bot} canAdd={canAdd} onPick={() => pickRef.current?.click()} />
      ) : (
        <>
          {due > 0 && firstDue ? (
            <div className="flex flex-col gap-4 rounded-3xl border border-primary/25 bg-gradient-to-r from-primary-soft/70 to-card px-5 py-4 shadow-soft sm:flex-row sm:items-center">
              <span className="hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground sm:flex">
                <BookOpenCheck className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {due} card{due === 1 ? "" : "s"} to review
                </div>
                <p className="text-sm text-muted-foreground">A few minutes now keeps them from slipping. Start with “{firstDue.title}”.</p>
              </div>
              <Button onClick={() => setStudying(firstDue.id)}>Review now</Button>
            </div>
          ) : null}

          {sets.length ? (
            <section aria-labelledby="study-title">
              <h2 id="study-title" className="mb-3 font-display text-lg font-semibold">
                Study
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {sets.map((s) => (
                  <li key={s.id} className="flex items-center gap-3.5 rounded-3xl border border-border bg-card p-3.5 shadow-soft transition hover:border-primary/30">
                    <span
                      className={cn(
                        "flex size-12 shrink-0 items-center justify-center rounded-2xl text-white",
                        s.kind === "quiz" ? "bg-gradient-to-br from-[#F59E0B] to-[#EF4444]" : "bg-gradient-to-br from-[#8B5CF6] to-[#6366F1]",
                      )}
                      aria-hidden
                    >
                      {s.kind === "quiz" ? <ListChecks className="size-6" /> : <Layers className="size-6" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{s.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {s.kind === "quiz" ? `${s.count} questions` : `${s.count} cards`}
                        {s.kind === "flashcards" && s.due ? <span className="font-semibold text-primary"> · {s.due} due</span> : null}
                        {s.kind === "quiz" && s.lastScore ? ` · last ${s.lastScore.score}/${s.lastScore.total}` : null}
                        {s.sources.length ? ` · ${s.sources[0]}` : ""}
                      </div>
                    </div>
                    <Button size="sm" variant={s.due ? "primary" : "soft"} onClick={() => setStudying(s.id)}>
                      {s.kind === "quiz" ? "Take" : "Study"}
                    </Button>
                    <Dropdown>
                      <DropdownTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`More for ${s.title}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownTrigger>
                      <DropdownContent>
                        <DropdownItem asChild>
                          <a href={`/api/bots/${botId}/study-sets/${s.id}/export`}>
                            <Download /> Export CSV (Anki, Quizlet)
                          </a>
                        </DropdownItem>
                        <DropdownSeparator />
                        <DropdownItem danger onSelect={() => setRemovingSet(s)}>
                          <Trash2 /> Delete
                        </DropdownItem>
                      </DropdownContent>
                    </Dropdown>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="files-title">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <h2 id="files-title" className="font-display text-lg font-semibold">
                Files
              </h2>
              <UsageMeter bytes={usage.bytes} maxBytes={usage.maxBytes} count={files.length} />
            </div>
            {files.length ? (
              <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <FileIcon kind={f.status === "ready" ? f.kind : kindFromName(f.name)} />
                    <div className="min-w-0 flex-1">
                      <a href={`/api/bots/${botId}/files/${f.id}/content`} target="_blank" rel="noreferrer" className="block truncate font-medium hover:text-primary hover:underline">
                        {f.name}
                      </a>
                      <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {f.status === "reading" || f.status === "uploading" ? (
                          <>
                            <LoaderCircle className="size-3 animate-spin" aria-hidden /> <span className="shimmer-text">Reading it…</span>
                          </>
                        ) : f.status === "failed" ? (
                          <span className="flex items-center gap-1 truncate text-danger">
                            <AlertCircle className="size-3 shrink-0" aria-hidden /> {f.note ?? "Couldn't read it."}
                          </span>
                        ) : (
                          <span className="truncate">
                            {kindLabel(f.kind)} · {f.detail} · {shortDate(f.createdAt)}
                            {SOURCE[f.source] ? ` · ${SOURCE[f.source]}` : ""}
                            {f.note ? <span className="text-warning"> · {f.note}</span> : null}
                          </span>
                        )}
                      </div>
                    </div>
                    {f.status === "failed" && f.retry ? (
                      <Button variant="outline" size="sm" onClick={() => void retry(f)}>
                        <RotateCcw /> Try again
                      </Button>
                    ) : null}
                    <Dropdown>
                      <DropdownTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`More for ${f.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownTrigger>
                      <DropdownContent>
                        {f.status === "ready" ? (
                          <>
                            <DropdownItem onSelect={() => ask(`Make flashcards from "${f.name}".`)}>
                              <Layers /> Make flashcards
                            </DropdownItem>
                            <DropdownItem onSelect={() => ask(`Make me a practice quiz on "${f.name}".`)}>
                              <ListChecks /> Make a practice quiz
                            </DropdownItem>
                            <DropdownItem onSelect={() => ask(`Summarize "${f.name}" for me: the main ideas, and what I should know for an exam.`)}>
                              <ScrollText /> Summarize it
                            </DropdownItem>
                            <DropdownSeparator />
                          </>
                        ) : null}
                        <DropdownItem asChild>
                          <a href={`/api/bots/${botId}/files/${f.id}/content`} target="_blank" rel="noreferrer">
                            <ExternalLink /> Open
                          </a>
                        </DropdownItem>
                        <DropdownItem asChild>
                          <a href={`/api/bots/${botId}/files/${f.id}/content?download=1`}>
                            <Download /> Download
                          </a>
                        </DropdownItem>
                        <DropdownSeparator />
                        <DropdownItem danger onSelect={() => setRemoving(f)}>
                          <Trash2 /> Delete
                        </DropdownItem>
                      </DropdownContent>
                    </Dropdown>
                  </li>
                ))}
              </ul>
            ) : (
              <button
                type="button"
                disabled={!canAdd}
                onClick={() => pickRef.current?.click()}
                className="flex w-full flex-col items-center gap-1 rounded-3xl border-2 border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:pointer-events-none"
              >
                <FileUp className="size-6" aria-hidden />
                No files yet. Add the material these came from, so {bot.name} can make more.
              </button>
            )}
          </section>
        </>
      )}

      {studying ? <StudyDialog botId={botId} setId={studying} open onOpenChange={(o) => !o && (setStudying(null), void refresh())} botName={bot.name} onAsk={ask} onChanged={() => void refresh()} /> : null}

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {removing?.name}?</DialogTitle>
            <DialogDescription>{bot.name} won&apos;t be able to read it anymore. Flashcards and quizzes made from it stay.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep it</Button>
            </DialogClose>
            <Button variant="danger" onClick={() => removing && void remove(removing)}>
              <Trash2 /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={removingSet !== null} onOpenChange={(o) => !o && setRemovingSet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{removingSet?.title}”?</DialogTitle>
            <DialogDescription>Its cards and your progress on them go too.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep it</Button>
            </DialogClose>
            <Button variant="danger" onClick={() => removingSet && void removeSet(removingSet)}>
              <Trash2 /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UsageMeter({ bytes, maxBytes, count }: { bytes: number; maxBytes: number; count: number }) {
  const pct = Math.min(1, bytes / maxBytes);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>
        {count} file{count === 1 ? "" : "s"} · {formatBytes(bytes)} of {formatBytes(maxBytes)}
      </span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full rounded-full", pct > 0.9 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.max(pct * 100, bytes ? 3 : 0)}%` }} />
      </span>
    </div>
  );
}

function EmptyLibrary({ botId, bot, canAdd, onPick }: { botId: string; bot: { name: string; avatar: AvatarId; color: ColorwayId }; canAdd: boolean; onPick: () => void }) {
  const ideas = [
    { icon: <ScrollText className="size-4" />, title: "A syllabus", body: "Exam dates, a study plan, what's on each test" },
    { icon: <Layers className="size-4" />, title: "Lecture slides", body: "Flashcards for every term, with the slide it's on" },
    { icon: <ListChecks className="size-4" />, title: "Your notes", body: "A practice quiz, scored, with explanations" },
  ];
  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onPick}
        disabled={!canAdd}
        className="group flex flex-col items-center gap-3 rounded-[2rem] border-2 border-dashed border-primary/30 bg-gradient-to-b from-primary-soft/40 to-card px-6 py-12 text-center transition hover:border-primary/60 disabled:pointer-events-none"
      >
        <Avatar avatar={bot.avatar} color={bot.color} size={96} mood="happy" />
        <div className="font-display text-xl font-semibold">Give {bot.name} your class files</div>
        <p className="max-w-md text-sm text-muted-foreground">
          Syllabi, slides, notes and readings, even photos of handwritten notes. {bot.name} reads them, answers from them, and turns them into flashcards and practice quizzes.
        </p>
        {canAdd ? (
          <span className="mt-1 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_6px_20px_-6px_rgb(109_77_255/0.6)] transition group-hover:bg-primary-hover">
            <Upload className="size-4" aria-hidden /> Choose files
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">{canAdd ? "or drop them here · " : ""}PDF, Word, PowerPoint, text and photos · up to 25 MB each · private to you</span>
      </button>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ideas.map((i) => (
          <li key={i.title} className="rounded-3xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-7 items-center justify-center rounded-xl bg-primary-soft text-primary">{i.icon}</span>
              {i.title}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">{i.body}</p>
          </li>
        ))}
      </ul>
      <p className="mx-auto flex max-w-xl items-start justify-center gap-1.5 text-center text-sm text-muted-foreground">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>
          You can also attach files in the{" "}
          <Link href={`/app/bots/${botId}`} className="font-medium text-primary hover:underline">
            chat
          </Link>{" "}
          or send them to {bot.name} on Discord. With the{" "}
          <Link href="/download" className="font-medium text-primary hover:underline">
            desktop app
          </Link>
          , give it a whole folder that stays in step.
        </span>
      </p>
    </div>
  );
}
