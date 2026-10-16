/**
 * How paying works, in three cards: starter credit, at cost, free with your own AI. On the home
 * page's pricing section and at the top of the pricing page. Numbers come from prices.ts and the
 * model catalog. Server-component safe.
 */
import { Gift, KeyRound, Scale } from "lucide-react";
import { starterCreditMicros } from "@/lib/billing/credit";
import { creditOpen } from "@/lib/env";
import { FAIR_USE, TOP_UPS_USD, UNIT_PRICES, about, formatCents, formatMicros, perMessageMicros, topUpChargeCents } from "@/lib/billing/prices";
import { cn } from "@/lib/utils";
import { defaultIncludedModel } from "@/components/billing/PriceList";

export function PayAsYouGo({ className }: { className?: string }) {
  const model = defaultIncludedModel();
  const perMessage = perMessageMicros(model);
  const starter = starterCreditMicros();
  const cards = [
    starter > 0
      ? {
          icon: <Gift />,
          title: `${formatMicros(starter)} to start`,
          body: `Every account starts with ${formatMicros(starter)} of credit, no card needed. That's about ${about(starter / Math.max(1, perMessage))} messages on ${model.label}.`,
        }
      : {
          icon: <Gift />,
          title: "No card to start",
          body: "Make your bot and talk to it on your own AI for free. Add credit when you want the models we run.",
        },
    {
      icon: <Scale />,
      title: "At cost, nothing added",
      body: `A message on ${model.label} is about ${formatMicros(perMessage)}, and a web lookup ${formatMicros(UNIT_PRICES.lookup)}: exactly what the services charge us. No plans, no subscription.`,
    },
    {
      icon: <KeyRound />,
      title: "Free with your own AI",
      body: `Run your bot on your own API key, or on the Claude or ChatGPT plan you already pay for, and its thinking is free here (fair use: ${FAIR_USE.ownBrainMessages.toLocaleString("en-US")} messages a month).`,
    },
  ];
  const amounts = TOP_UPS_USD.map((usd) => `$${usd}`);
  const example = TOP_UPS_USD[1] ?? TOP_UPS_USD[0];
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <ul className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <li key={c.title} className="flex flex-col rounded-3xl border border-border bg-card p-6 shadow-soft">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-5" aria-hidden="true">
              {c.icon}
            </span>
            <h3 className="mt-4 font-display text-xl font-bold tracking-tight">{c.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{c.body}</p>
          </li>
        ))}
      </ul>
      <p className="mx-auto max-w-3xl text-center text-sm text-balance text-muted-foreground">
        {creditOpen ? (
          <>
            When you need more, add {amounts.slice(0, -1).join(", ")} or {amounts[amounts.length - 1]}. Stripe&apos;s card fee goes on top (${example}{" "}
            of credit is {formatCents(topUpChargeCents(example))} on your card), so every dollar of credit is yours to use. Credit never expires.
          </>
        ) : (
          "Adding credit is coming soon. Until then there's the starter credit, and a bot on your own AI is free."
        )}
      </p>
    </div>
  );
}
