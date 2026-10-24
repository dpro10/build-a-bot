/**
 * Twilio Media Streams (bidirectional, from TwiML <Connect><Stream>): the phone call's audio as
 * JSON messages over a WebSocket, 8 kHz μ-law each way.
 *   in:  connected, start (streamSid, callSid, customParameters), media, mark, dtmf, stop
 *   out: media, mark, clear
 * https://www.twilio.com/docs/voice/media-streams/websocket-messages
 */
import type { WebSocket } from "ws";
import { mulawToPcm, pcmToMulaw } from "../audio/mulaw.ts";
import { Resampler } from "../audio/resample.ts";
import type { CallTransport } from "../call/transport.ts";

export type TwilioStart = {
  streamSid: string;
  callSid: string;
  accountSid: string;
  customParameters: Record<string, string>;
};

/** Sends audio in pieces of up to this many samples (100 ms at 8 kHz). */
const MAX_SEND = 800;

export class TwilioTransport implements CallTransport {
  readonly kind = "phone" as const;
  readonly outputRate = 8000;
  readonly reportsMarks = true;
  onAudio: ((pcm: Int16Array) => void) | null = null;
  onDtmf: ((digit: string) => void) | null = null;
  onMark: ((name: string) => void) | null = null;
  onClose: ((why: string) => void) | null = null;

  private readonly ws: WebSocket;
  private readonly up = new Resampler(8000, 16000);
  private streamSid = "";
  private closed = false;
  private started: Promise<TwilioStart>;
  private resolveStart!: (s: TwilioStart) => void;
  private rejectStart!: (e: Error) => void;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.started = new Promise((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    // Whoever calls start() hears about a failure; nobody else needs to.
    this.started.catch(() => {});
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let msg: TwilioMessage;
      try {
        msg = JSON.parse(data.toString()) as TwilioMessage;
      } catch {
        return;
      }
      this.onMessage(msg);
    });
    ws.on("close", () => this.finish("hung up"));
    ws.on("error", () => this.finish("connection error"));
  }

  get open(): boolean {
    return !this.closed;
  }

  /** Resolves with the stream's details once Twilio sends "start". */
  start(timeoutMs = 10_000): Promise<TwilioStart> {
    const timer = setTimeout(() => this.rejectStart(new Error("no start message from Twilio")), timeoutMs);
    return this.started.finally(() => clearTimeout(timer));
  }

  private onMessage(msg: TwilioMessage): void {
    switch (msg.event) {
      case "start":
        this.streamSid = msg.start?.streamSid ?? msg.streamSid ?? "";
        this.resolveStart({
          streamSid: this.streamSid,
          callSid: msg.start?.callSid ?? "",
          accountSid: msg.start?.accountSid ?? "",
          customParameters: msg.start?.customParameters ?? {},
        });
        return;
      case "media": {
        if (msg.media?.track && msg.media.track !== "inbound") return;
        const payload = msg.media?.payload;
        if (!payload) return;
        const pcm8 = mulawToPcm(Buffer.from(payload, "base64"));
        this.onAudio?.(this.up.process(pcm8));
        return;
      }
      case "mark":
        if (msg.mark?.name) this.onMark?.(msg.mark.name);
        return;
      case "dtmf":
        if (msg.dtmf?.digit) this.onDtmf?.(msg.dtmf.digit);
        return;
      case "stop":
        this.finish("hung up");
        return;
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ ...msg, streamSid: this.streamSid }));
  }

  sendAudio(pcm: Int16Array): void {
    for (let i = 0; i < pcm.length; i += MAX_SEND) {
      const piece = pcmToMulaw(pcm.subarray(i, i + MAX_SEND));
      this.send({ event: "media", media: { payload: Buffer.from(piece).toString("base64") } });
    }
  }

  mark(name: string): void {
    this.send({ event: "mark", mark: { name } });
  }

  clear(): void {
    this.send({ event: "clear" });
  }

  event(): void {
    // A phone has no screen.
  }

  close(): void {
    // Closing the stream ends <Connect>; Twilio moves on to the TwiML after it (hang up).
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) {
      try {
        this.ws.close(1000, "done");
      } catch {
        /* already closing */
      }
    }
    this.finish("closed");
  }

  private finish(why: string): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectStart(new Error(`stream ended before start (${why})`));
    this.onClose?.(why);
  }
}

type TwilioMessage = {
  event: string;
  streamSid?: string;
  start?: { streamSid?: string; callSid?: string; accountSid?: string; customParameters?: Record<string, string> };
  media?: { track?: string; payload?: string };
  mark?: { name?: string };
  dtmf?: { digit?: string };
};
