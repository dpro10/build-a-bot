import type { BotLimits, BrainConfig } from "@/lib/db/schema";
import { INCLUDED_MODELS, PROVIDER_BY_ID, type ProviderId } from "@/lib/models/catalog";
import { config, demoMode } from "@/lib/env";

/** Settings by the names the app gives them (lowercase, for "Settings changed: …"). */
const SETTING_NAMES: Record<string, string> = {
  name: "name",
  avatar: "look",
  color: "colors",
  instructions: "custom instructions",
  jobs: "what it helps with",
  role: "role",
  trust: "trust level",
  vibe: "personality",
  brain: "brain",
  limits: "limits",
  dailyActions: "actions per day",
  spendCapUsd: "spending cap",
  quietHours: "quiet hours",
  transcriptDays: "keep transcripts",
};

type LimitKey = keyof BotLimits;

/** "22:00" → "10 PM", "07:30" → "7:30 AM" */
function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** A limit's value as the owner sees it. Unset and "off" read the same, so re-saving one isn't a change. */
function limitValue(key: LimitKey, limits: BotLimits): string {
  switch (key) {
    case "transcriptDays":
      return limits.transcriptDays === undefined ? "90 days" : limits.transcriptDays === null ? "forever" : `${limits.transcriptDays} days`;
    case "quietHours":
      return limits.quietHours ? `${clockLabel(limits.quietHours.start)} to ${clockLabel(limits.quietHours.end)}` : "off";
    case "spendCapUsd":
      return limits.spendCapUsd ? `$${limits.spendCapUsd} a month` : "off";
    case "dailyActions":
      return limits.dailyActions === undefined ? "trust level's default" : String(limits.dailyActions);
  }
}

/**
 * The Activity receipt for a settings change, naming what changed ("Keep transcripts: 30 days",
 * "Settings changed: name, quiet hours") rather than the group it was saved in ("limits").
 * A limit counts only when its value really changed: the Limits card saves them all together.
 */
export function settingsChange(patch: Record<string, unknown> & { limits?: BotLimits }, before: BotLimits | null | undefined): { title: string; changed: string[] } {
  const prev = before ?? {};
  const changed: string[] = [];
  for (const key of Object.keys(patch)) {
    if (key !== "limits") changed.push(key);
    else {
      const next = { ...prev, ...patch.limits };
      const limits = (Object.keys(patch.limits ?? {}) as LimitKey[]).filter((k) => k in SETTING_NAMES && limitValue(k, next) !== limitValue(k, prev));
      changed.push(...(limits.length ? limits : ["limits"]));
    }
  }
  const only = changed.length === 1 ? changed[0] : null;
  if (only && patch.limits && only in patch.limits) {
    // One limit changed: say what it's set to now.
    const name = SETTING_NAMES[only];
    return { title: `${name[0].toUpperCase()}${name.slice(1)}: ${limitValue(only as LimitKey, { ...prev, ...patch.limits })}`, changed };
  }
  return { title: `Settings changed: ${changed.map((k) => SETTING_NAMES[k] ?? k).join(", ")}`, changed };
}

/** Human label for a bot's brain, e.g. "Nemotron 3.5 Lightning" or "Claude Sonnet 5.5 · your Anthropic key". */
export function brainLabel(brain: BrainConfig): string {
  if (brain.kind === "included") {
    const def = INCLUDED_MODELS.find((m) => m.id === brain.model);
    const label = def?.label ?? brain.model;
    return !config.tokenFactory.apiKey && demoMode ? `${label} · demo brain` : label;
  }
  const p = PROVIDER_BY_ID[brain.provider as ProviderId];
  const m = p?.models.find((x) => x.id === brain.model);
  return `${m?.label ?? brain.model} · your ${p?.name ?? brain.provider} key`;
}
