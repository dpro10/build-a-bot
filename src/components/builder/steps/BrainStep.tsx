"use client";
import * as React from "react";
import { ArrowUpRight, Check, CircleAlert, Eye, EyeOff, KeyRound, Laptop, Lock, Sparkles } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { Badge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { INCLUDED_MODELS, PROVIDERS, PROVIDER_BY_ID, SUBSCRIPTIONS, type ModelDef, type ProviderId } from "@/lib/models/catalog";
import { cn } from "@/lib/utils";
import { DEFAULT_MODEL, type BrainChoice } from "../state";
import { StepHeading } from "./StepHeading";

const TIERS: { id: ModelDef["tier"]; label: string; blurb: string }[] = [
  { id: "fast", label: "Fast", blurb: "Snappy everyday help" },
  { id: "balanced", label: "Balanced", blurb: "Smarter research and planning" },
  { id: "smart", label: "Smart", blurb: "The strongest open models" },
];

function formatContext(n?: number) {
  if (!n) return null;
  return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}K`;
}

export type KeyStatus = "idle" | "checking" | "ok" | "error";

export function BrainStep({
  brain,
  onBrain,
  apiKey,
  onApiKey,
  keyStatus,
  keyMessage,
  onValidate,
  plan,
  demo,
  botName,
}: {
  brain: BrainChoice;
  onBrain: (b: BrainChoice) => void;
  apiKey: string;
  onApiKey: (k: string) => void;
  keyStatus: KeyStatus;
  keyMessage: string | null;
  onValidate: () => void;
  plan: PlanId;
  demo: boolean;
  botName: string;
}) {
  const kinds: { id: BrainChoice["kind"]; title: string; blurb: string; icon: React.ReactNode; badge?: string }[] = [
    { id: "included", title: "Free open models", blurb: "Open-weight models we run for you. Nothing to set up.", icon: <Sparkles className="size-5" />, badge: "Easiest" },
    { id: "subscription", title: "Your Claude or ChatGPT plan", blurb: "Use the subscription you already pay for, through your own computer.", icon: <Laptop className="size-5" /> },
    { id: "byok", title: "Your own API key", blurb: "Anthropic, OpenAI, Gemini, OpenRouter, Groq and more.", icon: <KeyRound className="size-5" /> },
  ];

  const pick = (kind: BrainChoice["kind"]) => {
    if (kind === brain.kind) return;
    if (kind === "included") onBrain({ kind, model: DEFAULT_MODEL, effort: "low" });
    else if (kind === "subscription") onBrain({ kind, subscription: "claude", model: "default", whenOffline: "wait" });
    else onBrain({ kind, provider: "anthropic", model: PROVIDER_BY_ID.anthropic.models.find((m) => m.default)?.id ?? "", baseUrl: "" });
  };

  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Choose its brain" subtitle={`The AI model ${botName || "your bot"} thinks with. Switch anytime — its memory and apps stay put.`} />
      <div role="radiogroup" aria-label="Brain" className="grid gap-2.5 sm:grid-cols-3">
        {kinds.map((k) => {
          const active = brain.kind === k.id;
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(k.id)}
              className={cn(
                "relative flex flex-col items-start gap-2 rounded-3xl border bg-card p-4 text-left transition",
                active ? "border-primary shadow-glow ring-2 ring-primary/25" : "border-border hover:border-foreground/25",
              )}
            >
              <span className="flex w-full items-center justify-between">
                <span className={cn("flex size-10 items-center justify-center rounded-2xl", active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>{k.icon}</span>
                {k.badge ? <Badge tone="success">{k.badge}</Badge> : null}
              </span>
              <span className="font-display text-[17px] leading-tight font-semibold">{k.title}</span>
              <span className="text-sm leading-snug text-muted-foreground">{k.blurb}</span>
            </button>
          );
        })}
      </div>

      <div key={brain.kind} className="animate-fade-up">
        {brain.kind === "included" ? <IncludedPanel brain={brain} onBrain={onBrain} plan={plan} demo={demo} /> : null}
        {brain.kind === "subscription" ? <SubscriptionPanel brain={brain} onBrain={onBrain} onUseGeminiKey={() => onBrain({ kind: "byok", provider: "google", model: PROVIDER_BY_ID.google.models[0]?.id ?? "", baseUrl: "" })} /> : null}
        {brain.kind === "byok" ? (
          <ByokPanel brain={brain} onBrain={onBrain} apiKey={apiKey} onApiKey={onApiKey} keyStatus={keyStatus} keyMessage={keyMessage} onValidate={onValidate} />
        ) : null}
      </div>
    </div>
  );
}

function IncludedPanel({ brain, onBrain, plan, demo }: { brain: Extract<BrainChoice, { kind: "included" }>; onBrain: (b: BrainChoice) => void; plan: PlanId; demo: boolean }) {
  const current = INCLUDED_MODELS.find((m) => m.id === brain.model);
  const thinks = current?.thinking && current.thinking.style !== "none";
  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-border bg-background-2/60 p-4 sm:p-5">
      <p className="text-sm text-muted-foreground">
        Served from Nebius Token Factory. Your chats aren&apos;t used to train models. Free includes the fast models; Plus and Pro unlock bigger brains.
      </p>
      {TIERS.map((tier) => {
        const models = INCLUDED_MODELS.filter((m) => m.tier === tier.id);
        const locked = !demo && !PLANS[plan].includedModels.includes(tier.id);
        const needs = tier.id === "smart" ? "Pro" : "Plus";
        return (
          <div key={tier.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-display text-base font-semibold">{tier.label}</span>
              <span className="text-sm text-muted-foreground">· {tier.blurb}</span>
              {locked ? <Badge tone="accent">{needs}</Badge> : tier.id === "fast" ? <Badge tone="success">Free</Badge> : null}
            </div>
            <div role="radiogroup" aria-label={`${tier.label} models`} className="grid gap-2 sm:grid-cols-2">
              {models.map((m) => {
                const active = m.id === brain.model;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
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
                      <span className="mt-1 flex flex-wrap gap-x-2.5 text-[11px] font-medium text-muted-foreground/90">
                        {m.maker ? <span>{m.maker}</span> : null}
                        {formatContext(m.context) ? <span>{formatContext(m.context)} memory</span> : null}
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

function SubscriptionPanel({ brain, onBrain, onUseGeminiKey }: { brain: Extract<BrainChoice, { kind: "subscription" }>; onBrain: (b: BrainChoice) => void; onUseGeminiKey: () => void }) {
  const subs = SUBSCRIPTIONS.filter((s) => s.id === "claude" || s.id === "chatgpt");
  const current = SUBSCRIPTIONS.find((s) => s.id === brain.subscription)!;
  const cloud = SUBSCRIPTIONS.find((s) => s.id === "claude_cloud");
  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-border bg-background-2/60 p-4 sm:p-5">
      <div role="radiogroup" aria-label="Subscription" className="grid gap-2.5 sm:grid-cols-2">
        {subs.map((s) => {
          const active = s.id === brain.subscription;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onBrain({ ...brain, subscription: s.id as "claude" | "chatgpt", model: "default" })}
              className={cn("flex items-center gap-3 rounded-2xl border bg-card p-3.5 text-left transition", active ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-foreground/25")}
            >
              <BrandTile icon={s.icon} size={44} />
              <span className="min-w-0">
                <span className="block font-semibold">{s.name}</span>
                <span className="block text-sm text-muted-foreground">{s.plans} plan</span>
              </span>
              {active ? <Check className="ml-auto size-5 text-primary" strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        {[
          { t: "Install the Bridge", d: "One command on your Mac, Windows or Linux computer. Takes a minute." },
          { t: `It uses your own ${current.id === "claude" ? "Claude Code" : "Codex"}`, d: `Already signed in to your ${current.name} account — we never see your login.` },
          { t: "Your bot sends it work", d: "Answers come back to your bot on every channel. Your computer does the thinking." },
        ].map((x, i) => (
          <li key={x.t} className="rounded-2xl bg-card p-3.5 ring-1 ring-border">
            <span className="mb-1.5 flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">{i + 1}</span>
            <div className="text-sm font-semibold">{x.t}</div>
            <div className="text-xs leading-snug text-muted-foreground">{x.d}</div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 sm:grid-cols-2">
        {current.models.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sub-model">Model</Label>
            <Select id="sub-model" value={brain.model} onChange={(e) => onBrain({ ...brain, model: e.target.value })}>
              {current.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">When your computer is off</span>
          <Segmented
            aria-label="When your computer is off"
            value={brain.whenOffline}
            onChange={(whenOffline) => onBrain({ ...brain, whenOffline })}
            options={[
              { value: "wait", label: "Wait for it" },
              { value: "included", label: "Use a free model" },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p className="flex gap-2">
          <Lock className="mt-0.5 size-4 shrink-0 text-success" />
          Your subscription login stays on your computer. We never ask for it, store it or send it anywhere.
        </p>
        <p className="flex flex-wrap items-center gap-x-1">
          Have Gemini? Google only allows apps to use Gemini with an API key (there&apos;s a free tier).
          <button type="button" onClick={onUseGeminiKey} className="font-semibold text-primary underline-offset-2 hover:underline">
            Use a Gemini key instead
          </button>
        </p>
        {cloud ? (
          <p className="flex items-center gap-2">
            <Badge tone="neutral">Coming soon</Badge> {cloud.name}: {cloud.how}
          </p>
        ) : null}
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
      <div role="radiogroup" aria-label="Provider" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {PROVIDERS.map((p) => {
          const active = p.id === brain.provider;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
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
        Encrypted before it&apos;s stored, never logged, and never shown again — not even to you. Usage is billed by your provider.
      </p>
    </div>
  );
}
