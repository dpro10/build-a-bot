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
import { VoiceTyping } from "@/components/marketing/landing/VoiceTyping";
import { Recipes } from "@/components/marketing/landing/Recipes";
import { Promises } from "@/components/marketing/landing/Promises";
import { PricingTeaser } from "@/components/marketing/landing/PricingTeaser";
import { FinalCta } from "@/components/marketing/landing/FinalCta";
import { Faq, faqJsonLd, type FaqItem } from "@/components/marketing/Faq";
import { Container, Section, SectionHeader } from "@/components/marketing/ui";
import { starterCreditMicros } from "@/lib/billing/credit";
import { UNIT_PRICES, formatMicros, perMessageMicros } from "@/lib/billing/prices";
import { INCLUDED_MODELS } from "@/lib/models/catalog";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  description: SITE.description,
  alternates: { canonical: "/" },
};

/** The desktop app can be had (signed downloads, or the repo in demo mode); otherwise it's coming soon. */
const DEFAULT_MODEL = INCLUDED_MODELS.find((m) => m.default) ?? INCLUDED_MODELS[0];
const STARTER = starterCreditMicros();

const FAQ: { q: string; text: string }[] = [
  {
    q: "Is it really an AI?",
    text: "Yes. Every bot is an AI assistant, and it says so: when a conversation starts, every few hours after that, and in anything it sends to other people. It never pretends to be a person, even with a custom name and personality.",
  },
  {
    q: "Can I use my ChatGPT or Claude plan?",
    text: "Not the chat plans: they only run on your own computer, so your bot couldn't think while it's off. Use an API key instead, from Anthropic, OpenAI, Google Gemini, OpenRouter and others. Your provider bills you, it's free here, and what your bot reads and writes follows that provider's rules for keeping data.",
  },
  {
    q: "What does it cost?",
    text: `There are no plans and no subscription: you pay for what your bots use, at cost, from credit you add. A message on ${DEFAULT_MODEL.label} is about ${formatMicros(perMessageMicros(DEFAULT_MODEL))} and a web lookup ${formatMicros(UNIT_PRICES.lookup)}, exactly what the services charge us.${STARTER > 0 ? ` Every account starts with ${formatMicros(STARTER)} of credit, no card needed.` : ""} A bot on your own API key is free here.`,
  },
  {
    q: "What does Full faith mean?",
    text: `Full faith lets your bot act on its own across the apps you connect: sending, posting, updating and deleting for you, with a receipt for every action. A few hard limits still apply. It asks before sending your data to someone new right after reading outside content, before deleting more than 10 things at once, and before spending past your cap. It never shares passwords or keys and never pretends to be human.`,
  },
  {
    q: "Can it take notes in my meetings?",
    text: `Yes, when you say yes, with the desktop app. It notices when a call starts in Zoom, Meet, Teams and others, and your bot asks before it listens; for a meeting in the room, start it from the app's menu. While it listens, it stays on your screen with a red dot. NVIDIA Parakeet turns the call into text on your computer, so the audio never leaves it, and you get a summary, decisions and action items. The website never listens. Recording laws differ by place, so let everyone on the call know.`,
  },
  {
    q: "What is voice typing?",
    text: "Hold a key in any app and talk. What you meant is typed where your cursor is: no ums, the right punctuation, your corrections kept, and the names your bot knows spelled right. Start with “Hey” and your bot's name to ask it instead. The desktop app hears you on your own computer, with NVIDIA's Parakeet speech model, so in English and 24 European languages your voice never leaves it; we keep a word count, never your words. There's no word limit: hearing you is free, and the AI cleanup costs a fraction of a cent.",
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
  "What does it cost?": (
    <>
      {" "}
      <Link href="/pricing">See every price</Link>.
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
      <VoiceTyping />
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
