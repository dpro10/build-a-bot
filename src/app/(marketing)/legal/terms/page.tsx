import Link from "next/link";
import { DocLayout, DocSection, type TocEntry } from "@/components/marketing/DocLayout";
import { LegalHeader } from "@/components/marketing/LegalHeader";
import { PLANS } from "@/lib/billing/plans";
import { contactLink, pageMetadata } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Terms of Service",
  description: "The rules for using Build-a-bot: who can use it, what your bot may do, your responsibilities, third-party services, billing and more.",
  path: "/legal/terms",
});

const SECTIONS: TocEntry[] = [
  { id: "agreement", title: "The agreement" },
  { id: "eligibility", title: "Who can use it" },
  { id: "account", title: "Your account" },
  { id: "ai", title: "Bots are AI assistants" },
  { id: "responsibility", title: "You're responsible for your bot" },
  { id: "acceptable-use", title: "Acceptable use" },
  { id: "other-people", title: "Messaging other people" },
  { id: "third-parties", title: "Third-party services" },
  { id: "bridge", title: "Subscriptions and the Bridge" },
  { id: "content", title: "Your content" },
  { id: "billing", title: "Plans, billing and cancellation" },
  { id: "termination", title: "Suspension and termination" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Limits of liability" },
  { id: "changes", title: "Changes to these terms" },
  { id: "contact", title: "Contact" },
];

const n = (id: string) => SECTIONS.findIndex((s) => s.id === id) + 1;
const title = (id: string) => `${n(id)}. ${SECTIONS[n(id) - 1].title}`;

export default function TermsPage() {
  const contact = contactLink("Question about the terms");
  return (
    <>
      <LegalHeader
        title="Terms of Service"
        summary="The short version: be 18 or older, use your bot for things you'd be comfortable doing yourself, don't use it to spam, deceive or hurt anyone, and remember that you choose how much it can do on its own."
        other={{ href: "/legal/privacy", label: "Privacy policy" }}
      />
      <DocLayout toc={SECTIONS}>
        <DocSection id="agreement" title={title("agreement")}>
          <p>
            These terms are an agreement between you and Build-a-bot (&ldquo;we&rdquo;, &ldquo;us&rdquo;) about using our website, apps and
            services, including the bots you make, the Bridge app and recipes (together, &ldquo;Build-a-bot&rdquo;). By making a bot or an
            account, you agree to these terms and to our <Link href="/legal/privacy">privacy policy</Link>. If you don&apos;t agree, please
            don&apos;t use Build-a-bot.
          </p>
        </DocSection>

        <DocSection id="eligibility" title={title("eligibility")}>
          <p>
            You must be at least 18 years old to use Build-a-bot, and you confirm that you are when you make your first bot. Build-a-bot isn&apos;t
            designed for children. If we learn an account belongs to someone under 18, we&apos;ll close it.
          </p>
        </DocSection>

        <DocSection id="account" title={title("account")}>
          <ul>
            <li>You can start without an email address. Add one to keep your bots safe and sign in on other devices.</li>
            <li>Keep your sign-in links, devices and connected accounts secure. You&apos;re responsible for what happens under your account.</li>
            <li>Tell us right away if you think someone else has access to your account.</li>
          </ul>
        </DocSection>

        <DocSection id="ai" title={title("ai")}>
          <p>
            Every bot is an artificial-intelligence assistant, not a person. It tells the people it talks to that it&apos;s an AI, and you agree
            not to change, hide or work around that, including through custom names, personalities or instructions.
          </p>
          <p>
            AI makes mistakes. Your bot can misunderstand, leave things out or state things that aren&apos;t true. Check anything important, and
            don&apos;t rely on your bot for medical, legal, financial or emergency decisions. It isn&apos;t a professional or an emergency service.
          </p>
        </DocSection>

        <DocSection id="responsibility" title={title("responsibility")}>
          <p>
            You decide what your bot can reach (its apps and channels) and how much it can do on its own (its trust level, per-app rules, spending
            cap and quiet hours). <strong>You&apos;re responsible for what your bot does under the settings you choose</strong>, just as if you
            had done it yourself through those apps.
          </p>
          <ul>
            <li>
              On <strong>Look only</strong> and <strong>Ask me first</strong>, your bot doesn&apos;t act without your tap. When you approve an
              action, you&apos;re approving it as your own.
            </li>
            <li>
              On <strong>Trusted helper</strong> and <strong>Full faith</strong>, your bot acts on its own within the limits described on our{" "}
              <Link href="/safety">safety page</Link>. Choose these levels only for apps and tasks you&apos;re comfortable delegating.
            </li>
            <li>Every action gets a receipt. Review them, and use STOP if anything looks wrong.</li>
          </ul>
          <p>
            Our safety limits are designed to reduce risk, not to remove it. They don&apos;t move responsibility for your bot&apos;s actions to us.
          </p>
        </DocSection>

        <DocSection id="acceptable-use" title={title("acceptable-use")}>
          <p>You agree not to use Build-a-bot, or let your bot be used, to:</p>
          <ul>
            <li>send spam, unsolicited bulk messages, robocalls or marketing to people who haven&apos;t agreed to receive it;</li>
            <li>impersonate anyone, or make people believe they&apos;re dealing with a human when they&apos;re dealing with your bot;</li>
            <li>harass, threaten, stalk, bully or abuse anyone, or promote violence or hate;</li>
            <li>do anything illegal, or help anyone else do so, including fraud, scams and phishing;</li>
            <li>collect other people&apos;s personal data without a legal right to, or watch people without their knowledge;</li>
            <li>create sexual content involving minors, or contact or target minors in any way;</li>
            <li>break, probe or get around our security, safety limits, rate limits or usage limits, or another service&apos;s;</li>
            <li>resell, sublicense or share access to Build-a-bot, or run it for others as a service, without our written permission;</li>
            <li>break the terms or policies of a service your bot connects to.</li>
          </ul>
          <p>We may block actions, pause bots or remove recipes that we reasonably believe break these rules.</p>
        </DocSection>

        <DocSection id="other-people" title={title("other-people")}>
          <p>
            When your bot calls, texts, emails or messages anyone other than you, it&apos;s doing so for you. Only have it contact people who would
            expect to hear from you, follow the laws on calls, texts and email where you and they are, and respect requests to stop. If someone
            replies STOP to a text, your bot stops messaging them.
          </p>
          <p>
            <strong>Meeting notes.</strong> Your bot only takes notes in a meeting after you say yes, and it stays on your screen while it listens.
            Recording laws differ by place, and some require everyone&apos;s permission, so you&apos;re responsible for letting people know and
            getting their consent where the law requires it. Your bot offers a heads-up you can paste into the call&apos;s chat. If someone objects,
            stop the notes; &ldquo;Stop and delete&rdquo; throws away everything from that call.
          </p>
        </DocSection>

        <DocSection id="third-parties" title={title("third-parties")}>
          <p>
            Build-a-bot works with services run by other companies, and their own terms and privacy policies apply to how you use them. Depending on
            what you turn on, these include:
          </p>
          <ul>
            <li>
              <strong>AI model providers</strong>: Nebius Token Factory for the included open models, and the provider of any API key you add
              (for example Anthropic, OpenAI, Google, OpenRouter, Groq, Mistral, xAI, DeepSeek, Together, Fireworks or Cerebras);
            </li>
            <li>
              <strong>Channels</strong>: Twilio for phone calls and texts, Telegram, Discord, Slack, and our email providers for your bot&apos;s
              inbox;
            </li>
            <li>
              <strong>Apps</strong>: the apps you connect, either directly or through Composio, which handles sign-in and actions for many of them;
            </li>
            <li>
              <strong>Other building blocks</strong>: web search, speech-to-text for meeting notes and voice typing (NVIDIA's open speech models: on your own computer in the desktop app, or on our own server at Nebius with Together AI as a backup), payments
              (Stripe) and hosting.
            </li>
          </ul>
          <p>
            We don&apos;t control those services and aren&apos;t responsible for them. If one changes, limits or stops its service, parts of
            Build-a-bot may change or stop working too. Usage you pay a provider for directly, such as your own API key, is between you and that
            provider.
          </p>
        </DocSection>

        <DocSection id="bridge" title={title("bridge")}>
          <p>
            If you run your bot on your own Claude or ChatGPT subscription, it happens <strong>on your own computer</strong>, through the Bridge app,
            using your own copy of Claude Code or Codex that you signed in to yourself. Your subscription stays under your agreement with Anthropic
            or OpenAI, and you&apos;re responsible for following their terms. We never collect, store or relay your subscription login, and we
            don&apos;t run your subscription on our servers.
          </p>
        </DocSection>

        <DocSection id="content" title={title("content")}>
          <ul>
            <li>
              <strong>What&apos;s yours stays yours.</strong> You own what you put into Build-a-bot (your instructions, messages and files) and
              what your bot produces for you.
            </li>
            <li>
              <strong>Permission to run your bots.</strong> You give us permission to store, process and send that content only as needed to run
              Build-a-bot for you: to give it to the brain you chose, use the apps you connected, deliver messages and keep receipts.
            </li>
            <li>
              <strong>No training.</strong> We don&apos;t use your content to train AI models, and we don&apos;t sell it.
            </li>
            <li>
              <strong>Recipes you publish</strong> are public: anyone with the link can see them and make their own copy. Recipes never include
              your keys, memories, contacts or messages. You can stop sharing one at any time from your bot&apos;s Settings.
            </li>
          </ul>
        </DocSection>

        <DocSection id="billing" title={title("billing")}>
          <ul>
            <li>
              Free is free. Paid plans (Plus at ${PLANS.plus.priceMonthly}/month and Pro at ${PLANS.pro.priceMonthly}/month, or less when billed
              yearly) renew automatically each month or year until you cancel. Prices are in US dollars, and taxes may apply.
            </li>
            <li>Payments are handled by Stripe. We don&apos;t see or store your full card number.</li>
            <li>
              Each plan has monthly limits. When you reach one, that part of your bot pauses until the next month; we don&apos;t charge overages.
            </li>
            <li>
              You can cancel any time from Plan &amp; usage in the app. Your plan stays active until the end of the period you&apos;ve paid for,
              then moves to Free. Except where the law requires otherwise, payments aren&apos;t refundable.
            </li>
            <li>If we change prices, we&apos;ll tell you in advance, and the change applies from your next billing period.</li>
          </ul>
        </DocSection>

        <DocSection id="termination" title={title("termination")}>
          <p>
            You can stop using Build-a-bot and delete your account at any time from your <Link href="/app/account">Account page</Link>. We may
            suspend or close an account, or pause a bot, if it breaks these terms, puts people or our service at risk, or if the law requires it.
            When we can, we&apos;ll tell you first and give you a chance to export your data.
          </p>
        </DocSection>

        <DocSection id="disclaimers" title={title("disclaimers")}>
          <p>
            Build-a-bot is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent the law allows, we make no promises that it
            will be uninterrupted, error-free or fit for a particular purpose, or that what your bot says or does will be accurate or complete.
          </p>
        </DocSection>

        <DocSection id="liability" title={title("liability")}>
          <p>
            To the extent the law allows, we aren&apos;t liable for indirect, incidental, special or consequential losses, or for lost profits,
            data or goodwill, arising from your use of Build-a-bot or from actions your bot took under your settings. Our total liability for any
            claim is limited to the amount you paid us in the 12 months before the claim. Some places don&apos;t allow these limits, so they may
            not all apply to you.
          </p>
        </DocSection>

        <DocSection id="changes" title={title("changes")}>
          <p>
            We may update these terms as Build-a-bot grows. If a change is significant, we&apos;ll let you know in the app or by email before it
            takes effect. If you keep using Build-a-bot after that, the new terms apply.
          </p>
        </DocSection>

        <DocSection id="contact" title={title("contact")}>
          <p>
            Questions about these terms? Reach us at{" "}
            {contact.isEmail ? <a href={contact.href}>{contact.label}</a> : <Link href={contact.href}>{contact.label}</Link>}.
          </p>
        </DocSection>
      </DocLayout>
    </>
  );
}
