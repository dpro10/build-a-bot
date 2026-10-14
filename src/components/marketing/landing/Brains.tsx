import { ArrowRight, Laptop, Lock, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile, type IconSpec } from "@/components/brand/icons";
import { INCLUDED_MODELS, PROVIDERS, SUBSCRIPTIONS } from "@/lib/models/catalog";
import { PLANS, PLAN_ORDER, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { Container, Section, SectionHeader } from "../ui";
import { brandOrLetter } from "../icons";

type Family = { name: string; match: RegExp; icon: IconSpec };

/** Model families we host, in the order people tend to know them. */
const FAMILIES: Family[] = [
  { name: "Nemotron", match: /nemotron/i, icon: brandOrLetter("nvidia", "N", "76B900") },
  { name: "gpt-oss", match: /gpt-oss/i, icon: { letter: "AI", color: "10A37F" } },
  { name: "DeepSeek", match: /deepseek/i, icon: brandOrLetter("deepseek", "DS", "4D6BFE") },
  { name: "Qwen", match: /qwen/i, icon: brandOrLetter("qwen", "Q", "615CED") },
  { name: "GLM", match: /glm/i, icon: { letter: "Z", color: "3A3A4A" } },
  { name: "Kimi", match: /kimi/i, icon: { letter: "K", color: "1F2937" } },
  { name: "MiniMax", match: /minimax/i, icon: { letter: "M", color: "E73562" } },
  { name: "Hermes", match: /hermes/i, icon: { letter: "H", color: "6D28D9" } },
];

/** The cheapest plan whose included brains cover a model tier (matches the server's check). */
function planForTier(tier: "fast" | "balanced" | "smart"): PlanId {
  return PLAN_ORDER.find((id) => PLANS[id].includedModels.includes(tier)) ?? "pro";
}

function familyRows() {
  return FAMILIES.map((f) => {
    const models = INCLUDED_MODELS.filter((m) => f.match.test(m.label) || f.match.test(m.id));
    const plans = models.map((m) => planForTier(m.tier));
    const from = PLAN_ORDER.find((p) => plans.includes(p)) ?? "pro";
    return { ...f, models, from };
  }).filter((f) => f.models.length > 0);
}

function Card({ className, children, highlight }: { className?: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-3xl border bg-card p-6 shadow-soft sm:p-7",
        highlight ? "border-primary/40 ring-4 ring-primary/10" : "border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CardTitle({ kicker, title, badge, children }: { kicker: string; title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">{kicker}</span>
        {badge}
      </div>
      <h3 className="mt-1.5 font-display text-2xl font-bold tracking-tight">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function SubscriptionCard() {
  const subs = SUBSCRIPTIONS.filter((s) => s.status === "available");
  return (
    <Card>
      {/* Diagram: your computer → Bridge → your bot */}
      <div aria-hidden="true" className="rounded-2xl border border-border/70 bg-background-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col items-center gap-1.5">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-card shadow-soft ring-1 ring-border">
              <Laptop className="size-6" />
            </span>
            <span className="text-[11px] font-semibold text-muted-foreground">Your computer</span>
          </div>
          <div className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full border-t-2 border-dashed border-primary/40" />
            <span className="-mt-3.5 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground shadow-glow">Bridge</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-card shadow-soft ring-1 ring-border">
              <Avatar avatar="otto" size={40} animated={false} />
            </span>
            <span className="text-[11px] font-semibold text-muted-foreground">Your bot</span>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {subs.map((s) => (
            <div key={s.id} className="flex items-center gap-2.5 rounded-xl bg-card px-2.5 py-2 shadow-soft ring-1 ring-border">
              <BrandTile icon={brandOrLetter(s.icon.simpleIcon, s.icon.letter ?? s.name.charAt(0), s.icon.color)} size={26} />
              <span className="text-sm font-semibold">{s.name}</span>
              <span className="text-xs text-muted-foreground">{s.plans}</span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">{s.cli}</span>
            </div>
          ))}
        </div>
      </div>
      <CardTitle kicker="Option 1" title="Your subscription">
        Use the Claude Pro or Max, or ChatGPT Plus or Pro plan you already pay for. The Bridge runs your own Claude Code or Codex on your
        own computer, signed in by you.
      </CardTitle>
      <ul className="mt-4 flex flex-col gap-2 text-sm">
        <li className="flex gap-2">
          <Lock className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>
            <span className="font-semibold">Your login never leaves your machine.</span> We never see it or store it.
          </span>
        </li>
        <li className="flex gap-2 text-muted-foreground">
          <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Works while your computer is awake. When it sleeps, your bot waits, or uses the free brain if you opt in.</span>
        </li>
      </ul>
    </Card>
  );
}

function ApiKeyCard() {
  return (
    <Card>
      <div aria-hidden="true" className="rounded-2xl border border-border/70 bg-background-2 p-4">
        <div className="grid grid-cols-6 gap-2">
          {PROVIDERS.map((p) => (
            <span key={p.id} title={p.name} className="flex justify-center">
              <BrandTile icon={brandOrLetter(p.icon.simpleIcon, p.icon.letter ?? p.name.charAt(0), p.icon.color)} size={34} />
            </span>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 shadow-soft ring-1 ring-border">
          <Lock className="size-4 text-success" />
          <span className="truncate font-mono text-sm whitespace-nowrap text-muted-foreground">•••• 4f2a</span>
          <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">Encrypted</span>
        </div>
      </div>
      <CardTitle kicker="Option 2" title="Your own API key">
        Paste a key from Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, xAI, DeepSeek, Together, Fireworks or Cerebras, or point it at
        any OpenAI-compatible endpoint.
      </CardTitle>
      <ul className="mt-4 flex flex-col gap-2 text-sm">
        <li className="flex gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>
            <span className="font-semibold">Encrypted on arrival, never shown again.</span> You only ever see the last four characters.
          </span>
        </li>
        <li className="flex gap-2 text-muted-foreground">
          <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Gemini works with an API key only: Google doesn&apos;t let apps reuse Gemini subscriptions.</span>
        </li>
      </ul>
    </Card>
  );
}

function IncludedCard() {
  const rows = familyRows();
  const tiers = PLAN_ORDER.map((plan) => ({ plan, families: rows.filter((f) => f.from === plan) })).filter((t) => t.families.length > 0);
  return (
    <Card highlight>
      <div aria-hidden="true" className="flex flex-col gap-2.5 rounded-2xl border border-border/70 bg-background-2 p-4">
        {tiers.map((t, i) => (
          <div key={t.plan} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-1 w-11 shrink-0 rounded-full py-0.5 text-center text-[11px] font-bold",
                t.plan === "free" ? "bg-success-soft text-success" : "bg-primary-soft text-primary",
              )}
            >
              {i === 0 ? PLANS[t.plan].name : `+${PLANS[t.plan].name}`}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {t.families.map((f) => (
                <span key={f.name} className="inline-flex items-center gap-1.5 rounded-full bg-card py-1 pr-2.5 pl-1 text-[13px] font-semibold shadow-soft ring-1 ring-border">
                  <BrandTile icon={f.icon} size={20} />
                  {f.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <CardTitle
        kicker="Option 3"
        title="Included open models"
        badge={<span className="rounded-full bg-success px-2.5 py-1 text-xs font-bold text-success-foreground shadow-soft">Free to start</span>}
      >
        No key, no subscription, no problem. Use open models we host through Nebius Token Factory: {rows.map((r) => r.name).join(", ")}.
      </CardTitle>
      <ul className="mt-4 flex flex-col gap-2 text-sm">
        <li className="flex gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>
            <span className="font-semibold">Fast models on Free.</span> Bigger, smarter ones come with Plus and Pro.
          </span>
        </li>
        <li className="flex gap-2 text-muted-foreground">
          <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Switch brains any time. Your bot keeps its name, memory and apps.</span>
        </li>
      </ul>
    </Card>
  );
}

export function Brains() {
  return (
    <Section id="brains" aria-labelledby="brains-title" className="bg-background-2">
      <Container>
        <SectionHeader id="brains-title" eyebrow="The brain" title="Bring any brain.">
          Run your bot on the AI you already pay for, your own API key, or the open models we include. It&apos;s your call, and you can switch any time.
        </SectionHeader>
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          <SubscriptionCard />
          <ApiKeyCard />
          <IncludedCard />
        </div>
      </Container>
    </Section>
  );
}
