"use client";
/**
 * The meeting buddy: the owner's bot, small, at the very bottom of the screen.
 * It peeks up to ask "Want me to take notes?", then stays there with a red dot
 * and a timer the whole time it listens, so it's never recording out of sight.
 *
 * Three surfaces share it:
 *  - "screen": the desktop app's transparent always-on-top window (/desktop/buddy)
 *  - "page":   fixed to the bottom of a web page (the browser recorder)
 *  - "pip":    inside a Document Picture-in-Picture window that floats over other apps
 */
import * as React from "react";
import { AlertTriangle, Check, Copy, ExternalLink, Mic, Pause, Play, Square, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import type { AvatarMood } from "@/lib/avatars";
import { cn } from "@/lib/utils";
import type { BuddyAction, BuddyPhase, BuddyState } from "./desktop-api";

export type BuddyVariant = "screen" | "page" | "pip";

export type BuddyProps = BuddyState & {
  variant: BuddyVariant;
  onAction?: (action: BuddyAction) => void;
  /** The pointer is over something clickable (desktop click-through). */
  onInteractive?: (on: boolean) => void;
  onCopy?: (text: string) => void;
  className?: string;
};

const MOOD: Record<BuddyPhase, AvatarMood> = {
  asking: "happy",
  listening: "listening",
  paused: "sleeping",
  saving: "thinking",
  done: "happy",
  error: "alert",
};

export const DEFAULT_CONSENT_NOTE = "Heads-up: I'm using my AI assistant to take notes on this call (a transcript and a summary). Let me know if you'd rather I didn't.";

/** The heads-up with the bot's name in it (always says it's an AI). */
export function consentNoteFor(botName: string): string {
  return `Heads-up: I'm using my AI assistant ${botName} to take notes on this call (a transcript and a summary). Let me know if you'd rather I didn't.`;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function useNow(active: boolean, every = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

/** Recording time: what came before, plus the current stretch. */
export function useElapsed(elapsedMs = 0, runningSince?: number | null): number {
  const now = useNow(Boolean(runningSince));
  return elapsedMs + (runningSince ? Math.max(0, now - runningSince) : 0);
}

function Level({ level = 0, className }: { level?: number; className?: string }) {
  const bars = [0.55, 1, 0.75, 0.4];
  return (
    <span className={cn("flex h-4 items-center gap-[3px]", className)} aria-hidden>
      {bars.map((k, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-danger transition-[height] duration-100 ease-out"
          style={{ height: `${Math.round(4 + Math.min(1, level * 1.6) * k * 12)}px` }}
        />
      ))}
    </span>
  );
}

function IconButton({ label, onClick, children, tone = "neutral" }: { label: string; onClick?: () => void; children: React.ReactNode; tone?: "neutral" | "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        tone === "danger" ? "bg-danger text-white hover:brightness-110" : "bg-muted text-foreground hover:bg-border",
      )}
    >
      {children}
    </button>
  );
}

/** A standing note above the bot (persistent, unlike the caption). */
function NoticeChip({ text, className }: { text: string; className?: string }) {
  return (
    <p
      title={text}
      className={cn(
        "pointer-events-none flex max-w-[min(360px,100%)] items-start gap-1.5 rounded-2xl border border-warning/30 bg-card px-3 py-1.5 text-xs leading-snug text-foreground shadow-soft",
        className,
      )}
    >
      <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
      <span className="line-clamp-2">{text}</span>
    </p>
  );
}

function CopyNote({ note, onCopy }: { note: string; onCopy?: (text: string) => void }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
      onClick={() => {
        if (onCopy) onCopy(note);
        else void navigator.clipboard?.writeText(note).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : "Copy a heads-up"}
    </button>
  );
}

export function Buddy(props: BuddyProps) {
  const { variant, phase, bot, app, level, caption, message, minutesLeft, onAction, onInteractive, onCopy, className } = props;
  // A standing note while listening (not a transcript line), e.g. "I can only hear your mic here".
  const notice = (phase === "listening" || phase === "paused") && props.notice ? props.notice : null;
  const elapsed = useElapsed(props.elapsedMs, phase === "listening" ? props.runningSince : null);
  const [hover, setHover] = React.useState(false);
  // "Stop and delete" takes a second tap, so nothing is thrown away by accident.
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  React.useEffect(() => {
    if (!confirmDiscard) return;
    const t = setTimeout(() => setConfirmDiscard(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDiscard]);
  const now = useNow(Boolean(caption) && phase === "listening", 1000);
  const showCaption = Boolean(caption && phase === "listening" && now - caption.at < 7000);
  const act = (a: BuddyAction) => onAction?.(a);
  const enter = () => {
    setHover(true);
    onInteractive?.(true);
  };
  const leave = () => {
    setHover(false);
    onInteractive?.(false);
  };
  const recording = phase === "listening" || phase === "paused";
  const controlsAlways = variant !== "screen";
  const appName = app && app.id !== "other" && app.id !== "browser" ? app.name : null;
  const announce =
    phase === "asking"
      ? `${bot.name} asks: want me to take notes?`
      : phase === "listening"
        ? `${bot.name} is taking notes`
        : phase === "paused"
          ? `${bot.name} paused taking notes`
          : phase === "saving"
            ? `${bot.name} is writing your notes`
            : phase === "done"
              ? `${bot.name}: your notes are ready`
              : `${bot.name}: ${message ?? "something went wrong"}`;

  const bubble =
    phase === "asking" ? (
      <div className="w-full">
        <p className="font-display text-[17px] leading-snug font-bold">Want me to take notes?</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {appName ? `Looks like you're on a ${appName} call.` : "Looks like you're in a meeting."} I'll write down what's said and send you the notes when it ends.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            autoFocus={variant !== "screen"}
            onClick={() => act("take")}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[0_6px_20px_-6px_rgb(109_77_255/0.6)] transition hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Mic className="size-4" /> Take notes
          </button>
          <button
            type="button"
            onClick={() => act("dismiss")}
            className="inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            Not now
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-2.5 text-xs text-muted-foreground">
          <span>
            Only if everyone's OK with it. <CopyNote note={props.consentNote ?? consentNoteFor(bot.name)} onCopy={onCopy} />
          </span>
          {appName ? (
            <button type="button" onClick={() => act("never")} className="hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary">
              Don&apos;t ask in {appName}
            </button>
          ) : null}
        </div>
        {typeof minutesLeft === "number" && minutesLeft < 30 ? (
          <p className="mt-2 text-xs font-medium text-warning">{minutesLeft > 0 ? `${minutesLeft} min of meeting notes left this month.` : "No meeting minutes left this month."}</p>
        ) : null}
      </div>
    ) : phase === "saving" ? (
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-pulse rounded-full bg-primary" style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </span>
        Writing your notes…
      </p>
    ) : phase === "done" ? (
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-bold">Your notes are ready!</p>
          {message ? <p className="truncate text-xs text-muted-foreground">{message}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => act("open")}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Open <ExternalLink className="size-3.5" />
        </button>
        {variant === "screen" ? (
          <IconButton label="Hide" onClick={() => act("hide")}>
            <X className="size-4" />
          </IconButton>
        ) : null}
      </div>
    ) : phase === "error" ? (
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-sm">{message ?? "Something went wrong."}</p>
        <IconButton label="Open the app" onClick={() => act("open")}>
          <ExternalLink className="size-4" />
        </IconButton>
        {variant === "screen" ? (
          <IconButton label="Hide" onClick={() => act("hide")}>
            <X className="size-4" />
          </IconButton>
        ) : null}
      </div>
    ) : showCaption && caption ? (
      <p className="line-clamp-2 text-sm leading-snug">
        <span className="font-semibold">{caption.speaker}: </span>
        <span className="text-muted-foreground">{caption.text}</span>
      </p>
    ) : null;

  const pill = recording ? (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-card/95 py-1.5 pr-1.5 pl-3 shadow-soft backdrop-blur",
        variant === "pip" && "bg-card",
      )}
    >
      {phase === "listening" ? (
        <span className="relative flex size-2.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-danger" />
        </span>
      ) : (
        <Pause className="size-3.5 text-muted-foreground" aria-hidden />
      )}
      <span className="font-mono text-sm font-semibold tabular-nums">{formatClock(elapsed)}</span>
      {phase === "listening" ? <Level level={level} /> : <span className="text-xs font-semibold text-muted-foreground">Paused</span>}
      <span
        className={cn(
          "flex items-center gap-1 overflow-hidden transition-all duration-200",
          controlsAlways || hover ? "ml-1 max-w-56 opacity-100" : "max-w-0 opacity-0",
        )}
      >
        {phase === "listening" ? (
          <IconButton label="Pause" onClick={() => act("pause")}>
            <Pause className="size-4" />
          </IconButton>
        ) : (
          <IconButton label="Resume" onClick={() => act("resume")}>
            <Play className="size-4" />
          </IconButton>
        )}
        <IconButton label="Stop and write notes" tone="danger" onClick={() => act("stop")}>
          <Square className="size-3.5 fill-current" />
        </IconButton>
        {confirmDiscard ? (
          <button
            type="button"
            onClick={() => act("discard")}
            className="h-8 shrink-0 rounded-full bg-danger-soft px-3 text-xs font-semibold whitespace-nowrap text-danger hover:brightness-95 focus-visible:outline-2 focus-visible:outline-primary"
          >
            Delete it all?
          </button>
        ) : (
          <IconButton label="Stop and delete everything" onClick={() => setConfirmDiscard(true)}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </span>
    </div>
  ) : null;

  const live = (
    <span role="status" aria-live="polite" className="sr-only">
      {notice ? `${announce}. ${notice}` : announce}
    </span>
  );

  if (variant === "pip") {
    return (
      <div className={cn("flex h-full w-full flex-col justify-center gap-2 bg-background p-3 text-foreground", className)}>
        {live}
        <div className="flex items-center gap-3">
          <Avatar avatar={bot.avatar} color={bot.color} mood={MOOD[phase]} size={76} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-bold">{bot.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {phase === "listening" ? "Taking notes" : phase === "paused" ? "Not listening right now" : phase === "saving" ? "Writing your notes…" : phase === "done" ? "Notes are ready" : phase === "asking" ? "Ready when you are" : "Needs a look"}
              {appName ? ` · ${appName}` : ""}
            </p>
            {notice ? (
              <p className="mt-0.5 flex items-start gap-1 text-xs leading-snug text-warning" title={notice}>
                <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                <span className="line-clamp-2 text-foreground/80">{notice}</span>
              </p>
            ) : null}
            <div className="mt-1.5">{pill}</div>
          </div>
        </div>
        {bubble && phase !== "asking" ? <div className="rounded-2xl border border-border bg-card px-3 py-2">{bubble}</div> : null}
      </div>
    );
  }

  if (variant === "page") {
    // On a web page: the bot, its pill right beside it and the bubble above, centered as one
    // group so it fits a narrow window too. The bubble's tail points at the bot.
    return (
      <div className={cn("pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3", className)}>
        {live}
        <div className="flex max-w-full min-w-0 flex-col items-start">
          {bubble ? (
            <div
              key={phase}
              className={cn(
                "pointer-events-auto relative mb-1 animate-bubble rounded-3xl border border-border bg-card px-4 py-3 text-foreground shadow-lift",
                phase === "asking" ? "w-[min(400px,100%)]" : "max-w-[min(360px,100%)]",
              )}
            >
              {bubble}
              <span
                aria-hidden
                className="absolute -bottom-[7px] left-[29px] size-3.5 rotate-45 rounded-[3px] border-r border-b border-border bg-card sm:left-[37px]"
              />
            </div>
          ) : null}
          {notice ? <NoticeChip text={notice} className="mb-1" /> : null}
          <div className="flex items-end gap-1">
            <button
              type="button"
              onClick={() => act(phase === "asking" ? "take" : "open")}
              aria-label={phase === "asking" ? `${bot.name}: take notes` : `Show ${bot.name}'s notes`}
              className="pointer-events-auto shrink-0 animate-peek rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              style={{ marginBottom: "-14px" }}
            >
              <Avatar avatar={bot.avatar} color={bot.color} mood={MOOD[phase]} size={88} className="h-auto w-[72px] sm:w-[88px]" />
            </button>
            {pill ? <div className="pointer-events-auto mb-4 sm:mb-6">{pill}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  const peek = 16;
  return (
    <div
      className={cn(
        "pointer-events-none flex flex-col items-center justify-end",
        variant === "screen" ? "fixed inset-0 overflow-hidden px-3" : "fixed inset-x-0 bottom-0 z-50 px-3",
        className,
      )}
    >
      {live}
      {bubble ? (
        <div
          key={phase}
          data-buddy-interactive=""
          onPointerEnter={enter}
          onPointerLeave={leave}
          className={cn(
            "pointer-events-auto relative mb-1 animate-bubble rounded-3xl border border-border bg-card px-4 py-3 text-foreground shadow-lift",
            phase === "asking" ? "w-[min(400px,100%)]" : "max-w-[min(360px,100%)]",
          )}
        >
          {bubble}
          {notice ? null : (
            <span aria-hidden className="absolute -bottom-[7px] left-1/2 size-3.5 -translate-x-1/2 rotate-45 rounded-[3px] border-r border-b border-border bg-card" />
          )}
        </div>
      ) : null}
      {notice ? <NoticeChip text={notice} className="mb-1.5" /> : null}
      <div className="relative flex items-end">
        <button
          type="button"
          data-buddy-interactive=""
          onPointerEnter={enter}
          onPointerLeave={leave}
          onClick={() => act(phase === "asking" ? "take" : "open")}
          aria-label={phase === "asking" ? `${bot.name}: take notes` : `Open ${bot.name}'s notes`}
          className="pointer-events-auto animate-peek rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          style={{ marginBottom: `-${peek}px` }}
        >
          <Avatar avatar={bot.avatar} color={bot.color} mood={MOOD[phase]} size={phase === "asking" ? 104 : 88} />
        </button>
        {pill ? (
          <div data-buddy-interactive="" className="pointer-events-auto absolute bottom-6 left-full ml-1" onPointerEnter={enter} onPointerLeave={leave}>
            {pill}
          </div>
        ) : null}
      </div>
    </div>
  );
}
