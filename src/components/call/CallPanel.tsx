"use client";
/**
 * Talk to your bot: the call screen. The bot's face reacts (listening, thinking, talking), the
 * transcript fills in as you go, work handed to the bot shows as it runs, and each answer's speed
 * is shown. NVIDIA Parakeet hears and Magpie speaks on our voice server; Nemotron holds the
 * conversation; the bot's own agent does the work.
 */
import * as React from "react";
import { Check, Gauge, LoaderCircle, Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AvatarId, AvatarMood, ColorwayId } from "@/lib/avatars";
import { cn } from "@/lib/utils";
import { useVoiceCall, type CallStatus } from "./useVoiceCall";

const STATUS_TEXT: Record<CallStatus, string> = {
  idle: "",
  starting: "Getting the microphone…",
  connecting: "Calling…",
  listening: "Listening",
  hearing: "Hearing you…",
  thinking: "Thinking…",
  speaking: "Talking",
  ended: "Call ended",
  error: "Couldn't connect",
};

function moodFor(status: CallStatus, working: boolean): AvatarMood {
  if (status === "speaking") return "happy";
  if (status === "thinking") return working ? "working" : "thinking";
  if (status === "listening" || status === "hearing") return working ? "working" : "listening";
  if (status === "error") return "alert";
  return "idle";
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CallPanel({
  bot,
  open,
  onOpenChange,
}: {
  bot: { id: string; name: string; avatar: string; color: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const call = useVoiceCall(bot.id);
  const { status, start, hangUp } = call;
  const live = status !== "idle" && status !== "ended" && status !== "error";
  const working = call.tasks.some((t) => t.state === "started");
  const ring = React.useRef<HTMLDivElement>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const [now, setNow] = React.useState(() => Date.now());

  // Ring the moment the panel opens (once: effects can run twice in development).
  const rang = React.useRef(false);
  React.useEffect(() => {
    if (open && status === "idle" && !rang.current) {
      rang.current = true;
      void start();
    }
  }, [open, status, start]);

  // The ring around the face moves with whoever is talking.
  React.useEffect(() => {
    if (!live) return;
    let raf = 0;
    const tick = () => {
      const level = status === "speaking" ? call.botLevel() : call.callerLevel();
      if (ring.current) ring.current.style.transform = `scale(${1 + Math.min(0.25, level * 0.6)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, status, call]);

  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  React.useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [call.lines.length]);

  const close = (next: boolean) => {
    if (!next && live) hangUp();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent side="bottom" className="sm:w-[min(520px,calc(100vw-24px))]" onInteractOutside={(e) => live && e.preventDefault()}>
        <DialogTitle className="sr-only">Call with {bot.name}</DialogTitle>
        <DialogDescription className="sr-only">A voice call with your bot. Talk naturally; you can cut in at any time.</DialogDescription>
        <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-4">
          <div className="relative flex size-36 items-center justify-center">
            <div
              ref={ring}
              aria-hidden
              className={cn(
                "absolute inset-2 rounded-full transition-[background-color] duration-300",
                status === "speaking" ? "bg-primary/20" : status === "hearing" ? "bg-success/20" : live ? "bg-muted" : "bg-transparent",
              )}
            />
            <Avatar avatar={bot.avatar as AvatarId} color={bot.color as ColorwayId} size={112} mood={moodFor(status, working)} />
          </div>
          <div className="text-center">
            <div className="font-display text-xl font-bold">{bot.name}</div>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              {status === "connecting" || status === "starting" || status === "thinking" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              <span>{STATUS_TEXT[status]}</span>
              {live && call.startedAt ? <span className="tabular-nums">· {clock(now - call.startedAt)}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {call.latency !== null ? (
              <Badge tone="success" title="From when you stopped talking to the first word back">
                <Gauge /> Answered in {(call.latency / 1000).toFixed(1)} s
              </Badge>
            ) : null}
            <Badge tone="outline" title="Heard by NVIDIA Parakeet, spoken by NVIDIA Magpie, on our voice server">
              NVIDIA Parakeet + Magpie
            </Badge>
            {call.info?.talker?.includes("Nemotron") ? <Badge tone="outline">Nemotron 3.5 Lightning</Badge> : null}
          </div>
        </div>

        <div ref={scroller} className="mx-4 max-h-[34dvh] min-h-24 overflow-y-auto rounded-2xl bg-muted/50 px-4 py-3 text-sm" aria-label="Transcript">
          {call.lines.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">{live ? "Say hi. You can talk over it any time." : call.error ?? "The transcript shows here."}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {call.lines.map((l) => (
                <li key={l.id} className={cn("max-w-[85%] rounded-2xl px-3 py-1.5", l.role === "caller" ? "self-end bg-primary text-primary-foreground" : "self-start bg-card")}>
                  {l.text}
                  {l.cut ? <span className="ml-1 text-xs opacity-70">(you cut in)</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {call.tasks.length ? (
          <ul className="mx-4 mt-3 flex flex-col gap-1.5 text-sm" aria-label="Work in progress">
            {call.tasks.slice(-3).map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded-xl border border-border px-3 py-2">
                {t.state === "started" ? (
                  <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                ) : t.state === "done" ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-danger" />
                )}
                <span className="min-w-0">
                  <span className="font-medium">{t.request}</span>
                  {t.result ? <span className="block truncate text-muted-foreground">{t.result}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center justify-center gap-4 px-6 pt-5 pb-6">
          {live ? (
            <>
              <Button variant={call.muted ? "secondary" : "outline"} size="icon" className="size-14" onClick={call.toggleMute} aria-label={call.muted ? "Unmute" : "Mute"} aria-pressed={call.muted}>
                {call.muted ? <MicOff /> : <Mic />}
              </Button>
              <Button variant="danger" size="icon" className="size-14" onClick={() => close(false)} aria-label="Hang up">
                <PhoneOff />
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" onClick={() => void start()}>
                <Phone /> {status === "ended" ? "Call again" : "Try again"}
              </Button>
              <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </>
          )}
        </div>
        {status === "error" && call.error ? <p className="-mt-3 px-6 pb-5 text-center text-sm text-danger">{call.error}</p> : null}
        <p className="border-t border-border px-6 py-3 text-center text-xs text-muted-foreground">
          Audio isn&apos;t kept. The transcript is saved to this chat. Calls use credit at cost.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** The header's Call button. */
export function CallButton({ bot, disabled }: { bot: { id: string; name: string; avatar: string; color: string }; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="soft" size="md" onClick={() => setOpen(true)} disabled={disabled} className="shrink-0" aria-label={`Call ${bot.name}`}>
        <Phone />
        <span className="hidden sm:inline">Call</span>
      </Button>
      {open ? <CallPanel bot={bot} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
