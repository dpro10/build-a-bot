/**
 * The voice server: HTTP for health, WebSockets for calls.
 *   GET /health   can it take a call: everything loaded, the speech engine up, a line free? (the
 *                 app checks before routing calls)
 *   WS  /twilio   a phone call, from Twilio Media Streams
 *   WS  /call     a call from the browser
 * Each call: check its token (minted by the app), take a line, ask the app who's calling, run a
 * CallSession. A line is taken the moment a call is let in, before anything waits, so two callers
 * at once can't both get the last one; it's given back however the call ends.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyCallToken } from "./auth.ts";
import type { AppApi } from "./brain/app.ts";
import type { Llm } from "./brain/llm.ts";
import { CallSession, type SessionConfig } from "./call/session.ts";
import type { PhraseCache } from "./call/phrases.ts";
import type { SpeechPace } from "./call/speaker.ts";
import type { SpeechEngine } from "./speech/engine.ts";
import type { Vad } from "./vad/vad.ts";
import { TwilioTransport } from "./transports/twilio.ts";
import { WebTransport } from "./transports/web.ts";

export type ServerDeps = {
  secret: string;
  allowedOrigins: string[];
  maxCalls: number;
  webRate: number;
  engine: SpeechEngine;
  vad: Vad;
  llm: Llm;
  app: AppApi;
  phrases: PhraseCache;
  /** How fast speech is made here, shared by every call (see SpeechPace). */
  pace?: SpeechPace;
  /** Is everything loaded? Calls are refused until it is. */
  ready: () => boolean;
  session?: Partial<SessionConfig>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

export type VoiceServer = {
  server: Server;
  /** Lines in use: calls running, and calls being let in. */
  calls: () => number;
  /** Ends every call (a goodbye, then each one's report to the app), then stops; waits at most waitMs for calls to end. */
  close: (waitMs?: number) => Promise<void>;
};

/** What a caller hears when the server is going away (a deploy, a restart). */
export const SHUTDOWN_GOODBYE = "Sorry, I have to go. Please call back in a minute.";

export function createVoiceServer(deps: ServerDeps): VoiceServer {
  const log = deps.log ?? (() => {});
  const live = new Set<CallSession>();
  let lines = 0;
  let closing = false;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

  /** Can calls be taken at all: loaded, the speech engine answering, not shutting down? */
  function up(): boolean {
    return deps.ready() && deps.engine.ready && !closing;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://voice");
    if (req.method === "GET" && url.pathname === "/health") {
      const ok = up();
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(
        JSON.stringify({
          ok,
          engine: { ready: deps.engine.ready, version: deps.engine.info.version, voices: deps.engine.info.voices, asr: deps.engine.info.asr, tts: deps.engine.info.tts },
          talker: deps.llm.model,
          calls: lines,
          capacity: deps.maxCalls,
          // Seconds of speech made per second (under 1, sentences wait a little to play smoothly).
          ...(deps.pace ? { speechRate: Math.round(deps.pace.rate * 100) / 100 } : {}),
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://voice");
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (url.pathname !== "/twilio" && url.pathname !== "/call") return reject(404, "Not Found");
    if (url.pathname === "/call") {
      const origin = req.headers.origin;
      if (!origin || !deps.allowedOrigins.includes(origin)) return reject(403, "Forbidden");
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (url.pathname === "/twilio") void phoneCall(ws);
      else void webCall(ws);
    });
  });

  /** Takes a line if one is free, right away (nothing awaited in between); null if not. */
  function takeLine(): (() => void) | null {
    if (!up() || lines >= deps.maxCalls) return null;
    lines++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      lines--;
    };
  }

  async function run(session: CallSession): Promise<void> {
    live.add(session);
    log("call_started", { callId: session.info.callId, kind: session.info.kind, speaker: session.info.speaker, calls: lines });
    try {
      const done = session.start();
      // The server began shutting down while this call was being set up.
      if (closing) void session.end("error", SHUTDOWN_GOODBYE);
      await done;
    } finally {
      live.delete(session);
    }
  }

  async function phoneCall(ws: WebSocket): Promise<void> {
    const transport = new TwilioTransport(ws);
    let start;
    try {
      start = await transport.start();
    } catch (err) {
      log("twilio_no_start", { error: (err as Error).message });
      transport.close();
      return;
    }
    const token = verifyCallToken(deps.secret, start.customParameters.token ?? "");
    if (!token || token.kind !== "phone" || (token.callSid && token.callSid !== start.callSid)) {
      log("twilio_bad_token", { callSid: start.callSid });
      transport.close();
      return;
    }
    // Busy, or not up: closing hands the call back to Twilio's next TwiML (the simpler line).
    const release = takeLine();
    if (!release) {
      log("busy", { callId: token.callId, up: up() });
      transport.close();
      return;
    }
    try {
      let info;
      try {
        info = await deps.app.session(token.callId, "phone");
      } catch (err) {
        log("session_error", { callId: token.callId, error: (err as Error).message });
        transport.close();
        return;
      }
      await run(new CallSession({ ...common(), transport, info }));
    } finally {
      release();
    }
  }

  async function webCall(ws: WebSocket): Promise<void> {
    const transport = new WebTransport(ws, deps.webRate);
    let hello;
    try {
      hello = await transport.waitForHello();
    } catch {
      transport.close("no hello");
      return;
    }
    const token = verifyCallToken(deps.secret, hello.token);
    if (!token || token.kind !== "web") return transport.fail("This call link has expired. Start the call again.", 4001);
    const release = takeLine();
    if (!release) return transport.fail(up() ? "All lines are busy right now. Try again in a minute." : "The voice line isn't available right now. Try again in a minute.", 4003);
    try {
      let info;
      try {
        info = await deps.app.session(token.callId, "web");
      } catch (err) {
        log("session_error", { callId: token.callId, error: (err as Error).message });
        return transport.fail("Couldn't start the call. Try again in a moment.", 4002);
      }
      transport.ready({ callId: info.callId, bot: info.bot.name, voice: info.bot.voice || deps.engine.info.voice, engine: deps.engine.info.version, talker: deps.llm.model });
      await run(new CallSession({ ...common(), transport, info }));
    } finally {
      release();
    }
  }

  function common() {
    return {
      engine: deps.engine,
      vad: deps.vad,
      llm: deps.llm,
      app: deps.app,
      phrases: deps.phrases,
      pace: deps.pace,
      config: deps.session,
      log,
    };
  }

  return {
    server,
    calls: () => lines,
    async close(waitMs = 12_000) {
      closing = true;
      // Each call says goodbye and reports to the app; one still being set up does too, once it starts (run()).
      for (const session of live) void session.end("error", SHUTDOWN_GOODBYE);
      const until = Date.now() + waitMs;
      while (lines > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
      if (lines > 0) log("close_timeout", { calls: lines });
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
