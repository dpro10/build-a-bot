import { ArrowRight, Lock, ShieldCheck } from "lucide-react";
import { BrandTile, type IconSpec } from "@/components/brand/icons";
import { INCLUDED_MODELS, OPENAI_MARK, PROVIDERS } from "@/lib/models/catalog";
import { starterCreditMicros } from "@/lib/billing/credit";
import { formatMicros, perMessageMicros } from "@/lib/billing/prices";
import { cn } from "@/lib/utils";
import { Container, Section, SectionHeader } from "../ui";
import { brandOrLetter } from "../icons";

type Family = { name: string; match: RegExp; icon: IconSpec };

/** Model families on Nebius Token Factory, in the order people tend to know them. */
const FAMILIES: Family[] = [
  { name: "Nemotron", match: /nemotron/i, icon: brandOrLetter("nvidia", "N", "76B900") },
  { name: "gpt-oss", match: /gpt-oss/i, icon: OPENAI_MARK },
  { name: "DeepSeek", match: /deepseek/i, icon: brandOrLetter("deepseek", "DS", "4D6BFE") },
  { name: "Qwen", match: /qwen/i, icon: brandOrLetter("qwen", "Q", "615CED") },
  { name: "GLM", match: /glm/i, icon: { letter: "Z", color: "3A3A4A" } },
  { name: "Kimi", match: /kimi/i, icon: { letter: "K", color: "1F2937" } },
  { name: "MiniMax", match: /minimax/i, icon: { letter: "M", color: "E73562" } },
  { name: "Hermes", match: /hermes/i, icon: { letter: "H", color: "6D28D9" } },
];

/** Each family, with what a typical message costs on its cheapest model (at cost). */
function familyRows() {
  return FAMILIES.map((f) => {
    const models = INCLUDED_MODELS.filter((m) => f.match.test(m.label) || f.match.test(m.id));
    const from = Math.min(...models.map(perMessageMicros));
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

function ApiKeyCard() {
  return (
    <Card>
      <div aria-hidden="true" className="rounded-2xl border border-border/70 bg-background-2 p-4">
        <div className="grid grid-cols-6 gap-2">
          {PROVIDERS.map((p) => (
            <span key={p.id} title={p.name} className="flex justify-center">
              <BrandTile icon={p.icon.lucide ? p.icon : brandOrLetter(p.icon.simpleIcon, p.icon.letter ?? p.name.charAt(0), p.icon.color)} size={34} />
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
          <span>Free here: you pay the provider directly, and what your bot reads and writes follows their rules for keeping data.</span>
        </li>
      </ul>
    </Card>
  );
}

function IncludedCard() {
  const rows = familyRows();
  const dflt = INCLUDED_MODELS.find((m) => m.default) ?? INCLUDED_MODELS[0];
  const starter = starterCreditMicros();
  return (
    <Card highlight>
      <div aria-hidden="true" className="flex flex-wrap gap-1.5 rounded-2xl border border-border/70 bg-background-2 p-4">
        {rows.map((f) => (
          <span key={f.name} className="inline-flex items-center gap-1.5 rounded-full bg-card py-1 pr-2.5 pl-1 text-[13px] font-semibold shadow-soft ring-1 ring-border">
            <BrandTile icon={f.icon} size={20} />
            {f.name}
            <span className="font-medium text-muted-foreground tabular-nums">{formatMicros(f.from)}</span>
          </span>
        ))}
      </div>
      <CardTitle
        kicker="Option 1"
        title="Included open models"
        badge={<span className="rounded-full bg-success px-2.5 py-1 text-xs font-bold text-success-foreground shadow-soft">At cost</span>}
      >
        No key, no problem. Use open models served by Nebius Token Factory: {rows.map((r) => r.name).join(", ")}. You pay Token Factory&apos;s
        price per message, with nothing added.
      </CardTitle>
      <ul className="mt-4 flex flex-col gap-2 text-sm">
        <li className="flex gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>
            <span className="font-semibold">About {formatMicros(perMessageMicros(dflt))} a message</span> on {dflt.label}.
            {starter > 0 ? ` Every account starts with ${formatMicros(starter)} of credit.` : ""}
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
          Run your bot on the open models we include, or on your own API key from the AI company you like. It&apos;s your call, and you can switch any
          time.
        </SectionHeader>
        <div className="mx-auto mt-14 grid max-w-5xl gap-5 lg:grid-cols-2">
          <IncludedCard />
          <ApiKeyCard />
        </div>
      </Container>
    </Section>
  );
}
