import type { BrainConfig } from "@/lib/db/schema";
import { INCLUDED_MODELS, PROVIDER_BY_ID, type ProviderId } from "@/lib/models/catalog";
import { config, demoMode } from "@/lib/env";

/** Human label for a bot's brain, e.g. "Nemotron 3.5 Lightning" or "Your Claude (Bridge)". */
export function brainLabel(brain: BrainConfig): string {
  if (brain.kind === "subscription") return brain.provider === "codex" ? "Your ChatGPT · via Bridge" : "Your Claude · via Bridge";
  if (brain.kind === "included") {
    const def = INCLUDED_MODELS.find((m) => m.id === brain.model);
    const label = def?.label ?? brain.model;
    return !config.tokenFactory.apiKey && demoMode ? `${label} · demo brain` : label;
  }
  const p = PROVIDER_BY_ID[brain.provider as ProviderId];
  const m = p?.models.find((x) => x.id === brain.model);
  return `${m?.label ?? brain.model} · your ${p?.name ?? brain.provider} key`;
}
