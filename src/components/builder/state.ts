/**
 * Builder state: everything the owner picks, step by step, plus validation.
 * Saved to localStorage so a refresh doesn't lose progress — except API keys,
 * which only ever live in memory until they're sent to the server once.
 */
import { AVATARS, type AvatarId, type ColorwayId } from "@/lib/avatars";
import type { TrustLevel } from "@/lib/trust";
import { CHANNEL_BY_KIND, channelAvailability, isChannelKind, type ChannelKind, type LiveFlags } from "@/lib/channels/catalog";
import { getConnector } from "@/lib/connectors";
import { INCLUDED_MODELS, PROVIDER_BY_ID, type ProviderId } from "@/lib/models/catalog";
import { isJobId, JOB_BY_ID } from "@/lib/jobs";
import type { RecipeData } from "@/lib/recipes";
import { isRoleId, type RoleId } from "@/lib/roles";
import { ALWAYS_ON, countsTowardLimit } from "@/components/catalog/connector-meta";

export const STEPS = [
  { id: "face", label: "Face", title: "Pick a face" },
  { id: "name", label: "Name", title: "Name it" },
  { id: "brain", label: "Brain", title: "Choose its brain" },
  { id: "apps", label: "Apps", title: "Give it your apps" },
  { id: "trust", label: "Trust", title: "Decide how much it can do" },
  { id: "channels", label: "Talk", title: "Pick how you'll talk" },
  { id: "review", label: "Go", title: "Bring it to life" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export type BrainChoice =
  | { kind: "included"; model: string; effort: "low" | "medium" | "high" }
  | { kind: "byok"; provider: ProviderId; model: string; baseUrl: string };

export type BuilderState = {
  avatar: AvatarId;
  color: ColorwayId;
  /** True once the owner picked a colorway themselves (switching faces keeps it). */
  colorPicked: boolean;
  name: string;
  ownerName: string;
  brain: BrainChoice;
  jobs: string[];
  connectors: string[];
  customMcp: { url: string; name?: string }[];
  trust: TrustLevel;
  channels: ChannelKind[];
  /**
   * The channels a recipe or role talks on, shown as suggestions: a recipe starts in the web chat,
   * so nothing stops on a phone number or waits for a setup the owner didn't pick.
   */
  suggestedChannels: ChannelKind[];
  phone: string;
  email: string;
  instructions: string;
  ageConfirmed: boolean;
  recipeSlug: string | null;
  /** A ready-made role from the recipe (a tutor, a job applier…); null for a general assistant. */
  role: RoleId | null;
  /** Daily brief the bot sends on its own. */
  brief: { on: boolean; time: string; weekdays: boolean };
};

export const DEFAULT_MODEL = INCLUDED_MODELS.find((m) => m.default)!.id;

/** Apps that count toward the fair-use limit: third-party apps from the catalog plus your own MCP servers. */
export function countedApps(connectors: string[], customMcp: unknown[]): number {
  return connectors.filter((id) => {
    const def = getConnector(id);
    return Boolean(def && countsTowardLimit(def));
  }).length + customMcp.length;
}

/** What this server offers the builder, so a recipe or a saved draft only brings what works here. */
export type BuilderContext = {
  demo: boolean;
  live: LiveFlags;
  /** Built-ins and apps this server can't offer yet (see comingSoonConnectors). */
  comingSoon: string[];
  /** The signed-in account's email, for the Email channel. */
  ownerEmail: string | null;
};

/**
 * Channels a recipe or a saved draft may bring. Demo mode keeps them all (it simulates what
 * isn't set up); otherwise one that's coming soon here is left out.
 */
export function usableChannels(channels: unknown, ctx: BuilderContext): ChannelKind[] {
  const kinds = Array.isArray(channels) ? channels.filter(isChannelKind) : [];
  return [...new Set(kinds)].filter((kind) => {
    if (kind === "web") return false;
    if (ctx.demo) return true;
    const availability = channelAvailability(CHANNEL_BY_KIND[kind], ctx.demo, ctx.live);
    return availability !== "soon";
  });
}

/** Apps a recipe or a saved draft may bring: none that are coming soon here. */
function usableApps(connectors: unknown, ctx: BuilderContext): string[] {
  const ids = Array.isArray(connectors) ? connectors.filter((c): c is string => typeof c === "string") : [];
  return [...new Set(ids)].filter((id) => !ctx.comingSoon.includes(id));
}

export function initialState(recipe: (RecipeData & { slug?: string }) | null | undefined, ctx: BuilderContext): BuilderState {
  const base: BuilderState = {
    avatar: "blip",
    color: AVATARS.blip.defaultColor,
    colorPicked: false,
    name: "",
    ownerName: "",
    brain: { kind: "included", model: DEFAULT_MODEL, effort: "low" },
    jobs: [],
    connectors: [],
    customMcp: [],
    trust: "ask",
    channels: [],
    suggestedChannels: [],
    phone: "",
    email: ctx.ownerEmail ?? "",
    instructions: "",
    ageConfirmed: false,
    recipeSlug: null,
    role: null,
    brief: { on: true, time: "08:00", weekdays: false },
  };
  if (!recipe) return base;
  const jobs = recipe.jobs.filter(isJobId);
  return {
    ...base,
    avatar: recipe.avatar,
    color: recipe.color,
    colorPicked: true,
    name: recipe.name,
    jobs,
    // Jobs bring their built-in tools (web search for research, and so on), just like picking them by hand.
    connectors: usableApps([...recipe.connectors, ...jobs.flatMap((j) => JOB_BY_ID[j].builtins).filter((b) => !ALWAYS_ON.has(b))], ctx),
    trust: recipe.trust,
    suggestedChannels: usableChannels(recipe.channels, ctx),
    instructions: recipe.instructions,
    recipeSlug: recipe.slug ?? null,
    role: isRoleId(recipe.role) ? recipe.role : null,
    // The recipe brings its own routines.
    brief: { ...base.brief, on: !recipe.routines?.length },
  };
}

/** A saved draft on top of a fresh state, keeping only what works here: its channels and apps, and a model we still serve. */
export function withDraft(base: BuilderState, draft: Partial<BuilderState>, ctx: BuilderContext): BuilderState {
  // A draft saved before 2026-10-20 can hold a Claude or ChatGPT plan, which is gone: back to the default.
  const brain = draft.brain && (draft.brain.kind as string) !== "subscription" ? draft.brain : base.brain;
  return {
    ...base,
    ...draft,
    brain: brain.kind === "included" && !INCLUDED_MODELS.some((m) => m.id === brain.model) ? { ...brain, model: DEFAULT_MODEL } : brain,
    brief: draft.brief ?? base.brief,
    role: isRoleId(draft.role) ? draft.role : base.role,
    ageConfirmed: false,
    channels: usableChannels(draft.channels ?? base.channels, ctx),
    suggestedChannels: usableChannels(draft.suggestedChannels ?? base.suggestedChannels, ctx),
    connectors: usableApps(draft.connectors ?? base.connectors, ctx),
    // A draft saved before signing in takes the account's email.
    email: typeof draft.email === "string" && draft.email.trim() ? draft.email : base.email,
  };
}

export const STORAGE_KEY = "bab-builder-v1";

type Draft = { state: BuilderState; step: number; savedAt: number };

/** Save progress (the API key is never part of BuilderState, so it's never saved). */
export function saveDraft(state: BuilderState, step: number) {
  try {
    const draft: Draft = { state, step, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Private mode or storage full: progress just isn't saved.
  }
}

export function loadDraft(): { state: Partial<BuilderState>; step: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<Draft>;
    if (!draft.state || typeof draft.state !== "object") return null;
    // Drafts older than a week start fresh.
    if (draft.savedAt && Date.now() - draft.savedAt > 7 * 86400_000) return null;
    const state = { ...draft.state } as Partial<BuilderState> & { apiKey?: unknown };
    delete state.apiKey;
    if (state.avatar && !(state.avatar in AVATARS)) return null;
    return { state, step: Math.max(0, Math.min(STEPS.length - 1, Number(draft.step) || 0)) };
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export const NAME_PATTERN = /build[\s-]*a[\s-]*bot/i;

export function nameError(name: string): string | null {
  const n = name.trim();
  if (!n) return "Give it a name";
  if (n.length > 32) return "Keep it under 32 characters";
  if (NAME_PATTERN.test(n)) return "Pick a name that isn't the product's name";
  return null;
}

export function isPhoneLike(v: string) {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export function isEmailLike(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/** Why the owner can't continue from a step yet (null = good to go). */
export function stepError(step: StepId, s: BuilderState, extra: { apiKey: string; keyStatus: "idle" | "checking" | "ok" | "error" }): string | null {
  switch (step) {
    case "face":
      return null;
    case "name":
      return nameError(s.name);
    case "brain":
      if (s.brain.kind === "byok") {
        const p = PROVIDER_BY_ID[s.brain.provider];
        if (!p) return "Pick a provider";
        if (s.brain.provider === "custom" && !/^https?:\/\//.test(s.brain.baseUrl)) return "Add your endpoint's base URL";
        if (!s.brain.model.trim()) return "Pick a model";
        if (extra.apiKey.trim().length < 8) return "Paste your API key";
        if (extra.keyStatus === "checking") return "Checking your key…";
        if (extra.keyStatus === "error") return "That key didn't work — check it and try again";
      }
      return null;
    case "apps":
      return null;
    case "trust":
      return null;
    case "channels":
      if ((s.channels.includes("sms") || s.channels.includes("voice")) && !isPhoneLike(s.phone)) return "Add your mobile number for texts and calls";
      if (s.channels.includes("email") && !isEmailLike(s.email)) return "Add your email address";
      return null;
    case "review":
      if (!s.ageConfirmed) return "Confirm you're 18 or older";
      return nameError(s.name);
  }
}
