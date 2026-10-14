"use client";
/**
 * The no-install recorder: takes notes in a call that runs in another browser tab (or in
 * person, with one microphone). It only listens while its floating window (Document
 * Picture-in-Picture) is open, so the bot is always on screen; closing that window stops
 * the recording and the notes get written.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Globe, LoaderCircle, MonitorUp, Pause, Play, Square, Trash2, Wifi } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useBotLive } from "@/components/app/live-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { MeetingAppId } from "@/lib/meetings/apps";
import { Buddy, consentNoteFor, formatClock, useElapsed, type BuddyProps } from "./Buddy";
import type { BuddyAction } from "./desktop-api";
import { finishMeeting, MeetingRecorder, recorderSupported, type EngineProblem, markPaused } from "./recorder-engine";
import { openPipWindow, pipSupported } from "./pip";
import { ConsentSheet, StartSheet, type BotFace, type MeetingMode, type ShareState } from "./RecorderSetup";
import { TranscriptList } from "./Transcript";
import { copyText, hasConsent, markRecordingHere, mergeSegments, saveConsent, speakerName, type MeetingView, type SegmentView } from "./shared";

type Phase = "idle" | "starting" | "listening" | "paused" | "stopping" | "discarding";
type Notice = { id: string; tone: "info" | "warn"; text: string; short?: string; action?: { label: string; run: () => void } };

const SILENCE_STOP_MS = 15 * 60_000;
const SILENCE_WARN_MS = 12 * 60_000;

/** A tiny store so the loudness meter can update ten times a second without re-rendering the page. */
function createLevelStore() {
  let level = 0;
  const subs = new Set<() => void>();
  return {
    get: () => level,
    set: (v: number) => {
      if (Math.abs(v - level) < 0.02 && v !== 0) return;
      level = v;
      subs.forEach((s) => s());
    },
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
type LevelStore = ReturnType<typeof createLevelStore>;

function LiveBuddy({ store, ...props }: Omit<BuddyProps, "level"> & { store: LevelStore }) {
  const level = React.useSyncExternalStore(store.subscribe, store.get, () => 0);
  return <Buddy {...props} level={level} />;
}

function LevelBars({ store, active }: { store: LevelStore; active: boolean }) {
  const level = React.useSyncExternalStore(store.subscribe, store.get, () => 0);
  return (
    <span className="flex h-6 items-end gap-[3px]" aria-hidden>
      {[0.5, 0.85, 1, 0.7, 0.45, 0.8, 0.6].map((k, i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-full transition-[height] duration-100 ease-out", active ? "bg-danger" : "bg-muted-foreground/40")}
          style={{ height: `${Math.round(4 + (active ? Math.min(1, level * 1.5) : 0) * k * 20)}px` }}
        />
      ))}
    </span>
  );
}

function isChromium(): boolean {
  const ua = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
  if (ua.userAgentData?.brands?.some((b) => /chrom|edge/i.test(b.brand))) return true;
  return /\b(Chrome|Chromium|Edg)\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
}

type Support = { pip: boolean; recorder: boolean; share: boolean };

export type RecorderBlock = { kind: "off" | "unavailable" | "paused" | "busy" | "minutes"; text: string } | null;

export function BrowserRecorder({
  botId,
  bot,
  ownerId,
  ownerName,
  minutesLeft,
  block,
  desktopCard,
  onStarted,
  onDiscarded,
  onBlocked,
}: {
  botId: string;
  bot: BotFace;
  ownerId: string;
  ownerName: string;
  minutesLeft: number;
  /** Why notes can't start right now (shown on the card instead of the button). */
  block: RecorderBlock;
  desktopCard: React.ReactNode;
  onStarted: (m: MeetingView) => void;
  onDiscarded: (id: string) => void;
  /** The server refused to start: meeting notes are off, or the bot is busy in another meeting. */
  onBlocked: (reason: { code?: string; meetingId?: string }) => void;
}) {
  const router = useRouter();
  const live = useBotLive();
  const [support, setSupport] = React.useState<Support | null>(null);
  const [phase, setPhaseState] = React.useState<Phase>("idle");
  const phaseRef = React.useRef<Phase>("idle");
  const setPhase = React.useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  // Before starting
  const [consentOpen, setConsentOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [mode, setMode] = React.useState<MeetingMode>("call");
  const [share, setShare] = React.useState<ShareState>({ state: "none" });
  const shareRef = React.useRef<ShareState>(share);
  shareRef.current = share;
  const [app, setApp] = React.useState<MeetingAppId>("browser");
  const [noticeCopied, setNoticeCopied] = React.useState(false);
  const [startError, setStartError] = React.useState<{ text: string; upgrade?: string } | null>(null);

  // While recording
  const [meeting, setMeeting] = React.useState<MeetingView | null>(null);
  const meetingRef = React.useRef<MeetingView | null>(null);
  const engineRef = React.useRef<MeetingRecorder | null>(null);
  const [pip, setPip] = React.useState<{ win: Window; root: HTMLElement } | null>(null);
  const pipRef = React.useRef<{ win: Window; root: HTMLElement } | null>(null);
  const [segments, setSegments] = React.useState<SegmentView[]>([]);
  const [caption, setCaption] = React.useState<{ speaker: string; text: string; at: number } | null>(null);
  const [clockBase, setClockBase] = React.useState(0);
  const [runningSince, setRunningSince] = React.useState<number | null>(null);
  const [notices, setNotices] = React.useState<Notice[]>([]);
  const [tracks, setTracks] = React.useState<{ mic: boolean; system: boolean; inPerson: boolean }>({ mic: false, system: false, inPerson: false });
  const [leaveTo, setLeaveTo] = React.useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const levels = React.useMemo(createLevelStore, []);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);

  const note = consentNoteFor(bot.name);
  const recording = phase === "listening" || phase === "paused";
  const liveNow = recording || phase === "stopping" || phase === "discarding";
  const elapsed = useElapsed(clockBase, phase === "listening" ? runningSince : null);

  React.useEffect(() => {
    setSupport({ pip: pipSupported(), recorder: recorderSupported(), share: Boolean(navigator.mediaDevices?.getDisplayMedia) && isChromium() });
  }, []);

  const setNotice = React.useCallback((n: Notice | null, id?: string) => {
    setNotices((cur) => {
      const key = n?.id ?? id;
      const rest = cur.filter((x) => x.id !== key);
      return n ? [...rest, n] : rest.length === cur.length ? cur : rest;
    });
  }, []);

  const addSegments = React.useCallback(
    (incoming: SegmentView[]) => {
      const fresh = incoming.filter((s) => s.text?.trim());
      if (!fresh.length) return;
      setSegments((prev) => {
        const next = mergeSegments(prev, fresh);
        if (next !== prev) {
          const known = new Set(prev.map((s) => s.id));
          const newest = fresh.filter((s) => !known.has(s.id)).sort((a, b) => b.startMs - a.startMs)[0];
          if (newest) setCaption({ speaker: speakerName(newest, ownerName), text: newest.text, at: Date.now() });
        }
        return next;
      });
    },
    [ownerName],
  );

  // ---------------------------------------------------------------------------
  // Sharing the call's tab (before or during the recording)

  const stopShare = React.useCallback(() => {
    const s = shareRef.current;
    if (s.state === "ok") s.stream.getTracks().forEach((t) => t.stop());
  }, []);

  /** Ask the browser for the call's tab. Called straight from a click. */
  const requestCallAudio = React.useCallback((): Promise<{ stream: MediaStream; surface: string | null } | { error: "cancelled" | "no-audio" | "failed" }> => {
    const md = navigator.mediaDevices;
    if (!md?.getDisplayMedia) return Promise.resolve({ error: "failed" });
    type Controller = { setFocusBehavior?: (b: string) => void };
    let controller: Controller | undefined;
    try {
      const Ctor = (window as unknown as { CaptureController?: new () => Controller }).CaptureController;
      if (Ctor) controller = new Ctor();
    } catch {
      controller = undefined;
    }
    // Stay on this page after picking the tab, so the owner can press Start.
    try {
      controller?.setFocusBehavior?.("focus-capturing-application");
    } catch {
      /* some versions only allow it after the pick */
    }
    const options = {
      video: { displaySurface: "browser" },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      preferCurrentTab: false,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      systemAudio: "include",
      ...(controller ? { controller } : {}),
    } as unknown as DisplayMediaStreamOptions;
    return md.getDisplayMedia(options).then(
      (stream) => {
        try {
          controller?.setFocusBehavior?.("focus-capturing-application");
        } catch {
          /* already decided */
        }
        const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface ?? null;
        // Only the sound is used: stop the picture right away.
        for (const t of stream.getVideoTracks()) {
          t.stop();
          stream.removeTrack(t);
        }
        if (!stream.getAudioTracks().length) return { error: "no-audio" as const };
        return { stream, surface };
      },
      (err: unknown) => ({ error: (err as { name?: string })?.name === "NotAllowedError" || (err as { name?: string })?.name === "AbortError" ? ("cancelled" as const) : ("failed" as const) }),
    );
  }, []);

  const onShare = () => {
    stopShare();
    setShare({ state: "asking" });
    void requestCallAudio().then((r) => {
      if ("error" in r) {
        setShare(r.error === "cancelled" ? { state: "cancelled" } : r.error === "no-audio" ? { state: "no-audio" } : { state: "error", message: "That didn't work. Try again, or pick another tab." });
        return;
      }
      const stream = r.stream;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (phaseRef.current === "idle" || phaseRef.current === "starting") setShare((s) => (s.state === "ok" && s.stream === stream ? { state: "ended" } : s));
      });
      setShare({ state: "ok", stream, surface: r.surface });
    });
  };

  /** Mid-recording: bring the rest of the call in. */
  const addCallAudio = () => {
    void requestCallAudio().then((r) => {
      if ("error" in r) {
        if (r.error === "no-audio") toast.error("That share had no sound. Pick the call's tab and keep “Also share tab audio” on.");
        else if (r.error === "failed") toast.error("Couldn't share that tab. Try again.");
        return;
      }
      engineRef.current?.addStream("system", r.stream);
      setTracks((t) => ({ ...t, system: true }));
      setNotice(null, "side");
      setNotice(null, "ended");
      toast.success("Got it. Now the whole call is in the notes.");
    });
  };

  // ---------------------------------------------------------------------------
  // Start

  const openStart = () => {
    setStartError(null);
    if (!hasConsent(ownerId, botId)) setConsentOpen(true);
    else setSheetOpen(true);
  };

  const copyNotice = async () => {
    const ok = await copyText(note);
    if (!ok) {
      toast.error("Couldn't copy. Select the text and copy it yourself.");
      return;
    }
    setNoticeCopied(true);
    toast.success("Copied. Paste it in the call's chat.");
    const m = meetingRef.current;
    if (m && !m.noticeCopied) {
      meetingRef.current = { ...m, noticeCopied: true };
      setMeeting(meetingRef.current);
      void api(`/api/bots/${botId}/meetings/${m.id}`, { method: "PATCH", body: { noticeCopied: true } }).catch(() => {});
    }
  };

  const closePip = React.useCallback(() => {
    const p = pipRef.current;
    pipRef.current = null;
    setPip(null);
    try {
      p?.win.close();
    } catch {
      /* already closed */
    }
  }, []);

  const resetLive = React.useCallback(() => {
    engineRef.current = null;
    meetingRef.current = null;
    setMeeting(null);
    setSegments([]);
    setCaption(null);
    setNotices([]);
    setClockBase(0);
    setRunningSince(null);
    levels.set(0);
  }, [levels]);

  const start = ({ micOnly }: { micOnly?: boolean }) => {
    if (phaseRef.current !== "idle") return;
    setStartError(null);
    // The floating window first: the browser only allows it right after this click.
    const pipPromise = openPipWindow({ width: 380, height: 236, title: `${bot.name} is taking notes` });
    const inPerson = mode === "inperson";
    const shared = shareRef.current;
    const system = !inPerson && !micOnly && shared.state === "ok" ? shared.stream : null;
    const micPromise = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      : Promise.reject(new Error("No microphone access in this browser."));
    micPromise.catch(() => {});
    setPhase("starting");

    void (async () => {
      let handle: { win: Window; root: HTMLElement };
      const releaseMic = () => micPromise.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
      const fail = (text: string, upgrade?: string) => {
        void releaseMic();
        closePip();
        setPhase("idle");
        setStartError({ text, upgrade });
      };
      try {
        handle = await pipPromise;
      } catch (err) {
        fail(
          (err as { name?: string })?.name === "NotAllowedError"
            ? "Press Start again: your browser needs a fresh click to show me on top of your other windows."
            : "I couldn't open my floating window, and I only listen while I'm on your screen. Use Chrome or Edge, or the desktop app.",
        );
        return;
      }
      pipRef.current = handle;
      setPip(handle);
      handle.win.addEventListener(
        "pagehide",
        () => {
          if (pipRef.current?.win !== handle.win) return;
          pipRef.current = null;
          setPip(null);
          // Closing the floating bot stops the recording (and the notes get written).
          if (phaseRef.current === "listening" || phaseRef.current === "paused") void stopAndWriteRef.current("closed");
          else if (phaseRef.current === "starting") fail("You closed my window, so I didn't start.");
        },
        { once: true },
      );

      let mic: MediaStream | null = null;
      try {
        mic = await micPromise;
      } catch {
        if (!system) {
          fail("I need your microphone to take notes. Allow it in your browser's address bar, then press Start again.");
          return;
        }
      }
      if (phaseRef.current !== "starting") {
        mic?.getTracks().forEach((t) => t.stop());
        return;
      }

      let res: { meeting: MeetingView; chunkMs: number };
      try {
        res = await api<{ meeting: MeetingView; chunkMs: number }>(`/api/bots/${botId}/meetings`, {
          method: "POST",
          body: { app: inPerson ? "other" : app, inPerson, consentNotice: noticeCopied },
        });
      } catch (err) {
        mic?.getTracks().forEach((t) => t.stop());
        const e = err instanceof ApiError ? err : null;
        const code = typeof e?.data.code === "string" ? e.data.code : undefined;
        if (code === "meetings_off" || code === "already_recording") {
          onBlocked({ code, meetingId: typeof e?.data.meetingId === "string" ? e.data.meetingId : undefined });
          setSheetOpen(false);
        }
        fail(e?.message ?? "Couldn't start. Check your connection and try again.", e?.upgrade);
        return;
      }
      if (phaseRef.current !== "starting") {
        // The window was closed while the server was starting: nothing was recorded, so don't keep an empty meeting.
        mic?.getTracks().forEach((t) => t.stop());
        void api(`/api/bots/${botId}/meetings/${res.meeting.id}`, { method: "DELETE" }).catch(() => {});
        return;
      }

      const m = { ...res.meeting, noticeCopied: res.meeting.noticeCopied || noticeCopied };
      meetingRef.current = m;
      setMeeting(m);
      const engine = new MeetingRecorder({
        botId,
        meetingId: m.id,
        chunkMs: res.chunkMs,
        streams: { mic, system },
        onLevel: levels.set,
        onSegments: (s) => addSegmentsRef.current(s),
        onUploads: ({ pending, trouble }) =>
          setNotice(
            trouble
              ? {
                  id: "uploads",
                  tone: "warn",
                  text: `Having trouble sending audio (${pending} piece${pending === 1 ? "" : "s"} waiting). I'll keep trying, so leave this tab open.`,
                  short: "Having trouble sending audio. I'll keep trying.",
                }
              : null,
            "uploads",
          ),
        onProblem: (p) => onProblemRef.current(p),
        onTrackEnded: (t) => onTrackEndedRef.current(t),
        onSilence: (ms) => onSilenceRef.current(ms),
      });
      engineRef.current = engine;
      await engine.start();
      setTracks({ mic: Boolean(mic), system: Boolean(system), inPerson });
      setClockBase(0);
      setRunningSince(Date.now());
      setSegments([]);
      setCaption(null);
      const first: Notice[] = [];
      if (!inPerson && !system)
        first.push({
          id: "side",
          tone: "warn",
          text: "Only your side will be in the notes. Share the call's tab with audio to include everyone.",
          short: "Only your side is in the notes.",
          ...(support?.share ? { action: { label: "Share the call's tab", run: addCallAudio } } : {}),
        });
      if (!mic) first.push({ id: "mic", tone: "warn", text: "Your microphone is off, so only the others on the call will be in the notes.", short: "Your microphone is off." });
      setNotices(first);
      // A tab shared earlier but not used (they picked "In person" after all): stop sharing it.
      const leftover = shareRef.current;
      if (leftover.state === "ok" && leftover.stream !== system) leftover.stream.getTracks().forEach((t) => t.stop());
      setPhase("listening");
      setSheetOpen(false);
      setShare({ state: "none" });
      onStarted(m);
    })();
  };

  // ---------------------------------------------------------------------------
  // Pause, stop, discard

  const pause = () => {
    if (phaseRef.current !== "listening") return;
    engineRef.current?.pause();
    if (meetingRef.current) markPaused(botId, meetingRef.current.id, true);
    setClockBase((b) => b + (runningSince ? Date.now() - runningSince : 0));
    setRunningSince(null);
    setPhase("paused");
  };

  const resume = () => {
    if (phaseRef.current !== "paused") return;
    engineRef.current?.resume();
    if (meetingRef.current) markPaused(botId, meetingRef.current.id, false);
    setRunningSince(Date.now());
    setPhase("listening");
  };

  const stopAndWrite = async (why: "button" | "closed" | "silence" | "limit" | "too_long" | "no_audio" | "leave" = "button", problem?: EngineProblem): Promise<string | null> => {
    const engine = engineRef.current;
    const m = meetingRef.current;
    if (!engine || !m || (phaseRef.current !== "listening" && phaseRef.current !== "paused")) return null;
    setPhase("stopping");
    const { unsent } = await engine.stop({ waitMs: 45_000 });
    const done = await finishMeeting(botId, m.id);
    closePip();
    const message =
      why === "silence"
        ? "It was quiet for 15 minutes, so I stopped and I'm writing your notes."
        : why === "limit"
          ? `${problem?.message ?? "You've used this month's meeting minutes."} I'm writing notes from what I heard.`
          : why === "too_long" || why === "no_audio"
            ? (problem?.message ?? "I stopped.")
            : `${bot.name} is writing your notes.`;
    if (unsent) toast.warning(`${message} A little audio didn't make it, so the end may be missing.`);
    else if (why === "limit") toast.warning(message, problem?.upgrade ? { action: { label: "See plans", onClick: () => router.push("/app/billing") } } : undefined);
    else toast.success(message);
    if (!done) toast.error("Couldn't reach the server to finish up. Open the meeting and press Stop again.");
    if (why === "leave") {
      setPhase("idle");
      resetLive();
    } else {
      // Keep the panel up ("Opening your notes…") until the meeting page takes over.
      setOpening(true);
      router.push(`/app/bots/${botId}/meetings/${m.id}`);
    }
    return m.id;
  };
  const stopAndWriteRef = React.useRef(stopAndWrite);
  stopAndWriteRef.current = stopAndWrite;

  const discard = async () => {
    const engine = engineRef.current;
    const m = meetingRef.current;
    if (!engine || !m) return;
    setConfirmDiscard(false);
    setPhase("discarding");
    await engine.stop({ discard: true });
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      try {
        await api(`/api/bots/${botId}/meetings/${m.id}`, { method: "DELETE" });
        ok = true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) ok = true;
        else await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      }
    }
    closePip();
    setPhase("idle");
    resetLive();
    onDiscarded(m.id);
    if (ok) toast.success("Stopped and deleted. Nothing from this call was kept.");
    else toast.error("Stopped, but I couldn't delete it. Delete it from the list below.");
    router.refresh();
  };

  const onProblem = (p: EngineProblem) => {
    const m = meetingRef.current;
    if (p.code === "limit" || p.code === "too_long" || p.code === "no_audio") {
      void stopAndWrite(p.code, p);
      return;
    }
    engineRef.current?.abort();
    closePip();
    setPhase("idle");
    resetLive();
    if (p.code === "not_recording" && m) {
      toast("This meeting was stopped somewhere else, so I stopped here too.");
      router.push(`/app/bots/${botId}/meetings/${m.id}`);
    } else {
      toast.error(p.message);
      router.refresh();
    }
  };
  const onProblemRef = React.useRef(onProblem);
  onProblemRef.current = onProblem;

  const onTrackEnded = (t: "mic" | "system") => {
    if (t === "system") {
      setTracks((x) => ({ ...x, system: false }));
      setNotice({
        id: "ended",
        tone: "warn",
        text: "You stopped sharing the call's tab, so only your side is in the notes from here.",
        short: "You stopped sharing the call's tab.",
        ...(support?.share ? { action: { label: "Share it again", run: addCallAudio } } : {}),
      });
    } else {
      setTracks((x) => ({ ...x, mic: false }));
      setNotice({ id: "mic", tone: "warn", text: "Your microphone stopped, so only the call's sound is in the notes from here.", short: "Your microphone stopped." });
    }
  };
  const onTrackEndedRef = React.useRef(onTrackEnded);
  onTrackEndedRef.current = onTrackEnded;

  const onSilence = (ms: number) => {
    if (ms >= SILENCE_STOP_MS) {
      void stopAndWrite("silence");
      return;
    }
    if (ms >= SILENCE_WARN_MS) {
      const left = Math.max(1, Math.ceil((SILENCE_STOP_MS - ms) / 60_000));
      setNotice({
        id: "silence",
        tone: "info",
        text: `It's been quiet for a while. I'll stop in ${left} min and write your notes, unless someone talks.`,
        short: `Quiet for a while. I'll stop in ${left} min.`,
      });
    } else setNotice(null, "silence");
  };
  const onSilenceRef = React.useRef(onSilence);
  onSilenceRef.current = onSilence;

  const addSegmentsRef = React.useRef(addSegments);
  addSegmentsRef.current = addSegments;

  const onBuddyAction = (a: BuddyAction) => {
    if (a === "pause") pause();
    else if (a === "resume") resume();
    else if (a === "stop") void stopAndWrite("button");
    else if (a === "discard") void discard();
    else if (a === "open") panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ---------------------------------------------------------------------------
  // While recording: live transcript, keep awake, guard the page, header mood

  const meetingId = meeting?.id ?? null;
  React.useEffect(() => {
    if (!meetingId || !liveNow) return;
    let since: string | null = null;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await api<{ meeting: MeetingView; segments: SegmentView[]; serverTime: string }>(
          `/api/bots/${botId}/meetings/${meetingId}${since ? `?since=${encodeURIComponent(since)}` : ""}`,
        );
        if (cancelled) return;
        since = data.serverTime;
        addSegmentsRef.current(data.segments);
        if (data.meeting.status !== "recording" && (phaseRef.current === "listening" || phaseRef.current === "paused")) {
          onProblemRef.current({ code: "not_recording", message: "This meeting was stopped somewhere else." });
        }
      } catch (err) {
        if (!cancelled && err instanceof ApiError && err.status === 404 && (phaseRef.current === "listening" || phaseRef.current === "paused")) {
          onProblemRef.current({ code: "gone", message: "This meeting was deleted, so I stopped." });
        }
      }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [botId, meetingId, liveNow]);

  React.useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [segments]);

  React.useEffect(() => {
    if (!recording) return;
    type Sentinel = { released: boolean; release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };
    let lock: Sentinel | null = null;
    let cancelled = false;
    const request = async () => {
      if (!nav.wakeLock || document.visibilityState !== "visible") return;
      try {
        const l = await nav.wakeLock.request("screen");
        if (cancelled) void l.release().catch(() => {});
        else lock = l;
      } catch {
        /* not allowed right now (battery saver, hidden tab) */
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!lock || lock.released)) void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [recording]);

  React.useEffect(() => {
    if (!recording) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const pageHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      const m = meetingRef.current;
      engineRef.current?.abort();
      if (m) void finishMeeting(botId, m.id, { keepalive: true });
    };
    // In-app links would quietly end the recording: ask first.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", pageHide);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", pageHide);
      document.removeEventListener("click", onClick, true);
    };
  }, [recording, botId]);

  React.useEffect(() => {
    if (!meetingId || !liveNow) return;
    markRecordingHere(meetingId);
    const t = setInterval(() => markRecordingHere(meetingId), 10_000);
    return () => {
      clearInterval(t);
      markRecordingHere(null);
    };
  }, [meetingId, liveNow]);

  // The bot in the header listens too (and goes back to normal afterwards).
  const { setMood, setActivity } = live;
  const moodTouched = React.useRef(false);
  React.useEffect(() => {
    if (phase === "listening") {
      moodTouched.current = true;
      setMood("listening");
      setActivity("Taking notes");
    } else if (phase === "paused") {
      moodTouched.current = true;
      setMood("idle");
      setActivity("Notes paused");
    } else if (phase === "stopping") {
      moodTouched.current = true;
      setMood("thinking");
      setActivity("Writing notes");
    } else if (moodTouched.current) {
      moodTouched.current = false;
      setMood("idle");
      setActivity(null);
    }
  }, [phase, setMood, setActivity]);

  // Leaving another way (the back button): wrap up in the background and say so.
  React.useEffect(
    () => () => {
      const engine = engineRef.current;
      const m = meetingRef.current;
      if (engine && m && (phaseRef.current === "listening" || phaseRef.current === "paused")) {
        phaseRef.current = "stopping";
        void engine.stop({ waitMs: 30_000 }).then(() => finishMeeting(botId, m.id));
        toast(`${bot.name} stopped taking notes and is writing them now.`, {
          action: { label: "Open", onClick: () => window.location.assign(`/app/bots/${botId}/meetings/${m.id}`) },
        });
      }
      try {
        pipRef.current?.win.close();
      } catch {
        /* ignore */
      }
      stopShare();
      markRecordingHere(null);
      if (moodTouched.current) {
        setMood("idle");
        setActivity(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Don't keep a shared tab open if the sheet is closed without starting.
  React.useEffect(() => {
    if (!sheetOpen && phaseRef.current === "idle") {
      stopShare();
      setShare({ state: "none" });
    }
  }, [sheetOpen, stopShare]);

  // ---------------------------------------------------------------------------
  // Render

  const buddyBase = {
    bot: { name: bot.name, avatar: bot.avatar, color: bot.color },
    app: !tracks.inPerson && meeting && meeting.app !== "other" && meeting.app !== "browser" ? { id: meeting.app, name: meeting.appName } : undefined,
    elapsedMs: clockBase,
    runningSince: phase === "listening" ? runningSince : null,
    caption,
    consentNote: note,
    minutesLeft: Math.max(0, minutesLeft - Math.floor(elapsed / 60_000)),
    onAction: onBuddyAction,
  } as const;
  const buddyPhase = phase === "paused" ? "paused" : phase === "stopping" || phase === "discarding" ? "saving" : "listening";
  const minutesNow = Math.max(0, minutesLeft - Math.floor(elapsed / 60_000));

  const pipContent =
    pip && (phase === "starting" || liveNow)
      ? createPortal(
          phase === "starting" ? (
            <div className="flex h-full items-center gap-3 bg-background p-4 text-foreground">
              <Avatar avatar={bot.avatar} color={bot.color} mood="thinking" size={72} />
              <div className="min-w-0">
                <p className="font-display text-base font-bold">Getting ready…</p>
                <p className="text-sm text-muted-foreground">If your browser asks, allow the microphone.</p>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col bg-background">
              <div className="min-h-0 flex-1">
                <LiveBuddy store={levels} variant="pip" phase={buddyPhase} {...buddyBase} notice={notices.length ? (notices[notices.length - 1].short ?? notices[notices.length - 1].text) : null} />
              </div>
              {recording && !meeting?.noticeCopied ? (
                <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="truncate">Only if everyone&apos;s OK with it.</span>
                  <button type="button" onClick={() => void copyNotice()} className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary hover:underline">
                    <Copy className="size-3.5" aria-hidden /> Copy a heads-up
                  </button>
                </div>
              ) : null}
            </div>
          ),
          pip.root,
        )
      : null;

  const startBlocked = block ?? (support && (!support.pip || !support.recorder) ? { kind: "unsupported" as const, text: "" } : null);

  return (
    <>
      {liveNow && meeting ? (
        <section ref={panelRef} aria-label={`${bot.name} is taking notes`} className="scroll-mt-4 overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-gradient-to-r from-danger-soft/70 via-card to-card px-4 py-4 sm:px-5">
            <Avatar avatar={bot.avatar} color={bot.color} mood={phase === "listening" ? "listening" : phase === "paused" ? "sleeping" : "thinking"} size={64} className="h-auto w-[52px] sm:w-16" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {phase === "listening" ? (
                  <span className="relative flex size-2.5" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-danger" />
                  </span>
                ) : null}
                <h3 className="font-display text-lg font-bold">
                  {phase === "listening"
                    ? `${bot.name} is taking notes`
                    : phase === "paused"
                      ? "Paused"
                      : phase === "discarding"
                        ? "Deleting everything…"
                        : "Wrapping up…"}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {tracks.inPerson
                  ? "In person · one microphone"
                  : [meeting.app !== "browser" && meeting.app !== "other" ? meeting.appName : "Call in another tab", tracks.system && tracks.mic ? "you and the call" : tracks.system ? "the call only" : "your side only"].join(" · ")}
              </p>
            </div>
            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
              <LevelBars store={levels} active={phase === "listening"} />
              <span className="font-mono text-2xl font-semibold tabular-nums sm:text-3xl" aria-label={`Recording time ${formatClock(elapsed)}`}>
                {formatClock(elapsed)}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
            {phase === "stopping" || phase === "discarding" ? (
              <p className="flex items-center gap-2 text-sm font-medium" role="status">
                <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden />
                {phase === "discarding"
                  ? "Stopping and deleting what I captured…"
                  : opening
                    ? "Opening your notes…"
                    : "Sending the last bit of audio, then I'll write your notes…"}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {phase === "listening" ? (
                  <Button variant="outline" onClick={pause}>
                    <Pause /> Pause
                  </Button>
                ) : (
                  <Button variant="outline" onClick={resume}>
                    <Play /> Resume
                  </Button>
                )}
                <Button onClick={() => void stopAndWrite("button")}>
                  <Square className="fill-current" /> Stop and write notes
                </Button>
                <Button variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => setConfirmDiscard(true)}>
                  <Trash2 /> Stop and delete
                </Button>
                {!meeting.noticeCopied ? (
                  <Button variant="soft" className="sm:ml-auto" onClick={() => void copyNotice()}>
                    <Copy /> Copy a heads-up
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground sm:ml-auto">
                    <Check className="size-3.5 text-success" aria-hidden /> Heads-up copied
                  </span>
                )}
              </div>
            )}

            {notices.length ? (
              <ul className="flex flex-col gap-2">
                {notices.map((n) => (
                  <li
                    key={n.id}
                    className={cn(
                      "flex flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-sm sm:flex-row sm:items-center",
                      n.tone === "warn" ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary",
                    )}
                  >
                    <span className="flex min-w-0 flex-1 gap-2">
                      {n.id === "uploads" ? <Wifi className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
                      <span className="text-foreground">{n.text}</span>
                    </span>
                    {n.action ? (
                      <Button size="sm" variant="outline" onClick={n.action.run} className="self-start sm:self-auto">
                        <MonitorUp /> {n.action.label}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {minutesNow <= 10 && recording ? (
              <p className="text-sm text-warning">
                {minutesNow > 0 ? `About ${minutesNow} min of meeting notes left this month.` : "You're at this month's meeting minutes."}{" "}
                <Link href="/app/billing" className="font-semibold underline underline-offset-2">
                  Get more
                </Link>
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {pip ? `${bot.name} floats over your other windows while it listens. Closing that window stops it and writes your notes.` : null}
            </p>
          </div>

          <div className="border-t border-border">
            <div className="flex items-center justify-between px-4 pt-3 sm:px-5">
              <h4 className="text-sm font-semibold">Live transcript</h4>
              <span className="text-xs text-muted-foreground">{segments.length ? `${segments.length} line${segments.length === 1 ? "" : "s"}` : null}</span>
            </div>
            <div
              ref={listRef}
              onScroll={() => {
                const el = listRef.current;
                if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
              className="scrollbar-thin max-h-80 overflow-y-auto px-4 pt-2 pb-4 sm:px-5"
              tabIndex={0}
              aria-label="Live transcript"
            >
              {segments.length ? (
                <TranscriptList segments={segments} ownerName={ownerName} dense />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">Lines show up here a few seconds after people talk.</p>
              )}
            </div>
          </div>
        </section>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <Globe className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="flex flex-wrap items-center gap-2 font-display text-lg leading-tight font-semibold">
                  In this browser <Badge tone="success">No install</Badge>
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  For a call in another tab, like Google Meet, Teams or Zoom on the web, or a meeting in the room with you.
                </p>
              </div>
            </div>
            {startBlocked ? (
              <BlockNote block={startBlocked} botName={bot.name} />
            ) : (
              <p className="text-xs text-muted-foreground">Works in Chrome and Edge on a computer. {bot.name} floats over your call while it listens.</p>
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2">
              <Button onClick={openStart} disabled={Boolean(startBlocked) || phase !== "idle"} loading={phase === "starting"}>
                {phase === "starting" ? "Starting…" : "Start taking notes"}
              </Button>
            </div>
            {startError && !sheetOpen ? (
              <p role="alert" className="text-sm text-danger">
                {startError.text}{" "}
                {startError.upgrade ? (
                  <Link href="/app/billing" className="font-semibold underline underline-offset-2">
                    See plans
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
          {desktopCard}
        </div>
      )}

      {liveNow && meeting ? (
        <LiveBuddy store={levels} variant="page" phase={buddyPhase} {...buddyBase} className="lg:left-[280px]" />
      ) : null}
      {pipContent}

      <ConsentSheet
        open={consentOpen}
        onOpenChange={setConsentOpen}
        bot={bot}
        onAccept={() => {
          saveConsent(ownerId, botId);
          setConsentOpen(false);
          setSheetOpen(true);
        }}
      />
      <StartSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        bot={bot}
        mode={mode}
        onMode={setMode}
        canShare={Boolean(support?.share)}
        share={share}
        onShare={onShare}
        app={app}
        onApp={setApp}
        note={note}
        noticeCopied={noticeCopied}
        onCopyNotice={() => void copyNotice()}
        onStart={start}
        starting={phase === "starting"}
        error={
          startError ? (
            <>
              {startError.text}{" "}
              {startError.upgrade ? (
                <Link href="/app/billing" className="font-semibold underline underline-offset-2">
                  See plans
                </Link>
              ) : null}
            </>
          ) : null
        }
      />

      <Dialog open={leaveTo !== null} onOpenChange={(o) => !o && setLeaveTo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop taking notes?</DialogTitle>
            <DialogDescription>
              {bot.name} only listens while this page is open. Leaving stops it, and it writes your notes from what it heard so far.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse items-stretch sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
            <Button variant="ghost" onClick={() => setLeaveTo(null)}>
              Keep taking notes
            </Button>
            <Button
              onClick={() => {
                const to = leaveTo;
                setLeaveTo(null);
                void stopAndWrite("leave").then(() => {
                  if (to) router.push(to);
                });
              }}
            >
              Stop and leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop and delete everything?</DialogTitle>
            <DialogDescription>
              For when someone would rather not be recorded. {bot.name} stops right away and deletes everything from this call. There won&apos;t be
              any notes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse items-stretch sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Keep taking notes
            </Button>
            <Button variant="danger" onClick={() => void discard()}>
              <Trash2 /> Stop and delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BlockNote({ block, botName }: { block: NonNullable<RecorderBlock> | { kind: "unsupported"; text: string }; botName: string }) {
  if (block.kind === "unsupported") {
    return (
      <p className="flex gap-2 rounded-2xl bg-warning-soft px-3.5 py-2.5 text-sm text-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          This browser can&apos;t keep {botName} on your screen while it listens, so it can&apos;t take notes here. Use Chrome or Edge on a computer, or
          the desktop app.
        </span>
      </p>
    );
  }
  return (
    <p className={cn("flex gap-2 rounded-2xl px-3.5 py-2.5 text-sm", block.kind === "minutes" ? "bg-warning-soft" : "bg-muted")}>
      <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", block.kind === "minutes" ? "text-warning" : "text-muted-foreground")} aria-hidden />
      <span>
        {block.text}
        {block.kind === "minutes" ? (
          <>
            {" "}
            <Link href="/app/billing" className="font-semibold text-primary underline-offset-2 hover:underline">
              See plans
            </Link>
          </>
        ) : null}
      </span>
    </p>
  );
}
