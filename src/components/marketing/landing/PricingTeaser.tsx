import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container, Section, SectionHeader } from "../ui";
import { PlanCards } from "../pricing/PlanCards";
import { getViewer } from "../viewer";

export async function PricingTeaser() {
  const viewer = await getViewer();
  return (
    <Section id="pricing" aria-labelledby="pricing-title" className="bg-background-2">
      <Container>
        <SectionHeader id="pricing-title" eyebrow="Pricing" title="Free to start. Upgrade when your bot gets busy.">
          Messages on your own key or subscription don&apos;t use your included ones. No surprise bills: limits pause, they never charge extra.
        </SectionHeader>
        <div className="mt-12">
          <PlanCards teaser signedIn={Boolean(viewer)} currentPlan={viewer?.plan} />
        </div>
        <div className="mt-8 text-center">
          <Link href="/pricing" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            Compare every feature <ArrowRight className="size-4" />
          </Link>
        </div>
      </Container>
    </Section>
  );
}
