/**
 * A call from the browser (the app's Call button), over one WebSocket:
 *   browser → here: {"type":"hello","token","sampleRate"} first; then binary PCM16 mono at that rate;
 *                   {"type":"mark","name"} as its playback passes a mark; {"type":"hangup"}
 *   here → browser: {"type":"ready","outputRate",...}; binary PCM16 at outputRate; {"type":"mark"},
 *                   {"type":"clear"} (stop playing what's queued); live call events (transcript,
 *                   state, latency, task...); {"type":"ended"}
 */
import type { WebSocket } from "ws";
import { bytesToPcm, pcmToBytes } from "../audio/pcm.ts";
import { Resampler } from "../audio/resample.ts";
import type { CallTransport } from "../call/transport.ts";

export type WebHello = { token: string; sampleRate: number };

export class WebTransport implements CallTransport {
  readonly kind = "web" as const;
  readonly outputRate: number;
  readonly reportsMarks = true;
  onAudio: ((pcm: Int16Array) => void) | null = null;
  onDtmf: ((digit: string) => void) | null = null;
  onMark: ((name: string) => void) | null = null;
  onClose: ((why: string) => void) | null = null;

  private readonly ws: WebSocket;
  private up: Resampler | null = null;
  private closed = false;
  private hello: Promise<WebHello>;
  private resolveHello!: (h: WebHello) => void;
  private rejectHello!: (e: Error) => void;
  private gotHello = false;

  constructor(ws: WebSocket, outputRate = 22050) {
    this.ws = ws;
    this.outputRate = outputRate;
    this.hello = new Promise((resolve, reject) => {
      this.resolveHello = resolve;
      this.rejectHello = reject;
    });
    this.hello.catch(() => {});
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (!this.gotHello || !this.up) return;
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        const pcm = bytesToPcm(buf);
        this.onAudio?.(this.up.from === 16000 ? pcm : this.up.process(pcm));
        return;
      }
      let msg: { type?: string; token?: string; sampleRate?: number; name?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "hello" && !this.gotHello && typeof msg.token === "string") {
        const rate = Number(msg.sampleRate) || 16000;
        if (rate < 8000 || rate > 96000) {
          this.rejectHello(new Error("bad sample rate"));
          return;
        }
        this.gotHello = true;
        this.up = new Resampler(rate, 16000);
        this.resolveHello({ token: msg.token, sampleRate: rate });
      } else if (msg.type === "mark" && typeof msg.name === "string") {
        this.onMark?.(msg.name);
      } else if (msg.type === "hangup") {
        this.finish("hung up");
        try {
          this.ws.close(1000, "bye");
        } catch {
          /* closing */
        }
      }
    });
    ws.on("close", () => this.finish("hung up"));
    ws.on("error", () => this.finish("connection error"));
  }

  get open(): boolean {
    return !this.closed;
  }

  /** The browser's opening message (with its call token). */
  waitForHello(timeoutMs = 10_000): Promise<WebHello> {
    const timer = setTimeout(() => this.rejectHello(new Error("no hello from the browser")), timeoutMs);
    return this.hello.finally(() => clearTimeout(timer));
  }

  private sendJson(msg: Record<string, unknown>): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  ready(info: Record<string, unknown>): void {
    this.sendJson({ type: "ready", outputRate: this.outputRate, ...info });
  }

  sendAudio(pcm: Int16Array): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(pcmToBytes(pcm));
  }

  mark(name: string): void {
    this.sendJson({ type: "mark", name });
  }

  clear(): void {
    this.sendJson({ type: "clear" });
  }

  event(event: Record<string, unknown>): void {
    this.sendJson(event);
  }

  /** Tells the browser something went wrong, then hangs up. */
  fail(message: string, code = 4000): void {
    this.sendJson({ type: "error", message });
    this.close(message, code);
  }

  close(reason = "ended", code = 1000): void {
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) {
      try {
        this.ws.close(code, reason.slice(0, 120));
      } catch {
        /* closing */
      }
    }
    this.finish(reason);
  }

  private finish(why: string): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectHello(new Error(`closed before hello (${why})`));
    this.onClose?.(why);
  }
}
