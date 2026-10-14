import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { PlanCards } from "@/components/marketing/pricing/PlanCards";
import { CompareTable } from "@/components/marketing/pricing/CompareTable";
import { Faq, type FaqItem } from "@/components/marketing/Faq";
import { FinalCta } from "@/components/marketing/landing/FinalCta";
import { Container, Section, SectionHeader } from "@/components/marketing/ui";
import { getViewer } from "@/components/marketing/viewer";
import { PLANS } from "@/lib/billing/plans";
import { contactLink, pageMetadata } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Pricing",
  description: `Start free. Plus is $${PLANS.plus.priceMonthly}/month and Pro is $${PLANS.pro.priceMonthly}/month, with calls, texts, Full faith mode and smarter included models. Your own key or subscription never uses your included messages.`,
  path: "/pricing",
});

export default async function PricingPage() {
  const viewer = await getViewer();
  const contact = contactLink("Billing question");

  const faq: FaqItem[] = [
    {
      q: "What counts as a message?",
      a: (
        <p>
          One message is one thing you (or someone you&apos;ve approved) send your bot that it answers, on any channel. Routines, morning briefs, its
          greeting and follow-ups after you approve something don&apos;t count.
        </p>
      ),
    },
    {
      q: "Do messages on my own key or subscription count?",
      a: (
        <p>
          Not against your included messages. When your bot runs on your own API key or your Claude or ChatGPT plan, those messages have their own,
          much larger fair-use allowance ({PLANS.free.limits.byoMessages.toLocaleString("en-US")} a month on Free). Your AI provider bills you
          directly for API usage; we don&apos;t mark it up.
        </p>
      ),
    },
    {
      q: "What happens if I hit a limit?",
      a: (
        <p>
          No overage charges, ever. Your bot tells you it&apos;s reached the month&apos;s limit and pauses that one thing until your next month starts.
          You can upgrade any time, or switch it to your own key or subscription to keep going.
        </p>
      ),
    },
    {
      q: "Can I cancel any time?",
      a: (
        <p>
          Yes, from Plan &amp; usage in the app, in a couple of taps. Your plan stays active until the end of the period you paid for, then your
          account moves to Free. Your bots and their history stay put.
        </p>
      ),
    },
    {
      q: "Is there a free trial?",
      a: <p>Free is free for as long as you like, with no card needed. Upgrade when your bot needs more messages, calls, texts or Full faith.</p>,
    },
    {
      q: "What currency are prices in?",
      a: <p>All prices are in US dollars. Taxes may be added where they apply.</p>,
    },
    {
      q: "Who do I talk to about billing?",
      a: contact.isEmail ? (
        <p>
          Email us at <a href={contact.href}>{contact.label}</a> and a person will get back to you.
        </p>
      ) : (
        <p>
          Reach us from <Link href={contact.href}>{contact.label}</Link> in the app, where you can also manage your plan.
        </p>
      ),
    },
  ];

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="aurora" aria-hidden="true" />
        <Container className="relative pt-16 pb-6 text-center sm:pt-20">
          <h1 className="mx-auto max-w-3xl font-display text-[2.6rem] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance sm:text-6xl">
            Simple plans. <span className="mk-gradient-text">Bring your own brain for free.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
            Start free and upgrade when your bot gets busy. Messages on your own API key or Claude or ChatGPT plan never use your included ones.
          </p>
          <ul className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {["No card to start", "Cancel any time", "No overage charges"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-success" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <Section aria-labelledby="plans-title" className="pt-8 sm:pt-10">
        <Container>
          <h2 id="plans-title" className="sr-only">
            Plans
          </h2>
          <PlanCards signedIn={Boolean(viewer)} currentPlan={viewer?.plan} />
          {viewer ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              You&apos;re signed in.{" "}
              <Link href="/app/billing" className="font-semibold text-primary hover:underline">
                Manage your plan and usage
              </Link>
              .
            </p>
          ) : null}
        </Container>
      </Section>

      <Section id="compare" aria-labelledby="compare-title" className="bg-background-2">
        <Container className="max-w-5xl">
          <SectionHeader id="compare-title" eyebrow="Compare" title="Every feature, side by side." />
          <div className="mt-12">
            <CompareTable />
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Calls and texts use US &amp; Canada numbers to start. WhatsApp and iMessage are on the waitlist.
          </p>
        </Container>
      </Section>

      <Section id="pricing-faq" aria-labelledby="pricing-faq-title">
        <Container className="max-w-3xl">
          <SectionHeader id="pricing-faq-title" eyebrow="FAQ" title="Pricing questions." />
          <Faq items={faq} className="mt-12" />
          <div className="mt-8 text-center">
            <Link href="/safety" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              How we keep your bot safe <ArrowRight className="size-4" />
            </Link>
          </div>
        </Container>
      </Section>

      <FinalCta />
    </>
  );
}
