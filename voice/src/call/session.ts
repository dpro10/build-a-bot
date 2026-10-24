/**
 * One call, from hello to goodbye.
 *
 *   caller audio → Silero VAD → turn detector ─┬─ pause: Parakeet hears the turn so far, and the talker
 *                                              │        starts its reply, held back (spoken nowhere yet)
 *                                              ├─ resume: they weren't done; drop the held reply
 *                                              └─ end: release the held reply at once (or hear and
 *                                                       answer now if there wasn't one)
 *   reply: Nemotron writes a step → sentences → Magpie streams audio → the caller
 *   barge-in: the caller talks over the bot → stop mid-word, clear what hasn't played, listen
 *
 * The talker hands real work to the bot's agent in the app (ask_bot). What it says alongside a
 * hand-off is held back (it can't know yet how the job will go): the caller hears "Let me check."
 * instead, and the talker answers from the job's real outcome. A reply that still claims what didn't
 * happen is replaced by an honest line. Work that takes a while keeps running; its result comes back
 * as an <update> when the line is quiet.
 */
import type { AppApi, CallReport, CallTurn, SessionInfo } from "../brain/app.ts";
import {
  ASK_BOT,
  END_CALL,
  NOTHING_RAN,
  UNREACHABLE,
  WORKING,
  claimsDone,
  claimsWork,
  honestLine,
  jobDone,
  jobFromAct,
  jobResult,
  jobUpdate,
  lostLine,
  notDoneLine,
  talkerPrompt,
  talkerTools,
  type Job,
} from "../brain/talker.ts";
import type { ChatMessage, Llm, LlmUsage, ToolCall } from "../brain/llm.ts";
import type { SpeechEngine, Heard } from "../speech/engine.ts";
import { SentenceChunker } from "../speech/text.ts";
import { TurnDetector, endDelayFor, type TurnEvent, type TurnOptions } from "../turn/detector.ts";
import { VAD_RATE, VAD_WINDOW_MS, type Vad, type VadStream } from "../vad/vad.ts";
import { concatPcm } from "../audio/pcm.ts";
import { ENGINE_TROUBLE, PhraseCache } from "./phrases.ts";
import { hasDigits, maskPin, pinFromSpeech } from "./pin.ts";
import { Speaker, type SpeechPace } from "./speaker.ts";
import type { CallTransport } from "./transport.ts";

export type SessionConfig = {
  turn: Partial<TurnOptions>;
  /** Hear and start answering at the first pause, before the turn is surely over. */
  speculate: boolean;
  /** Say a filler if nothing's been said this long after the caller finished. */
  fillerAfterMs: number;
  /** How long to wait for the bot's agent before saying it'll follow up. */
  actWaitMs: number;
  /** Quiet this long after the bot speaks: "Are you still there?", then goodbye. */
  idleMs: number;
  /** Audio kept from before speech was detected, so first syllables aren't clipped. */
  prerollMs: number;
  /** Longest stretch of one turn sent to speech recognition. */
  maxTurnMs: number;
  /** Talker messages kept (older ones fall away). */
  maxHistory: number;
};

export const DEFAULT_SESSION: SessionConfig = {
  turn: {},
  speculate: true,
  fillerAfterMs: 1300,
  actWaitMs: 8000,
  idleMs: 15_000,
  prerollMs: 320,
  maxTurnMs: 45_000,
  maxHistory: 30,
};

export type SessionDeps = {
  engine: SpeechEngine;
  vad: Vad;
  llm: Llm;
  app: AppApi;
  phrases: PhraseCache;
  /** How fast speech is made here (shared by every call): sentences wait to play without gaps. */
  pace?: SpeechPace;
  transport: CallTransport;
  info: SessionInfo;
  config?: Partial<SessionConfig>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  now?: () => number;
};

type Reply = {
  id: number;
  /** What the caller said (or the update being passed on). */
  input: string;
  isUpdate: boolean;
  held: boolean;
  ac: AbortController;
  /** Resolves when a held reply is released (true) or dropped (false). */
  committed: Promise<boolean>;
  commit: (ok: boolean) => void;
  /** Text queued to speak, per step. */
  said: string[];
  /** Ids of the speaker pieces it queued. */
  pieces: Set<number>;
  firstAudioAt: number | null;
  firstTokenMs: number | null;
  /** Wall time the caller stopped talking, for latency. */
  speechEndedAt: number | null;
  heardMs: number | null;
  done: Promise<void>;
  /** Messages it adds to the talker's history (the caller's words, what it said, tool results). */
  added: ChatMessage[];
  /** It has asked the bot's agent to do something: never dropped quietly after that. */
  toolsStarted: boolean;
  turnIndex: number | null;
  /** What became of the last request it handed to the bot's agent (an update starts with its own). */
  job: Job | null;
};

type Speculation = { id: number; samples: number; heard: Promise<Heard | null>; reply: Reply | null; pin: string | null };

const DEFAULT_LATENCY_TURNS = 200;

export class CallSession {
  readonly info: SessionInfo;
  private readonly engine: SpeechEngine;
  private readonly llm: Llm;
  private readonly app: AppApi;
  private readonly phrases: PhraseCache;
  private readonly transport: CallTransport;
  private readonly cfg: SessionConfig;
  private readonly log: (event: string, fields?: Record<string, unknown>) => void;
  private readonly now: () => number;
  private readonly vad: VadStream;
  private readonly detector: TurnDetector;
  private readonly speaker: Speaker;

  private startedAt = 0;
  /** The call is over: nothing more happens on it. */
  private ended = false;
  /** The call is ending (a goodbye may still be playing): no new turns. */
  private ending: Promise<CallReport> | null = null;
  private endedBy: CallReport["endedBy"] = "caller";
  private finished!: Promise<CallReport>;
  private resolveFinished!: (r: CallReport) => void;

  // Caller audio, from just before the current turn.
  private chunks: { start: number; pcm: Int16Array }[] = [];
  private samplesIn = 0;
  private turnStartSample = 0;
  private speechEndedAt: number | null = null;

  private specSeq = 0;
  private spec: Speculation | null = null;
  private replySeq = 0;
  private reply: Reply | null = null;
  /** Which reply each queued piece of speech belongs to, until it starts playing. */
  private pieceReply = new Map<number, Reply>();
  /** A turn whose answer was dropped because they kept talking: said again with the next one. */
  private carry = "";
  /** A turn that came in while a reply was busy with the bot's agent: answered after it. */
  private pendingInput: { input: string; speechEndedAt: number; heardMs: number | null } | null = null;
  private history: ChatMessage[] = [];
  private turns: CallTurn[] = [];
  private latencies: number[] = [];
  private usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  private updates: { text: string; job: Job }[] = [];
  private jobs = 0;
  private fillerTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private askedStillThere = false;
  private hangupAfterSpeech = false;
  private dtmf = "";
  private dtmfTimer: ReturnType<typeof setTimeout> | null = null;
  private pinTries = 0;
  /** The line is gone: nothing more can be said on it. */
  private hungUp = false;
  /** The speech engine failed this many times in a row (it couldn't say or hear anything). */
  private engineErrors = 0;

  constructor(deps: SessionDeps) {
    this.info = deps.info;
    this.engine = deps.engine;
    this.llm = deps.llm;
    this.app = deps.app;
    this.phrases = deps.phrases;
    this.transport = deps.transport;
    this.cfg = { ...DEFAULT_SESSION, ...deps.config, turn: { ...DEFAULT_SESSION.turn, ...deps.config?.turn } };
    this.log = deps.log ?? (() => {});
    this.now = deps.now ?? (() => performance.now());
    this.vad = deps.vad.stream();
    this.detector = new TurnDetector(this.cfg.turn);
    this.speaker = new Speaker({
      engine: deps.engine,
      transport: deps.transport,
      voice: deps.info.bot.voice || deps.engine.info.voice || undefined,
      language: deps.info.language,
      now: this.now,
      pace: deps.pace,
      events: {
        onTalking: () => {
          this.detector.botSpeaking = true;
          this.clearIdle();
          this.transport.event({ type: "state", state: "speaking" });
        },
        onQuiet: () => {
          this.detector.botSpeaking = false;
          this.transport.event({ type: "state", state: "listening" });
          this.onQuiet();
        },
        onAudioStart: (piece) => {
          if (piece.made) this.engineErrors = 0;
          this.onAudioStart(piece.id);
        },
        onError: (err) => {
          this.log("tts_error", { error: err.message });
          this.engineTrouble();
        },
      },
    });
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve));
  }

  get voice(): string {
    return this.speaker.voice ?? "";
  }

  /** Answers the call; resolves with the report when it's over. */
  start(): Promise<CallReport> {
    this.startedAt = this.now();
    this.transport.onAudio = (pcm) => this.onAudio(pcm);
    this.transport.onDtmf = (digit) => this.onDtmf(digit);
    this.transport.onClose = (why) => {
      this.hungUp = true;
      this.log("transport_closed", { why });
      void this.end("caller");
    };
    // They hung up while the call was being set up: nobody's there to talk to.
    if (!this.transport.open) {
      this.hungUp = true;
      this.log("transport_closed", { why: "before the call started" });
      void this.end("caller");
      return this.finished;
    }
    this.history = [];
    this.say(this.info.greeting, "bot");
    const maxMs = Math.max(1, this.info.maxMinutes) * 60_000;
    this.limitTimer = setTimeout(() => {
      this.limitTimer = null;
      void this.end("limit", "I have to wrap up this call now. Talk soon!");
    }, maxMs);

    // Fillers in this call's voice and rate, made while the greeting plays.
    void this.phrases.warm(["Mm-hm.", "One sec.", "Let me check."], this.voice, this.transport.outputRate);
    return this.finished;
  }

  // ---- hearing ------------------------------------------------------------------------------

  private onAudio(pcm: Int16Array): void {
    if (this.ended || this.ending || !pcm.length) return;
    this.chunks.push({ start: this.samplesIn, pcm });
    this.samplesIn += pcm.length;
    this.trimAudio();
    this.vad
      .push(pcm)
      .then((probs) => {
        for (const p of probs) for (const e of this.detector.push(p, VAD_WINDOW_MS)) this.onTurnEvent(e);
      })
      .catch((err: Error) => this.log("vad_error", { error: err.message }));
  }

  /** Keeps the preroll when nobody's talking, and at most maxTurnMs of a turn. */
  private trimAudio(): void {
    const keepFrom = this.detector.speaking
      ? Math.max(this.turnStartSample, this.samplesIn - (this.cfg.maxTurnMs * VAD_RATE) / 1000)
      : this.samplesIn - (this.cfg.prerollMs * VAD_RATE) / 1000 - VAD_RATE;
    while (this.chunks.length > 1 && this.chunks[0].start + this.chunks[0].pcm.length <= keepFrom) this.chunks.shift();
  }

  private turnAudio(): Int16Array {
    const from = this.turnStartSample;
    const parts: Int16Array[] = [];
    for (const c of this.chunks) {
      const end = c.start + c.pcm.length;
      if (end <= from) continue;
      parts.push(c.start >= from ? c.pcm : c.pcm.subarray(from - c.start));
    }
    return concatPcm(parts);
  }

  private onTurnEvent(e: TurnEvent): void {
    if (this.ended || this.ending) return;
    switch (e.type) {
      case "barge_in": {
        this.log("barge_in");
        this.interrupt();
        break;
      }
      case "speech_start": {
        this.clearIdle();
        this.turnStartSample = Math.max(0, Math.round(((e.at - this.cfg.prerollMs) * VAD_RATE) / 1000));
        // They started again before the answer was audible: drop it, and hear both parts together.
        if (this.reply && !this.reply.isUpdate && this.reply.firstAudioAt === null && !this.reply.held && !this.reply.toolsStarted) {
          this.carry = `${this.carry} ${this.reply.input}`.trim();
          this.dropReply(this.reply);
        }
        this.transport.event({ type: "state", state: "hearing" });
        break;
      }
      case "pause": {
        this.speechEndedAt = this.now() - this.detector.opts.pauseMs;
        if (this.cfg.speculate) this.speculate();
        break;
      }
      case "resume": {
        this.dropSpeculation();
        break;
      }
      case "end": {
        void this.endTurn();
        break;
      }
    }
  }

  private hear(pcm: Int16Array): Promise<Heard | null> {
    const t0 = this.now();
    return this.engine
      .hear(pcm, VAD_RATE, { phrases: this.info.phrases, language: this.info.language })
      .then((h) => {
        this.engineErrors = 0;
        this.log("heard", { audioMs: Math.round((pcm.length * 1000) / VAD_RATE), ms: Math.round(this.now() - t0) });
        return h;
      })
      .catch((err: Error) => {
        this.log("asr_error", { error: err.message });
        this.engineTrouble();
        return null;
      });
  }

  /** At the first pause: hear the turn so far and start answering, held back. */
  private speculate(): void {
    this.dropSpeculation();
    const id = ++this.specSeq;
    const samples = this.samplesIn;
    const heard = this.hear(this.turnAudio());
    const spec: Speculation = { id, samples, heard, reply: null, pin: null };
    this.spec = spec;
    void heard.then((h) => {
      if (this.spec !== spec || !h) return;
      const text = h.text.trim();
      const pinNext = this.wantsPin() && hasDigits(text);
      // Someone reading out digits may pause between them: give them longer.
      this.detector.setEndMs(pinNext ? Math.round(this.detector.opts.endMs * 1.9) : endDelayFor(text, this.detector.opts.endMs));
      if (!text) return;
      if (pinNext) {
        // Maybe a PIN, maybe one still being said: it waits for the turn's end, and never goes to the model.
        spec.pin = pinFromSpeech(text);
        return;
      }
      // Don't hold a reply while the bot is still saying something else.
      if (this.speaker.busy || this.reply) return;
      spec.reply = this.startReply(this.withCarry(text), { held: true });
    });
  }

  private dropSpeculation(): void {
    const spec = this.spec;
    this.spec = null;
    if (spec?.reply) this.dropReply(spec.reply);
  }

  private async endTurn(): Promise<void> {
    const spec = this.spec;
    this.spec = null;
    const speechEndedAt = this.speechEndedAt ?? this.now();
    let heard: Heard | null;
    let reply: Reply | null = null;
    if (spec) {
      heard = await spec.heard;
      reply = spec.reply;
    } else {
      heard = await this.hear(this.turnAudio());
    }
    if (this.ended || this.ending) return;
    const text = heard?.text.trim() ?? "";
    if (!text) {
      // Noise, a cough, or nothing recognizable.
      if (reply) this.dropReply(reply);
      this.onQuiet();
      return;
    }
    if (this.wantsPin()) {
      const pin = spec?.pin ?? pinFromSpeech(text);
      if (pin) {
        if (reply) this.dropReply(reply);
        this.recordTurn("caller", "(said a PIN)");
        await this.checkPin(pin);
        return;
      }
    }
    // While a PIN is wanted, digits that could be one never reach the model or the transcript.
    const said = this.wantsPin() ? maskPin(text) : text;
    const input = this.withCarry(said);
    // They started talking again while this was being heard: answer it together with what follows.
    if (this.detector.speaking) {
      if (reply) this.dropReply(reply);
      this.carry = input;
      return;
    }
    this.carry = "";
    this.recordTurn("caller", said);
    if (this.reply && this.reply.toolsStarted && !this.reply.ac.signal.aborted) {
      // The bot's agent is still on the last request: answer this one right after.
      if (reply) this.dropReply(reply);
      this.pendingInput = { input, speechEndedAt, heardMs: heard?.elapsedMs ?? null };
      return;
    }
    if (reply && reply.input === input && !reply.ac.signal.aborted) {
      reply.speechEndedAt = speechEndedAt;
      reply.heardMs = heard?.elapsedMs ?? null;
      this.reply = reply;
      reply.held = false;
      this.speaker.release();
      reply.commit(true);
      this.log("speculation_used", { reply: reply.id });
    } else {
      if (reply) this.dropReply(reply);
      reply = this.startReply(input, { held: false });
      reply.speechEndedAt = speechEndedAt;
      reply.heardMs = heard?.elapsedMs ?? null;
    }
    this.armFiller(reply);
  }

  private withCarry(text: string): string {
    return this.carry ? `${this.carry} ${text}` : text;
  }

  private wantsPin(): boolean {
    return this.info.speaker === "unverified" && this.info.pinAvailable;
  }

  // ---- answering ----------------------------------------------------------------------------

  private startReply(input: string, opts: { held: boolean; isUpdate?: boolean; job?: Job }): Reply {
    let commit!: (ok: boolean) => void;
    const committed = new Promise<boolean>((resolve) => (commit = resolve));
    const reply: Reply = {
      id: ++this.replySeq,
      input,
      isUpdate: opts.isUpdate ?? false,
      held: opts.held,
      ac: new AbortController(),
      committed,
      commit,
      said: [],
      pieces: new Set(),
      firstAudioAt: null,
      firstTokenMs: null,
      speechEndedAt: null,
      heardMs: null,
      done: Promise.resolve(),
      added: [],
      toolsStarted: false,
      turnIndex: null,
      job: opts.job ?? null,
    };
    if (opts.held) this.speaker.hold();
    else {
      reply.commit(true);
      this.reply = reply;
    }
    this.transport.event({ type: "state", state: "thinking" });
    reply.done = this.runReply(reply).catch((err: Error) => this.replyFailed(reply, err));
    return reply;
  }

  private async runReply(reply: Reply): Promise<void> {
    const messages: ChatMessage[] = [...this.history, { role: "user", content: reply.input }];
    reply.added.push({ role: "user", content: reply.input });
    const tools = talkerTools(this.info);
    let nudged = false;
    for (let step = 0; step < 4; step++) {
      if (reply.ac.signal.aborted) return;
      // A step is heard whole before any of it is said (the talker's whole answer comes about a
      // tenth of a second after its first word): words that come with a hand-off can't know yet
      // how the job will go, and a claim can be checked before anyone hears it.
      let text = "";
      const calls: { call: ToolCall; args: Record<string, unknown> | null }[] = [];
      for await (const ev of this.llm.stream({ system: talkerPrompt(this.info), messages, tools, signal: reply.ac.signal })) {
        if (reply.ac.signal.aborted) return;
        if (ev.type === "text") {
          text += ev.delta;
        } else if (ev.type === "tool_call") {
          calls.push({ call: ev.call, args: ev.args });
        } else if (ev.type === "done") {
          this.usage.inputTokens += ev.usage.inputTokens;
          this.usage.outputTokens += ev.usage.outputTokens;
          if (reply.firstTokenMs === null) reply.firstTokenMs = ev.firstTokenMs;
        }
      }
      if (reply.ac.signal.aborted) return;
      text = text.trim();
      const handsOff = calls.some((c) => c.call.function.name === ASK_BOT);
      if (!handsOff) {
        // After a job that didn't do it, or with no job at all: no saying it was done.
        if (reply.job ? !jobDone(reply.job) && claimsDone(text) : claimsWork(text)) {
          if (!reply.job && !nudged && step < 3) {
            nudged = true;
            this.log("claim_without_job", { reply: reply.id });
            messages.push({ role: "assistant", content: text }, { role: "user", content: NOTHING_RAN });
            continue;
          }
          this.log("claim_replaced", { reply: reply.id, status: reply.job?.status ?? "none" });
          text = reply.job ? honestLine(reply.job, this.info) : notDoneLine(this.info);
        }
        this.speak(reply, text);
      }
      if (!calls.length) {
        if (text) {
          const assistant: ChatMessage = { role: "assistant", content: text };
          messages.push(assistant);
          reply.added.push(assistant);
        }
        break;
      }
      // Tools run only for a reply the caller is really getting.
      if (!(await reply.committed) || reply.ac.signal.aborted) return;
      reply.toolsStarted = true;
      // What came with a hand-off was never said, so the talker doesn't remember saying it.
      const assistant: ChatMessage = { role: "assistant", content: handsOff ? "" : text, tool_calls: calls.map((c) => c.call) };
      messages.push(assistant);
      reply.added.push(assistant);
      if (handsOff) this.queueFiller(reply, "Let me check.");
      let ending = false;
      for (const { call, args } of calls) {
        let result: string;
        if (call.function.name === END_CALL) {
          ending = true;
          result = JSON.stringify({ status: "ending" });
        } else if (call.function.name === ASK_BOT && typeof args?.request === "string" && args.request.trim()) {
          reply.job = await this.askBot(args.request.trim(), reply);
          result = jobResult(reply.job, this.info);
        } else {
          result = JSON.stringify({ status: "error", error: `unknown tool or missing request: ${call.function.name}` });
        }
        const toolMsg: ChatMessage = { role: "tool", tool_call_id: call.id, content: result };
        messages.push(toolMsg);
        reply.added.push(toolMsg);
      }
      if (ending) {
        this.hangupAfterSpeech = true;
        if (!text || handsOff) this.speak(reply, "Okay, bye!");
        break;
      }
    }
    if (reply.ac.signal.aborted || !(await reply.committed)) return;
    this.afterReply(reply);
  }

  /** The talker failed (Token Factory down, too slow, or broken): say what's true, and carry on. */
  private replyFailed(reply: Reply, err: Error): void {
    if (reply.ac.signal.aborted || this.ended || this.ending) return;
    this.log("reply_error", { error: err.message });
    // A guess at a turn that may not be over: drop it, and the turn's end starts afresh.
    if (reply.held) {
      this.dropReply(reply);
      return;
    }
    const line = lostLine(reply.job, this.info);
    this.speak(reply, line);
    reply.added.push({ role: "assistant", content: line });
    this.afterReply(reply);
  }

  /** A reply is over: the talker remembers it, the transcript gets what was said, and a turn that waited goes next. */
  private afterReply(reply: Reply): void {
    this.remember(reply.added);
    const said = reply.said.join(" ").trim();
    if (said) reply.turnIndex = this.recordTurn("bot", said);
    if (this.reply === reply) this.reply = null;
    const next = this.pendingInput;
    this.pendingInput = null;
    if (next && !this.ended && !this.ending) {
      const r = this.startReply(next.input, { held: false });
      r.speechEndedAt = next.speechEndedAt;
      r.heardMs = next.heardMs;
      this.armFiller(r);
      return;
    }
    this.onQuiet();
  }

  /** Adds to the talker's history, keeping it short and in a shape the API accepts. */
  private remember(messages: ChatMessage[]): void {
    this.history = sanitizeHistory([...this.history, ...messages]).slice(-this.cfg.maxHistory);
    this.history = sanitizeHistory(this.history);
  }

  /** What the talker said, a sentence at a time. */
  private speak(reply: Reply, text: string): void {
    const chunker = new SentenceChunker();
    for (const sentence of [...chunker.push(text), ...chunker.flush()]) this.queueSpeech(reply, sentence);
  }

  private queueSpeech(reply: Reply, sentence: string): void {
    reply.said.push(sentence);
    this.track(reply, this.speaker.say(sentence));
    this.transport.event({ type: "say", text: sentence, reply: reply.id });
  }

  private queueFiller(reply: Reply, text: string): void {
    const audio = this.phrases.get(text, this.voice, this.transport.outputRate);
    this.track(reply, this.speaker.say(text, audio));
  }

  private track(reply: Reply, pieceId: number): void {
    reply.pieces.add(pieceId);
    this.pieceReply.set(pieceId, reply);
  }

  private armFiller(reply: Reply): void {
    if (this.fillerTimer) clearTimeout(this.fillerTimer);
    this.fillerTimer = setTimeout(() => {
      this.fillerTimer = null;
      if (this.reply !== reply || reply.ac.signal.aborted || reply.firstAudioAt !== null || this.speaker.busy) return;
      const text = reply.input.length > 60 ? "Let me think." : "Mm-hm.";
      const audio = this.phrases.get(text, this.voice, this.transport.outputRate) ?? this.phrases.get("Mm-hm.", this.voice, this.transport.outputRate);
      if (!audio) return;
      this.log("filler", { reply: reply.id });
      this.track(reply, this.speaker.say(text, audio));
    }, this.cfg.fillerAfterMs);
  }

  /** The bot's agent, in the app: wait a while for its answer, then let it finish in the background. */
  private async askBot(request: string, reply: Reply): Promise<Job> {
    this.jobs++;
    this.transport.event({ type: "task", state: "started", request });
    const job: Promise<Job> = this.app.act(this.info.callId, request).then(jobFromAct, (err: Error) => {
      this.log("act_error", { error: err.message });
      return UNREACHABLE;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), this.cfg.actWaitMs)));
    const aborted = new Promise<null>((resolve) => reply.ac.signal.addEventListener("abort", () => resolve(null), { once: true }));
    const first = reply.ac.signal.aborted ? null : await Promise.race([job, waited, aborted]);
    clearTimeout(timer);
    const finish = (j: Job) => {
      this.jobs--;
      this.transport.event({ type: "task", state: jobDone(j) ? "done" : "failed", request, status: j.status, result: j.text || undefined });
    };
    if (first) {
      finish(first);
      return first;
    }
    // Still going: the talker says so now, and the answer is passed on when it comes.
    void job.then((j) => {
      finish(j);
      if (this.ended || this.ending) return;
      this.queueUpdate(jobUpdate(request, j, this.info), j);
    });
    return WORKING;
  }

  private queueUpdate(text: string, job: Job): void {
    this.updates.push({ text, job });
    this.onQuiet();
  }

  /** Says something outside the talker (a fixed line, or pre-made audio of it), as its own reply. */
  private speakNow(text: string, audio?: Int16Array): void {
    this.speaker.say(text, audio);
    this.recordTurn("bot", text);
  }

  private say(text: string, role: "bot"): void {
    if (!text.trim()) return;
    this.speaker.say(text);
    this.recordTurn(role, text);
    this.remember([{ role: "assistant", content: text }]);
  }

  private dropReply(reply: Reply): void {
    if (reply.ac.signal.aborted) return;
    reply.ac.abort();
    reply.commit(false);
    if (this.reply === reply) this.reply = null;
    // Its audio (held or queued) goes too.
    this.speaker.stop();
    this.log("reply_dropped", { reply: reply.id });
  }

  /** The caller talked over the bot. */
  private interrupt(): void {
    const current = this.reply;
    const { heard, cut } = this.speaker.stop();
    if (current) {
      current.ac.abort();
      current.commit(false);
      this.reply = null;
      // The talker remembers what the caller actually heard, and what its agent was asked to do.
      const added = current.added.map((m) => ({ ...m }));
      const lastSaid = [...added].reverse().find((m) => m.role === "assistant");
      if (lastSaid && cut) lastSaid.content = heard ? `${heard} [cut off by the caller]` : "[cut off by the caller]";
      this.remember(added);
      const said = heard || current.said.join(" ").trim();
      if (said) this.recordTurn("bot", said, cut);
    } else if (cut) {
      const last = [...this.history].reverse().find((m) => m.role === "assistant");
      if (last) last.content = heard ? `${heard} [cut off by the caller]` : "[cut off by the caller]";
      const lastTurn = this.turns[this.turns.length - 1];
      if (lastTurn?.role === "bot") {
        lastTurn.text = heard || lastTurn.text;
        lastTurn.interrupted = true;
      }
    }
    this.transport.event({ type: "interrupted", heard });
  }

  private onAudioStart(pieceId: number): void {
    const reply = this.pieceReply.get(pieceId);
    this.pieceReply.delete(pieceId);
    if (!reply || reply.firstAudioAt !== null || reply.ac.signal.aborted) return;
    reply.firstAudioAt = this.now();
    if (reply.speechEndedAt !== null) {
      const ms = Math.round(reply.firstAudioAt - reply.speechEndedAt);
      if (this.latencies.length < DEFAULT_LATENCY_TURNS) this.latencies.push(ms);
      this.log("latency", { ms, asrMs: reply.heardMs === null ? null : Math.round(reply.heardMs), llmFirstTokenMs: reply.firstTokenMs === null ? null : Math.round(reply.firstTokenMs) });
      this.transport.event({ type: "latency", ms, asrMs: reply.heardMs, llmMs: reply.firstTokenMs });
    }
  }

  /** The line went quiet: hang up if asked, pass on an update, or start the idle clock. */
  private onQuiet(): void {
    if (this.ended || this.ending || this.speaker.busy || this.detector.speaking || this.reply || this.spec) return;
    if (this.hangupAfterSpeech) {
      void this.end(this.endedBy === "caller" ? "bot" : this.endedBy);
      return;
    }
    const update = this.updates.shift();
    if (update) {
      this.startReply(`<update>${update.text}</update>`, { held: false, isUpdate: true, job: update.job });
      return;
    }
    this.armIdle();
  }

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.ended || this.ending || this.speaker.busy || this.reply || this.detector.speaking) return;
      if (this.jobs > 0) {
        this.armIdle();
        return;
      }
      if (!this.askedStillThere) {
        this.askedStillThere = true;
        this.speakNow("Are you still there?");
        return;
      }
      void this.end("bot", "I'll let you go. Talk soon!");
    }, this.cfg.idleMs);

  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.askedStillThere = this.askedStillThere && this.detector.speaking ? false : this.askedStillThere;
  }

  /**
   * The speech engine failed: a sentence it couldn't say, a turn it couldn't hear. Once it's down
   * or restarting, or fails twice in a row, the caller would only get silence: say sorry (from
   * audio made at start-up, if there is some) and end the call.
   */
  private engineTrouble(): void {
    if (this.ended || this.ending) return;
    this.engineErrors++;
    if (this.engine.ready && this.engineErrors < 2) return;
    this.log("engine_trouble", { errors: this.engineErrors, ready: this.engine.ready });
    const audio = this.phrases.get(ENGINE_TROUBLE, this.voice, this.transport.outputRate);
    void this.end("error", audio ? ENGINE_TROUBLE : undefined, audio);
  }

  // ---- PIN ----------------------------------------------------------------------------------

  private onDtmf(digit: string): void {
    if (!this.wantsPin()) return;
    if (this.dtmfTimer) clearTimeout(this.dtmfTimer);
    if (digit === "#" || digit === "*") {
      const pin = this.dtmf;
      this.dtmf = "";
      if (pin.length >= 4) void this.checkPin(pin);
      return;
    }
    if (!/^\d$/.test(digit)) return;
    this.dtmf += digit;
    if (this.dtmf.length >= 8) {
      const pin = this.dtmf;
      this.dtmf = "";
      void this.checkPin(pin);
      return;
    }
    // Typed digits then a pause count as done.
    this.dtmfTimer = setTimeout(() => {
      const pin = this.dtmf;
      this.dtmf = "";
      if (pin.length >= 4) void this.checkPin(pin);
    }, 2500);
  }

  private async checkPin(pin: string): Promise<void> {
    this.pinTries++;
    let result;
    try {
      result = await this.app.pin(this.info.callId, pin);
    } catch (err) {
      this.log("pin_error", { error: (err as Error).message });
      this.speakNow("I couldn't check that just now. Try again in a moment.");
      return;
    }
    if (this.ended || this.ending) return;
    if (result.ok) {
      this.info.speaker = "owner";
      this.info.owner.firstName = result.firstName || this.info.owner.firstName;
      this.info.context = result.context || this.info.context;
      this.remember([{ role: "user", content: "(The caller said the right PIN: it's the owner.)" }]);
      this.transport.event({ type: "verified" });
      this.speakNow(`Thanks, ${this.info.owner.firstName}. What can I do for you?`);
      return;
    }
    if (result.locked) {
      this.info.pinAvailable = false;
      this.info.speaker = "contact";
      this.speakNow("That's too many tries, so I can only take a message for now.");
      return;
    }
    this.speakNow(result.remaining > 0 ? "That PIN didn't match. Try once more?" : "That PIN didn't match.");
  }

  // ---- the end ------------------------------------------------------------------------------

  private recordTurn(role: CallTurn["role"], text: string, interrupted = false): number {
    const turn: CallTurn = { role, text, at: Math.round(this.now() - this.startedAt), ...(interrupted ? { interrupted } : {}) };
    this.turns.push(turn);
    this.transport.event({ type: "transcript", role, text });
    void this.app.turn(this.info.callId, turn).catch(() => {});
    return this.turns.length - 1;
  }

  /**
   * Ends the call (once: later calls get the same report): a goodbye if there's one and someone to
   * hear it, then the report to the app, then the line closes.
   */
  end(endedBy: CallReport["endedBy"], goodbye?: string, goodbyeAudio?: Int16Array): Promise<CallReport> {
    this.ending ??= this.finish(endedBy, goodbye, goodbyeAudio);
    return this.ending;
  }

  private async finish(endedBy: CallReport["endedBy"], goodbye?: string, goodbyeAudio?: Int16Array): Promise<CallReport> {
    this.endedBy = endedBy;
    if (goodbye && !this.hungUp) {
      this.reply?.ac.abort();
      this.spec?.reply?.ac.abort();
      this.speaker.stop();
      this.speakNow(goodbye, goodbyeAudio);
      // Let it play (a phone call keeps going until the stream closes).
      const until = this.now() + 8000;
      while (this.speaker.busy && !this.hungUp && this.now() < until) await new Promise((r) => setTimeout(r, 100));
    }
    this.ended = true;
    for (const t of [this.fillerTimer, this.idleTimer, this.limitTimer, this.dtmfTimer]) if (t) clearTimeout(t);
    this.reply?.ac.abort();
    this.spec?.reply?.ac.abort();
    this.speaker.close();
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
    const report: CallReport = {
      endedBy,
      durationS: Math.round((this.now() - this.startedAt) / 1000),
      // Nothing from the caller (they hung up at once, or never spoke): there's no conversation to keep.
      turns: this.turns.some((t) => t.role === "caller") ? this.turns : [],
      latency: { turns: sorted.length, p50Ms: pct(0.5), p90Ms: pct(0.9), samples: this.latencies },
      usage: { ...this.usage, model: this.llm.model },
      engine: { version: this.engine.info.version },
    };
    this.log("call_ended", { endedBy, durationS: report.durationS, turns: report.turns.length, p50Ms: report.latency.p50Ms });
    // Report before hanging up: when a phone stream closes, Twilio asks the app what's next, and
    // the app hangs up only on a call it knows has ended (anything else carries on another way).
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.app.end(this.info.callId, report), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timed out")), 5000)))]);
    } catch (err) {
      this.log("report_error", { error: (err as Error).message });
    } finally {
      clearTimeout(timer);
    }
    this.transport.event({ type: "ended", by: endedBy });
    this.transport.close(endedBy);
    this.resolveFinished(report);
    return report;
  }
}

/**
 * Chat APIs want every tool result right after the assistant message that asked for it, and no
 * history that starts mid-exchange. Cut-off replies and trimming can break both: mend them.
 */
export function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "tool") continue; // kept only right after its call (below)
    if (m.role === "assistant" && m.tool_calls?.length) {
      const results: ChatMessage[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") results.push(messages[j++]);
      const ids = new Set(results.map((r) => (r as { tool_call_id: string }).tool_call_id));
      if (m.tool_calls.every((c) => ids.has(c.id))) {
        out.push(m, ...results.filter((r) => m.tool_calls!.some((c) => c.id === (r as { tool_call_id: string }).tool_call_id)));
      } else if (m.content.trim()) {
        out.push({ role: "assistant", content: m.content });
      }
      i = j - 1;
      continue;
    }
    out.push(m);
  }
  while (out.length && out[0].role !== "user" && !(out[0].role === "assistant" && !("tool_calls" in out[0] && out[0].tool_calls?.length))) out.shift();
  return out;
}
