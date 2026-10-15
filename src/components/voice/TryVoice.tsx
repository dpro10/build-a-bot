"use client";
/**
 * Voice typing, right on the Voice typing page: hold the mic button (or click it to keep
 * listening, and click again to finish), talk, and what you meant is typed into the box at your
 * cursor. "Hey {bot}, …" asks your bot instead. The same cleanup and dictionary as the desktop app,
 * so you can see what it does before installing anything.
 */
import * as React from "react";
import Link from "next/link";
import { AlertCircle, Loader2, Mic, Sparkles, Square } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { pickMime } from "@/components/meetings/recorder-engine";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { cn } from "@/lib/utils";

type Bot = { id: string; name: string; avatar: AvatarId; color: ColorwayId };
type Usage = { words: number; limit: number | null };
type Phase = "idle" | "starting" | "listening" | "working" | "asking";

/** Above this loudness counts as speech (the browser's own gain control is on). */
const SPEECH_RMS = 0.012;
/** Held at least this long: let go to type. Shorter: it's a click, and it keeps listening. */
const HOLD_MS = 300;
const MAX_MS = 10 * 60_000;

function uploadType(mime: string | undefined): string {
  const t = (mime || "audio/webm").split(";")[0].trim().toLowerCase();
  if (t.startsWith("audio/")) return t;
  return t.includes("mp4") ? "audio/mp4" : t.includes("ogg") ? "audio/ogg" : "audio/webm";
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Recording = {
  stream: MediaStream;
  mr: MediaRecorder;
  chunks: Blob[];
  t0: number;
  speechMs: number;
  ctx: AudioContext;
  analyser: AnalyserNode;
  timer: number;
  mime: string;
};

export function TryVoice({
  bots,
  available,
  simulated,
  initialUsage,
  paidPlans,
}: {
  bots: Bot[];
  available: boolean;
  /** Demo mode without speech-to-text: it types sample sentences. */
  simulated: boolean;
  initialUsage: Usage;
  paidPlans: boolean;
}) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [handsfree, setHandsfree] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [levels, setLevels] = React.useState<number[]>(() => new Array(18).fill(0));
  const [text, setText] = React.useState("");
  const [compare, setCompare] = React.useState<{ heard: string; typed: string; polished: boolean } | null>(null);
  const [reply, setReply] = React.useState<{ bot: Bot; command: string; text: string; label: string | null; done: boolean; approvals?: number } | null>(null);
  const [problem, setProblem] = React.useState<{ message: string; upgrade?: boolean } | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [usage, setUsage] = React.useState<Usage>(initialUsage);
  const [polish, setPolish] = React.useState(true);
  const [commands, setCommands] = React.useState(true);
  const rec = React.useRef<Recording | null>(null);
  const press = React.useRef<{ at: number; stopWhenReady: boolean } | null>(null);
  const box = React.useRef<HTMLTextAreaElement>(null);
  const demoCommand = React.useRef(false);
  const bot = bots[0] ?? null;

  const release = React.useCallback((r: Recording) => {
    window.clearInterval(r.timer);
    for (const t of r.stream.getTracks()) t.stop();
    void r.ctx.close().catch(() => {});
    setLevels(new Array(18).fill(0));
  }, []);

  React.useEffect(
    () => () => {
      if (rec.current) release(rec.current);
    },
    [release],
  );

  function insertAtCursor(words: string) {
    const el = box.current;
    // What's in the box now: it may have been typed into while the words were on their way.
    const current = el?.value ?? text;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const gap = before && !/\s$/.test(before) && !/^[,.!?;:]/.test(words) ? " " : "";
    const next = `${before}${gap}${words}${after}`;
    setText(next);
    requestAnimationFrame(() => {
      const pos = before.length + gap.length + words.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  async function start() {
    if (rec.current || phase === "starting" || phase === "working") return;
    setProblem(null);
    setNote(null);
    setReply((r) => (r?.done ? null : r));
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      setPhase("idle");
      const name = (err as Error)?.name;
      setProblem({
        message:
          name === "NotAllowedError"
            ? "Your browser didn't allow the microphone. Allow it for this site (the icon in the address bar), then try again."
            : name === "NotFoundError"
              ? "I can't find a microphone. Plug one in and try again."
              : "I couldn't use the microphone. Try again in a moment.",
      });
      press.current = null;
      return;
    }
    const mime = pickMime();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const r: Recording = { stream, mr, chunks, t0: performance.now(), speechMs: 0, ctx, analyser, timer: 0, mime: uploadType(mr.mimeType || mime) };
    r.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (rms >= SPEECH_RMS) r.speechMs += 60;
      const level = rms > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(rms) + 56) / 44)) : 0;
      setLevels((l) => [...l.slice(1), level]);
      const ms = performance.now() - r.t0;
      setElapsed(ms);
      if (ms > MAX_MS) void stop();
    }, 60);
    mr.start(250);
    rec.current = r;
    setElapsed(0);
    setPhase("listening");
    if (press.current?.stopWhenReady) void stop();
  }

  async function stop() {
    const r = rec.current;
    if (!r) {
      if (press.current) press.current.stopWhenReady = true;
      return;
    }
    rec.current = null;
    press.current = null;
    setHandsfree(false);
    await new Promise<void>((resolve) => {
      r.mr.onstop = () => resolve();
      try {
        r.mr.stop();
      } catch {
        resolve();
      }
    });
    release(r);
    const durationMs = Math.round(performance.now() - r.t0);
    const blob = new Blob(r.chunks, { type: r.mime });
    if (durationMs < 300 || !blob.size) {
      setPhase("idle");
      setNote("Didn't catch that. Hold the button while you talk.");
      return;
    }
    setPhase("working");
    const q = new URLSearchParams({
      durationMs: String(durationMs),
      speechMs: String(r.speechMs),
      category: "other",
      polish: polish ? "1" : "0",
      commands: commands ? "1" : "0",
      styles: "1",
    });
    if (simulated && demoCommand.current) {
      // The demo hears "Hey {bot}, …" whatever the room sounded like.
      q.set("demo", "command");
      q.delete("speechMs");
    }
    demoCommand.current = false;
    let body: Record<string, unknown> & { kind?: string; error?: string; code?: string; usage?: Usage };
    let ok = false;
    try {
      const res = await fetch(`/api/voice/dictate?${q}`, { method: "POST", headers: { "content-type": r.mime }, body: blob });
      ok = res.ok;
      body = await res.json().catch(() => ({}));
    } catch {
      setPhase("idle");
      setProblem({ message: "I can't reach Build-a-bot. Check your internet and try again." });
      return;
    }
    if (!ok) {
      setPhase("idle");
      setProblem({ message: String(body.error ?? "Something went wrong. Try again."), upgrade: body.code === "limit" });
      return;
    }
    if (body.usage) setUsage(body.usage);
    if (body.kind === "empty") {
      setPhase("idle");
      setNote("Didn't catch that. Try again a little closer to the mic.");
      return;
    }
    if (body.kind === "command") {
      const target = bots.find((b) => b.id === (body.bot as { id: string })?.id) ?? bot;
      if (!target) return setPhase("idle");
      await ask(target, String(body.command ?? ""));
      return;
    }
    const typed = String(body.text ?? "");
    insertAtCursor(typed);
    setCompare({ heard: String(body.heard ?? ""), typed, polished: Boolean(body.polished) });
    setPhase("idle");
  }

  async function ask(target: Bot, command: string) {
    if (!command) {
      setReply({ bot: target, command: "", text: `Hi! Say “Hey ${target.name}” and what you need, in one go.`, label: null, done: true });
      setPhase("idle");
      return;
    }
    setPhase("asking");
    setReply({ bot: target, command, text: "", label: `${target.name} is thinking…`, done: false });
    setCompare(null);
    let full = "";
    let approvals = 0;
    try {
      const res = await fetch("/api/voice/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ botId: target.id, text: command }) });
      if (!res.ok || !res.body) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "That didn't work.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
          buf = buf.slice(i + 2);
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "text") {
            full += ev.delta;
            setReply((r) => (r ? { ...r, text: full, label: null } : r));
          } else if (ev.type === "tool" && ev.state === "running") setReply((r) => (r ? { ...r, label: ev.title ? `${ev.title}…` : `${target.name} is working…` } : r));
          else if (ev.type === "approval") approvals++;
          else if (ev.type === "done") full = ev.text || full;
          else if (ev.type === "error") full = ev.message || full;
        }
      }
      setReply({ bot: target, command, text: full || "Done.", label: null, done: true, approvals });
    } catch (err) {
      setReply(null);
      setProblem({ message: (err as Error).message || "That didn't work." });
    }
    setPhase("idle");
  }

  // Hold to talk, or click to keep listening (and click again to finish).
  function onDown() {
    if (phase === "listening" && handsfree) {
      void stop();
      return;
    }
    if (phase !== "idle") return;
    press.current = { at: performance.now(), stopWhenReady: false };
    void start();
  }

  function onUp() {
    const p = press.current;
    if (!p) return;
    if (performance.now() - p.at < HOLD_MS) {
      // A click: keep listening until the next click.
      press.current = null;
      setHandsfree(true);
      return;
    }
    void stop();
  }

  const busy = phase === "working" || phase === "asking" || phase === "starting";
  const listening = phase === "listening";

  if (!available) {
    return (
      <div className="rounded-3xl border border-border bg-card p-6 text-center shadow-soft">
        <p className="font-semibold">Voice typing is coming soon.</p>
        <p className="mt-1 text-sm text-muted-foreground">It needs speech-to-text, which isn't set up on this server yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
      <div className="p-5 sm:p-6">
        <label htmlFor="voice-try" className="text-sm font-semibold">
          Try it here
        </label>
        <textarea
          id="voice-try"
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Your words land here, at the cursor. Hold the mic and say something like: “Um, let's meet at two, no wait, three tomorrow.”"
          className="mt-2 w-full resize-y rounded-2xl border border-input bg-background px-4 py-3 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/15"
        />

        {compare ? (
          <div className="mt-3 grid gap-2 rounded-2xl bg-muted/60 p-3 text-sm sm:grid-cols-2" aria-live="polite">
            <div className="min-w-0">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">You said</div>
              <p className="mt-0.5 text-muted-foreground">{compare.heard || "—"}</p>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-xs font-semibold tracking-wide text-primary uppercase">
                <Sparkles className="size-3" aria-hidden="true" /> It typed
              </div>
              <p className="mt-0.5">{compare.typed}</p>
            </div>
          </div>
        ) : null}

        {reply ? (
          <div className="mt-3 flex gap-3 rounded-2xl border border-border bg-background-2 p-3" aria-live="polite">
            <Avatar avatar={reply.bot.avatar} color={reply.bot.color} size={40} mood={reply.done ? "idle" : "thinking"} />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold">{reply.bot.name}</div>
              {reply.command ? <p className="text-muted-foreground italic">“{reply.command}”</p> : null}
              {reply.label ? (
                <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {reply.label}
                </p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap">{reply.text}</p>
              )}
              {reply.done && reply.command ? (
                <Link href={`/app/bots/${reply.bot.id}`} className="mt-1 inline-block text-xs font-semibold text-primary hover:underline">
                  {reply.approvals ? `It needs your OK: approve it in your chat with ${reply.bot.name} →` : `It's in your chat with ${reply.bot.name} →`}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {problem ? (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl bg-danger-soft px-3 py-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {problem.message}{" "}
              {problem.upgrade && paidPlans ? (
                <Link href="/app/billing" className="font-semibold underline">
                  Upgrade
                </Link>
              ) : null}
            </span>
          </p>
        ) : null}
        {note ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {note}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 border-t border-border bg-background-2/60 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onPointerDown={(e) => {
              if (e.button === 0) onDown();
            }}
            onPointerUp={onUp}
            onPointerLeave={() => {
              if (press.current && phase === "listening" && performance.now() - press.current.at >= HOLD_MS) void stop();
            }}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                onDown();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onUp();
              }
            }}
            disabled={busy}
            aria-pressed={listening}
            aria-label={listening ? (handsfree ? "Finish and type it" : "Let go to type it") : "Hold to talk, or click to keep listening"}
            className={cn(
              "relative flex size-14 shrink-0 touch-none items-center justify-center rounded-full text-white shadow-glow transition select-none focus-visible:ring-4 focus-visible:ring-primary/30 focus-visible:outline-none",
              listening ? "bg-danger" : "bg-primary hover:bg-primary-hover",
              busy && "opacity-70",
            )}
          >
            {listening ? <span className="absolute inset-0 animate-pulse-ring rounded-full" aria-hidden="true" /> : null}
            {busy ? <Loader2 className="size-6 animate-spin" /> : listening && handsfree ? <Square className="size-5 fill-current" /> : <Mic className="size-6" />}
          </button>
          <div className="min-w-0">
            {listening ? (
              <div className="flex items-center gap-3">
                <span className="flex h-7 items-center gap-[3px]" aria-hidden="true">
                  {levels.map((l, i) => (
                    <span key={i} className="block w-[3px] rounded-full bg-primary transition-[height] duration-75" style={{ height: `${Math.max(4, l * 28)}px`, opacity: 0.4 + (i / levels.length) * 0.6 }} />
                  ))}
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">{fmt(elapsed)}</span>
              </div>
            ) : null}
            <p className="text-sm font-semibold">
              {phase === "listening"
                ? handsfree
                  ? "Listening. Click to finish."
                  : "Listening. Let go to type it."
                : phase === "working"
                  ? "Writing…"
                  : phase === "asking"
                    ? `Asking ${reply?.bot.name ?? "your bot"}…`
                    : "Hold to talk"}
            </p>
            {phase === "idle" ? <p className="text-xs text-muted-foreground">Or click once to keep listening, and click again when you're done.</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:ml-auto">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={polish} onCheckedChange={setPolish} aria-label="Clean up my words" />
            Clean up
          </label>
          {bot ? (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={commands} onCheckedChange={setCommands} aria-label={`“Hey ${bot.name}” asks ${bot.name}`} />
              “Hey {bot.name}”
            </label>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-6">
        <span>{usage.limit ? `${usage.words.toLocaleString()} of ${usage.limit.toLocaleString()} words this month` : `${usage.words.toLocaleString()} words this month · unlimited on your plan`}</span>
        {simulated ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning">Demo</span>
            It doesn't hear you yet: it types sample sentences.
            {bot ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto text-xs"
                disabled={busy || listening}
                onClick={() => {
                  demoCommand.current = true;
                  press.current = { at: performance.now() - HOLD_MS, stopWhenReady: false };
                  void start().then(() => window.setTimeout(() => void stop(), 1200));
                }}
              >
                Try “Hey {bot.name}”
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
