import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { PayAsYouGo } from "@/components/marketing/pricing/PayAsYouGo";
import { PriceList, defaultIncludedModel } from "@/components/billing/PriceList";
import { billingFaq } from "@/components/billing/faq";
import { Faq, type FaqItem } from "@/components/marketing/Faq";
import { FinalCta } from "@/components/marketing/landing/FinalCta";
import { Container, Section, SectionHeader } from "@/components/marketing/ui";
import { getViewer } from "@/components/marketing/viewer";
import { starterCreditMicros } from "@/lib/billing/credit";
import { UNIT_PRICES, formatMicros, perMessageMicros } from "@/lib/billing/prices";
import { contactLink, pageMetadata } from "@/lib/site";

const model = defaultIncludedModel();
const starter = starterCreditMicros();

export const metadata = pageMetadata({
  title: "Pricing",
  description: `No plans: pay for what your bot uses, at cost. About ${formatMicros(perMessageMicros(model))} a message on ${model.label} and ${formatMicros(UNIT_PRICES.lookup)} a web lookup, and free on your own AI key.${starter > 0 ? ` Every account starts with ${formatMicros(starter)} of credit.` : ""}`,
  path: "/pricing",
});

export default async function PricingPage() {
  const viewer = await getViewer();
  const contact = contactLink("Billing question");

  const faq: FaqItem[] = [
    ...billingFaq("pricing").map((f) => ({ q: f.q, a: <p>{f.a}</p> })),
    {
      q: "Who do I talk to about billing?",
      a: contact.isEmail ? (
        <p>
          Email us at <a href={contact.href}>{contact.label}</a> and a person will get back to you.
        </p>
      ) : (
        <p>
          Reach us from <Link href={contact.href}>{contact.label}</Link> in the app, where you can also see your credit and what you&apos;ve used.
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
            Pay for what you use. <span className="mk-gradient-text">At cost.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
            No plans and no subscription. Your bot&apos;s thinking, web lookups, texts and calls cost exactly what the services charge us, with nothing
            added. On your own AI, it&apos;s free here.
          </p>
          <ul className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {["No card to start", "Nothing added to any price", "Credit never expires"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-success" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <Section aria-labelledby="how-title" className="pt-8 sm:pt-10">
        <Container>
          <h2 id="how-title" className="sr-only">
            How paying works
          </h2>
          <PayAsYouGo />
          <p className="mt-8 text-center text-sm text-muted-foreground">
            {viewer ? (
              <>
                You&apos;re signed in.{" "}
                <Link href="/app/billing" className="font-semibold text-primary hover:underline">
                  See your credit and usage
                </Link>
                .
              </>
            ) : (
              <Link href="/build" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                Build your bot <ArrowRight className="size-4" />
              </Link>
            )}
          </p>
        </Container>
      </Section>

      <Section id="prices" aria-labelledby="prices-title" className="bg-background-2">
        <Container className="max-w-4xl">
          <SectionHeader id="prices-title" eyebrow="Every price" title="What things cost.">
            Each price is what the service charges us, and the same numbers run the meter, so this page can&apos;t drift from your bill.
          </SectionHeader>
          <PriceList full className="mt-12" />
          <p className="mt-4 text-center text-xs text-muted-foreground">Prices in US dollars. Texts and calls use US and Canada numbers to start.</p>
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
