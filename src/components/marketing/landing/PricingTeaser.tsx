import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container, Section, SectionHeader } from "../ui";
import { PayAsYouGo } from "../pricing/PayAsYouGo";

export function PricingTeaser() {
  return (
    <Section id="pricing" aria-labelledby="pricing-title" className="bg-background-2">
      <Container>
        <SectionHeader id="pricing-title" eyebrow="Pricing" title="Pay for what you use. At cost.">
          No plans and no subscription. Your bot&apos;s thinking, lookups, texts and calls cost exactly what the services charge us, with nothing
          added.
        </SectionHeader>
        <PayAsYouGo className="mt-12" />
        <div className="mt-8 text-center">
          <Link href="/pricing" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            See every price <ArrowRight className="size-4" />
          </Link>
        </div>
      </Container>
    </Section>
  );
}
