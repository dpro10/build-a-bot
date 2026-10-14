/**
 * Brains a bot can run on.
 *
 *  included      Open-weight models we serve through Nebius Token Factory (we pay; plan limits apply).
 *  byok          The owner's own API key (encrypted at rest, never shown again).
 *  subscription  The owner's own Claude / ChatGPT plan, run by their own CLI on their own
 *                computer through the Bridge (vendor rules: docs/DECISIONS.md).
 *
 * Prices are USD per 1M tokens (input / output) and are used for receipts and
 * plan-cost estimates; providers' own bills are authoritative.
 */

export type ThinkingControl =
  /** reasoning_effort: "none" turns thinking off; other values tune depth. */
  | { style: "reasoning_effort"; off: string | null; levels: string[] }
  /** chat_template_kwargs: { enable_thinking } toggles thinking. */
  | { style: "template_toggle" }
  /** Non-reasoning model: nothing to control. */
  | { style: "none" };

export type ModelDef = {
  /** Provider model id sent in API requests. */
  id: string;
  label: string;
  blurb: string;
  tier: "fast" | "balanced" | "smart";
  context?: number;
  priceIn?: number;
  priceOut?: number;
  reasoning?: boolean;
  tools: boolean;
  default?: boolean;
  /** Plan needed when we pay (included models only). */
  plan?: "free" | "plus" | "pro";
  /** Env var that can override `id` without a code change (included models). */
  envOverride?: string;
  /** How to steer thinking (Token Factory models differ; docs/research/integrations-2026-10-14.md). */
  thinking?: ThinkingControl;
  /** Who trained it, for the picker. */
  maker?: string;
  /** Served region, when it matters for latency (voice). */
  region?: string;
};

export type ProviderId =
  | "nebius"
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "groq"
  | "mistral"
  | "xai"
  | "deepseek"
  | "together"
  | "fireworks"
  | "cerebras"
  | "custom";

export type ProviderDef = {
  id: ProviderId;
  name: string;
  api: "openai" | "anthropic";
  baseUrl: string;
  keyUrl?: string;
  keyPlaceholder?: string;
  /** simple-icons slug, a Lucide mark, or a letter fallback. */
  icon: { simpleIcon?: string; lucide?: string; letter?: string; color: string };
  models: ModelDef[];
  /** Free-text model id allowed (OpenRouter, custom). */
  freeformModel?: boolean;
  headers?: Record<string, string>;
  note?: string;
};

// ---------------------------------------------------------------------------
// Included open-weight models (Nebius Token Factory)
// ---------------------------------------------------------------------------

export const INCLUDED_MODELS: ModelDef[] = [
  {
    id: "nvidia/Nemotron-3_5-Lightning",
    envOverride: "TF_MODEL_LIGHTNING",
    label: "Nemotron 3.5 Lightning",
    maker: "NVIDIA",
    blurb: "Fast, sharp and thrifty. Great for everyday help.",
    tier: "fast",
    context: 1_048_576,
    priceIn: 0.06,
    priceOut: 0.24,
    reasoning: true,
    tools: true,
    default: true,
    plan: "free",
    region: "eu-north1",
    thinking: { style: "reasoning_effort", off: "none", levels: ["none", "high"] },
  },
  {
    id: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    envOverride: "TF_MODEL_QWEN_FAST",
    label: "Qwen3 30B Instruct",
    maker: "Alibaba Qwen",
    blurb: "Snappy, no-nonsense answers. Great for voice.",
    tier: "fast",
    context: 262_144,
    priceIn: 0.1,
    priceOut: 0.3,
    tools: true,
    plan: "free",
    region: "eu-north1",
    thinking: { style: "none" },
  },
  {
    id: "openai/gpt-oss-120b",
    label: "gpt-oss-120b",
    maker: "OpenAI (open weights)",
    blurb: "OpenAI's open model. Solid all-rounder with tools.",
    tier: "fast",
    context: 131_072,
    priceIn: 0.15,
    priceOut: 0.6,
    reasoning: true,
    tools: true,
    plan: "free",
    thinking: { style: "reasoning_effort", off: null, levels: ["low", "medium", "high"] },
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    envOverride: "TF_MODEL_SUPER",
    label: "Nemotron 3 Super",
    maker: "NVIDIA",
    blurb: "Smarter research and planning.",
    tier: "balanced",
    context: 262_144,
    priceIn: 0.3,
    priceOut: 0.9,
    reasoning: true,
    tools: true,
    plan: "plus",
    region: "us-central1",
    thinking: { style: "template_toggle" },
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Flash-0731",
    label: "DeepSeek V4 Flash",
    maker: "DeepSeek",
    blurb: "Very capable and very cheap, huge context.",
    tier: "balanced",
    context: 1_024_000,
    priceIn: 0.14,
    priceOut: 0.28,
    reasoning: true,
    tools: true,
    plan: "plus",
    thinking: { style: "reasoning_effort", off: "none", levels: ["none", "low", "high", "max"] },
  },
  {
    id: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    label: "Qwen3 235B Instruct",
    maker: "Alibaba Qwen",
    blurb: "Big, fluent and fast to answer (no slow thinking).",
    tier: "balanced",
    context: 262_144,
    priceIn: 0.2,
    priceOut: 0.6,
    tools: true,
    plan: "plus",
    thinking: { style: "none" },
  },
  {
    id: "zai-org/GLM-5.3-Flash",
    label: "GLM-5.3 Flash",
    maker: "Z.ai",
    blurb: "Quick thinker that can also look at images.",
    tier: "balanced",
    context: 1_024_000,
    priceIn: 0.15,
    priceOut: 0.5,
    reasoning: true,
    tools: true,
    plan: "plus",
    thinking: { style: "reasoning_effort", off: null, levels: ["low", "high", "max"] },
  },
  {
    id: "MiniMaxAI/MiniMax-M3",
    label: "MiniMax M3",
    maker: "MiniMax",
    blurb: "Strong agent model with a 1M-token context.",
    tier: "balanced",
    context: 1_048_576,
    priceIn: 0.3,
    priceOut: 1.2,
    reasoning: true,
    tools: true,
    plan: "plus",
  },
  {
    id: "nvidia/Nemotron-3-Ultra-550b-a55b",
    envOverride: "TF_MODEL_ULTRA",
    label: "Nemotron 3 Ultra",
    maker: "NVIDIA",
    blurb: "The strongest Nemotron for long, multi-step work.",
    tier: "smart",
    context: 1_048_576,
    priceIn: 1,
    priceOut: 3,
    reasoning: true,
    tools: true,
    plan: "pro",
    region: "us-central1",
    thinking: { style: "reasoning_effort", off: "none", levels: ["none", "high"] },
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Pro",
    label: "DeepSeek V4 Pro",
    maker: "DeepSeek",
    blurb: "Top-tier open reasoning for hard problems.",
    tier: "smart",
    context: 1_048_576,
    priceIn: 1.75,
    priceOut: 3.5,
    reasoning: true,
    tools: true,
    plan: "pro",
    thinking: { style: "reasoning_effort", off: "none", levels: ["none", "low", "high", "max"] },
  },
  {
    id: "zai-org/GLM-5.3",
    label: "GLM-5.3",
    maker: "Z.ai",
    blurb: "The best open model on agent benchmarks.",
    tier: "smart",
    context: 1_024_000,
    priceIn: 1.4,
    priceOut: 4.4,
    reasoning: true,
    tools: true,
    plan: "pro",
    thinking: { style: "reasoning_effort", off: null, levels: ["low", "high", "max"] },
  },
  {
    id: "moonshotai/Kimi-K3",
    label: "Kimi K3",
    maker: "Moonshot AI",
    blurb: "Frontier open model with vision. Pricier.",
    tier: "smart",
    context: 1_024_000,
    priceIn: 3,
    priceOut: 15,
    reasoning: true,
    tools: true,
    plan: "pro",
    thinking: { style: "reasoning_effort", off: "none", levels: ["none", "low", "medium", "high", "max"] },
  },
  {
    id: "NousResearch/Hermes-4-405B",
    label: "Hermes 4 405B",
    maker: "Nous Research",
    blurb: "Steerable open model that follows your custom instructions closely.",
    tier: "smart",
    context: 131_072,
    priceIn: 1,
    priceOut: 3,
    reasoning: true,
    tools: true,
    plan: "pro",
  },
];

/** How much a model can take in at once, for the pickers: "128K", "256K", "1M" (K = 1,024 tokens, as vendors count). */
export function contextLabel(tokens?: number): string | null {
  if (!tokens) return null;
  return tokens >= 1_000_000 ? `${Math.round(tokens / 1_000_000)}M` : `${Math.round(tokens / 1024)}K`;
}

/**
 * Request knobs for an included (Token Factory) model at a given effort.
 * low → thinking off (fast chat); medium/high → thinking on with more room.
 */
export function includedRequestOptions(model: ModelDef, effort: "low" | "medium" | "high" = "low") {
  const t = model.thinking ?? { style: "none" as const };
  const thinkingOn = effort !== "low";
  let extra: Record<string, unknown> = {};
  if (t.style === "reasoning_effort") {
    if (!thinkingOn && t.off) extra = { reasoning_effort: t.off };
    else if (thinkingOn) {
      const want = effort === "high" ? ["high", "max", "medium"] : ["low", "medium", "high"];
      const pick = want.find((w) => t.levels.includes(w));
      if (pick) extra = { reasoning_effort: pick };
    } else extra = { reasoning_effort: t.levels[0] };
  } else if (t.style === "template_toggle") {
    extra = { chat_template_kwargs: { enable_thinking: thinkingOn } };
  }
  const reasoningActive = Boolean(model.reasoning) && (thinkingOn || (t.style === "reasoning_effort" && !t.off));
  // Thinking eats max_tokens: give reasoning models generous room or replies come back empty.
  const maxTokens = reasoningActive ? (effort === "high" ? 16384 : 8192) : 4096;
  return { extra, maxTokens };
}

export function resolveIncludedModelId(model: ModelDef): string {
  const override = model.envOverride ? process.env[model.envOverride] : undefined;
  return override && override.trim() ? override.trim() : model.id;
}

// ---------------------------------------------------------------------------
// Bring your own key
// ---------------------------------------------------------------------------

/** simple-icons doesn't ship OpenAI's logo, so OpenAI and ChatGPT get a plain mark instead of letters. */
export const OPENAI_MARK = { lucide: "Hexagon", color: "10A37F" };

export const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    api: "anthropic",
    baseUrl: "https://api.anthropic.com",
    keyUrl: "https://platform.claude.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    icon: { simpleIcon: "anthropic", color: "191919" },
    note: "Claude Max plans include monthly API credit you can use with a key.",
    models: [
      {
        id: "claude-opus-5-5",
        label: "Claude Opus 5.5",
        blurb: "Anthropic's default flagship: excellent at long, careful work.",
        tier: "smart",
        context: 1_000_000,
        priceIn: 4,
        priceOut: 20,
        reasoning: true,
        tools: true,
        default: true,
      },
      {
        id: "claude-sonnet-5-5",
        label: "Claude Sonnet 5.5",
        blurb: "Fast and capable for everyday agent work.",
        tier: "balanced",
        context: 1_000_000,
        priceIn: 2,
        priceOut: 10,
        reasoning: true,
        tools: true,
      },
      {
        id: "claude-haiku-5-5",
        label: "Claude Haiku 5.5",
        blurb: "Quick and very affordable.",
        tier: "fast",
        context: 1_000_000,
        priceIn: 0.1,
        priceOut: 0.5,
        reasoning: true,
        tools: true,
      },
      {
        id: "claude-fable-5-1",
        label: "Claude Fable 5.1",
        blurb: "Anthropic's most capable model, for the hardest jobs.",
        tier: "smart",
        context: 1_000_000,
        priceIn: 10,
        priceOut: 50,
        reasoning: true,
        tools: true,
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    api: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    icon: OPENAI_MARK,
    freeformModel: true,
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", blurb: "OpenAI's flagship.", tier: "smart", priceIn: 2, priceOut: 10, tools: true, default: true },
      { id: "gpt-6-luna", label: "GPT-6 Luna", blurb: "Fast and affordable.", tier: "fast", priceIn: 0.1, priceOut: 0.5, tools: true },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    api: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    icon: { simpleIcon: "googlegemini", color: "8E75B2" },
    freeformModel: true,
    note: "Gemini works with an API key only; Google doesn't allow apps to reuse Gemini subscriptions.",
    models: [
      { id: "gemini-4-argon", label: "Gemini 4 Argon", blurb: "Google's flagship.", tier: "smart", priceIn: 2, priceOut: 10, tools: true, default: true },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    api: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/settings/keys",
    keyPlaceholder: "sk-or-…",
    icon: { simpleIcon: "openrouter", color: "6467F2" },
    freeformModel: true,
    headers: { "HTTP-Referer": "https://build-a-bot.site", "X-Title": "Build-a-bot" },
    note: "One key, hundreds of models. Works on networks that block some vendors.",
    models: [
      { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", blurb: "via OpenRouter", tier: "balanced", tools: true, default: true },
      { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", blurb: "via OpenRouter", tier: "smart", tools: true },
      { id: "moonshotai/kimi-k3", label: "Kimi K3", blurb: "via OpenRouter", tier: "smart", tools: true },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    api: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    icon: { letter: "G", color: "F55036" },
    freeformModel: true,
    models: [{ id: "openai/gpt-oss-120b", label: "gpt-oss-120b", blurb: "Very fast open model.", tier: "fast", tools: true, default: true }],
  },
  {
    id: "mistral",
    name: "Mistral",
    api: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    keyUrl: "https://console.mistral.ai/api-keys",
    icon: { simpleIcon: "mistralai", color: "FA520F" },
    freeformModel: true,
    models: [{ id: "mistral-large-latest", label: "Mistral Large", blurb: "Mistral's flagship.", tier: "smart", tools: true, default: true }],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    api: "openai",
    baseUrl: "https://api.x.ai/v1",
    keyUrl: "https://console.x.ai",
    keyPlaceholder: "xai-…",
    icon: { simpleIcon: "x", color: "000000" },
    freeformModel: true,
    models: [{ id: "grok-4", label: "Grok", blurb: "xAI's model.", tier: "smart", tools: true, default: true }],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    api: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    keyUrl: "https://platform.deepseek.com/api_keys",
    icon: { letter: "DS", color: "4D6BFE" },
    freeformModel: true,
    models: [{ id: "deepseek-chat", label: "DeepSeek Chat", blurb: "Strong and cheap.", tier: "balanced", tools: true, default: true }],
  },
  {
    id: "together",
    name: "Together AI",
    api: "openai",
    baseUrl: "https://api.together.xyz/v1",
    keyUrl: "https://api.together.ai/settings/api-keys",
    icon: { letter: "T", color: "0F6FFF" },
    freeformModel: true,
    models: [{ id: "openai/gpt-oss-120b", label: "gpt-oss-120b", blurb: "Open model.", tier: "balanced", tools: true, default: true }],
  },
  {
    id: "fireworks",
    name: "Fireworks",
    api: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    keyUrl: "https://fireworks.ai/account/api-keys",
    icon: { letter: "F", color: "6720FF" },
    freeformModel: true,
    models: [
      { id: "accounts/fireworks/models/gpt-oss-120b", label: "gpt-oss-120b", blurb: "Open model.", tier: "balanced", tools: true, default: true },
    ],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    api: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    keyUrl: "https://cloud.cerebras.ai",
    icon: { letter: "C", color: "F05A28" },
    freeformModel: true,
    models: [{ id: "gpt-oss-120b", label: "gpt-oss-120b", blurb: "Extremely fast.", tier: "fast", tools: true, default: true }],
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    api: "openai",
    baseUrl: "",
    icon: { letter: "{}", color: "64748B" },
    freeformModel: true,
    note: "Any OpenAI-compatible endpoint: a self-hosted vLLM, LM Studio over a tunnel, etc.",
    models: [],
  },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<ProviderId, ProviderDef>;

// ---------------------------------------------------------------------------
// Subscriptions (run on the owner's computer through the Bridge)
// ---------------------------------------------------------------------------

export type SubscriptionDef = {
  id: "claude" | "chatgpt" | "gemini" | "claude_cloud";
  name: string;
  plans: string;
  cli: string;
  how: string;
  status: "available" | "api_key_only" | "waitlist";
  icon: { simpleIcon?: string; lucide?: string; letter?: string; color: string };
  models: { id: string; label: string }[];
};

export const SUBSCRIPTIONS: SubscriptionDef[] = [
  {
    id: "claude",
    name: "Claude",
    plans: "Pro or Max",
    cli: "claude",
    how: "Runs through your own Claude Code on your computer. Your login never leaves your machine.",
    status: "available",
    icon: { simpleIcon: "claude", color: "D97757" },
    models: [
      { id: "default", label: "Your Claude Code default" },
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    plans: "Plus or Pro",
    cli: "codex",
    how: "Runs through your own Codex CLI on your computer, signed in with your ChatGPT account.",
    status: "available",
    icon: OPENAI_MARK,
    models: [{ id: "default", label: "Your Codex default" }],
  },
  {
    id: "gemini",
    name: "Gemini",
    plans: "AI Pro or Ultra",
    cli: "gemini",
    how: "Google only allows Gemini through an API key (free tier available). We'll set that up instead.",
    status: "api_key_only",
    icon: { simpleIcon: "googlegemini", color: "8E75B2" },
    models: [],
  },
  {
    id: "claude_cloud",
    name: "Claude, always on",
    plans: "Pro or Max",
    cli: "claude",
    how: "Your own unmodified Claude Code in a private cloud sandbox, signed in on Anthropic's page. Works while your laptop sleeps.",
    status: "waitlist",
    icon: { simpleIcon: "claude", color: "D97757" },
    models: [],
  },
];

export function findModel(provider: ProviderId | "nebius", id: string): ModelDef | undefined {
  if (provider === "nebius") return INCLUDED_MODELS.find((m) => m.id === id || resolveIncludedModelId(m) === id);
  return PROVIDER_BY_ID[provider]?.models.find((m) => m.id === id);
}

/** Estimated cost in micro-dollars for a turn. */
export function estimateCostMicros(
  provider: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
): number {
  const def = findModel(provider as ProviderId, model);
  if (!def?.priceIn || !def.priceOut) return 0;
  const cached = usage.cachedInputTokens ?? 0;
  const freshIn = Math.max(0, usage.inputTokens - cached);
  const cost = freshIn * def.priceIn + cached * def.priceIn * 0.1 + usage.outputTokens * def.priceOut;
  return Math.round(cost); // tokens × $/1M = micro-dollars
}
