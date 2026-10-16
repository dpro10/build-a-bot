/**
 * The Build-a-bot app, as the voice server sees it. The app owns everything about the bot (who's
 * calling and what they may do, the agent with its apps, memory, approvals and receipts, credit);
 * this server owns the audio and the conversation's timing.
 */
import { signBody } from "../auth.ts";

/** Who's on the line, decided by the app. */
export type Speaker = "owner" | "unverified" | "contact";

export type SessionInfo = {
  callId: string;
  kind: "web" | "phone";
  bot: { id: string; name: string; persona: string; voice?: string };
  /** The bot's owner (their first name; never said to someone who hasn't shown they're the owner). */
  owner: { firstName: string; timezone: string };
  speaker: Speaker;
  /** First words, chosen by the app (it knows when to say "your AI assistant"). */
  greeting: string;
  /** A few lines about the owner and the bot's recent work, for the talker. */
  context: string;
  /** Words to listen out for: the bot's name, the owner's, people they talk about. */
  phrases: string[];
  language?: string;
  maxMinutes: number;
  /** The caller can still prove they're the owner with a PIN. */
  pinAvailable: boolean;
};

export type ActResult = {
  /** What the bot's agent said back: facts it found, what it did, what waits for a tap. */
  text: string;
  status: string;
  approvals: { title: string }[];
};

export type PinResult = { ok: true; firstName: string; context: string } | { ok: false; remaining: number; locked: boolean };

export type CallTurn = { role: "caller" | "bot"; text: string; at: number; interrupted?: boolean };

export type CallReport = {
  endedBy: "caller" | "bot" | "error" | "limit";
  durationS: number;
  turns: CallTurn[];
  latency: { turns: number; p50Ms: number | null; p90Ms: number | null; samples: number[] };
  usage: { inputTokens: number; outputTokens: number; model: string };
  engine: { version: string };
};

export interface AppApi {
  session(callId: string, kind: "web" | "phone"): Promise<SessionInfo>;
  act(callId: string, request: string, signal?: AbortSignal): Promise<ActResult>;
  pin(callId: string, pin: string): Promise<PinResult>;
  /** Live transcript for the app's call view (best effort). */
  turn(callId: string, turn: CallTurn): Promise<void>;
  end(callId: string, report: CallReport): Promise<void>;
}

export class AppError extends Error {
  override name = "AppError";
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type HttpAppOptions = { baseUrl: string; secret: string; fetchImpl?: typeof fetch };

export class HttpApp implements AppApi {
  private readonly opts: HttpAppOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpAppOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async post<T>(path: string, payload: unknown, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    const body = JSON.stringify(payload);
    const signals = [AbortSignal.timeout(opts.timeoutMs ?? 15_000), ...(opts.signal ? [opts.signal] : [])];
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-voice-signature": signBody(this.opts.secret, body) },
      body,
      signal: AbortSignal.any(signals),
      redirect: "error",
    });
    const text = await res.text();
    if (!res.ok) {
      let message = `app answered ${res.status}`;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? message;
      } catch {
        /* not JSON */
      }
      throw new AppError(message, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  session(callId: string, kind: "web" | "phone"): Promise<SessionInfo> {
    return this.post("/api/calls/session", { callId, kind });
  }

  act(callId: string, request: string, signal?: AbortSignal): Promise<ActResult> {
    // The bot's agent may browse, search or wait on the owner's computer: give it time.
    return this.post("/api/calls/act", { callId, request }, { signal, timeoutMs: 300_000 });
  }

  pin(callId: string, pin: string): Promise<PinResult> {
    return this.post("/api/calls/pin", { callId, pin });
  }

  async turn(callId: string, turn: CallTurn): Promise<void> {
    await this.post("/api/calls/turn", { callId, turn }, { timeoutMs: 5000 });
  }

  async end(callId: string, report: CallReport): Promise<void> {
    await this.post("/api/calls/end", { callId, report }, { timeoutMs: 30_000 });
  }
}
