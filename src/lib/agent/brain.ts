/**
 * Turns a bot's brain config into a streaming provider + request knobs.
 */
import type { Db } from "@/lib/db";
import type { Bot } from "@/lib/db/schema";
import { config, demoMode } from "@/lib/env";
import { readCredential } from "@/lib/channels/secrets";
import {
  INCLUDED_MODELS,
  PROVIDER_BY_ID,
  includedRequestOptions,
  resolveIncludedModelId,
  type ModelDef,
  type ProviderId,
} from "@/lib/models/catalog";
import { createAnthropicProvider } from "@/lib/llm/anthropic";
import { createDemoProvider } from "@/lib/llm/demo";
import { createOpenAiCompatibleProvider } from "@/lib/llm/openai-compatible";
import { assertPublicUrl, fetchWithTimeout, publicFetch, UnsafeUrlError } from "@/lib/tools/net";

/**
 * A custom endpoint is fetched like any address someone else chose: public only, checked again when
 * connecting, and never redirected (model APIs don't redirect). Answers can take a while to start.
 */
const customEndpointFetch: typeof fetch = (input, init) => publicFetch(String(input), { ...init, maxRedirects: 0, timeoutMs: 120_000 });
import type { Effort, LlmProvider } from "@/lib/llm/types";

export type ResolvedBrain =
  | {
      kind: "llm";
      provider: LlmProvider;
      model: string;
      /** For receipts & cost: "nebius" | "anthropic" | ... | "demo" */
      providerId: string;
      included: boolean;
      maxTokens: number;
      effort: Effort;
      label: string;
    }
  | { kind: "unavailable"; reason: string };

export function includedModelDef(id: string): ModelDef {
  return (
    INCLUDED_MODELS.find((m) => m.id === id || resolveIncludedModelId(m) === id) ??
    INCLUDED_MODELS.find((m) => m.default) ??
    INCLUDED_MODELS[0]
  );
}

/** Retries a provider stream once without model-specific knobs if the server rejects them. */
function withKnobFallback(
  make: (extra: Record<string, unknown> | undefined) => LlmProvider,
  extra: Record<string, unknown>,
): LlmProvider {
  let knobsOk = Object.keys(extra).length > 0;
  const primary = make(extra);
  const plain = make(undefined);
  return {
    id: primary.id,
    async *stream(req) {
      if (!knobsOk) {
        yield* plain.stream(req);
        return;
      }
      try {
        yield* primary.stream(req);
      } catch (err) {
        const msg = (err as Error).message ?? "";
        if (/reasoning_effort|chat_template_kwargs|enable_thinking|thinking/i.test(msg)) {
          knobsOk = false;
          yield* plain.stream(req);
          return;
        }
        throw err;
      }
    },
  };
}

export async function resolveBrain(db: Db, bot: Bot): Promise<ResolvedBrain> {
  const brain = bot.brain;
  const effort: Effort = brain.effort ?? "low";

  if (brain.kind !== "byok" || brain.provider === "demo") {
    const def = includedModelDef(brain.model);
    if (config.tokenFactory.apiKey && brain.provider !== "demo") {
      const { extra, maxTokens } = includedRequestOptions(def, effort);
      const model = resolveIncludedModelId(def);
      const provider = withKnobFallback(
        (knobs) =>
          createOpenAiCompatibleProvider({
            id: "nebius",
            baseUrl: config.tokenFactory.baseUrl,
            apiKey: config.tokenFactory.apiKey!,
            extraBody: knobs ? () => knobs : undefined,
            defaultMaxTokens: maxTokens,
          }),
        extra,
      );
      return { kind: "llm", provider, model, providerId: "nebius", included: true, maxTokens, effort, label: def.label };
    }
    if (demoMode) {
      return {
        kind: "llm",
        provider: createDemoProvider(),
        model: def.id,
        providerId: "demo",
        included: true,
        maxTokens: 4096,
        effort,
        label: `${def.label} (demo brain)`,
      };
    }
    return { kind: "unavailable", reason: "The open models we run are coming soon. Until then, switch me to your own AI key in Settings → Brain." };
  }

  // Bring your own key.
  const apiKey = await readCredential(db, brain.credentialId);
  if (!apiKey) return { kind: "unavailable", reason: "This bot's API key is missing. Add it again in Settings → Brain." };
  const providerId = brain.provider as ProviderId;
  const def = PROVIDER_BY_ID[providerId];
  if (!def) return { kind: "unavailable", reason: `Unknown provider ${brain.provider}` };

  if (def.api === "anthropic") {
    return {
      kind: "llm",
      provider: createAnthropicProvider({ apiKey }),
      model: brain.model,
      providerId: "anthropic",
      included: false,
      maxTokens: 64000,
      effort,
      label: def.models.find((m) => m.id === brain.model)?.label ?? brain.model,
    };
  }

  const baseUrl = providerId === "custom" ? brain.baseUrl ?? "" : def.baseUrl;
  if (!baseUrl) return { kind: "unavailable", reason: "This bot's custom endpoint URL is missing." };
  // A custom endpoint is owner-supplied: never let it point at our own network.
  if (providerId === "custom") {
    try {
      await assertPublicUrl(baseUrl);
    } catch (err) {
      return { kind: "unavailable", reason: err instanceof UnsafeUrlError ? `Custom endpoint refused: ${err.message}` : "Custom endpoint URL is invalid." };
    }
  }
  const knobs: Record<string, unknown> =
    providerId === "openai" && effort !== "low" ? { reasoning_effort: effort } : {};
  return {
    kind: "llm",
    provider: createOpenAiCompatibleProvider({
      id: providerId,
      baseUrl,
      apiKey,
      headers: def.headers,
      extraBody: Object.keys(knobs).length ? () => knobs : undefined,
      defaultMaxTokens: 8192,
      ...(providerId === "custom" ? { fetchImpl: customEndpointFetch } : {}),
    }),
    model: brain.model,
    providerId,
    included: false,
    maxTokens: 8192,
    effort,
    label: def.models.find((m) => m.id === brain.model)?.label ?? brain.model,
  };
}

/** Validate a user's API key by listing models (cheap, no tokens spent). */
export async function validateApiKey(providerId: ProviderId, apiKey: string, baseUrl?: string): Promise<{ ok: boolean; message?: string }> {
  const def = PROVIDER_BY_ID[providerId];
  if (!def) return { ok: false, message: "Unknown provider" };
  try {
    if (def.api === "anthropic") {
      const res = await fetchWithTimeout("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        timeoutMs: 10000,
      });
      return res.ok ? { ok: true } : { ok: false, message: res.status === 401 || res.status === 403 ? "Anthropic didn't accept that key." : `Anthropic didn't accept that (error ${res.status}). Check the key and try again.` };
    }
    const root = providerId === "custom" ? baseUrl : def.baseUrl;
    if (!root) return { ok: false, message: "Add your endpoint's base URL." };
    if (providerId === "custom") {
      try {
        await assertPublicUrl(root);
      } catch (err) {
        return { ok: false, message: err instanceof UnsafeUrlError ? err.message : "That URL isn't valid." };
      }
    }
    const models = `${root.replace(/\/$/, "")}/models`;
    const ask = { headers: { authorization: `Bearer ${apiKey}`, ...def.headers }, timeoutMs: 10000 };
    const res = providerId === "custom" ? await publicFetch(models, { ...ask, maxRedirects: 0 }) : await fetchWithTimeout(models, { ...ask, redirect: "error" });
    if (res.ok) return { ok: true };
    // Some providers (Gemini) reject a bad key with 400 rather than 401: read what they said.
    const said = res.status === 400 ? (await res.text().catch(() => "")).slice(0, 2000) : "";
    const badKey = res.status === 401 || res.status === 403 || /api[ _-]?key|unauthori[sz]ed|invalid[^"]{0,40}(key|token|credential)/i.test(said);
    return { ok: false, message: badKey ? "That key wasn't accepted." : `The provider didn't accept that (error ${res.status}). Check the key and try again.` };
  } catch {
    return { ok: false, message: "Couldn't reach the provider to check the key." };
  }
}
