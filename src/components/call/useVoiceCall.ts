"use client";
/**
 * A call with the bot from the browser, through the voice server (voice/src/transports/web.ts):
 * the microphone goes up as 16 kHz PCM, the bot's voice comes back as PCM and is played without
 * gaps, and everything is dropped the moment the caller cuts in (the server says "clear").
 * Audio is never stored here.
 */
import * as React from "react";

export type CallStatus = "idle" | "starting" | "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "ended" | "error";
export type CallLine = { id: number; role: "caller" | "bot"; text: string; cut?: boolean };
export type CallTask = { id: number; request: string; state: "started" | "done" | "failed"; result?: string };

type ServerEvent =
  | { type: "ready"; outputRate: number; bot?: string; engine?: string; talker?: string }
  | { type: "state"; state: "listening" | "hearing" | "thinking" | "speaking" }
  | { type: "transcript"; role: "caller" | "bot"; text: string }
  | { type: "latency"; ms: number }
  | { type: "task"; state: "started" | "done" | "failed"; request: string; result?: string }
  | { type: "interrupted"; heard: string }
  | { type: "mark"; name: string }
  | { type: "clear" }
  | { type: "verified" }
  | { type: "ended"; by: string }
  | { type: "error"; message: string };

/** The AudioWorklet that turns the microphone into 20 ms PCM16 frames. */
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 50);
    this.buf = new Int16Array(this.size);
    this.n = 0;
    this.muted = false;
    this.port.onmessage = (e) => { if (e.data && typeof e.data.muted === "boolean") this.muted = e.data.muted; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const s = this.muted ? 0 : Math.max(-1, Math.min(1, ch[i]));
      if (Math.abs(s) > peak) peak = Math.abs(s);
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.size) {
        this.port.postMessage({ pcm: this.buf.buffer, peak }, [this.buf.buffer]);
        this.buf = new Int16Array(this.size);
        this.n = 0;
        peak = 0;
      }
    }
    return true;
  }
}
registerProcessor("bab-capture", Capture);
`;

export function useVoiceCall(botId: string) {
  const [status, setStatus] = React.useState<CallStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<CallLine[]>([]);
  const [tasks, setTasks] = React.useState<CallTask[]>([]);
  const [latency, setLatency] = React.useState<number | null>(null);
  const [muted, setMuted] = React.useState(false);
  const [info, setInfo] = React.useState<{ engine?: string; talker?: string } | null>(null);
  const [startedAt, setStartedAt] = React.useState<number | null>(null);

  const ws = React.useRef<WebSocket | null>(null);
  const capture = React.useRef<{ ctx: AudioContext; stream: MediaStream; node: AudioWorkletNode } | null>(null);
  const play = React.useRef<{ ctx: AudioContext; rate: number; next: number; sources: Set<AudioBufferSourceNode>; gain: GainNode; analyser: AnalyserNode } | null>(null);
  const timers = React.useRef(new Set<ReturnType<typeof setTimeout>>());
  const lineId = React.useRef(0);
  const callerPeak = React.useRef(0);
  const ended = React.useRef(false);

  const addLine = React.useCallback((role: CallLine["role"], text: string) => {
    setLines((prev) => [...prev.slice(-60), { id: ++lineId.current, role, text }]);
  }, []);

  const stopPlayback = React.useCallback(() => {
    const p = play.current;
    if (!p) return;
    for (const s of p.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    p.sources.clear();
    p.next = p.ctx.currentTime;
  }, []);

  const cleanup = React.useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current.clear();
    const c = capture.current;
    capture.current = null;
    if (c) {
      c.node.port.onmessage = null;
      c.stream.getTracks().forEach((t) => t.stop());
      void c.ctx.close().catch(() => {});
    }
    const p = play.current;
    play.current = null;
    if (p) void p.ctx.close().catch(() => {});
    const socket = ws.current;
    ws.current = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "bye");
  }, []);

  const finish = React.useCallback(
    (next: CallStatus, message?: string) => {
      if (ended.current) return;
      ended.current = true;
      if (message) setError(message);
      setStatus(next);
      cleanup();
    },
    [cleanup],
  );

  const onAudio = React.useCallback((data: ArrayBuffer) => {
    const p = play.current;
    if (!p) return;
    const pcm = new Int16Array(data);
    if (!pcm.length) return;
    const buffer = p.ctx.createBuffer(1, pcm.length, p.rate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = p.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(p.gain);
    // A little cushion before the first piece, then back to back.
    const at = Math.max(p.next, p.ctx.currentTime + 0.06);
    src.start(at);
    p.next = at + buffer.duration;
    p.sources.add(src);
    src.onended = () => p.sources.delete(src);
  }, []);

  const onEvent = React.useCallback(
    (e: ServerEvent) => {
      switch (e.type) {
        case "ready":
          setInfo({ engine: e.engine, talker: e.talker });
          setStartedAt(Date.now());
          if (play.current) play.current.rate = e.outputRate;
          setStatus("listening");
          break;
        case "state":
          setStatus(e.state);
          break;
        case "transcript":
          addLine(e.role, e.text);
          break;
        case "latency":
          setLatency(e.ms);
          break;
        case "task":
          setTasks((prev) => {
            if (e.state === "started") return [...prev, { id: prev.length + 1, request: e.request, state: "started" }];
            const i = [...prev].reverse().findIndex((t) => t.request === e.request && t.state === "started");
            if (i < 0) return prev;
            const idx = prev.length - 1 - i;
            return prev.map((t, j) => (j === idx ? { ...t, state: e.state, result: e.result } : t));
          });
          break;
        case "interrupted":
          stopPlayback();
          setLines((prev) => {
            const last = prev[prev.length - 1];
            return last?.role === "bot" ? [...prev.slice(0, -1), { ...last, text: e.heard || last.text, cut: true }] : prev;
          });
          break;
        case "clear":
          stopPlayback();
          break;
        case "mark": {
          // Say so when playback reaches this point.
          const p = play.current;
          const delay = p ? Math.max(0, p.next - p.ctx.currentTime) : 0;
          const t = setTimeout(() => {
            timers.current.delete(t);
            if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "mark", name: e.name }));
          }, delay * 1000);
          timers.current.add(t);
          break;
        }
        case "verified":
          break;
        case "ended":
          // Let the last words play out.
          {
            const p = play.current;
            const delay = p ? Math.max(0, p.next - p.ctx.currentTime) : 0;
            const t = setTimeout(() => finish("ended"), Math.min(8000, delay * 1000 + 200));
            timers.current.add(t);
          }
          break;
        case "error":
          finish("error", e.message);
          break;
      }
    },
    [addLine, finish, stopPlayback],
  );

  const start = React.useCallback(async () => {
    if (status !== "idle" && status !== "ended" && status !== "error") return;
    ended.current = false;
    setError(null);
    setLines([]);
    setTasks([]);
    setLatency(null);
    setStartedAt(null);
    setStatus("starting");
    // The microphone first: no point ringing if we can't hear.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch {
      setStatus("error");
      setError("Allow the microphone to talk to your bot.");
      return;
    }
    let res: Response;
    try {
      res = await fetch(`/api/bots/${botId}/calls`, { method: "POST" });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setStatus("error");
      setError("Couldn't reach the app. Check your connection.");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { token?: string; wsUrl?: string; error?: string };
    if (!res.ok || !body.token || !body.wsUrl) {
      stream.getTracks().forEach((t) => t.stop());
      setStatus("error");
      setError(body.error ?? "Couldn't start the call.");
      return;
    }
    setStatus("connecting");
    // Hear at 16 kHz when the browser can resample for us; otherwise send its own rate.
    let ctx: AudioContext;
    let source: MediaStreamAudioSourceNode;
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
      source = ctx.createMediaStreamSource(stream);
    } catch {
      ctx = new AudioContext();
      source = ctx.createMediaStreamSource(stream);
    }
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const node = new AudioWorkletNode(ctx, "bab-capture");
    source.connect(node);
    capture.current = { ctx, stream, node };
    const out = new AudioContext();
    const gain = out.createGain();
    const analyser = out.createAnalyser();
    analyser.fftSize = 256;
    gain.connect(analyser);
    analyser.connect(out.destination);
    play.current = { ctx: out, rate: 22050, next: 0, sources: new Set(), gain, analyser };

    const socket = new WebSocket(body.wsUrl);
    socket.binaryType = "arraybuffer";
    ws.current = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "hello", token: body.token, sampleRate: ctx.sampleRate }));
    socket.onmessage = (m) => {
      if (typeof m.data === "string") {
        try {
          onEvent(JSON.parse(m.data) as ServerEvent);
        } catch {
          /* not for us */
        }
      } else onAudio(m.data as ArrayBuffer);
    };
    socket.onclose = (e) => {
      if (!ended.current) finish(e.code === 1000 ? "ended" : "error", e.code === 1000 ? undefined : e.reason || "The call dropped.");
    };
    socket.onerror = () => {
      if (!ended.current) finish("error", "Couldn't reach the voice line.");
    };
    node.port.onmessage = (m: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(m.data.pcm);
      callerPeak.current = m.data.peak;
    };
  }, [botId, finish, onAudio, onEvent, status]);

  const hangUp = React.useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "hangup" }));
    finish("ended");
  }, [finish]);

  const toggleMute = React.useCallback(() => {
    setMuted((m) => {
      capture.current?.node.port.postMessage({ muted: !m });
      return !m;
    });
  }, []);

  /** How loud the caller is right now (0..1). */
  const callerLevel = React.useCallback((): number => (muted ? 0 : callerPeak.current), [muted]);

  /** How loud the bot is right now (0..1), for the speaking ring. */
  const botLevel = React.useCallback((): number => {
    const p = play.current;
    if (!p) return 0;
    const data = new Uint8Array(p.analyser.fftSize);
    p.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    return peak;
  }, []);

  React.useEffect(() => () => cleanup(), [cleanup]);

  return { status, error, lines, tasks, latency, muted, info, startedAt, start, hangUp, toggleMute, botLevel, callerLevel };
}
