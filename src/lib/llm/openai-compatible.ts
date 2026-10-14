/**
 * OpenAI-compatible Chat Completions provider (streaming + tool calls).
 *
 * Used for Nebius Token Factory (our included open-weight brains) and for users'
 * own keys on OpenAI, Google Gemini (OpenAI-compatible endpoint), OpenRouter,
 * Groq, Mistral, xAI, DeepSeek, Together, Fireworks, Cerebras or any custom
 * OpenAI-compatible server.
 */
import { readSse } from "./sse";
import {
  classifyStatus,
  LlmError,
  type LlmEvent,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmToolCall,
  type StopReason,
} from "./types";

export type OpenAiCompatibleOptions = {
  id: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  /** Extra JSON merged into every request body (model-specific knobs). */
  extraBody?: (req: LlmRequest) => Record<string, unknown> | undefined;
  /** Some servers reject stream_options; we retry without it once. */
  supportsStreamOptions?: boolean;
  defaultMaxTokens?: number;
  fetchImpl?: typeof fetch;
};

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export function toOpenAiMessages(system: string, messages: LlmMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || (m.toolCalls?.length ? null : ""),
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: c.argsText || JSON.stringify(c.args ?? {}) },
              })),
            }
          : {}),
      });
    } else out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

function parseArgs(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Some open models (when the server's tool parser misses) write tool calls into
 * the text as <tool_call>{"name": ..., "arguments": {...}}</tool_call>. Recover them.
 */
export function extractInlineToolCalls(
  text: string,
  toolNames: Set<string>,
): { calls: LlmToolCall[]; cleaned: string } {
  const calls: LlmToolCall[] = [];
  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const cleaned = text.replace(pattern, (_m, body: string) => {
    try {
      const parsed = JSON.parse(body) as { name?: string; arguments?: unknown; parameters?: unknown };
      const args = (parsed.arguments ?? parsed.parameters ?? {}) as Record<string, unknown>;
      if (parsed.name && toolNames.has(parsed.name)) {
        calls.push({
          id: `call_inline_${calls.length}_${Date.now().toString(36)}`,
          name: parsed.name,
          args: typeof args === "string" ? parseArgs(args) : args,
          argsText: typeof args === "string" ? args : JSON.stringify(args),
        });
        return "";
      }
    } catch {
      /* leave text as-is */
    }
    return _m;
  });
  return { calls, cleaned: cleaned.trim() };
}

export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): LlmProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let streamOptionsOk = opts.supportsStreamOptions ?? true;

  async function post(req: LlmRequest, includeStreamOptions: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAiMessages(req.system, req.messages),
      stream: true,
      max_tokens: req.maxTokens ?? opts.defaultMaxTokens ?? 8192,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: "auto",
          }
        : {}),
      ...(includeStreamOptions ? { stream_options: { include_usage: true } } : {}),
      ...(opts.extraBody?.(req) ?? {}),
    };
    try {
      return await fetchImpl(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${opts.apiKey}`,
          ...opts.headers,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      throw new LlmError(`Network error reaching ${opts.id}`, undefined, "network");
    }
  }

  return {
    id: opts.id,
    async *stream(req: LlmRequest): AsyncGenerator<LlmEvent> {
      let res = await post(req, streamOptionsOk);
      if (!res.ok && res.status === 400 && streamOptionsOk) {
        const text = await res.text().catch(() => "");
        if (/stream_options|include_usage/i.test(text)) {
          streamOptionsOk = false;
          res = await post(req, false);
        } else {
          throw new LlmError(`${opts.id} rejected the request: ${sanitize(text)}`, 400, "bad_request");
        }
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new LlmError(`${opts.id} error ${res.status}: ${sanitize(text)}`, res.status, classifyStatus(res.status));
      }

      const toolNames = new Set(req.tools.map((t) => t.name));
      const partial = new Map<number, { id: string; name: string; args: string }>();
      let text = "";
      let finish: string | null = null;
      let usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      let sawUsage = false;

      for await (const data of readSse(res.body, req.signal)) {
        if (data === "[DONE]") break;
        let chunk: {
          choices?: {
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              reasoning?: string | null;
              tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
            };
            finish_reason?: string | null;
          }[];
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          } | null;
          error?: { message?: string };
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new LlmError(`${opts.id}: ${sanitize(chunk.error.message ?? "stream error")}`);
        if (chunk.usage) {
          sawUsage = true;
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
          };
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (reasoning) yield { type: "reasoning", delta: reasoning };
        if (delta.content) {
          text += delta.content;
          // Hold back text while an inline <tool_call> block may be forming.
          if (!text.includes("<tool_call>")) yield { type: "text", delta: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const index = tc.index ?? 0;
          const entry = partial.get(index) ?? { id: "", name: "", args: "" };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
          partial.set(index, entry);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }

      const calls: LlmToolCall[] = [...partial.entries()]
        .sort(([a], [b]) => a - b)
        .map(([i, c]) => ({
          id: c.id || `call_${i}_${Date.now().toString(36)}`,
          name: c.name,
          args: parseArgs(c.args),
          argsText: c.args,
        }))
        .filter((c) => c.name);

      if (text.includes("<tool_call>")) {
        const { calls: inline, cleaned } = extractInlineToolCalls(text, toolNames);
        calls.push(...inline);
        if (cleaned) yield { type: "text", delta: cleaned };
      }

      for (const call of calls) yield { type: "tool_call", call };

      if (!sawUsage) {
        // Rough fallback so metering never reads zero.
        usage = {
          inputTokens: Math.ceil(JSON.stringify(req.messages).length / 4 + req.system.length / 4),
          outputTokens: Math.ceil(text.length / 4),
          cachedInputTokens: 0,
        };
      }

      const stopReason: StopReason = calls.length
        ? "tool_calls"
        : finish === "length"
          ? "max_tokens"
          : finish === "content_filter"
            ? "refusal"
            : "end";
      yield { type: "done", stopReason, usage, servedBy: req.model };
    },
  };
}

/** Never echo anything that could be a key back to users or logs. */
export function sanitize(text: string): string {
  return text
    .replace(/(sk|rk|pk|tvly|gsk|xai|nvapi|key)[-_][A-Za-z0-9_-]{8,}/gi, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 400);
}
