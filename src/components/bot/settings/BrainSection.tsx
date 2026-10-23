"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, Check, CircleAlert, ExternalLink, KeyRound, Lock, Sparkles } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { INCLUDED_MODELS, PROVIDERS, PROVIDER_BY_ID, contextLabel, type ModelDef, type ProviderId } from "@/lib/models/catalog";
import { formatMicros, perMessageMicros } from "@/lib/billing/prices";
import { cn } from "@/lib/utils";
import { FieldGroup, SettingsSection, useApiErrorToast } from "./ui";
import { radioKeyDown, radioTabIndex } from "@/components/bot/activity/radio-keys";

export type BrainValue = {
  kind: "included" | "byok";
  provider: string;
  model: string;
  effort?: "low" | "medium" | "high";
  baseUrl?: string | null;
};

type Tier = "fast" | "balanced" | "smart";
const TIERS: { id: Tier; label: string; blurb: string }[] = [
  { id: "fast", label: "Fast", blurb: "Quick everyday help" },
  { id: "balanced", label: "Balanced", blurb: "Smarter, still quick" },
  { id: "smart", label: "Smart", blurb: "Best for long, careful work" },
];

const EFFORT_HINT = {
  low: "Fastest. Thinks briefly before it uses a tool.",
  medium: "Thinks a little first. A bit slower.",
  high: "Takes its time on hard problems. Slowest.",
};

const OTHER = "__other__";

export function brainText(b: BrainValue, demoBrain: boolean): string {
  if (b.kind === "included") {
    const def = INCLUDED_MODELS.find((m) => m.id === b.model);
    return `${def?.label ?? b.model}${demoBrain ? " · demo brain" : ""}`;
  }
  const p = PROVIDER_BY_ID[b.provider as ProviderId];
  const m = p?.models.find((x) => x.id === b.model);
  return `${m?.label ?? b.model} · your ${p?.name ?? b.provider} key`;
}

function BrainIcon({ b, size = 40 }: { b: BrainValue; size?: number }) {
  if (b.kind === "byok") {
    const p = PROVIDER_BY_ID[b.provider as ProviderId];
    if (p) return <BrandTile icon={p.icon} size={size} className="rounded-2xl" />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow" style={{ width: size, height: size }}>
      <Sparkles className="size-1/2" aria-hidden />
    </span>
  );
}

export function BrainSection({
  botId,
  botName,
  initial,
  label,
  keyHint,
  demoBrain,
}: {
  botId: string;
  botName: string;
  initial: BrainValue;
  /** brainLabel() of `initial`, from the server. */
  label: string;
  keyHint: string | null;
  demoBrain: boolean;
}) {
  const router = useRouter();
  const onError = useApiErrorToast();
  const [current, setCurrent] = React.useState(initial);
  const [savedHint, setSavedHint] = React.useState<{ provider: string; hint: string } | null>(
    initial.kind === "byok" && keyHint ? { provider: initial.provider, hint: keyHint.replace(/^…/, "") } : null,
  );
  const [tab, setTab] = React.useState<BrainValue["kind"]>(initial.kind);
  const [saving, setSaving] = React.useState(false);

  // Included
  const [model, setModel] = React.useState(initial.kind === "included" ? initial.model : (INCLUDED_MODELS.find((m) => m.default)?.id ?? INCLUDED_MODELS[0].id));
  const [effort, setEffort] = React.useState<"low" | "medium" | "high">(initial.kind === "included" ? (initial.effort ?? "low") : "low");

  // Your own key
  const firstProvider = (initial.kind === "byok" ? initial.provider : "anthropic") as ProviderId;
  const [provider, setProvider] = React.useState<ProviderId>(PROVIDER_BY_ID[firstProvider] ? firstProvider : "anthropic");
  const pdef = PROVIDER_BY_ID[provider];
  const initialByokModel = initial.kind === "byok" ? initial.model : "";
  const [byokModel, setByokModel] = React.useState(() => pickModel(pdef, initialByokModel));
  const [customModel, setCustomModel] = React.useState(initial.kind === "byok" && !pdef.models.some((m) => m.id === initialByokModel) ? initialByokModel : "");
  const [baseUrl, setBaseUrl] = React.useState(initial.kind === "byok" ? (initial.baseUrl ?? "") : "");
  const [apiKey, setApiKey] = React.useState("");
  // "unverified": saved, but the provider couldn't be reached to check it (demo servers).
  const [keyState, setKeyState] = React.useState<{ state: "idle" | "checking" | "ok" | "unverified" | "error"; message?: string }>({ state: "idle" });

  const selected = INCLUDED_MODELS.find((m) => m.id === model) ?? INCLUDED_MODELS[0];
  const hasSavedKey = savedHint?.provider === provider;

  const patch = async (brain: Record<string, unknown>, success: string) => {
    setSaving(true);
    try {
      const res = await api<{ bot: { brain: BrainValue } }>(`/api/bots/${botId}`, { method: "PATCH", body: { brain } });
      setCurrent(res.bot.brain);
      toast.success(success);
      router.refresh();
      return true;
    } catch (err) {
      onError(err);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Models that don't think step by step have nothing to tune: keep them on "low".
  const effectiveEffort = selected.reasoning ? effort : "low";
  const saveIncluded = () => patch({ kind: "included", model, effort: effectiveEffort }, `${botName} now thinks with ${selected.label}`);

  const saveByok = async () => {
    const chosenModel = byokModel === OTHER || !pdef.models.length ? customModel.trim() : byokModel;
    if (!chosenModel) return setKeyState({ state: "error", message: "Pick a model, or type its name." });
    if (provider === "custom" && !/^https?:\/\/\S+$/.test(baseUrl.trim())) return setKeyState({ state: "error", message: "Add your server's address, like https://example.com/v1." });
    const key = apiKey.trim();
    if (!key && !hasSavedKey) return setKeyState({ state: "error", message: "Paste your API key." });
    if (key && key.length < 8) return setKeyState({ state: "error", message: "That key looks too short." });
    if (key) {
      setKeyState({ state: "checking" });
      try {
        const res = await api<{ ok: boolean; message?: string; unverified?: boolean }>("/api/brain/validate", {
          method: "POST",
          body: { provider, apiKey: key, ...(provider === "custom" ? { baseUrl: baseUrl.trim() } : {}) },
        });
        if (!res.ok) return setKeyState({ state: "error", message: res.message ?? "That key didn't work." });
        setKeyState(res.unverified ? { state: "unverified", message: res.message } : { state: "ok", message: "Key works." });
      } catch (err) {
        return setKeyState({ state: "error", message: (err as Error).message || "Couldn't check the key." });
      }
    }
    const ok = await patch(
      { kind: "byok", provider, model: chosenModel, ...(key ? { apiKey: key } : {}), ...(provider === "custom" ? { baseUrl: baseUrl.trim() } : {}) },
      `${botName} now thinks with your ${pdef.name} key`,
    );
    if (ok) {
      if (key) setSavedHint({ provider, hint: key.slice(-4) });
      setApiKey("");
    }
  };

  const chooseProvider = (id: ProviderId) => {
    setProvider(id);
    const def = PROVIDER_BY_ID[id];
    setByokModel(pickModel(def, current.kind === "byok" && current.provider === id ? current.model : ""));
    setCustomModel(current.kind === "byok" && current.provider === id && !def.models.some((m) => m.id === current.model) ? current.model : "");
    setKeyState({ state: "idle" });
    setApiKey("");
  };

  const isCurrentIncluded = current.kind === "included" && current.model === model && (current.effort ?? "low") === effectiveEffort;
  const chosenByokModel = byokModel === OTHER || !pdef.models.length ? customModel.trim() : byokModel;
  const isCurrentByok =
    current.kind === "byok" &&
    current.provider === provider &&
    current.model === chosenByokModel &&
    !apiKey.trim() &&
    (provider !== "custom" || (current.baseUrl ?? "") === baseUrl.trim());

  return (
    <SettingsSection id="brain" icon={Brain} title="Brain" description={`The AI model ${botName} thinks with. Switch any time; its memory and apps stay the same.`}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-background-2/70 p-3.5">
          <BrainIcon b={current} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Thinking with</div>
            <div className="font-semibold [overflow-wrap:anywhere]">
              {/* The server's label once the page has refreshed; our own until then. */}
              {current.kind === initial.kind && current.provider === initial.provider && current.model === initial.model ? label : brainText(current, demoBrain)}
            </div>
          </div>
          <Badge tone="primary" className="shrink-0">
            {current.kind === "included" ? "Included" : "Your key"}
          </Badge>
        </div>

        <Segmented
          aria-label="Kind of brain"
          value={tab}
          onChange={(t) => setTab(t)}
          options={[
            { value: "included", label: "Included" },
            { value: "byok", label: "API key" },
          ]}
          className="self-start"
        />

        {tab === "included" ? (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              Open models we run for you on Nebius Token Factory. Nothing to set up: each message is paid from your credit at Token Factory&apos;s
              price, with nothing added. Prices are for a typical message.
              {demoBrain ? " In this demo, answers come from a stand-in brain." : ""}{" "}
              <Link href="/app/billing" className="font-medium text-primary hover:underline">
                Credit &amp; usage
              </Link>
            </p>
            {TIERS.map((tier) => {
              const models = INCLUDED_MODELS.filter((m) => m.tier === tier.id);
              return (
                <div key={tier.id} className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <h4 className="text-sm font-semibold">{tier.label}</h4>
                    <span className="text-xs text-muted-foreground">{tier.blurb}</span>
                  </div>
                  <div role="radiogroup" aria-label={`${tier.label} models`} className="grid gap-2 sm:grid-cols-2">
                    {models.map((m, i) => (
                      <ModelCard
                        key={m.id}
                        m={m}
                        tabIndex={radioTabIndex(model === m.id, i, models.some((x) => x.id === model))}
                        selected={model === m.id}
                        current={current.kind === "included" && current.model === m.id}
                        onSelect={() => setModel(m.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            <FieldGroup label="How hard it thinks" hint={selected.reasoning ? EFFORT_HINT[effort] : `${selected.label} answers right away; there's nothing to tune.`}>
              <Segmented
                aria-label="How hard it thinks"
                value={effectiveEffort}
                onChange={(x) => setEffort(x)}
                options={[
                  { value: "low", label: "Quick", disabled: !selected.reasoning },
                  { value: "medium", label: "Thoughtful", disabled: !selected.reasoning },
                  { value: "high", label: "Deep", disabled: !selected.reasoning },
                ]}
                className="self-start"
              />
            </FieldGroup>
            <SaveRow>
              <Button onClick={saveIncluded} loading={saving} disabled={isCurrentIncluded}>
                {isCurrentIncluded ? (
                  <>
                    <Check /> In use
                  </>
                ) : (
                  `Use ${selected.label}`
                )}
              </Button>
            </SaveRow>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              Use your own account with an AI company. You pay them directly, and it&apos;s free here. What {botName} reads and writes then goes to
              them, and their rules for keeping data apply, not ours.
            </p>
            <div role="radiogroup" aria-label="Provider" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {PROVIDERS.map((p, i) => {
                const on = provider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={radioTabIndex(on, i, true)}
                    onKeyDown={radioKeyDown}
                    onClick={() => chooseProvider(p.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-2xl border px-2.5 py-2 text-left transition",
                      on ? "border-primary bg-primary-soft/60 ring-4 ring-primary/10" : "border-border bg-card hover:border-foreground/20 hover:bg-muted/40",
                    )}
                  >
                    <BrandTile icon={p.icon} size={30} className="rounded-xl" />
                    <span className="min-w-0 truncate text-sm font-semibold" title={p.name}>
                      {p.name.replace(/\s*\(.*\)$/, "")}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background-2/60 p-4">
              <div className="flex items-start gap-3">
                <BrandTile icon={pdef.icon} size={36} className="rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{pdef.name}</div>
                  {pdef.note ? <p className="text-xs text-muted-foreground">{pdef.note}</p> : null}
                </div>
                {pdef.keyUrl ? (
                  <a href={pdef.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Get a key <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : null}
              </div>

              {pdef.models.length ? (
                <FieldGroup label="Model" htmlFor="byok-model" hint={pdef.models.find((m) => m.id === byokModel)?.blurb}>
                  <Select id="byok-model" value={byokModel} onChange={(e) => setByokModel(e.target.value)}>
                    {pdef.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    {pdef.freeformModel ? <option value={OTHER}>Another model…</option> : null}
                  </Select>
                </FieldGroup>
              ) : null}
              {byokModel === OTHER || !pdef.models.length ? (
                <FieldGroup label={pdef.models.length ? "Model name" : "Model"} htmlFor="byok-custom-model" hint="Exactly as the provider spells it.">
                  <Input
                    id="byok-custom-model"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder={provider === "openrouter" ? "anthropic/claude-sonnet-5.5" : provider === "custom" ? "llama-4-70b-instruct" : "model-name"}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-sm"
                  />
                </FieldGroup>
              ) : null}
              {provider === "custom" ? (
                <FieldGroup label="Server address" htmlFor="byok-base" hint="An OpenAI-compatible endpoint, ending in /v1 for most servers.">
                  <Input id="byok-base" type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://my-server.example.com/v1" autoComplete="off" spellCheck={false} />
                </FieldGroup>
              ) : null}
              <FieldGroup
                label="API key"
                htmlFor="byok-key"
                hint={
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="size-3" aria-hidden /> Encrypted and never shown again, not even to you.
                  </span>
                }
              >
                {hasSavedKey ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Badge tone="success">
                      <KeyRound /> Key saved •••• {savedHint?.hint}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Paste a new one to replace it.</span>
                  </div>
                ) : null}
                <Input
                  id="byok-key"
                  type="password"
                  name="byok-api-key"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (keyState.state !== "checking") setKeyState({ state: "idle" });
                  }}
                  placeholder={hasSavedKey ? "Leave empty to keep your saved key" : (pdef.keyPlaceholder ?? "Paste your key")}
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  className="font-mono text-sm"
                />
              </FieldGroup>
              {keyState.state !== "idle" ? (
                <div
                  role="status"
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    keyState.state === "error" ? "text-danger" : keyState.state === "ok" ? "text-success" : keyState.state === "unverified" ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {keyState.state === "checking" ? <Spinner /> : keyState.state === "ok" ? <Check className="size-4 shrink-0" /> : <CircleAlert className="size-4 shrink-0" />}
                  {keyState.state === "checking" ? "Checking your key…" : keyState.message}
                </div>
              ) : null}
            </div>
            <SaveRow>
              <Button onClick={saveByok} loading={saving || keyState.state === "checking"} disabled={isCurrentByok}>
                {isCurrentByok ? (
                  <>
                    <Check /> In use
                  </>
                ) : apiKey.trim() ? (
                  "Check key and switch"
                ) : (
                  `Use ${pdef.name.replace(/\s*\(.*\)$/, "")}`
                )}
              </Button>
            </SaveRow>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

function pickModel(def: (typeof PROVIDERS)[number], current: string): string {
  if (current && def.models.some((m) => m.id === current)) return current;
  if (current && def.freeformModel) return OTHER;
  return def.models.find((m) => m.default)?.id ?? def.models[0]?.id ?? OTHER;
}

function SaveRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {children}
      </div>
    </div>
  );
}

function ModelCard({
  m,
  tabIndex,
  selected,
  current,
  onSelect,
}: {
  m: ModelDef;
  tabIndex: 0 | -1;
  selected: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const ctx = contextLabel(m.context);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      onKeyDown={radioKeyDown}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-2xl border p-3.5 text-left transition",
        selected ? "border-primary bg-primary-soft/60 ring-4 ring-primary/10" : "border-border bg-card hover:border-foreground/20 hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{m.label}</span>
        {current ? <Badge tone="success">In use</Badge> : null}
      </span>
      <span className="text-xs text-muted-foreground">by {m.maker ?? "an open lab"}</span>
      <span className="text-sm text-foreground">{m.blurb}</span>
      <span className="mt-1 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary tabular-nums">≈ {formatMicros(perMessageMicros(m))} a message</span>
        {ctx ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{ctx} context</span> : null}
        {m.reasoning ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Can think step by step</span> : null}
      </span>
    </button>
  );
}
