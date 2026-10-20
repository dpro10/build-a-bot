/**
 * Questions about paying, answered the same way on the pricing page and in Credit & usage.
 * Numbers come from prices.ts and the model catalog. Server-component safe.
 */
import Link from "next/link";
import { starterCreditMicros } from "@/lib/billing/credit";
import { CARD_FEE, FAIR_USE, TOP_UPS_USD, UNIT_PRICES, about, formatMicros, perMessageMicros } from "@/lib/billing/prices";
import { creditOpen } from "@/lib/env";
import { contactLink } from "@/lib/site";
import { defaultIncludedModel } from "./PriceList";

export type BillingFaq = { q: string; a: React.ReactNode };

/** `where`: "pricing" (the public page) or "app" (Credit & usage, where adding credit is right there). */
export function billingFaq(where: "pricing" | "app"): BillingFaq[] {
  const model = defaultIncludedModel();
  const starter = starterCreditMicros();
  const contact = contactLink(where === "app" ? "Credit refund" : "Billing question");
  const writeToUs = contact.isEmail ? (
    <a href={contact.href} className="font-medium text-primary hover:underline">
      email {contact.label}
    </a>
  ) : (
    "write to us"
  );
  const amounts = `$${TOP_UPS_USD.slice(0, -1).join(", $")} or $${TOP_UPS_USD[TOP_UPS_USD.length - 1]}`;

  const items: (BillingFaq | null)[] = [
    {
      q: "Why are there no plans?",
      a: "Build-a-bot is new, and we'd rather not make money on it yet. So there's no subscription and nothing is marked up: you pay exactly what the AI, search and phone services charge us for what your bots do, and we break even. If that ever changes, we'll say so first.",
    },
    {
      q: "What does a message cost?",
      a: `It depends on the model and on how much the message involves. Each answer is charged for the tokens it used: the bot's instructions, what it remembers and the conversation going in, the reply coming out. A typical message is about 5,000 tokens in and 500 out, about ${formatMicros(perMessageMicros(model))} on ${model.label}. Each web lookup it runs is ${formatMicros(UNIT_PRICES.lookup)}. Reminders and routines cost only the thinking they do, and a bot's Activity tab shows what every action cost.`,
    },
    {
      q: "What's free?",
      a: `A bot on your own AI key: your provider bills you, and we add nothing (fair use: ${FAIR_USE.ownBrainMessages.toLocaleString("en-US")} messages a month). Speech heard on your computer by the desktop app, for voice typing and meeting notes. Chatting on the web, Telegram, Discord and Slack, and connecting apps. You pay only for what costs us money: thinking on the models we run, lookups, texts and calls.`,
    },
    where === "pricing"
      ? {
          q: "Is there a free trial?",
          a:
            starter > 0
              ? `Better: every account starts with ${formatMicros(starter)} of credit, no card needed, and it doesn't run out on a date. That's about ${about(starter / Math.max(1, perMessageMicros(model)))} messages on ${model.label}.`
              : "There's nothing to trial: making a bot is free, and a bot on your own AI key is free to run here.",
        }
      : null,
    {
      q: "What happens when I run out?",
      a: "Nothing is charged on its own: there's no card on file and no overage. Bots on the models we run tell you they're out of credit and wait, and people who message them hear \"try again later\". Add credit, or switch a bot to your own AI in its Settings → Brain, and it picks up again. A balance can dip a fraction of a cent below zero, because a message's cost is known only once it's answered; the next credit you add covers it.",
    },
    {
      q: "How do I add credit?",
      a: creditOpen ? (
        <>
          {where === "app" ? "Right above: " : <>From <Link href="/app/billing">Credit &amp; usage</Link> in the app: </>}
          {amounts} at a time, by card through Stripe. Stripe charges {CARD_FEE.percent}% + {CARD_FEE.fixedCents}¢ a payment, and we add that on top instead of taking it out
          of your credit, so $10 of credit is $10 to use. Adding more at once makes the fee a smaller share.
        </>
      ) : (
        "Adding credit is coming soon. Until then there's the starter credit, and a bot on your own AI key is free here."
      ),
    },
    {
      q: "Does credit expire? Can I get it back?",
      a: (
        <>
          Credit never expires. If you&apos;d like credit you added and haven&apos;t used refunded, {writeToUs} and we&apos;ll send it back to your card
          (Stripe keeps its card fee). Starter credit can&apos;t be cashed out.
        </>
      ),
    },
    where === "pricing"
      ? {
          q: "What currency are prices in?",
          a: "US dollars. Model prices follow Nebius Token Factory's, and the others follow Tavily's, Twilio's and Browser Use's: if theirs change, ours do too, and this page shows the new ones.",
        }
      : null,
  ];
  return items.filter((x): x is BillingFaq => x !== null);
}
