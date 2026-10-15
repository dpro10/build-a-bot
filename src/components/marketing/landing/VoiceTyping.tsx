import Link from "next/link";
import { ArrowRight, BookA, Keyboard, MessageCircle, Mic, ShieldCheck, Sparkles } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { VoicePillMock } from "@/components/voice/VoicePillMock";
import { Container, Section, SectionHeader } from "../ui";

const POINTS = [
  { icon: <Keyboard />, title: "Any app", body: "Hold a key in Slack, email, docs or your code editor. Let go, and it's typed where your cursor is." },
  { icon: <Sparkles />, title: "Cleaned up", body: "No ums, the right punctuation, your corrections kept. Casual in chats, proper in email." },
  { icon: <BookA />, title: "Your words", body: "Names your bot remembers and words you add are spelled right, every time." },
  { icon: <ShieldCheck />, title: "Private", body: "Your voice becomes text and is thrown away. We count words, never keep them." },
];

function Cut({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span className="sr-only">(removed: </span>
      <del className="text-muted-foreground decoration-muted-foreground decoration-[1.5px]">{children}</del>
      <span className="sr-only">)</span>
    </>
  );
}

/** `desktopApp`: the desktop app can be had; otherwise voice typing everywhere is "coming soon" (the browser try-out works). */
export function VoiceTyping({ desktopApp }: { desktopApp: boolean }) {
  return (
    <Section id="voice" aria-labelledby="voice-title" className="overflow-hidden bg-background-2">
      <Container>
        <SectionHeader id="voice-title" eyebrow="Voice typing" icon={<Mic />} title="Talk instead of type. In any app.">
          Hold a key and say it the way you'd say it. It types what you meant, where your cursor is. Most people talk about three times faster than they type.
          {desktopApp ? "" : " Coming soon to the desktop app; try it in your browser today."}
        </SectionHeader>

        <div className="mt-14 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-stretch">
          {/* A chat app, with what was said and what was typed. */}
          <figure className="relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-lift">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold">
              <span className="text-muted-foreground">#</span> launch-plan
            </div>
            <div className="flex flex-1 flex-col gap-4 p-5">
              <div className="rounded-2xl bg-muted/60 p-4 text-[15px]">
                <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">You say</div>
                {/* What the cleanup takes out is struck through. */}
                <p className="mt-1">
                  “<Cut>Um, so</Cut> I think we should, <Cut>uh,</Cut> ship the beta on <Cut>Thursday. No wait,</Cut> Friday. And can Priya send the <Cut>the</Cut> release notes?”
                </p>
              </div>
              <div className="rounded-2xl border border-primary/25 bg-primary-soft/40 p-4 text-[15px]">
                <div className="flex items-center gap-1 text-xs font-semibold tracking-wide text-primary uppercase">
                  <Sparkles className="size-3" aria-hidden="true" /> It types
                </div>
                <p className="mt-1 font-medium">I think we should ship the beta on Friday. And can Priya send the release notes?</p>
              </div>
              <div className="mt-auto flex justify-center pt-2">
                <VoicePillMock state="done" text="I think we should ship the beta on Friday…" />
              </div>
            </div>
            <figcaption className="sr-only">Voice typing in a chat app: the spoken words with fillers and a correction, and the clean message it typed.</figcaption>
          </figure>

          {/* Asking the bot. */}
          <figure className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-lift">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="size-4 text-primary" aria-hidden="true" /> Or ask your bot
            </div>
            <p className="text-[15px] text-muted-foreground">Start with its name, from any app:</p>
            <p className="rounded-2xl bg-muted/60 px-4 py-3 text-[15px] italic">“Hey Otto, remind me to call Mom tomorrow at 5.”</p>
            <div className="flex gap-3 rounded-2xl bg-[#16141f] p-4 text-[#f4f2f9]">
              <Avatar avatar="otto" color="mint" size={40} mood="happy" />
              <div className="min-w-0 text-sm">
                <div className="font-semibold">Otto</div>
                <p className="mt-0.5">Done. I'll remind you tomorrow at 5 PM to call Mom.</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {["Paste", "Copy", "Reply", "Open chat"].map((b, i) => (
                    <span key={b} className={i === 0 ? "rounded-full bg-[#6a4af5] px-2.5 py-1 font-semibold text-white" : "rounded-full bg-white/10 px-2.5 py-1"}>
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <figcaption className="text-sm text-muted-foreground">It answers right there, does it with your apps, and it's in your chat later.</figcaption>
          </figure>
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {POINTS.map((p) => (
            <li key={p.title} className="rounded-3xl border border-border bg-card p-5 shadow-soft">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-5" aria-hidden="true">
                {p.icon}
              </span>
              <div className="mt-3 font-semibold">{p.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <Link href="/app/voice" className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
            Try voice typing <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <p className="text-sm text-muted-foreground">8,000 words a month free. Unlimited on Plus and Pro.</p>
        </div>
      </Container>
    </Section>
  );
}
