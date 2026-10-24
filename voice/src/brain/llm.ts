/**
 * The talker's model: NVIDIA Nemotron 3.5 Lightning on Nebius Token Factory (any OpenAI-compatible
 * chat endpoint works), streamed, with reasoning off so the first words come fast.
 */

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall; args: Record<string, unknown> | null }
  | { type: "done"; finish: "stop" | "tool_calls" | "length" | "error"; usage: LlmUsage; firstTokenMs: number | null };

export type LlmRequest = {
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export interface Llm {
  readonly model: string;
  stream(req: LlmRequest): AsyncGenerator<LlmEvent, void, unknown>;
}

export class LlmError extends Error {
  override name = "LlmError";
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Never let a key into a log line. */
export function redact(text: string): string {
  return text
    .replace(/(sk|rk|pk|tvly|gsk|xai|nvapi|key|v1)[-_][A-Za-z0-9_-]{8,}/gi, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 400);
}

async function* sseData(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
      }
    }
    if (buf.startsWith("data:")) yield buf.slice(5).trimStart();
  } finally {
    reader.releaseLock();
    await body.cancel().catch(() => {});
  }
}

function parseArgs(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Text that must never be spoken: reasoning that leaked through, and tool calls written as text. */
const HIDDEN_START = /<think>|<tool_call>/;
const HIDDEN_TAGS = ["<think>", "<tool_call>"];

export type OpenAiLlmOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Model knobs merged into each request, e.g. { reasoning_effort: "none" }. */
  extraBody?: Record<string, unknown>;
  /** The longest one reply may take, first byte to last: a caller can't be left waiting on a stuck request. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class OpenAiCompatibleLlm implements Llm {
  readonly model: string;
  private readonly opts: OpenAiLlmOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAiLlmOptions) {
    this.opts = opts;
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *stream(req: LlmRequest): AsyncGenerator<LlmEvent> {
    const t0 = performance.now();
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: req.maxTokens ?? 400,
      temperature: req.temperature ?? 0.6,
      ...(req.tools.length
        ? { tools: req.tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto", parallel_tool_calls: false }
        : {}),
      ...this.opts.extraBody,
    };
    // A healthy reply takes a second or two (reasoning off, about 25 words).
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 10_000);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    const tooSlow = () => new LlmError(`the model didn't answer within ${Math.round((this.opts.timeoutMs ?? 10_000) / 1000)} s`);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal,
        redirect: "error",
      });
    } catch (err) {
      if (req.signal?.aborted) return;
      if (timeout.aborted) throw tooSlow();
      throw new LlmError(`couldn't reach the model: ${redact((err as Error).message)}`);
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      if (req.signal?.aborted) return;
      throw new LlmError(`model error ${res.status}: ${redact(text)}`, res.status);
    }

    const partial = new Map<number, { id: string; name: string; args: string }>();
    let firstTokenMs: number | null = null;
    let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
    let finish: string | null = null;
    let text = "";
    let spokenUpTo = 0;
    let hidden = false;
    let hiddenKind: "think" | "tool" = "think";

    try {
      for await (const data of sseData(res.body, req.signal)) {
        if (data === "[DONE]") break;
        let chunk: {
          choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          error?: { message?: string };
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new LlmError(`model error: ${redact(chunk.error.message ?? "stream error")}`);
        if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (delta.content) {
          if (firstTokenMs === null) firstTokenMs = performance.now() - t0;
          text += delta.content;
          for (;;) {
            if (hidden) {
              const close = hiddenKind === "think" ? text.indexOf("</think>", spokenUpTo) : -1;
              if (close < 0) break;
              spokenUpTo = close + "</think>".length;
              hidden = false;
              continue;
            }
            const rest = text.slice(spokenUpTo);
            const m = HIDDEN_START.exec(rest);
            if (m) {
              if (m.index > 0) yield { type: "text", delta: rest.slice(0, m.index) };
              spokenUpTo += m.index + m[0].length;
              hidden = true;
              hiddenKind = m[0] === "<think>" ? "think" : "tool";
              continue;
            }
            // Hold back what may be the start of a tag still arriving ("<thi").
            const lt = rest.lastIndexOf("<");
            const hold = lt >= 0 && HIDDEN_TAGS.some((tag) => tag.startsWith(rest.slice(lt))) ? lt : rest.length;
            if (hold > 0) {
              yield { type: "text", delta: rest.slice(0, hold) };
              spokenUpTo += hold;
            }
            break;
          }
        }
        for (const tc of delta.tool_calls ?? []) {
          if (firstTokenMs === null) firstTokenMs = performance.now() - t0;
          const index = tc.index ?? 0;
          const entry = partial.get(index) ?? { id: "", name: "", args: "" };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
          partial.set(index, entry);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } catch (err) {
      if (req.signal?.aborted) return;
      if (timeout.aborted) throw tooSlow();
      throw err instanceof LlmError ? err : new LlmError(`model stream broke: ${redact((err as Error).message)}`);
    }
    if (req.signal?.aborted) return;
    // The timeout can end the body quietly (as a clean end of stream): a cut-off reply isn't one.
    if (timeout.aborted) throw tooSlow();

    // Text left over that isn't hidden (it ended without a newline or tag).
    if (!hidden && spokenUpTo < text.length) yield { type: "text", delta: text.slice(spokenUpTo) };

    const calls: ToolCall[] = [...partial.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, c]) => c.name)
      .map(([i, c]) => ({ id: c.id || `call_${i}_${Date.now().toString(36)}`, type: "function" as const, function: { name: c.name, arguments: c.args } }));
    // Tool calls written into the text by a server whose parser missed them.
    const names = new Set(req.tools.map((t) => t.name));
    for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
      try {
        const parsed = JSON.parse(m[1]) as { name?: string; arguments?: unknown };
        if (parsed.name && names.has(parsed.name)) {
          const args = typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments ?? {});
          calls.push({ id: `call_inline_${calls.length}_${Date.now().toString(36)}`, type: "function", function: { name: parsed.name, arguments: args } });
        }
      } catch {
        /* not a tool call after all */
      }
    }
    for (const call of calls) yield { type: "tool_call", call, args: parseArgs(call.function.arguments) };
    if (!usage.inputTokens) {
      usage = { inputTokens: Math.ceil((req.system.length + JSON.stringify(req.messages).length) / 4), outputTokens: Math.ceil(text.length / 4) };
    }
    const reason = calls.length ? "tool_calls" : finish === "length" ? "length" : "stop";
    yield { type: "done", finish: reason, usage, firstTokenMs };
  }
}
