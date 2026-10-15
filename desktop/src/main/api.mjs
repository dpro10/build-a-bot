/**
 * Talks to the Build-a-bot server with this computer's device token
 * (`Authorization: Bearer bab_dev_…`). The token lives only here, in the main
 * process: it is never logged, never put in a URL and never given to a web page.
 * `fetch` is injected (Electron's session.fetch in the app, a fake in tests).
 */

export class ApiError extends Error {
  /** @param {number} status @param {string} message @param {string | undefined} code @param {any} body */
  constructor(status, message, code, body) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const VERSION = "0.1.0";

/**
 * @param {object} o
 * @param {typeof fetch} o.fetch
 * @param {() => string | null} o.server  the paired server's origin
 * @param {() => string | null} o.token
 * @param {string} [o.platform]
 */
export function createApi(o) {
  const ua = `BuildABotDesktop/${VERSION} (${o.platform ?? process.platform})`;

  /**
   * @param {string} method @param {string} route
   * @param {{ json?: any, body?: Uint8Array, contentType?: string, auth?: boolean, server?: string, timeoutMs?: number }} [opts]
   */
  async function call(method, route, opts = {}) {
    const paired = o.server();
    const server = opts.server ?? paired;
    if (!server) throw new ApiError(0, "Not paired", "not_paired");
    /** @type {Record<string, string>} */
    const headers = { "user-agent": ua, accept: "application/json" };
    if (opts.auth !== false) {
      // The token belongs to the server it was issued by. A chunk, finish or poll addressed to
      // the server this computer was paired with before must never carry the new token.
      if (server !== paired) throw new ApiError(401, "This computer isn't paired with that server anymore.", "not_paired");
      const token = o.token();
      if (!token) throw new ApiError(401, "This computer isn't paired.", "not_paired");
      headers.authorization = `Bearer ${token}`;
    }
    let body;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.body) {
      headers["content-type"] = opts.contentType ?? "application/octet-stream";
      body = opts.body;
    }
    let res;
    try {
      res = await o.fetch(`${server}${route}`, {
        method,
        headers,
        body,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      throw new ApiError(0, "Can't reach Build-a-bot", "network", { cause: String(/** @type {any} */ (err)?.message ?? err) });
    }
    const text = await res.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, ok: res.ok, data };
  }

  /**
   * A streamed reply (Server-Sent Events): calls `onEvent` with each event's JSON as it arrives,
   * and resolves when the stream ends. Throws ApiError for HTTP errors.
   * @param {string} route @param {any} body @param {(event: any) => void} onEvent @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
   */
  async function sse(route, body, onEvent, opts = {}) {
    const server = o.server();
    const token = o.token();
    if (!server || !token) throw new ApiError(401, "This computer isn't paired.", "not_paired");
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 180_000);
    let res;
    try {
      res = await o.fetch(`${server}${route}`, {
        method: "POST",
        headers: { "user-agent": ua, accept: "text/event-stream", "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      });
    } catch (err) {
      throw new ApiError(0, "Can't reach Build-a-bot", "network", { cause: String(/** @type {any} */ (err)?.message ?? err) });
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`, data?.code, data);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = raw
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(l.startsWith("data: ") ? 6 : 5))
            .join("\n");
          if (!data) continue;
          try {
            onEvent(JSON.parse(data));
          } catch {
            /* not JSON: skip */
          }
        }
      }
    } catch (err) {
      throw new ApiError(0, "The reply was cut off", "network", { cause: String(/** @type {any} */ (err)?.message ?? err) });
    }
  }

  /** JSON call that throws ApiError on failure. */
  async function json(method, route, opts) {
    const r = await call(method, route, opts);
    if (!r.ok) throw new ApiError(r.status, r.data?.error ?? `HTTP ${r.status}`, r.data?.code, r.data);
    return r.data;
  }

  const m = (botId, meetingId) => `/api/bots/${encodeURIComponent(botId)}/meetings/${encodeURIComponent(meetingId)}`;

  return {
    /** Trade a pairing code for a device token. */
    pair({ server, code, name, platform }) {
      return json("POST", "/api/bridge/pair", { server, auth: false, json: { code, name, platform, clis: {} } });
    },
    session() {
      return json("GET", "/api/desktop/session");
    },
    /** Revoke this computer's own device token on the server ("Unpair"). */
    revokeDevice() {
      return json("DELETE", "/api/desktop/session");
    },
    startMeeting(botId, { app, consentNotice }) {
      return json("POST", `/api/bots/${encodeURIComponent(botId)}/meetings`, { json: { app, consentNotice: Boolean(consentNotice) } });
    },
    /**
     * One audio chunk; returns { status, body } and never throws for HTTP errors
     * (the upload queue decides what to do), only for network errors.
     * @param {import('./spool.mjs').ChunkItem} item
     */
    async uploadChunk(item) {
      // Audio for a server this computer is no longer paired with: that meeting is gone for us
      // (the queue drops just its chunks; 401 would drop every meeting's).
      if (item.server !== o.server()) return { status: 404, body: { error: "This computer is paired with another server now.", code: "other_server" } };
      const q = new URLSearchParams({
        track: item.track,
        chunk: String(item.chunk),
        startMs: String(Math.max(0, Math.round(item.startMs))),
        durationMs: String(Math.max(1, Math.round(item.durationMs))),
        silent: item.silent ? "1" : "0",
      });
      const r = await call("POST", `${m(item.botId, item.meetingId)}/audio?${q}`, {
        server: item.server,
        body: /** @type {Uint8Array} */ (item.bytes),
        contentType: item.mime || "audio/webm",
        timeoutMs: 150_000,
      });
      return { status: r.status, body: r.data };
    },
    finish(botId, meetingId, server) {
      return json("POST", `${m(botId, meetingId)}/finish`, { server, json: {} });
    },
    getMeeting(botId, meetingId, server) {
      return json("GET", m(botId, meetingId), { server });
    },
    markNoticeCopied(botId, meetingId) {
      return json("PATCH", m(botId, meetingId), { json: { noticeCopied: true } });
    },
    /** A paused meeting isn't wrapped up as abandoned on the server. */
    setPaused(botId, meetingId, paused) {
      return json("PATCH", m(botId, meetingId), { json: { paused } });
    },
    deleteMeeting(botId, meetingId) {
      return json("DELETE", m(botId, meetingId));
    },

    // Voice typing ------------------------------------------------------------

    /**
     * One dictation: the recording → what to type (or a request for the bot). Never kept on the server.
     * @param {{ bytes: Uint8Array, mime: string, durationMs: number, speechMs?: number }} rec
     * @param {{ category?: string, app?: string | null, lang?: string | null, polish?: boolean, commands?: boolean, styles?: boolean, demo?: string | null }} p
     */
    dictate(rec, p = {}) {
      const q = new URLSearchParams({ durationMs: String(Math.max(1, Math.round(rec.durationMs))) });
      if (rec.speechMs !== undefined) q.set("speechMs", String(Math.max(0, Math.round(rec.speechMs))));
      if (p.category) q.set("category", p.category);
      if (p.app) q.set("app", String(p.app).slice(0, 60));
      if (p.lang && p.lang !== "auto") q.set("lang", p.lang);
      q.set("polish", p.polish === false ? "0" : "1");
      q.set("commands", p.commands === false ? "0" : "1");
      q.set("styles", p.styles === false ? "0" : "1");
      if (p.demo) q.set("demo", p.demo);
      return json("POST", `/api/voice/dictate?${q}`, { body: rec.bytes, contentType: rec.mime || "audio/webm", timeoutMs: 60_000 });
    },
    /** "Hey {bot}, …": runs it in the bot's chat; `onEvent` gets the chat's streamed events. */
    ask(botId, text, onEvent, opts) {
      return sse("/api/voice/ask", { botId, text }, onEvent, opts);
    },
    dictionary() {
      return json("GET", "/api/voice/dictionary");
    },
    /** @param {{ kind: 'word'|'snippet', text: string, heard?: string[], source?: 'manual'|'correction' }} entry */
    addDictionaryEntry(entry) {
      return json("POST", "/api/voice/dictionary", { json: entry });
    },
    updateDictionaryEntry(id, patch) {
      return json("PATCH", `/api/voice/dictionary/${encodeURIComponent(id)}`, { json: patch });
    },
    deleteDictionaryEntry(id) {
      return json("DELETE", `/api/voice/dictionary/${encodeURIComponent(id)}`);
    },
  };
}
