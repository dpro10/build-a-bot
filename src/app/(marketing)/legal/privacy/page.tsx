import Link from "next/link";
import { DocLayout, DocSection, type TocEntry } from "@/components/marketing/DocLayout";
import { LegalHeader } from "@/components/marketing/LegalHeader";
import { getConnector } from "@/lib/connectors";
import { live } from "@/lib/env";
import { contactLink, pageMetadata } from "@/lib/site";
import { audioStaysOnComputer, groqApiKey, speechServices } from "@/lib/transcribe";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description:
    "What Build-a-bot collects, how it's protected, how it's used (to run your bots; never sold or used to train AI), who processes it for us, how long we keep it, and how to export or delete it.",
  path: "/legal/privacy",
});

const SECTIONS: TocEntry[] = [
  { id: "summary", title: "The short version" },
  { id: "collect", title: "What we collect" },
  { id: "protect", title: "How we protect it" },
  { id: "use", title: "How we use it" },
  { id: "ai-providers", title: "AI brains and your data" },
  { id: "subprocessors", title: "Who processes it for us" },
  { id: "retention", title: "How long we keep it" },
  { id: "choices", title: "Export, delete and your rights" },
  { id: "cookies", title: "Cookies" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Changes" },
  { id: "contact", title: "Contact" },
];

const n = (id: string) => SECTIONS.findIndex((s) => s.id === id) + 1;
const title = (id: string) => `${n(id)}. ${SECTIONS[n(id) - 1].title}`;

const SUBPROCESSORS: { name: string; purpose: string; data: string }[] = [
  { name: "Vercel", purpose: "Hosting and running the app, and storing your bots' files (the Library)", data: "Everything passing through the app while it's processed, and the files you give your bots" },
  { name: "Our managed Postgres host", purpose: "Storing your account and bots", data: "Account, bots, messages, receipts (secrets stay encrypted)" },
  {
    name: "Nebius Token Factory",
    purpose: "The included open models",
    data: "Messages and context when your bot uses an included model, including the meeting and call transcripts it works from; photos and scanned pages from your Library; dictated text, when voice typing's cleanup runs there",
  },
  { name: "Your chosen AI provider", purpose: "Your own API key, if you add one", data: "Messages and context, sent to that provider only" },
  { name: "Tavily", purpose: "Web search, reading web pages and checking facts", data: "Search queries, short facts to check (never your files) and the addresses of pages your bot reads" },
  { name: "Composio", purpose: "Sign-in and actions for many apps", data: "App tokens and the actions your bot takes in those apps" },
  {
    name: "Twilio",
    purpose: "Phone calls and texts",
    data: "Phone numbers, texts, and call audio while it's heard. When our voice server isn't answering, Twilio's speech recognition hears the caller and Amazon Polly reads the replies",
  },
  { name: "AgentMail and Resend", purpose: "Your bot's email address and sign-in emails", data: "Email addresses and email content" },
  { name: "Telegram, Discord, Slack", purpose: "Chat channels you turn on", data: "Messages in those channels and your account IDs there" },
  { name: "Stripe", purpose: "Payments", data: "Billing details (we never see your full card number)" },
  { name: "Open-Meteo, Frankfurter, Wikipedia", purpose: "Weather, currency rates and public lookups", data: "Only the search terms, like a city name" },
];

type Processor = (typeof SUBPROCESSORS)[number];

/**
 * The fixed list, plus the services only some setups use, listed only when they're switched on: a
 * speech-to-text service (for computers where NVIDIA Parakeet can't hear), the voice server (on a
 * Google Cloud machine, voice/deploy/gce.sh) and web actions in a cloud browser (Browser Use).
 */
function subprocessors(): Processor[] {
  const extra: Processor[] = [];
  const speech = speechServices();
  if (speech.length) {
    extra.push({
      name: speech.length > 1 ? `Speech-to-text: ${speech[0]}, with ${speech[1]} as a backup` : `Speech-to-text: ${speech[0]}`,
      purpose: "Turning speech into text only where your computer can't: Private speech off, NVIDIA Parakeet unable to run, or (voice typing) before it has downloaded",
      data: `Audio, only while it's turned into text${groqApiKey() ? " (and dictated text, when voice typing's cleanup runs on Groq)" : ""}`,
    });
  }
  if (live.voiceServer) {
    extra.push({ name: "Google Cloud", purpose: "The machine our voice server runs on: it hears and speaks on calls with NVIDIA's open speech models", data: "Call audio, only while the call is on" });
  }
  const webActions = getConnector("browser");
  if (webActions && webActions.status !== "soon") {
    extra.push({ name: "Browser Use", purpose: "Web actions in a cloud browser", data: "The pages your bot visits and what it types into them" });
  }
  return [...SUBPROCESSORS.slice(0, 5), ...extra, ...SUBPROCESSORS.slice(5)];
}

export default function PrivacyPage() {
  const contact = contactLink("Privacy question");
  const processors = subprocessors();
  // Without speech-to-text on this server, the desktop app never sends audio (audioStaysOnComputer).
  const audioStays = audioStaysOnComputer();
  return (
    <>
      <LegalHeader
        title="Privacy Policy"
        summary="We collect what we need to run your bots, protect it with encryption and strict access rules, never sell it, never use it to train AI models, and let you export or delete all of it whenever you like."
        other={{ href: "/legal/terms", label: "Terms of Service" }}
      />
      <DocLayout toc={SECTIONS}>
        <DocSection id="summary" title={title("summary")}>
          <ul>
            <li>We use your data to run your bots, and for nothing else you wouldn&apos;t expect.</li>
            <li>
              <strong>We don&apos;t sell your data, and we don&apos;t use it to train AI models.</strong> No ads, no ad trackers.
            </li>
            <li>API keys and app logins are encrypted at rest and never shown again.</li>
            <li>
              Meeting notes only listen after you say yes, in the desktop app, which turns the call into text on your own computer.{" "}
              {audioStays ? "The audio never reaches our servers." : "Where it can't, the audio is turned into text on our server, and isn't kept."}
            </li>
            <li>Voice typing only listens while you hold its key, and the desktop app turns your voice into text on your own computer. Neither the audio nor what you dictate is kept on our servers: we count the words, that&apos;s all.</li>
            <li>Calls with your bot aren&apos;t recorded: what&apos;s said is heard as it&apos;s said, and its transcript is kept in your chat with the bot. Our website only listens when you call your bot from it.</li>
            <li>
              You can export everything or delete your account from your <Link href="/app/account">Account page</Link>.
            </li>
          </ul>
        </DocSection>

        <DocSection id="collect" title={title("collect")}>
          <h3>Your account</h3>
          <p>
            Your email address (once you add one), your name if you give it, your time zone, the credit you&apos;ve added (the amounts and dates;
            Stripe keeps the card), and the date you confirmed you&apos;re 18 or older.
          </p>
          <h3>Your bots</h3>
          <p>
            Each bot&apos;s name, look, personality, instructions, jobs, brain choice, trust level and rules, routines, and the channels and apps you
            turn on.
          </p>
          <h3>Messages and what your bot remembers</h3>
          <p>
            Conversations with your bot on every channel, things you ask it to remember, its notes, the people you&apos;ve approved it to contact,
            and approvals you&apos;ve given or declined.
          </p>
          <h3>Receipts</h3>
          <p>A record of every action your bot took or tried to take, why, and what it cost.</p>
          <h3>Meetings</h3>
          <p>
            If you use meeting notes: the transcript of each meeting you said yes to, the notes your bot writes from it, and a record of when you
            said yes and whether you shared the heads-up. Lines are labeled by microphone (&ldquo;You&rdquo;, &ldquo;Others&rdquo; or &ldquo;Room&rdquo;),
            never by recognizing voices. The desktop app turns the call into text on your own computer, with NVIDIA&apos;s Parakeet speech model, and
            sends only the words. Each piece of audio waits on your computer only until it&apos;s been heard (or while the app is offline), then it&apos;s
            deleted.{" "}
            {audioStays
              ? "If Parakeet can't run on your computer, no audio is sent instead: the app says it can't take notes there."
              : "If Private speech is off, or Parakeet can't run on your computer, the audio is sent to be turned into text by the speech-to-text service listed below, and isn't stored."}
          </p>
          <h3>Voice typing</h3>
          <p>
            If you use voice typing: the words and snippets you add to your dictionary, and a monthly count of the words you typed by voice. The
            desktop app turns what you say into text on your own computer, with NVIDIA&apos;s Parakeet speech model (downloaded once from NVIDIA&apos;s
            pages on GitHub and Hugging Face), and sends us only the text. Voice typing works only in the desktop app.{" "}
            {audioStays
              ? "If Parakeet can't hear you (it hasn't downloaded yet, you turned it off, it fails, or you talk in a language it doesn't know), the recording isn't sent anywhere: voice typing says why instead."
              : "If Parakeet can't hear you (it hasn't downloaded yet, you turned it off, it fails, or you talk in a language it doesn't know), the recording is sent once and turned into text by the speech-to-text service listed below."}{" "}
            Either way, the text is cleaned up and sent back to you;
            neither the audio nor the text is stored on our servers. The kind of app
            you&apos;re typing in (like &ldquo;chat&rdquo; or &ldquo;email&rdquo;) and, for well-known apps, its name are sent along so the text fits
            it, never what&apos;s on your screen. To spell your names right, the names your bots remember are used as hints. To learn from
            your fixes, the desktop app reads the text box it just typed into, on your computer, for two minutes (never a password box); what it
            reads isn&apos;t sent or logged, and only a word you fixed is added to your dictionary (you can turn this off). So your words
            don&apos;t run together, it also looks at the few characters next to your cursor right before it types, on your computer; they
            aren&apos;t sent, logged or kept (you can turn this off too). The desktop app keeps your recent dictations
            on your own computer, encrypted, and you can turn that off or clear it. A request that starts with your bot&apos;s name (&ldquo;Hey
            Otto, &hellip;&rdquo;) goes to your bot like a typed message, and is kept in your chat with it. When you edit by voice, the text you
            selected is sent along with what you said, used once to make the change, and not stored. If you ask your bot about text you
            selected (&ldquo;Hey Otto, add this to my calendar&rdquo;), that text goes to your bot with your request and is kept in your chat with
            it.
          </p>
          <h3>Your files (the Library)</h3>
          <p>
            Files you give a bot: ones you upload, ones you send it on Telegram or Discord, and the folder you sync from the desktop app (nothing
            else on your computer is read). They&apos;re stored privately, with their text, so your bot can read and quote them. Photos and scanned
            pages are read by a vision model on Nebius Token Factory.
          </p>
          <h3>Calls</h3>
          <p>
            If you call your bot, or it calls you: the phone numbers on the call (including people who call your bot&apos;s number), when it
            happened and how long it lasted, and a transcript of what was said, kept in your chat with the bot. Calls aren&apos;t recorded: the
            audio is heard while the call is on, by our voice server (NVIDIA&apos;s open speech models) or Twilio&apos;s speech recognition, and
            isn&apos;t kept. Calling your bot from our website works the same way, through your browser&apos;s microphone, and only while the call
            is on.
          </p>
          <h3>Connection tokens and keys</h3>
          <p>
            Tokens that let your bot use the apps you connect, your channel tokens and any API keys you add. These are encrypted as soon as they
            arrive.
          </p>
          <h3>Technical details</h3>
          <p>
            Your browser&apos;s user agent for each signed-in session, the computers you pair with the desktop app, and monthly usage counts (messages,
            searches, minutes, texts, words typed by voice) with what they cost, for your credit.
          </p>
        </DocSection>

        <DocSection id="protect" title={title("protect")}>
          <ul>
            <li>
              <strong>Secrets are encrypted at rest</strong> with AES-256-GCM: API keys, app tokens and channel tokens. After you enter a key we
              only ever show its last few characters, and keys are never written to logs.
            </li>
            <li>
              <strong>Sign-in is token-based.</strong> We store only a fingerprint (hash) of your session and sign-in links, never the tokens
              themselves.
            </li>
            <li>
              <strong>Receipts are append-only.</strong> The database refuses edits, so the record of what your bot did can&apos;t be rewritten.
            </li>
            <li>
              <strong>Access is locked down.</strong> Database row-level security is on, and the app checks that every request belongs to you.
            </li>
          </ul>
        </DocSection>

        <DocSection id="use" title={title("use")}>
          <p>We use your data to:</p>
          <ul>
            <li>run your bots: send your messages to the brain you chose, use the apps you connected, and deliver replies on your channels;</li>
            <li>keep you and others safe: enforce your trust settings and our hard limits, keep receipts, and follow our crisis protocol;</li>
            <li>run your credit: count what you use, charge it at cost, and handle payments;</li>
            <li>help you when you ask, and fix problems.</li>
          </ul>
          <p>
            <strong>We don&apos;t sell your data, share it for advertising, or use it to train AI models</strong>, ours or anyone else&apos;s.
          </p>
        </DocSection>

        <DocSection id="ai-providers" title={title("ai-providers")}>
          <p>
            To answer you, your bot sends your message and the context it needs to the brain you picked: Nebius Token Factory for the included open
            models, or the provider of an API key you added. That provider processes it under its own terms and privacy policy, including how
            long it keeps it. We only send what&apos;s needed for the task at hand.
          </p>
        </DocSection>

        <DocSection id="subprocessors" title={title("subprocessors")}>
          <p>These services process data for us. Most only see data when you turn on the feature that uses them.</p>
          <ul className="flex flex-col gap-2 sm:hidden">
            {processors.map((s) => (
              <li key={s.name} className="rounded-2xl border border-border bg-card p-3.5 text-sm shadow-soft">
                <div className="font-semibold">{s.name}</div>
                <div className="mt-0.5 text-muted-foreground">{s.purpose}</div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground/80">Data:</span> {s.data}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-2xl border border-border sm:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-background-2">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Service
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    What it&apos;s for
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Data involved
                  </th>
                </tr>
              </thead>
              <tbody>
                {processors.map((s) => (
                  <tr key={s.name} className="border-t border-border align-top">
                    <th scope="row" className="px-4 py-3 font-medium">
                      {s.name}
                    </th>
                    <td className="px-4 py-3 text-muted-foreground">{s.purpose}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Apps you connect (like Gmail or GitHub) receive what your bot sends them under your settings, under their own privacy policies.</p>
        </DocSection>

        <DocSection id="retention" title={title("retention")}>
          <ul>
            <li>We keep your data while your account is open, so your bots remember what they should.</li>
            <li>Delete a bot and its messages, memories, notes, meetings, files and receipts go with it. Delete your account and everything goes.</li>
            <li>Files in the Library stay until you delete them. Call transcripts are part of your chat with the bot, and go with it.</li>
            <li>You can delete individual memories and notes in the app at any time.</li>
            <li>
              Meeting transcripts are deleted after 90 days, unless you choose 30 days or to keep them. The notes from a meeting stay until you
              delete them, and you can delete a meeting, or just its transcript, at any time.
            </li>
            <li>Sign-in sessions expire after 180 days. Sign-in links work once and expire after 20 minutes.</li>
            <li>Deleted data can stay in encrypted backups for a short time before it&apos;s overwritten.</li>
          </ul>
        </DocSection>

        <DocSection id="choices" title={title("choices")}>
          <ul>
            <li>
              <strong>Export:</strong> download everything we hold about you as a file from your <Link href="/app/account">Account page</Link>.
              Secrets aren&apos;t included, since we never show them again.
            </li>
            <li>
              <strong>Delete:</strong> delete your account and all of its data from the same page. There&apos;s no subscription to cancel; ask us
              first if you&apos;d like unused credit you added refunded.
            </li>
            <li>
              <strong>Disconnect:</strong> remove an app or turn off a channel at any time; your bot loses access right away.
            </li>
            <li>
              <strong>Your rights:</strong> depending on where you live, you may have rights to access, correct, delete or move your data, or to
              object to some processing. You can use most of them in the app, or contact us for the rest.
            </li>
          </ul>
        </DocSection>

        <DocSection id="cookies" title={title("cookies")}>
          <p>
            We use <strong>one cookie</strong>: a secure, HTTP-only session cookie that keeps you signed in. No ad trackers, no third-party
            analytics cookies. Your light or dark theme choice is saved in your browser&apos;s local storage, not in a cookie.
          </p>
        </DocSection>

        <DocSection id="children" title={title("children")}>
          <p>
            Build-a-bot is for adults 18 and over. We don&apos;t knowingly collect data from children, and if we learn that we have, we delete the
            account and its data.
          </p>
        </DocSection>

        <DocSection id="changes" title={title("changes")}>
          <p>
            If we change this policy in a meaningful way, we&apos;ll tell you in the app or by email before the change takes effect, and update the
            date at the top of this page.
          </p>
        </DocSection>

        <DocSection id="contact" title={title("contact")}>
          <p>
            Questions or requests about your data? Reach us at{" "}
            {contact.isEmail ? <a href={contact.href}>{contact.label}</a> : <Link href={contact.href}>{contact.label}</Link>}.
          </p>
        </DocSection>
      </DocLayout>
    </>
  );
}
