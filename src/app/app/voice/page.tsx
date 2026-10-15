import type { Metadata } from "next";
import { AppWindow, AudioLines, BookA, Download, Keyboard, Laptop, MessageCircle, ShieldCheck, Sparkles, Trash2, Wand2 } from "lucide-react";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { listBots, listBridgeDevices } from "@/lib/data";
import { DEVICE_ONLINE_MS } from "@/lib/bridge/jobs";
import { desktopApp } from "@/lib/meetings";
import { dictationUsage, dictionaryView, loadVoiceContext, voiceTypingAvailable } from "@/lib/dictation";
import { transcriptionSetup } from "@/lib/transcribe";
import { paidPlansOpen } from "@/lib/env";
import { isDesktopApp } from "@/components/account/bridge-shared";
import { PageContainer, PageHeader, SectionHeading } from "@/components/account/PageHeader";
import { DesktopPairing } from "@/components/meetings/DesktopPairing";
import { DictionaryEditor } from "@/components/voice/DictionaryEditor";
import { TryVoice } from "@/components/voice/TryVoice";
import { VoicePillMock } from "@/components/voice/VoicePillMock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = { title: "Voice typing" };

const DEV_COMMAND = "cd desktop && npm install && npm start";

const SHORTCUTS = [
  { os: "Mac", keys: "Right Option (⌥)" },
  { os: "Windows", keys: "Ctrl + Windows" },
  { os: "Linux", keys: "Right Ctrl" },
];

const HOW = [
  { icon: <Keyboard />, title: "Hold a key, in any app", body: "Slack, email, docs, your code editor: wherever your cursor is. Let go and it's typed there. Tap twice to keep talking hands-free." },
  { icon: <Sparkles />, title: "Cleaned up as you go", body: "No ums or repeats, the right punctuation, and your corrections kept: “at 2, no, 3” comes out “at 3”. Casual in chats, proper in email." },
  { icon: <BookA />, title: "Spelled your way", body: "Names your bots remember and words you add are spelled right. Say a snippet's phrase and it types your link or address." },
  { icon: <Wand2 />, title: "Edit by voice", body: "Select some text, hold Shift with your key, and say what to change: “make this friendlier”, “turn it into a list”, “translate it to Spanish”." },
  { icon: <MessageCircle />, title: "Or ask your bot", body: "Start with “Hey” and your bot's name: “Hey Otto, remind me to call Mom at 5.” It answers right there, and it's in your chat." },
];

const PRIVATE = [
  { icon: <AudioLines />, text: "The mic is on only while you hold the key, and the pill on your screen shows it the whole time." },
  { icon: <Trash2 />, text: "Your voice is turned into text and thrown away. We keep a word count, never your words." },
  { icon: <Laptop />, text: "Your history stays on your computer, encrypted, and you can turn it off." },
  { icon: <ShieldCheck />, text: "So the words fit, only the kind of app you're in (“chat”, “email”) and a well-known app's name are sent. Never what's on your screen." },
  { icon: <Wand2 />, text: "When you edit by voice, the text you selected is sent once to change it, and never kept." },
];

export default async function VoicePage() {
  const user = await requireUser("/app/voice");
  const db = await getDb();
  const [ctx, usage, devices, bots] = await Promise.all([loadVoiceContext(db, user), dictationUsage(db, user), listBridgeDevices(db, user.id), listBots(db, user.id)]);
  const app = desktopApp();
  const now = Date.now();
  const computers = devices
    .filter((d) => !d.revokedAt && isDesktopApp(d.platform))
    .map((d) => ({ id: d.id, name: d.name, online: Boolean(d.lastSeenAt && now - d.lastSeenAt.getTime() < DEVICE_ONLINE_MS) }));
  const botList = bots.map(({ bot }) => ({ id: bot.id, name: bot.name, avatar: bot.avatar as AvatarId, color: bot.color as ColorwayId }));

  return (
    <PageContainer>
      <PageHeader
        title="Voice typing"
        description="Hold a key in any app and talk. What you meant is typed where your cursor is: no ums, the right punctuation, your names spelled your way."
        actions={app.status === "soon" ? <Badge tone="outline">Desktop app coming soon</Badge> : <Badge tone="primary">Beta</Badge>}
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

      <SectionHeading id="try-title" title="Try it" description="Right here in your browser, with the same cleanup and your words. The desktop app does this in every app." />
      <div className="mb-10">
        <TryVoice bots={botList} available={voiceTypingAvailable()} simulated={!transcriptionSetup()} initialUsage={usage} paidPlans={paidPlansOpen} />
      </div>

      <section id="desktop" aria-labelledby="desktop-title" className="mb-10 scroll-mt-6">
        <SectionHeading id="desktop-title" title="In every app" description="The desktop app listens for your shortcut anywhere, then types where your cursor is." />
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
            <div className="min-w-0 bg-card p-5 sm:p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <AppWindow className="size-4 text-primary" aria-hidden="true" /> Get the app
              </h3>
              {app.status === "download" ? (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">For Mac and Windows. Open it, pair it below, then turn on voice typing from its menu.</p>
                  <Button asChild className="mt-3">
                    <a href={app.url} target="_blank" rel="noopener noreferrer">
                      <Download /> Download the desktop app
                    </a>
                  </Button>
                </>
              ) : app.status === "repo" ? (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">Signed downloads are coming. Developers can run it today from the repo:</p>
                  <div className="mt-3 flex items-start gap-2 rounded-2xl border border-border bg-background-2 py-1.5 pr-1.5 pl-4">
                    <code className="min-w-0 flex-1 py-1.5 font-mono text-[13px] leading-relaxed break-words">
                      <span className="text-muted-foreground select-none">$ </span>
                      {DEV_COMMAND}
                    </code>
                    <CopyButton value={DEV_COMMAND} label="Copy" className="shrink-0" aria-label={`Copy: ${DEV_COMMAND}`} />
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">Signed downloads for Mac and Windows are coming soon. Until then, try it above in your browser.</p>
              )}
              <h4 className="mt-5 text-sm font-semibold">The key to hold</h4>
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
                <Laptop className="size-4 text-primary" aria-hidden="true" /> Pair this computer
              </h3>
              {app.status === "soon" && !computers.length ? (
                <p className="mt-2 text-sm text-muted-foreground">When the app is out, you'll pair it here with a one-time code.</p>
              ) : (
                <>
                  <p className="mt-2 mb-3 text-sm text-muted-foreground">
                    In the desktop app, choose <span className="font-medium text-foreground">Pair this computer</span> and enter the code you get here.
                  </p>
                  <DesktopPairing />
                </>
              )}
              {computers.length ? (
                <p className="mt-4 text-sm">
                  Paired: {computers.map((c) => `${c.name}${c.online ? " (online)" : ""}`).join(", ")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section id="dictionary" aria-labelledby="dictionary-title" className="mb-10 scroll-mt-6">
        <SectionHeading id="dictionary-title" title="Your words" description="Used everywhere you type by voice: here, and in the desktop app." />
        <DictionaryEditor initial={[...ctx.words, ...ctx.snippets].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(dictionaryView)} fromMemories={ctx.fromMemories} />
      </section>

      <section aria-labelledby="private-title" className="rounded-3xl border border-border bg-background-2 p-5 sm:p-6">
        <h2 id="private-title" className="font-display text-xl font-semibold">
          Private by design
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {PRIVATE.map((p) => (
            <li key={p.text} className="flex gap-3 text-sm">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-card text-primary [&_svg]:size-4" aria-hidden="true">
                {p.icon}
              </span>
              <span className="text-muted-foreground">{p.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">
          {usage.limit
            ? `${usage.words.toLocaleString()} of your ${usage.limit.toLocaleString()} free words this month are used. Plus and Pro have no monthly limit.`
            : `${usage.words.toLocaleString()} words this month. Your plan has no monthly limit.`}
        </p>
      </section>
    </PageContainer>
  );
}
