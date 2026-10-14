/**
 * Provider-neutral chat types. Every brain (Nebius open models, a user's own
 * OpenAI/Anthropic/Gemini key, the demo brain) streams these events, so the agent
 * loop, the policy engine and the UI never care which model is behind a bot.
 */

export type JsonSchema = Record<string, unknown>;

export type LlmToolCall = {
  id: string;
  name: string;
  /** Parsed arguments, or null when the model produced invalid JSON. */
  args: Record<string, unknown> | null;
  argsText: string;
};

export type LlmMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: LlmToolCall[];
      /** Provider-native content for faithful replay inside the same run (e.g. Claude thinking blocks). */
      raw?: { provider: string; model: string; content: unknown };
    }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export type LlmTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type Effort = "low" | "medium" | "high";

export type LlmRequest = {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  maxTokens?: number;
  effort?: Effort;
  temperature?: number;
  signal?: AbortSignal;
  /** Stable per-conversation id, used for provider-side caching hints where supported. */
  cacheKey?: string;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
};

export type StopReason = "end" | "tool_calls" | "max_tokens" | "refusal" | "error";

export type LlmEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; call: LlmToolCall }
  | {
      type: "done";
      stopReason: StopReason;
      usage: LlmUsage;
      raw?: { provider: string; model: string; content: unknown };
      /** The model that actually served the turn (fallbacks can change it). */
      servedBy?: string;
    };

export interface LlmProvider {
  /** e.g. "nebius", "anthropic", "openai", "demo" */
  id: string;
  stream(req: LlmRequest): AsyncGenerator<LlmEvent, void, unknown>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly kind: "auth" | "rate_limit" | "bad_request" | "unavailable" | "network" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "LlmError";
  }

  /** A short, owner-facing explanation (never includes keys or raw provider payloads). */
  get friendly(): string {
    switch (this.kind) {
      case "auth":
        return "The brain's API key was rejected. Check the key in Settings → Brain.";
      case "rate_limit":
        return "The brain is rate-limited right now. Try again in a minute.";
      case "bad_request":
        return "The brain rejected the request. Try a different model in Settings → Brain.";
      case "unavailable":
        return "The brain is temporarily unavailable. Try again shortly.";
      case "network":
        return "Couldn't reach the brain. Check your connection or try again.";
      default:
        return "Something went wrong talking to the brain.";
    }
  }
}

export function classifyStatus(status: number): LlmError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 404 || status === 422) return "bad_request";
  if (status >= 500) return "unavailable";
  return "unknown";
}
