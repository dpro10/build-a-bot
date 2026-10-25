import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, AudioLines, BookA, BookCheck, Keyboard, Laptop, Lock, MessageCircle, ShieldCheck, Sparkles, Trash2, Wand2 } from "lucide-react";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { listBridgeDevices } from "@/lib/data";
import { DEVICE_ONLINE_MS } from "@/lib/bridge/devices";
import { dictationUsage, dictionaryView, loadVoiceContext } from "@/lib/dictation";
import { transcriptionSetup } from "@/lib/transcribe";
import { isDesktopApp } from "@/components/account/bridge-shared";
import { PageContainer, PageHeader, SectionHeading } from "@/components/account/PageHeader";
import { DictionaryEditor } from "@/components/voice/DictionaryEditor";
import { VoicePillMock } from "@/components/voice/VoicePillMock";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Voice typing" };

const SHORTCUTS = [
  { os: "Mac", keys: "Right Option (⌥)" },
  { os: "Windows", keys: "Right Ctrl" },
  { os: "Linux", keys: "Right Ctrl" },
];

const HOW = [
  { icon: <Keyboard />, title: "Hold a key, in any app", body: "Slack, email, docs, your code editor: wherever your cursor is. Let go and it's typed there. Tap twice to keep talking hands-free." },
  { icon: <Sparkles />, title: "Cleaned up as you go", body: "No ums or repeats, the right punctuation, and your corrections kept: “at 2, no, 3” comes out “at 3”. Casual in chats, proper in email." },
  { icon: <BookA />, title: "Spelled your way", body: "Names your bots remember and words you add are spelled right. Say a snippet's phrase and it types your link or address." },
  { icon: <Wand2 />, title: "Edit by voice", body: "Select some text, hold Shift with your key, and say what to change: “make this friendlier”, “turn it into a list”, “translate it to Spanish”." },
  { icon: <MessageCircle />, title: "Or ask your bot", body: "Start with “Hey” and your bot's name: “Hey Otto, remind me to call Mom at 5.” With text selected and Shift held, it gets that too: “Hey Otto, add this to my calendar.”" },
];

/**
 * What stays private. A recording reaches our server only when this site has speech-to-text, and
 * then only where Parakeet can't hear: before it has downloaded, with Private speech off, or in a
 * language it doesn't know. Who hears it then is named.
 */
const privatePoints = () => {
  const stt = transcriptionSetup();
  return [
    { icon: <AudioLines />, text: "The mic is on only while you hold the key, and the pill on your screen shows it the whole time." },
    {
      icon: <Lock />,
      text: `The app hears you on your own computer, with NVIDIA's Parakeet speech model (English and 24 European languages)${stt ? "" : ", so your voice stays there"}. Only the words come to us, to be cleaned up.`,
    },
    {
      icon: <Trash2 />,
      text: !stt
        ? "We keep a word count, never your words."
        : stt.provider === "nvidia"
          ? "Until Parakeet has downloaded, if you turn Private speech off, or in a language Parakeet doesn't know, the recording is turned into text on our own server, by NVIDIA's open speech models, and thrown away. We keep a word count, never your words."
          : `Until Parakeet has downloaded, if you turn Private speech off, or in a language Parakeet doesn't know, the recording is sent through our server to ${stt.label}, turned into text and thrown away. We keep a word count, never your words.`,
    },
    { icon: <Laptop />, text: "Your history stays on your computer, encrypted, and you can turn it off." },
    { icon: <ShieldCheck />, text: "So the words fit, only the kind of app you're in (“chat”, “email”) and a well-known app's name are sent. Never what's on your screen." },
    { icon: <BookCheck />, text: "Fix a word it got wrong right where it typed it, and it learns it: for two minutes, the app reads that one box on your computer (never a password box), and only the word you fixed is saved to Your words. You can turn this off." },
    { icon: <Keyboard />, text: "Talk right after a word or a sentence and it adds the space, so your words don't run together: right before typing, the app looks at the few characters next to your cursor, on your computer, and keeps nothing. You can turn this off." },
    { icon: <Wand2 />, text: "When you edit by voice, the text you selected is sent once to change it, and never kept." },
  ];
};

export default async function VoicePage() {
  const user = await requireUser("/app/voice");
  const db = await getDb();
  const [ctx, usage, devices] = await Promise.all([loadVoiceContext(db, user), dictationUsage(db, user), listBridgeDevices(db, user.id)]);
  const now = Date.now();
  const computers = devices
    .filter((d) => !d.revokedAt && isDesktopApp(d.platform))
    .map((d) => ({ id: d.id, name: d.name, online: Boolean(d.lastSeenAt && now - d.lastSeenAt.getTime() < DEVICE_ONLINE_MS) }));

  return (
    <PageContainer>
      <PageHeader
        title="Voice typing"
        description="Hold a key in any app and talk. What you meant is typed where your cursor is: no ums, the right punctuation, your names spelled your way. It works in the desktop app."
      />

      <section aria-label="What voice typing does" className="mb-10 overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
          <ul className="flex flex-col gap-4">
            {HOW.map((h) => (
              <li key={h.title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary [&_svg]:size-[18px]" aria-hidden="true">
                  {h.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{h.title}</div>
                  <p className="text-sm text-muted-foreground">{h.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <figure className="relative flex flex-col gap-4 rounded-3xl bg-gradient-to-b from-primary-soft/60 to-background-2 p-5 sm:p-6">
            <div className="rounded-2xl border border-border bg-card p-4 text-sm shadow-soft">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">You say</div>
              <p className="mt-1 text-muted-foreground">“Um, so can we move the, uh, the team sync to Thursday, no wait, Friday at three? New line. Thanks!”</p>
              <div className="mt-3 flex items-center gap-1 text-xs font-semibold tracking-wide text-primary uppercase">
                <Sparkles className="size-3" aria-hidden="true" /> It types
              </div>
              <p className="mt-1 font-medium">
                Can we move the team sync to Friday at 3?
                <br />
                Thanks!
              </p>
            </div>
            <div className="flex justify-center">
              <VoicePillMock />
            </div>
            <figcaption className="sr-only">An example: the spoken words with fillers and a correction, and the clean text it types.</figcaption>
          </figure>
        </div>
      </section>

      <section id="desktop" aria-labelledby="desktop-title" className="mb-10 scroll-mt-6">
        <SectionHeading id="desktop-title" title="In the desktop app" description="Voice typing happens in the app: it listens for your key in any app, hears you on your computer with NVIDIA Parakeet, and types where your cursor is." />
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
            <div className="min-w-0 bg-card p-5 sm:p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <Keyboard className="size-4 text-primary" aria-hidden="true" /> The key to hold
              </h3>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {SHORTCUTS.map((s) => (
                  <div key={s.os} className="contents">
                    <dt className="text-muted-foreground">{s.os}</dt>
                    <dd>
                      <kbd className="rounded-md border border-border bg-background-2 px-1.5 py-0.5 font-mono text-xs font-semibold">{s.keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">You can pick other keys in the app. On a Mac it asks for Accessibility, so it can hear the key in any app and paste for you.</p>
            </div>
            <div className="min-w-0 bg-card p-5 sm:p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <Laptop className="size-4 text-primary" aria-hidden="true" /> {computers.length ? "Your computers" : "Get the app"}
              </h3>
              {computers.length ? (
                <p className="mt-2 text-sm">
                  Paired: {computers.map((c) => `${c.name}${c.online ? " (online)" : ""}`).join(", ")}. Turn on voice typing from the app&apos;s menu.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">For Mac and Windows. Download it and pair it with your account, then turn on voice typing from its menu.</p>
              )}
              {/* The app has one home: the Desktop app page has its download and pairing. */}
              <Button asChild variant={computers.length ? "outline" : "primary"} className="mt-3">
                <Link href="/app/desktop">
                  {computers.length ? "Manage the desktop app" : "Get the desktop app"} <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="dictionary" aria-labelledby="dictionary-title" className="mb-10 scroll-mt-6">
        <SectionHeading id="dictionary-title" title="Your words" description="The desktop app spells these your way, and types your snippets, everywhere you talk." />
        <DictionaryEditor initial={[...ctx.words, ...ctx.snippets].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(dictionaryView)} fromMemories={ctx.fromMemories} />
      </section>

      <section aria-labelledby="private-title" className="rounded-3xl border border-border bg-background-2 p-5 sm:p-6">
        <h2 id="private-title" className="font-display text-xl font-semibold">
          Private by design
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {privatePoints().map((p) => (
            <li key={p.text} className="flex gap-3 text-sm">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-card text-primary [&_svg]:size-4" aria-hidden="true">
                {p.icon}
              </span>
              <span className="text-muted-foreground">{p.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          {usage.words.toLocaleString("en-US")} word{usage.words === 1 ? "" : "s"} this month, with no limit. Hearing you is free on your computer; the AI
          cleanup is paid from your credit, a fraction of a cent each time, and without credit you still get the plain cleanup.{" "}
          <Link href="/app/billing" className="font-medium text-primary hover:underline">
            Credit &amp; usage
          </Link>
        </p>
      </section>
    </PageContainer>
  );
}
