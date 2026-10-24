/**
 * Stand-ins for a call's parts, so session logic can be tested in plain time with no models:
 * a caller made of loud and quiet audio, an engine that "hears" by measuring loud audio and "speaks"
 * tones as long as the words, a scripted model, an app that records what it's told.
 */
import type { AppApi, ActResult, CallReport, CallTurn, PinResult, SessionInfo } from "../../src/brain/app.ts";
import type { Llm, LlmEvent, LlmRequest } from "../../src/brain/llm.ts";
import type { EngineInfo, Heard, HearOptions, SpeakOptions, SpeechEngine, Spoken } from "../../src/speech/engine.ts";
import type { CallTransport } from "../../src/call/transport.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ms of loud audio in a 16 kHz clip. */
function loudMs(pcm: Int16Array): number {
  let n = 0;
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > 1500) n++;
  return (n * 1000) / 16000;
}

export class FakeEngine implements SpeechEngine {
  info: EngineInfo = { version: "fake", asr: true, tts: true, voices: ["Aria"], voice: "Aria", sampleRate: 22050 };
  ready = true;
  /** Down: every hear and speak fails, as when the sidecar has crashed. */
  down = false;
  /** Hung: speak never answers (no audio, no result), as a stuck engine. */
  hung = false;
  heard: { ms: number; opts?: HearOptions }[] = [];
  spoken: string[] = [];
  /** What the caller said, from how much they talked. */
  transcribe: (speechMs: number) => string;
  hearDelayMs: number;
  /** Synthesis speed: ms of compute per ms of audio. */
  speakFactor: number;

  constructor(opts: { transcribe?: (speechMs: number) => string; hearDelayMs?: number; speakFactor?: number } = {}) {
    this.transcribe = opts.transcribe ?? (() => "hello");
    this.hearDelayMs = opts.hearDelayMs ?? 10;
    this.speakFactor = opts.speakFactor ?? 0.05;
  }

  async hear(pcm: Int16Array, _rate: number, opts?: HearOptions): Promise<Heard> {
    if (this.down) throw new Error("speech engine isn't running");
    const ms = loudMs(pcm);
    this.heard.push({ ms, opts });
    await sleep(this.hearDelayMs);
    return { text: this.transcribe(ms), confidence: 0.9, elapsedMs: this.hearDelayMs };
  }

  async speak(text: string, opts: SpeakOptions, onAudio: (pcm: Int16Array) => void): Promise<Spoken> {
    if (this.down) throw new Error("speech engine isn't running");
    if (this.hung) return new Promise<Spoken>(() => {});
    this.spoken.push(text);
    // 60 ms of audio a word, made in 20 ms pieces.
    const words = text.split(/\s+/).filter(Boolean).length;
    const total = Math.round((opts.sampleRate * 60 * words) / 1000);
    const step = Math.round(opts.sampleRate / 50);
    for (let at = 0; at < total; at += step) {
      if (opts.signal?.aborted) return { status: "cancelled", ttfaMs: 1, rtfx: 20, audioS: at / opts.sampleRate, elapsedS: 0 };
      await sleep(Math.max(1, 20 * this.speakFactor));
      if (opts.signal?.aborted) return { status: "cancelled", ttfaMs: 1, rtfx: 20, audioS: at / opts.sampleRate, elapsedS: 0 };
      const n = Math.min(step, total - at);
      onAudio(new Int16Array(n).fill(1000));
    }
    return { status: "ok", ttfaMs: 1, rtfx: 20, audioS: total / opts.sampleRate, elapsedS: 0.01 };
  }

  async close(): Promise<void> {}
}

export type LlmScript = (
  req: LlmRequest,
  n: number,
) => { text?: string; tools?: { name: string; args: Record<string, unknown> }[]; delayMs?: number; /** The request fails (Token Factory down). */ fail?: string };

/** A model that answers from a script, streaming the text word by word. */
export class FakeLlm implements Llm {
  readonly model = "fake-nemotron";
  requests: LlmRequest[] = [];
  private readonly script: LlmScript;

  constructor(script: LlmScript) {
    this.script = script;
  }

  async *stream(req: LlmRequest): AsyncGenerator<LlmEvent> {
    const n = this.requests.length;
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
    const plan = this.script(req, n);
    await sleep(plan.delayMs ?? 20);
    if (req.signal?.aborted) return;
    if (plan.fail) throw new Error(plan.fail);
    for (const word of (plan.text ?? "").split(/(?<=\s)/)) {
      if (!word) continue;
      if (req.signal?.aborted) return;
      yield { type: "text", delta: word };
      await sleep(2);
    }
    let i = 0;
    for (const t of plan.tools ?? []) {
      const call = { id: `call_${n}_${i++}`, type: "function" as const, function: { name: t.name, arguments: JSON.stringify(t.args) } };
      yield { type: "tool_call", call, args: t.args };
    }
    yield { type: "done", finish: plan.tools?.length ? "tool_calls" : "stop", usage: { inputTokens: 100, outputTokens: 10 }, firstTokenMs: plan.delayMs ?? 20 };
  }
}

export class FakeApp implements AppApi {
  acts: string[] = [];
  pins: string[] = [];
  turns: CallTurn[] = [];
  reports: CallReport[] = [];
  actResult: (request: string) => ActResult = (request) => ({ text: `Done: ${request}`, status: "ok", approvals: [] });
  actDelayMs = 20;
  pinResult: (pin: string) => PinResult = (pin) => (pin === "4481" ? { ok: true, firstName: "Diego", context: "Owner: Diego." } : { ok: false, remaining: 2, locked: false });

  async session(_callId: string, _kind: "web" | "phone"): Promise<SessionInfo> {
    throw new Error("not used");
  }

  async act(_callId: string, request: string): Promise<ActResult> {
    this.acts.push(request);
    await sleep(this.actDelayMs);
    return this.actResult(request);
  }

  async pin(_callId: string, pin: string): Promise<PinResult> {
    this.pins.push(pin);
    return this.pinResult(pin);
  }

  async turn(_callId: string, turn: CallTurn): Promise<void> {
    this.turns.push(turn);
  }

  async end(_callId: string, report: CallReport): Promise<void> {
    this.reports.push(report);
  }
}

export class FakeTransport implements CallTransport {
  readonly kind: "web" | "phone";
  readonly outputRate = 8000;
  readonly reportsMarks = false;
  onAudio: ((pcm: Int16Array) => void) | null = null;
  onDtmf: ((digit: string) => void) | null = null;
  onMark: ((name: string) => void) | null = null;
  onClose: ((why: string) => void) | null = null;
  sentMs = 0;
  clears = 0;
  events: Record<string, unknown>[] = [];
  closed: string | null = null;
  open = true;

  constructor(kind: "web" | "phone" = "phone") {
    this.kind = kind;
  }

  /** The far end hangs up. */
  hangUp(): void {
    if (!this.open) return;
    this.open = false;
    this.onClose?.("hung up");
  }

  sendAudio(pcm: Int16Array): void {
    this.sentMs += (pcm.length * 1000) / this.outputRate;
  }
  mark(): void {}
  clear(): void {
    this.clears++;
  }
  event(e: Record<string, unknown>): void {
    this.events.push(e);
  }
  close(reason?: string): void {
    this.open = false;
    this.closed = reason ?? "closed";
  }
}

/** A caller: loud audio is talking, zeros are silence, fed a bit faster than real time. */
export class Caller {
  private readonly transport: FakeTransport;
  private readonly speed: number;

  constructor(transport: FakeTransport, speed = 4) {
    this.transport = transport;
    this.speed = speed;
  }

  private async feed(ms: number, value: number): Promise<void> {
    for (let t = 0; t < ms; t += 32) {
      const pcm = new Int16Array(512);
      if (value) for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(value * Math.sin(i / 3));
      this.transport.onAudio?.(pcm);
      await sleep(32 / this.speed);
    }
  }

  talk(ms: number): Promise<void> {
    return this.feed(ms, 9000);
  }

  silence(ms: number): Promise<void> {
    return this.feed(ms, 0);
  }
}

export function sessionInfo(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    callId: "call_test",
    kind: "phone",
    bot: { id: "bot_1", name: "Otto", persona: "Friendly and brief." },
    owner: { firstName: "Diego", timezone: "America/Chicago" },
    speaker: "owner",
    greeting: "Hey Diego, it's Otto.",
    context: "Owner: Diego.",
    phrases: ["Otto", "Diego"],
    maxMinutes: 10,
    pinAvailable: false,
    ...over,
  };
}

export async function until(cond: () => boolean, timeoutMs = 5000, what = "condition"): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}
