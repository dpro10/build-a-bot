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
    const server = opts.server ?? o.server();
    if (!server) throw new ApiError(0, "Not paired", "not_paired");
    /** @type {Record<string, string>} */
    const headers = { "user-agent": ua, accept: "application/json" };
    if (opts.auth !== false) {
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
  };
}
