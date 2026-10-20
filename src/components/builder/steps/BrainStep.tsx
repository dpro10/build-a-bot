"use client";
import * as React from "react";
import { ArrowUpRight, Check, CircleAlert, Eye, EyeOff, KeyRound, Lock, Sparkles } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { formatMicros, perMessageMicros } from "@/lib/billing/prices";
import { INCLUDED_MODELS, PROVIDERS, PROVIDER_BY_ID, contextLabel, type ModelDef, type ProviderId } from "@/lib/models/catalog";
import { cn } from "@/lib/utils";
import { DEFAULT_MODEL, type BrainChoice } from "../state";
import { onRadioGroupKeyDown, radioTabIndex } from "../radio-group";
import { StepHeading } from "./StepHeading";

const TIERS: { id: ModelDef["tier"]; label: string; blurb: string }[] = [
  { id: "fast", label: "Fast", blurb: "Snappy everyday help" },
  { id: "balanced", label: "Balanced", blurb: "Smarter research and planning" },
  { id: "smart", label: "Smart", blurb: "The strongest open models" },
];

export type KeyStatus = "idle" | "checking" | "ok" | "error";

export function BrainStep({
  brain,
  onBrain,
  apiKey,
  onApiKey,
  keyStatus,
  keyMessage,
  onValidate,
  demo,
  starterCredit,
  botName,
}: {
  brain: BrainChoice;
  onBrain: (b: BrainChoice) => void;
  apiKey: string;
  onApiKey: (k: string) => void;
  keyStatus: KeyStatus;
  keyMessage: string | null;
  onValidate: () => void;
  demo: boolean;
  /** Credit every account starts with ("$1.00"), or null when there's none. */
  starterCredit: string | null;
  botName: string;
}) {
  const kinds: { id: BrainChoice["kind"]; title: string; blurb: string; icon: React.ReactNode; badge?: string; tone?: "primary" | "success" }[] = [
    {
      id: "included",
      title: "Open models on Nebius",
      blurb: "Nothing to set up. Paid from your credit, at cost: a fraction of a cent a message.",
      icon: <Sparkles className="size-5" />,
      badge: "Easiest",
      tone: "primary",
    },
    { id: "byok", title: "Your own API key", blurb: "Anthropic, OpenAI, Gemini, OpenRouter, Groq and more.", icon: <KeyRound className="size-5" />, badge: "Free here", tone: "success" },
  ];

  const pick = (kind: BrainChoice["kind"]) => {
    if (kind === brain.kind) return;
    if (kind === "included") onBrain({ kind, model: DEFAULT_MODEL, effort: "low" });
    else onBrain({ kind, provider: "anthropic", model: PROVIDER_BY_ID.anthropic.models.find((m) => m.default)?.id ?? "", baseUrl: "" });
  };

  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Choose its brain" subtitle={`The AI model ${botName || "your bot"} thinks with. Switch anytime — its memory and apps stay put.`} />
      <div role="radiogroup" aria-label="Brain" onKeyDown={onRadioGroupKeyDown} className="grid gap-2.5 sm:grid-cols-2">
        {kinds.map((k, i) => {
          const active = brain.kind === k.id;
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={radioTabIndex(active, i, false)}
              onClick={() => pick(k.id)}
              className={cn(
                "relative flex flex-col items-start gap-2 rounded-3xl border bg-card p-4 text-left transition",
                active ? "border-primary shadow-glow ring-2 ring-primary/25" : "border-border hover:border-foreground/25",
              )}
            >
              <span className="flex w-full items-center justify-between">
                <span className={cn("flex size-10 items-center justify-center rounded-2xl", active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>{k.icon}</span>
                {k.badge ? <Badge tone={k.tone ?? "success"}>{k.badge}</Badge> : null}
              </span>
              <span className="font-display text-[17px] leading-tight font-semibold">{k.title}</span>
              <span className="text-sm leading-snug text-muted-foreground">{k.blurb}</span>
            </button>
          );
        })}
      </div>

      <div key={brain.kind} className="animate-fade-up">
        {brain.kind === "included" ? <IncludedPanel brain={brain} onBrain={onBrain} demo={demo} starterCredit={starterCredit} /> : null}
        {brain.kind === "byok" ? (
          <ByokPanel brain={brain} onBrain={onBrain} apiKey={apiKey} onApiKey={onApiKey} keyStatus={keyStatus} keyMessage={keyMessage} onValidate={onValidate} />
        ) : null}
      </div>
    </div>
  );
}

function IncludedPanel({
  brain,
  onBrain,
  demo,
  starterCredit,
}: {
  brain: Extract<BrainChoice, { kind: "included" }>;
  onBrain: (b: BrainChoice) => void;
  demo: boolean;
  starterCredit: string | null;
}) {
  const current = INCLUDED_MODELS.find((m) => m.id === brain.model);
  const thinks = current?.thinking && current.thinking.style !== "none";
  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-border bg-background-2/60 p-4 sm:p-5">
      <p className="text-sm text-muted-foreground">
        Served from Nebius Token Factory and paid from your credit at its price, with nothing added
        {demo ? " (demo mode: nothing is charged)" : starterCredit ? `. Every account starts with ${starterCredit} of credit, no card needed` : ""}. Your chats aren&apos;t used
        to train models. Prices are for a typical message.
      </p>
      {TIERS.map((tier) => {
        const models = INCLUDED_MODELS.filter((m) => m.tier === tier.id);
        return (
          <div key={tier.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-display text-base font-semibold">{tier.label}</span>
              <span className="text-sm text-muted-foreground">· {tier.blurb}</span>
            </div>
            <div role="radiogroup" aria-label={`${tier.label} models`} onKeyDown={onRadioGroupKeyDown} className="grid gap-2 sm:grid-cols-2">
              {models.map((m, i) => {
                const active = m.id === brain.model;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={radioTabIndex(active, i, !models.some((x) => x.id === brain.model))}
                    onClick={() => onBrain({ ...brain, model: m.id })}
                    className={cn(
                      "flex items-start gap-3 rounded-2xl border bg-card p-3 text-left transition",
                      active ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-foreground/25",
                    )}
                  >
                    <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2", active ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                      {active ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-semibold">{m.label}</span>
                        {m.default ? <Badge tone="primary" className="px-1.5 py-0 text-[10px]">Default</Badge> : null}
                      </span>
                      <span className="block text-[13px] leading-snug text-muted-foreground">{m.blurb}</span>
                      <span className="mt-1 flex flex-wrap gap-x-2.5 text-[11px] font-medium text-muted-foreground">
                        <span className="font-semibold text-foreground/80 tabular-nums">≈ {formatMicros(perMessageMicros(m))} a message</span>
                        {m.maker ? <span>{m.maker}</span> : null}
                        {contextLabel(m.context) ? <span>{contextLabel(m.context)} context</span> : null}
                        {m.reasoning ? <span>Can think step by step</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">How hard should it think?</div>
          <div className="text-xs text-muted-foreground">{thinks ? "Quick replies are fastest; Deep is best for tricky questions." : "This model always answers straight away."}</div>
        </div>
        <Segmented
          aria-label="Thinking effort"
          value={brain.effort}
          onChange={(effort) => onBrain({ ...brain, effort })}
          options={[
            { value: "low", label: "Quick" },
            { value: "medium", label: "Thoughtful", disabled: !thinks },
            { value: "high", label: "Deep", disabled: !thinks },
          ]}
        />
      </div>
    </div>
  );
}

function ByokPanel({
  brain,
  onBrain,
  apiKey,
  onApiKey,
  keyStatus,
  keyMessage,
  onValidate,
}: {
  brain: Extract<BrainChoice, { kind: "byok" }>;
  onBrain: (b: BrainChoice) => void;
  apiKey: string;
  onApiKey: (k: string) => void;
  keyStatus: KeyStatus;
  keyMessage: string | null;
  onValidate: () => void;
}) {
  const provider = PROVIDER_BY_ID[brain.provider];
  const [show, setShow] = React.useState(false);
  const known = provider.models.some((m) => m.id === brain.model);
  const [custom, setCustom] = React.useState(!known && Boolean(brain.model));

  const setProvider = (id: ProviderId) => {
    const p = PROVIDER_BY_ID[id];
    onBrain({ kind: "byok", provider: id, model: p.models.find((m) => m.default)?.id ?? p.models[0]?.id ?? "", baseUrl: id === "custom" ? brain.baseUrl : "" });
    setCustom(id === "custom");
    onApiKey("");
  };

  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-border bg-background-2/60 p-4 sm:p-5">
      <div role="radiogroup" aria-label="Provider" onKeyDown={onRadioGroupKeyDown} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {PROVIDERS.map((p, i) => {
          const active = p.id === brain.provider;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={radioTabIndex(active, i, !PROVIDERS.some((x) => x.id === brain.provider))}
              onClick={() => setProvider(p.id)}
              className={cn("flex items-center gap-2.5 rounded-2xl border bg-card p-2.5 text-left text-sm font-semibold transition", active ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-foreground/25")}
            >
              <BrandTile icon={p.icon} size={30} />
              <span className="min-w-0 leading-tight">{p.name.replace(" (OpenAI-compatible)", "")}</span>
            </button>
          );
        })}
      </div>

      {provider.note ? <p className="text-sm text-muted-foreground">{provider.note}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {brain.provider === "custom" ? (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="byok-base">Base URL</Label>
            <Input id="byok-base" value={brain.baseUrl} placeholder="https://your-server.example.com/v1" inputMode="url" onChange={(e) => onBrain({ ...brain, baseUrl: e.target.value.trim() })} />
            <FieldHint>Any OpenAI-compatible endpoint (vLLM, LM Studio through a tunnel, and so on).</FieldHint>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="byok-model">Model</Label>
          {provider.models.length && !custom ? (
            <Select
              id="byok-model"
              value={brain.model}
              onChange={(e) => {
                if (e.target.value === "__other") {
                  setCustom(true);
                  onBrain({ ...brain, model: "" });
                } else onBrain({ ...brain, model: e.target.value });
              }}
            >
              {provider.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.default ? " (recommended)" : ""}
                </option>
              ))}
              {provider.freeformModel ? <option value="__other">Another model…</option> : null}
            </Select>
          ) : (
            <Input id="byok-model" value={brain.model} placeholder="model-id" onChange={(e) => onBrain({ ...brain, model: e.target.value.trim() })} />
          )}
          {custom && provider.models.length ? (
            <button type="button" className="self-start text-xs font-semibold text-primary" onClick={() => {
              setCustom(false);
              onBrain({ ...brain, model: provider.models.find((m) => m.default)?.id ?? provider.models[0].id });
            }}>
              Pick from the list instead
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="byok-key">API key</Label>
            {provider.keyUrl ? (
              <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline">
                Get a key <ArrowUpRight className="size-3" />
              </a>
            ) : null}
          </div>
          <div className="relative">
            <Input
              id="byok-key"
              type={show ? "text" : "password"}
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder={provider.keyPlaceholder ?? "Paste your key"}
              onChange={(e) => onApiKey(e.target.value)}
              onBlur={() => apiKey.trim().length >= 8 && keyStatus === "idle" && onValidate()}
              onPaste={() => setTimeout(onValidate, 50)}
              className="pr-11 font-mono text-sm"
            />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground" aria-label={show ? "Hide key" : "Show key"}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onValidate} disabled={apiKey.trim().length < 8 || keyStatus === "checking"}>
          {keyStatus === "checking" ? <Spinner /> : <KeyRound />} Check key
        </Button>
        <span className={cn("flex items-center gap-1.5 text-sm", keyStatus === "ok" && "text-success", keyStatus === "error" && "text-danger", keyStatus === "idle" && "text-muted-foreground")} aria-live="polite">
          {keyStatus === "ok" ? <Check className="size-4" strokeWidth={3} /> : keyStatus === "error" ? <CircleAlert className="size-4" /> : null}
          {keyStatus === "checking" ? "Checking with the provider…" : (keyMessage ?? (keyStatus === "idle" ? "We'll check it works before saving." : ""))}
        </span>
      </div>

      <p className="flex gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0 text-success" />
        Encrypted before it&apos;s stored, never logged, and never shown again — not even to you. Usage is billed by your provider, and what your
        bot reads and writes goes to them, under their rules for keeping data.
      </p>
    </div>
  );
}
