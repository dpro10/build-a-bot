/**
 * What everything costs, at cost: the pricing page shows all of it, Credit & usage a shorter list.
 * Prices come from prices.ts and the model catalog, so the page and the meter can't disagree.
 * Server-component safe.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { callsOnVoiceServer } from "@/lib/billing/call-rate";
import { available, demoMode, live } from "@/lib/env";
import { INCLUDED_MODELS } from "@/lib/models/catalog";
import {
  FAIR_USE,
  TYPICAL_CLEANUP,
  TYPICAL_MEETING_HOUR,
  UNIT_PRICES,
  formatMicros,
  perMessageMicros,
  perMillionLabel,
  tokensMicros,
} from "@/lib/billing/prices";
import { audioStaysOnComputer } from "@/lib/transcribe";
import { cn } from "@/lib/utils";

type Row = { label: React.ReactNode; hint?: React.ReactNode; price: React.ReactNode; per?: string; soon?: boolean };
type Group = { id: string; title: string; note?: React.ReactNode; rows: Row[] };

const TIER_NAME = { fast: "Fast", balanced: "Balanced", smart: "Smart" } as const;
const fmt = (n: number) => n.toLocaleString("en-US");

/** The model a new bot starts on, for the examples. */
export function defaultIncludedModel() {
  return INCLUDED_MODELS.find((m) => m.default) ?? INCLUDED_MODELS[0];
}

function groups(full: boolean): Group[] {
  const dflt = defaultIncludedModel();
  // The short list: the default, then the cheapest of each other tier.
  const models = full
    ? INCLUDED_MODELS
    : [dflt, ...(["balanced", "smart"] as const).map((t) => INCLUDED_MODELS.filter((m) => m.tier === t).sort((a, b) => perMessageMicros(a) - perMessageMicros(b))[0])].filter(
        (m, i, all) => m && all.indexOf(m) === i,
      );
  const phone = available("twilio");
  const texts = available("twilioTexting");
  const voiceServer = callsOnVoiceServer();
  const audioStays = audioStaysOnComputer();
  const freeHere: Row[] = [
    {
      label: "Your own AI key",
      hint: `Anthropic, OpenAI, Google and more. Your provider bills you, and we add nothing. Fair use: ${fmt(FAIR_USE.ownBrainMessages)} messages a month.`,
      price: "Free",
    },
    {
      label: "Speech heard on your computer",
      hint: `Voice typing and meeting notes in the desktop app: NVIDIA Parakeet hears you on your computer${audioStays ? ", so the audio never leaves it" : ""}.`,
      price: "Free",
    },
    { label: "Web chat, Discord and Slack", hint: "Talking to your bot there costs only the thinking.", price: "Free" },
    { label: "Apps, reminders and routines", hint: "Connecting apps is free. A reminder or routine costs only the thinking it does.", price: "Free" },
  ];
  return [
    {
      id: "thinking",
      title: "Thinking, on the open models we run",
      note: (
        <>
          Served by Nebius Token Factory and charged per token at its price. A typical message is about 5,000 tokens in (the bot&apos;s instructions,
          what it remembers, the conversation) and 500 out; each one is charged for what it actually used.
        </>
      ),
      rows: models.map((m) => ({
        label: (
          <>
            {m.label}{" "}
            {m.default ? <span className="rounded-full bg-primary-soft px-1.5 py-px align-middle text-[11px] font-bold text-primary">Default</span> : null}
          </>
        ),
        hint: `${m.maker ? `${m.maker} · ` : ""}${TIER_NAME[m.tier]} · ${perMillionLabel(m)} per million tokens in / out`,
        price: `≈ ${formatMicros(perMessageMicros(m))}`,
        per: "a message",
      })),
    },
    {
      id: "doing",
      title: "Looking things up and getting things done",
      rows: [
        {
          label: "A web search, the news, or reading a page",
          hint: "Tavily's price for each lookup.",
          price: formatMicros(UNIT_PRICES.lookup),
          per: "each",
          soon: !available("webSearch"),
        },
        {
          label: "A task in the cloud browser",
          hint: `Filling a form or reading a page that needs a real browser. Browser Use charges ${formatMicros(UNIT_PRICES.webTask)} to start and about ${formatMicros(UNIT_PRICES.webStep)} a step; you pay what it reports.`,
          price: `from ${formatMicros(UNIT_PRICES.webTask)}`,
          per: "a task",
          soon: !available("browser"),
        },
        {
          label: "An hour of meeting notes",
          hint: `Hearing the call on your computer is free. Writing the notes is one long message on the bot's brain (priced here on ${dflt.label}).`,
          price: `≈ ${formatMicros(tokensMicros(dflt, TYPICAL_MEETING_HOUR))}`,
          per: "an hour",
        },
        {
          label: "Voice typing's AI cleanup",
          hint: "Fixes punctuation and the ums when what you said needs it. Without credit you still get the plain cleanup.",
          price: `≈ ${formatMicros(tokensMicros(dflt, TYPICAL_CLEANUP))}`,
          per: "each time",
        },
      ],
    },
    {
      id: "phone",
      title: "Texts and calls",
      note: phone
        ? "Twilio's US prices, with carrier fees. Each minute a call has started counts, and what your bot thinks on a call is charged like any message. A text is counted in segments of about 160 characters (70 with emoji)."
        : "Coming soon. These are the prices they'll have.",
      rows: [
        { label: "A text someone sends your bot", price: formatMicros(UNIT_PRICES.textIn), per: "a segment", soon: !texts },
        { label: "A text your bot sends", price: formatMicros(UNIT_PRICES.textOut), per: "a segment", soon: !texts },
        {
          label: "A call to your bot",
          hint: voiceServer
            ? `Our voice server hears and speaks with NVIDIA's open speech models, so it's just the line. When it can't take a call, Twilio's own speech does, at ${formatMicros(UNIT_PRICES.callMinute)} a minute.`
            : "The line, plus Twilio hearing what's said and speaking the replies.",
          price: formatMicros(voiceServer ? UNIT_PRICES.callMinuteStreamIn : UNIT_PRICES.callMinute),
          per: "a minute",
          soon: !phone,
        },
        { label: "A call your bot makes to you", hint: "To read you a reminder, or when you ask it to call.", price: formatMicros(UNIT_PRICES.callMinuteOut), per: "a minute", soon: !phone },
      ],
    },
    { id: "free", title: "Free here", rows: freeHere },
  ];
}

/**
 * The price list. `full`: every included model and every note (the pricing page); otherwise three
 * models and a link to the rest (Credit & usage).
 */
export function PriceList({ full = false, className }: { full?: boolean; className?: string }) {
  const all = groups(full);
  return (
    <div className={cn("overflow-hidden rounded-3xl border border-border bg-card shadow-soft", className)}>
      {all.map((g, gi) => (
        <section key={g.id} aria-labelledby={`prices-${g.id}`} className={cn(gi > 0 && "border-t border-border")}>
          <div className="bg-background-2/50 px-4 pt-5 pb-3 sm:px-6">
            <h3 id={`prices-${g.id}`} className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
              {g.title}
            </h3>
            {g.note && (full || g.id === "phone") ? <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{g.note}</p> : null}
          </div>
          <ul>
            {g.rows.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-4 border-t border-border/70 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <div className="text-sm leading-snug font-medium">
                    {r.label}{" "}
                    {r.soon ? <span className="rounded-full bg-muted px-1.5 py-px align-middle text-[11px] font-semibold text-muted-foreground">Coming soon</span> : null}
                  </div>
                  {r.hint ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{r.hint}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <div className={cn("font-display text-base font-bold tabular-nums", r.price === "Free" ? "text-success" : r.soon ? "text-muted-foreground" : "text-foreground")}>
                    {r.price}
                  </div>
                  {r.per ? <div className="text-[11px] text-muted-foreground">{r.per}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!full ? (
        <div className="border-t border-border px-4 py-3.5 sm:px-6">
          <Link href="/pricing" className="group inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            Every model and price <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      ) : null}
      {demoMode && !live.includedBrain ? (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6">Demo mode: answers are simulated here, and nothing is charged.</p>
      ) : null}
    </div>
  );
}
