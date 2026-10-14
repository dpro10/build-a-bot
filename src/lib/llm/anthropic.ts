/**
 * Claude via the official Anthropic SDK, for owners who bring their own Anthropic
 * API key (including the API credit that comes with Claude Max plans).
 *
 * Notes (claude-api skill, models cached 2026-10-06):
 *  - Current models run adaptive thinking by default; we omit `thinking` and steer
 *    depth with `output_config.effort`.
 *  - Within one agent run we replay assistant content verbatim (thinking + tool_use
 *    blocks). Across turns we send plain text only, so no thinking block is ever
 *    replayed after a history edit (preserved-thinking rules).
 *  - Opus 5.5 / Sonnet 5.5 / Fable 5.1 get server-side refusal fallbacks
 *    (`fallbacks: "default"`), so a policy decline is retried on a fallback model.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  LlmError,
  type LlmEvent,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmToolCall,
  type StopReason,
} from "./types";

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-opus-5"]);

function toAnthropicMessages(messages: LlmMessage[], model: string): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  let pendingResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];

  const flushResults = () => {
    if (pendingResults.length) {
      // All tool results for one assistant turn go back in a single user message.
      out.push({ role: "user", content: pendingResults });
      pendingResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === "tool") {
      pendingResults.push({
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      });
      continue;
    }
    flushResults();
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.raw && m.raw.provider === "anthropic" && m.raw.model === model) {
      out.push({ role: "assistant", content: m.raw.content as Anthropic.Beta.BetaContentBlockParam[] });
    } else {
      const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args ?? {} });
      }
      if (blocks.length) out.push({ role: "assistant", content: blocks });
    }
  }
  flushResults();
  return out;
}

export function createAnthropicProvider(opts: { apiKey: string }): LlmProvider {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2 });

  return {
    id: "anthropic",
    async *stream(req: LlmRequest): AsyncGenerator<LlmEvent> {
      const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
        eager_input_streaming: true,
      }));
      const useFallbacks = FALLBACK_MODELS.has(req.model);
      const params: Anthropic.Beta.MessageCreateParamsStreaming = {
        model: req.model,
        max_tokens: req.maxTokens ?? 64000,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: toAnthropicMessages(req.messages, req.model),
        ...(tools.length ? { tools } : {}),
        output_config: { effort: req.effort ?? "medium" },
        stream: true,
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      };

      let message: Anthropic.Beta.BetaMessage | undefined;
      // Eager input streaming means a malformed tool input surfaces as a JSON parse
      // error from the stream; re-issue the turn (max 2 times) for that case only.
      for (let attempt = 0; ; attempt++) {
        try {
          const stream = client.beta.messages.stream(params, { signal: req.signal });
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              yield { type: "text", delta: event.delta.text };
            }
          }
          message = await stream.finalMessage();
          break;
        } catch (err) {
          if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
            throw new LlmError("Anthropic rejected the API key", err.status, "auth");
          }
          if (err instanceof Anthropic.RateLimitError) throw new LlmError("Anthropic rate limit", 429, "rate_limit");
          if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
            throw new LlmError(`Anthropic rejected the request: ${err.message.slice(0, 300)}`, err.status, "bad_request");
          }
          if (err instanceof Anthropic.APIConnectionError) throw new LlmError("Couldn't reach Anthropic", undefined, "network");
          if (err instanceof Anthropic.APIError) {
            throw new LlmError(`Anthropic error ${err.status ?? ""}`, err.status, (err.status ?? 500) >= 500 ? "unavailable" : "unknown");
          }
          if ((err as Error)?.name === "AbortError") throw err;
          if (attempt >= 2) throw new LlmError("Claude produced an unreadable tool call twice", undefined, "unknown");
          // Unparseable tool input: retry the same turn.
        }
      }

      const calls: LlmToolCall[] = [];
      for (const block of message.content) {
        if (block.type === "tool_use") {
          const input = block.input;
          calls.push({
            id: block.id,
            name: block.name,
            args: input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null,
            argsText: JSON.stringify(input ?? {}),
          });
        }
      }

      let stopReason: StopReason;
      switch (message.stop_reason) {
        case "tool_use":
          stopReason = calls.length ? "tool_calls" : "end";
          break;
        case "max_tokens":
          stopReason = "max_tokens";
          break;
        case "refusal":
          stopReason = "refusal";
          break;
        default:
          stopReason = calls.length ? "tool_calls" : "end";
      }

      // A refusal or truncation can cut a tool_use off mid-input: never run those.
      if (stopReason === "tool_calls") for (const call of calls) yield { type: "tool_call", call };

      yield {
        type: "done",
        stopReason,
        usage: {
          inputTokens:
            message.usage.input_tokens +
            (message.usage.cache_read_input_tokens ?? 0) +
            (message.usage.cache_creation_input_tokens ?? 0),
          outputTokens: message.usage.output_tokens,
          cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
        },
        raw: { provider: "anthropic", model: req.model, content: message.content },
        servedBy: message.model,
      };
    },
  };
}
