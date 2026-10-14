import type { Metadata } from "next";
import Link from "next/link";
import { Hero } from "@/components/marketing/landing/Hero";
import { HowItWorks } from "@/components/marketing/landing/HowItWorks";
import { Brains } from "@/components/marketing/landing/Brains";
import { AppWall } from "@/components/marketing/landing/AppWall";
import { TrustSection } from "@/components/marketing/landing/TrustSection";
import { InjectionSection } from "@/components/marketing/landing/InjectionSection";
import { Channels } from "@/components/marketing/landing/Channels";
import { MeetingNotes } from "@/components/marketing/landing/MeetingNotes";
import { Recipes } from "@/components/marketing/landing/Recipes";
import { Promises } from "@/components/marketing/landing/Promises";
import { PricingTeaser } from "@/components/marketing/landing/PricingTeaser";
import { FinalCta } from "@/components/marketing/landing/FinalCta";
import { Faq, faqJsonLd, type FaqItem } from "@/components/marketing/Faq";
import { Container, Section, SectionHeader } from "@/components/marketing/ui";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  description: SITE.description,
  alternates: { canonical: "/" },
};

const FAQ: { q: string; text: string }[] = [
  {
    q: "Is it really an AI?",
    text: "Yes. Every bot is an AI assistant, and it says so: when a conversation starts, every few hours after that, and in anything it sends to other people. It never pretends to be a person, even with a custom name and personality.",
  },
  {
    q: "Can I use my ChatGPT or Claude plan?",
    text: "Yes. Install the Bridge on your computer and your bot runs on your own Claude Code (Claude Pro or Max) or Codex (ChatGPT Plus or Pro), signed in by you. Your login never leaves your machine, and we never see it. It works while your computer is awake; when it sleeps, your bot waits, or uses the free brain if you opt in. Gemini works with an API key.",
  },
  {
    q: "What does Full faith mean?",
    text: "Full faith lets your bot act on its own across the apps you connect: sending, posting, updating and deleting for you, with a receipt for every action. A few hard limits still apply. It asks before sending your data to someone new right after reading outside content, before deleting more than 10 things at once, and before spending past your cap. It never shares passwords or keys and never pretends to be human. Full faith comes with Plus and Pro.",
  },
  {
    q: "Can it take notes in my meetings?",
    text: "Yes, when you say yes. The desktop app notices when a call starts in Zoom, Meet, Teams and others, and your bot asks before it listens. You can also start notes from your browser. While it listens, it stays on your screen with a red dot. The audio is turned into text and thrown away, and you get a summary, decisions and action items. Recording laws differ by place, so let everyone on the call know.",
  },
  {
    q: "What if it makes a mistake?",
    text: "Every action gets a receipt, so you can see exactly what happened and why. Text STOP from any channel to pause everything at once. Want more control? Turn the dial down: on Ask me first, nothing happens without your tap. Start low and raise it as you get comfortable.",
  },
  {
    q: "Is my data safe?",
    text: "Your API keys and app logins are encrypted at rest with AES-256-GCM and never shown again. Receipts can't be edited after the fact. We don't sell your data or use it to train AI models, and you can export everything or delete your account whenever you like.",
  },
  {
    q: "Do I need to code?",
    text: "No. The builder asks one simple question per screen, and your bot is ready in about a minute. If you do code, you can bring your own API keys and connect any MCP server.",
  },
  {
    q: "Can I export my bot?",
    text: "Yes. Download any bot as a recipe: its personality, jobs, apps, channels, trust level and routines (never your keys, memories or messages). You can also share it as a link so others can make their own copy, and export all your data as a file from your Account page.",
  },
];

const LINKS: Record<string, React.ReactNode> = {
  "Can it take notes in my meetings?": (
    <>
      {" "}
      <Link href="/safety#recording">How recording stays fair</Link>.
    </>
  ),
  "Is my data safe?": (
    <>
      {" "}
      Details are on our <Link href="/safety">safety page</Link> and in the <Link href="/legal/privacy">privacy policy</Link>.
    </>
  ),
  "What does Full faith mean?": (
    <>
      {" "}
      <Link href="/safety#hard-limits">See every hard limit</Link>.
    </>
  ),
};

export default function LandingPage() {
  const items: FaqItem[] = FAQ.map((f) => ({
    q: f.q,
    a: (
      <p>
        {f.text}
        {LINKS[f.q] ?? null}
      </p>
    ),
  }));
  return (
    <>
      <Hero />
      <HowItWorks />
      <Brains />
      <AppWall />
      <TrustSection />
      <InjectionSection />
      <Channels />
      <MeetingNotes />
      <Recipes />
      <Promises />
      <PricingTeaser />
      <Section id="faq" aria-labelledby="faq-title" className="bg-background">
        <Container className="max-w-3xl">
          <SectionHeader id="faq-title" eyebrow="FAQ" title="Questions, answered." />
          <Faq items={items} className="mt-12" />
        </Container>
      </Section>
      <FinalCta />
      <script
        type="application/ld+json"
        // Static, trusted content: our own FAQ copy.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(FAQ.map(({ q, text }) => ({ q, text })))).replace(/</g, "\\u003c") }}
      />
    </>
  );
}
