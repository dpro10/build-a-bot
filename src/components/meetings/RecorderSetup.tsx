"use client";
/**
 * Before the browser recorder starts: a one-time "before I take notes on calls" sheet,
 * then the start sheet (where the meeting is, sharing the call's tab, the heads-up).
 * Nothing is captured until the owner presses Start.
 */
import * as React from "react";
import { AlertTriangle, AppWindow, Check, CircleCheck, Copy, MonitorUp, RefreshCw, Users } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import type { MeetingAppId } from "@/lib/meetings/apps";
import { BROWSER_CALL_APPS, meetingAppName } from "./shared";

export type BotFace = { name: string; avatar: AvatarId; color: ColorwayId };

export type ShareState =
  | { state: "none" }
  | { state: "asking" }
  | { state: "ok"; stream: MediaStream; surface: string | null }
  | { state: "no-audio" }
  | { state: "cancelled" }
  | { state: "ended" }
  | { state: "error"; message: string };

export type MeetingMode = "call" | "inperson";

export function ConsentSheet({ open, onOpenChange, bot, onAccept }: { open: boolean; onOpenChange: (open: boolean) => void; bot: BotFace; onAccept: () => void }) {
  const [checked, setChecked] = React.useState(false);
  const id = React.useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="bottom" aria-describedby={`${id}-desc`}>
        <DialogHeader className="items-center pr-6 text-center sm:pr-12">
          <span className="flex size-24 items-center justify-center rounded-full bg-primary-soft">
            <Avatar avatar={bot.avatar} color={bot.color} mood="listening" size={88} title={bot.name} />
          </span>
          <DialogTitle className="mt-2">Before I take notes on calls</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 text-[15px] leading-relaxed">
          <p id={`${id}-desc`}>
            Some places, like California, Florida, Illinois, Pennsylvania and Washington, require <strong>everyone</strong> on a call to agree to
            being recorded. I&apos;ll help you tell them.
          </p>
          <p className="text-muted-foreground">
            I only listen while I&apos;m on your screen. I delete the audio once your notes are written, and I never use your meetings to train AI.
          </p>
          <label
            htmlFor={`${id}-ok`}
            className={cn(
              "mt-1 flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 text-sm font-medium transition",
              checked ? "border-primary/40 bg-primary-soft/50" : "border-border bg-background-2 hover:border-primary/30",
            )}
          >
            <input
              id={`${id}-ok`}
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-[var(--primary)]"
            />
            I&apos;ll let people know when I&apos;m using {bot.name} to take notes.
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button disabled={!checked} onClick={onAccept}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeCard({
  selected,
  onSelect,
  icon,
  title,
  sub,
  disabled,
  tabIndex,
  onKeyDown,
  refEl,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
  disabled?: boolean;
  tabIndex: number;
  onKeyDown: (e: React.KeyboardEvent) => void;
  refEl: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={refEl}
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        "flex min-w-0 flex-1 items-start gap-3 rounded-2xl border p-3.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50",
        selected ? "border-primary bg-primary-soft/50 ring-1 ring-primary" : "border-border bg-card hover:border-primary/40",
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs leading-snug text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          done ? "bg-success text-success-foreground" : "bg-primary-soft text-primary",
        )}
        aria-hidden
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  );
}

export function StartSheet({
  open,
  onOpenChange,
  bot,
  mode,
  onMode,
  canShare,
  share,
  onShare,
  app,
  onApp,
  note,
  noticeCopied,
  onCopyNotice,
  onStart,
  starting,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot: BotFace;
  mode: MeetingMode;
  onMode: (m: MeetingMode) => void;
  canShare: boolean;
  share: ShareState;
  onShare: () => void;
  app: MeetingAppId;
  onApp: (a: MeetingAppId) => void;
  note: string;
  noticeCopied: boolean;
  onCopyNotice: () => void;
  /** Must open the floating window synchronously: it's called straight from the click. */
  onStart: (opts: { micOnly?: boolean }) => void;
  starting: boolean;
  error: React.ReactNode;
}) {
  const id = React.useId();
  const radios = React.useRef<(HTMLButtonElement | null)[]>([]);
  const modes: MeetingMode[] = ["call", "inperson"];
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const j = (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + modes.length) % modes.length;
    onMode(modes[j]);
    radios.current[j]?.focus();
  };
  const shared = share.state === "ok";
  const callReady = mode === "inperson" || shared;

  return (
    <Dialog open={open} onOpenChange={(o) => (!starting ? onOpenChange(o) : undefined)}>
      <DialogContent side="bottom" aria-describedby={`${id}-desc`}>
        <DialogHeader>
          <DialogTitle>Take notes in this browser</DialogTitle>
          <DialogDescription id={`${id}-desc`}>
            {bot.name} floats over your other windows while it listens. Close it, or press stop, and your notes get written.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <div>
            <div id={`${id}-where`} className="mb-2 text-sm font-semibold">
              Where&apos;s the meeting?
            </div>
            <div role="radiogroup" aria-labelledby={`${id}-where`} className="flex flex-col gap-2 sm:flex-row">
              <ModeCard
                refEl={(el) => {
                  radios.current[0] = el;
                }}
                selected={mode === "call"}
                onSelect={() => onMode("call")}
                tabIndex={mode === "call" ? 0 : -1}
                onKeyDown={(e) => onKey(e, 0)}
                icon={<AppWindow className="size-[18px]" aria-hidden />}
                title="A call in another tab"
                sub="Google Meet, Teams or Zoom on the web"
              />
              <ModeCard
                refEl={(el) => {
                  radios.current[1] = el;
                }}
                selected={mode === "inperson"}
                onSelect={() => onMode("inperson")}
                tabIndex={mode === "inperson" ? 0 : -1}
                onKeyDown={(e) => onKey(e, 1)}
                icon={<Users className="size-[18px]" aria-hidden />}
                title="In person, or on speaker"
                sub="One microphone hears the whole room"
              />
            </div>
          </div>

          <ol className="flex flex-col gap-4">
            {mode === "call" ? (
              <Step n={1} title="Share the call's tab" done={shared}>
                {!canShare ? (
                  <p className="text-sm text-muted-foreground">
                    This browser can&apos;t share a tab&apos;s sound. Use Chrome or Edge, pick &ldquo;In person&rdquo; for a call on speaker, or use the desktop
                    app.
                  </p>
                ) : shared ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
                      <CircleCheck className="size-4" aria-hidden />
                      {share.surface === "monitor" ? "Sharing your computer's sound" : "Sharing the call's sound"}
                    </span>
                    <button type="button" onClick={onShare} className="text-sm font-semibold text-primary hover:underline">
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-sm text-muted-foreground">
                      Your browser asks which tab to share. Pick the call, and keep <span className="font-medium text-foreground">Also share tab audio</span> on.
                    </p>
                    {share.state === "no-audio" ? (
                      <p className="flex gap-1.5 text-sm text-warning">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        That share had no sound. Pick the call&apos;s tab, with tab audio on.
                      </p>
                    ) : share.state === "ended" ? (
                      <p className="text-sm text-warning">You stopped sharing. Share the call&apos;s tab again to include everyone.</p>
                    ) : share.state === "error" ? (
                      <p className="text-sm text-warning">{share.message}</p>
                    ) : null}
                    <Button variant="soft" onClick={onShare} loading={share.state === "asking"}>
                      {share.state === "asking" ? null : share.state === "no-audio" || share.state === "ended" ? <RefreshCw /> : <MonitorUp />}
                      {share.state === "no-audio" || share.state === "ended" ? "Try again" : "Share the call's tab"}
                    </Button>
                  </div>
                )}
                <label htmlFor={`${id}-app`} className="mt-3 mb-1 block text-xs font-medium text-muted-foreground">
                  Which app? (optional)
                </label>
                <Select id={`${id}-app`} size="sm" value={app} onChange={(e) => onApp(e.target.value as MeetingAppId)} className="max-w-60">
                  <option value="browser">Not sure</option>
                  {BROWSER_CALL_APPS.filter((a) => a !== "other").map((a) => (
                    <option key={a} value={a}>
                      {meetingAppName(a)}
                    </option>
                  ))}
                </Select>
              </Step>
            ) : null}
            <Step n={mode === "call" ? 2 : 1} title="Let everyone know" done={noticeCopied}>
              <p className="text-sm text-muted-foreground">
                {mode === "call" ? "Paste this in the call's chat, or say it out loud." : "Say it out loud, or send it before you start."} Some places require everyone&apos;s OK.
              </p>
              <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-border bg-background-2 p-3 sm:flex-row sm:items-start">
                <p className="min-w-0 flex-1 text-sm leading-relaxed">{note}</p>
                <Button variant={noticeCopied ? "ghost" : "outline"} size="sm" onClick={onCopyNotice} className="self-start">
                  {noticeCopied ? <Check /> : <Copy />}
                  {noticeCopied ? "Copied" : "Copy"}
                </Button>
              </div>
            </Step>
          </ol>

          {error ? (
            <p role="alert" className="flex gap-2 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter className="flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center">
          {mode === "call" && !shared ? (
            <Button variant="ghost" onClick={() => onStart({ micOnly: true })} disabled={starting} className="sm:mr-auto">
              Start with only your side
            </Button>
          ) : null}
          <Button size="lg" onClick={() => onStart({})} loading={starting} disabled={!callReady && !starting}>
            {starting ? "Starting…" : "Start taking notes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
