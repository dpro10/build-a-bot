/**
 * Browser Use Cloud, API v2: a hosted browser agent. We give it a natural-language
 * task and a cloud browser; it clicks and types, then reports back in a JSON shape we
 * ask for. Plain fetch, no SDK. Research and alternatives:
 * docs/research/web-actions-2026-10-14.md.
 *
 * Endpoints, checked against browser-use-sdk@3.11.3's generated v2 types (2026-09-04):
 *   POST  /sessions            { keepAlive, persistMemory, startUrl, proxyCountryCode } → { id, status, liveUrl }
 *   GET   /sessions/{id}       → { status: "active" | "stopped", liveUrl }
 *   PATCH /sessions/{id}       { action: "stop" }
 *   POST  /tasks               { task, sessionId?, startUrl, maxSteps, allowedDomains, structuredOutput (a JSON
 *                                Schema as a string), systemPromptExtension, sessionSettings?, llm? } → { id, sessionId }
 *   GET   /tasks/{id}/status   → { status: created | started | finished | failed | stopped, output, isSuccess, cost }
 *   GET   /tasks/{id}          → full task, incl. steps[].url and steps[].screenshotUrl
 *   PATCH /tasks/{id}          { action: "stop" | "stop_task_and_session" }
 * Auth: the X-Browser-Use-API-Key header.
 *
 * "Fill now, send after approval": the fill runs in a keepAlive session and stops
 * before the send button; the submit is a follow-up task in the same session. Sessions
 * close after about 15 idle minutes, so an approval for a live fill expires with it.
 */
import { assertPublicUrl, fetchWithTimeout } from "@/lib/tools/net";
import { truncate } from "@/lib/utils";
import {
  FILL_OUTPUT_SCHEMA,
  READ_OUTPUT_SCHEMA,
  SUBMIT_OUTPUT_SCHEMA,
  agentRules,
  blockerMessage,
  fillOutput,
  fillTask,
  parseAgentJson,
  readOutput,
  readTask,
  submitOutput,
  submitTask,
} from "./prompts";
import { RASTER } from "./store";
import { siteOf } from "./safety";
import type { SubmitInput, WebActionsProvider, WebFillResult, WebReadResult, WebSubmitResult } from "./types";

export type BrowserUseConfig = {
  apiKey: string;
  baseUrl: string;
  /** Agent model (`llm`); unset = Browser Use's default. */
  model?: string;
  /** Two-letter proxy country, "off" for none; unset = Browser Use's default (US). */
  proxyCountry?: string;
};

export const BROWSER_USE_LIMITS = {
  readTimeoutMs: 110_000,
  fillTimeoutMs: 150_000,
  /** Approvals run inside a 120 s request, which also writes the bot's follow-up. */
  submitTimeoutMs: 75_000,
  readMaxSteps: 20,
  fillMaxSteps: 30,
  submitMaxSteps: 12,
  sessionTtlMs: 15 * 60_000,
  maxScreenshotBytes: 1_500_000,
} as const;

export class BrowserUseError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BrowserUseError";
  }
}

class TaskTimeout extends Error {}

type SessionView = { id: string; status: "active" | "stopped"; liveUrl?: string | null };
type TaskCreated = { id: string; sessionId: string };
type TaskStatusView = { id: string; status: "created" | "started" | "finished" | "failed" | "stopped"; output?: string | null; isSuccess?: boolean | null; cost?: string | null };
type TaskView = TaskStatusView & { steps?: { number: number; url: string; screenshotUrl?: string | null }[] };

const TERMINAL = new Set(["finished", "failed", "stopped"]);

function friendly(status: number, detail: string): string {
  if (status === 401 || status === 403) return "The cloud browser service rejected our key. Web actions need to be set up again on this server.";
  if (status === 402 || /insufficient credits/i.test(detail)) return "The cloud browser account is out of credits.";
  if (status === 429 || /too many concurrent/i.test(detail)) return "The cloud browser is busy right now. Try again in a minute.";
  if (status === 404) return "That browser session no longer exists.";
  if (status === 422 || status === 400) return `The cloud browser rejected the request${detail ? `: ${truncate(detail, 160)}` : "."}`;
  return "The cloud browser service had a problem. Try again shortly.";
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function costOf(v: string | null | undefined): number | undefined {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Hosts the agent may open: the site and its subdomains. */
export function allowedDomains(site: string): string[] {
  return [site, `*.${site}`];
}

/** A URL the agent reported, kept only if it's on the site (else the one we started from). */
function onSite(reported: string | undefined, site: string, fallback: string): string {
  if (!reported) return fallback;
  try {
    const u = new URL(reported);
    const s = siteOf(u);
    return (u.protocol === "https:" || u.protocol === "http:") && (s === site || s.endsWith(`.${site}`)) ? u.toString() : fallback;
  } catch {
    return fallback;
  }
}

function sniffImage(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function createBrowserUseProvider(cfg: BrowserUseConfig): WebActionsProvider {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const proxy =
    !cfg.proxyCountry ? {} : /^(off|none|false|0)$/i.test(cfg.proxyCountry) ? { proxyCountryCode: null } : { proxyCountryCode: cfg.proxyCountry.toLowerCase() };
  const llm = cfg.model ? { llm: cfg.model } : {};

  /** One API call. GETs retry on network errors and 5xx; anything retries on 429 (not processed). */
  async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const idempotent = method === "GET";
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchWithTimeout(`${base}${path}`, {
          method,
          headers: {
            "X-Browser-Use-API-Key": cfg.apiKey,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
          timeoutMs: 20_000,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        if (idempotent && attempt < 2) {
          await wait(800 * 2 ** attempt, signal);
          continue;
        }
        throw new BrowserUseError("Couldn't reach the cloud browser service.");
      }
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
      if ((res.status === 429 || (idempotent && res.status >= 500)) && attempt < 2) {
        await wait(1000 * 2 ** attempt, signal);
        continue;
      }
      let detail = "";
      try {
        const data = (await res.json()) as { detail?: unknown; message?: unknown };
        const raw = data.detail ?? data.message;
        detail = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
      } catch {
        /* not JSON */
      }
      throw new BrowserUseError(friendly(res.status, detail), res.status);
    }
  }

  async function stopSession(id: string | undefined) {
    if (!id) return;
    try {
      await call("PATCH", `/sessions/${encodeURIComponent(id)}`, { action: "stop" });
    } catch {
      /* best effort: idle sessions also time out on their own */
    }
  }

  async function waitForTask(taskId: string, deadline: number, signal?: AbortSignal): Promise<TaskStatusView> {
    let delay = 1500;
    for (;;) {
      const s = await call<TaskStatusView>("GET", `/tasks/${encodeURIComponent(taskId)}/status`, undefined, signal);
      if (TERMINAL.has(s.status)) return s;
      if (Date.now() + delay > deadline) {
        try {
          await call("PATCH", `/tasks/${encodeURIComponent(taskId)}`, { action: "stop" });
        } catch {
          /* best effort */
        }
        throw new TaskTimeout();
      }
      await wait(delay, signal);
      delay = Math.min(Math.round(delay * 1.4), 4000);
    }
  }

  /** The last step's screenshot, copied now: Browser Use's links are presigned and expire within minutes. */
  async function lastScreenshot(taskId: string, signal?: AbortSignal): Promise<{ shot?: { contentType: string; base64: string }; lastUrl?: string }> {
    try {
      const task = await call<TaskView>("GET", `/tasks/${encodeURIComponent(taskId)}`, undefined, signal);
      const steps = [...(task.steps ?? [])].sort((a, b) => a.number - b.number);
      const lastUrl = steps.at(-1)?.url;
      const withShot = steps.reverse().find((s) => s.screenshotUrl);
      if (!withShot?.screenshotUrl) return { lastUrl };
      const url = await assertPublicUrl(withShot.screenshotUrl);
      if (url.protocol !== "https:") return { lastUrl };
      const res = await fetchWithTimeout(url.toString(), { signal, timeoutMs: 15_000 });
      if (!res.ok) return { lastUrl };
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > BROWSER_USE_LIMITS.maxScreenshotBytes) return { lastUrl };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > BROWSER_USE_LIMITS.maxScreenshotBytes) return { lastUrl };
      // Trust the bytes, not the header: only PNG, JPEG or WebP are kept.
      const contentType = sniffImage(buf);
      if (!contentType || !RASTER.test(contentType)) return { lastUrl };
      return { lastUrl, shot: { contentType, base64: buf.toString("base64") } };
    } catch {
      return {};
    }
  }

  return {
    id: "browser-use",
    label: "Browser Use Cloud",
    simulated: false,
    sessionTtlMs: BROWSER_USE_LIMITS.sessionTtlMs,

    async read({ url, site, task, signal }): Promise<WebReadResult> {
      const deadline = Date.now() + BROWSER_USE_LIMITS.readTimeoutMs;
      const created = await call<TaskCreated>(
        "POST",
        "/tasks",
        {
          task: readTask(url, task),
          startUrl: url,
          maxSteps: BROWSER_USE_LIMITS.readMaxSteps,
          allowedDomains: allowedDomains(site),
          structuredOutput: JSON.stringify(READ_OUTPUT_SCHEMA),
          systemPromptExtension: agentRules(site, "read"),
          highlightElements: false,
          metadata: { app: "build-a-bot", step: "read" },
          ...(Object.keys(proxy).length ? { sessionSettings: proxy } : {}),
          ...llm,
        },
        signal,
      );
      try {
        const status = await waitForTask(created.id, deadline, signal);
        if (status.status !== "finished") return { ok: false, error: `The browser couldn't finish reading ${site}.` };
        const parsed = readOutput.safeParse(parseAgentJson(status.output));
        if (!parsed.success) {
          return status.output?.trim()
            ? { ok: true, answer: truncate(status.output.trim(), 4000), found: true, url, costUsd: costOf(status.cost) }
            : { ok: false, error: `The browser didn't report anything from ${site}.` };
        }
        const out = parsed.data;
        if (out.blocker && !out.found) return { ok: false, error: blockerMessage(out.blocker, site), blocker: out.blocker };
        return {
          ok: true,
          answer: truncate(out.answer, 4000),
          found: out.found,
          url: onSite(out.pageUrl, site, url),
          title: out.pageTitle,
          costUsd: costOf(status.cost),
        };
      } catch (err) {
        if (err instanceof TaskTimeout) return { ok: false, error: `${site} took too long to browse. Try a more specific request.` };
        throw err;
      } finally {
        await stopSession(created.sessionId);
      }
    },

    async fill({ url, site, fields, instructions, signal }): Promise<WebFillResult> {
      const deadline = Date.now() + BROWSER_USE_LIMITS.fillTimeoutMs;
      const session = await call<SessionView>("POST", "/sessions", { keepAlive: true, persistMemory: true, startUrl: url, ...proxy }, signal);
      let keep = false;
      try {
        const created = await call<TaskCreated>(
          "POST",
          "/tasks",
          {
            task: fillTask(url, fields, instructions),
            sessionId: session.id,
            startUrl: url,
            maxSteps: BROWSER_USE_LIMITS.fillMaxSteps,
            allowedDomains: allowedDomains(site),
            structuredOutput: JSON.stringify(FILL_OUTPUT_SCHEMA),
            systemPromptExtension: agentRules(site, "fill"),
            highlightElements: false,
            metadata: { app: "build-a-bot", step: "fill" },
            ...llm,
          },
          signal,
        );
        const status = await waitForTask(created.id, deadline, signal);
        if (status.status !== "finished") return { ok: false, error: `The browser stopped before it finished filling the form on ${site}.` };
        const parsed = fillOutput.safeParse(parseAgentJson(status.output));
        if (!parsed.success) return { ok: false, error: "The browser didn't report what it typed, so I won't offer to send it." };
        const out = parsed.data;
        if (out.blocker) return { ok: false, error: blockerMessage(out.blocker, site), blocker: out.blocker };
        const filled = out.filled.map((f) => ({ label: truncate(f.label.trim(), 120), value: truncate(f.value, 2000) })).filter((f) => f.label);
        if (!filled.length || !out.readyToSubmit) {
          return { ok: false, error: out.notes ? `The form on ${site} isn't ready to send: ${truncate(out.notes, 300)}` : `The browser couldn't fill the form on ${site}.` };
        }
        const { shot, lastUrl } = await lastScreenshot(created.id, signal);
        keep = true;
        return {
          ok: true,
          providerSessionId: session.id,
          url: onSite(out.pageUrl ?? lastUrl, site, url),
          title: out.pageTitle ? truncate(out.pageTitle, 120) : undefined,
          filled,
          notes: out.notes ? truncate(out.notes, 500) : undefined,
          screenshot: shot,
          liveUrl: session.liveUrl && session.liveUrl.startsWith("https://") ? session.liveUrl : undefined,
          costUsd: costOf(status.cost),
        };
      } catch (err) {
        if (err instanceof TaskTimeout) return { ok: false, error: `Filling the form on ${site} took too long, so I stopped. Nothing was sent.` };
        throw err;
      } finally {
        if (!keep) await stopSession(session.id);
      }
    },

    async submit({ providerSessionId, url, site, fields, signal }: SubmitInput): Promise<WebSubmitResult> {
      const closed = `The browser holding that filled form has closed (they close after about 15 idle minutes), so nothing was sent. Ask me to fill it again.`;
      const deadline = Date.now() + BROWSER_USE_LIMITS.submitTimeoutMs;
      try {
        const session = await call<SessionView>("GET", `/sessions/${encodeURIComponent(providerSessionId)}`, undefined, signal);
        if (session.status !== "active") return { ok: false, error: closed };
      } catch (err) {
        if (err instanceof BrowserUseError) return { ok: false, error: err.status === 404 ? closed : `${err.message} Nothing was sent.` };
        throw err;
      }
      let created: TaskCreated;
      try {
        created = await call<TaskCreated>(
          "POST",
          "/tasks",
          {
            task: submitTask(url, fields),
            sessionId: providerSessionId,
            maxSteps: BROWSER_USE_LIMITS.submitMaxSteps,
            allowedDomains: allowedDomains(site),
            structuredOutput: JSON.stringify(SUBMIT_OUTPUT_SCHEMA),
            systemPromptExtension: agentRules(site, "submit"),
            highlightElements: false,
            metadata: { app: "build-a-bot", step: "submit" },
            ...llm,
          },
          signal,
        );
      } catch (err) {
        // The task was never accepted, so nothing was sent.
        await stopSession(providerSessionId);
        return { ok: false, error: err instanceof BrowserUseError ? `${err.message} Nothing was sent.` : "Couldn't start the browser to send it. Nothing was sent." };
      }
      try {
        const status = await waitForTask(created.id, deadline, signal);
        const parsed = submitOutput.safeParse(parseAgentJson(status.output));
        if (status.status === "finished" && parsed.success) {
          const out = parsed.data;
          if (out.submitted) {
            return { ok: true, confirmation: truncate(out.confirmation.trim() || `${site} accepted the form.`, 600), url: onSite(out.pageUrl, site, url), costUsd: costOf(status.cost) };
          }
          if (out.blocker) return { ok: false, error: `${blockerMessage(out.blocker, site)} Nothing was sent.`, blocker: out.blocker };
          return { ok: false, error: `I didn't send it: ${truncate(out.problem || "the form had changed since the preview", 300)}.` };
        }
        return {
          ok: false,
          uncertain: true,
          error: `The browser stopped partway through sending, so I can't tell whether ${site} got it. Look for a confirmation email before trying again.`,
        };
      } catch (err) {
        // The send was already handed to the browser: whatever went wrong, the outcome is unknown.
        const why = err instanceof TaskTimeout ? `${site} took too long to respond` : "I lost contact with the browser while it was sending";
        return { ok: false, uncertain: true, error: `${why}, so I can't tell whether the form went through. Look for a confirmation email before trying again.` };
      } finally {
        await stopSession(providerSessionId);
      }
    },

    async discard(providerSessionId) {
      await stopSession(providerSessionId);
    },
  };
}
