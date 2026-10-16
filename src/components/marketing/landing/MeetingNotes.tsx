import Link from "next/link";
import { ArrowRight, AudioLines, MessageCircle, NotebookPen, ShieldCheck, UserX } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { BuddyMock } from "@/components/meetings/BuddyMock";
import { meetingAppIcon } from "@/components/meetings/shared";
import { Container, Section, SectionHeader } from "../ui";

const POINTS = [
  { icon: <UserX />, title: "No bot joins the call", body: "It listens on your computer, so nobody has to let a stranger into the meeting." },
  { icon: <NotebookPen />, title: "Notes, sent to you", body: "A summary, the decisions and who's doing what, in your chat, Telegram or email." },
  { icon: <ShieldCheck />, title: "Heard on your computer", body: "NVIDIA Parakeet turns the call into text on your computer, so the audio never leaves it. Your meetings never train AI." },
  { icon: <MessageCircle />, title: "Ask about any meeting", body: "“What did Priya say about pricing?” Your bot searches what was said." },
];

const APPS = ["zoom", "meet", "teams", "webex", "slack", "discord"] as const;

/** Meeting notes are taken in the desktop app. `desktopApp`: it can be had (downloads, or the repo); otherwise it's coming soon. */
export function MeetingNotes({ desktopApp }: { desktopApp: boolean }) {
  return (
    <Section id="meetings" aria-labelledby="meetings-title" className="overflow-hidden bg-gradient-to-b from-background via-primary-soft/30 to-background-2">
      <Container>
        <SectionHeader id="meetings-title" eyebrow="Meeting notes" icon={<AudioLines />} title="It takes notes in your calls. When you say yes.">
          When a call starts, your bot peeks up from the bottom of your screen and asks. Say yes, and it stays right there while it listens, then sends you the notes.
          {desktopApp ? " It's in the desktop app." : " Coming soon in the desktop app."}
        </SectionHeader>

        <div className="mt-14 grid gap-8 lg:grid-cols-2 lg:gap-10">
          {[
            { phase: "asking" as const, step: "1", title: "It asks first", body: "“Want me to take notes?” Nothing is recorded until you tap yes, and you can copy a heads-up for everyone on the call." },
            { phase: "listening" as const, step: "2", title: "It stays where you can see it", body: "A red dot and a timer at the bottom of your screen, the whole time it listens. Pause or stop with one tap." },
          ].map((s) => (
            <figure key={s.phase} className="flex flex-col gap-5">
              <div className="relative">
                <div className="absolute -inset-4 rounded-[2.5rem] bg-primary/10 blur-2xl" aria-hidden="true" />
                <BuddyMock phase={s.phase} avatar="otto" color="grape" name="Inky" className="relative" title={s.phase === "asking" ? "Design sync" : "Weekly planning"} app={s.phase === "asking" ? "zoom" : "meet"} />
              </div>
              <figcaption className="flex gap-3.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">
                  {s.step}
                </span>
                <span>
                  <span className="block font-display text-xl font-bold tracking-tight">{s.title}</span>
                  <span className="mt-1 block text-[15px] leading-relaxed text-muted-foreground">{s.body}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>

        <ul className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {APPS.map((a) => (
              <BrandTile key={a} icon={meetingAppIcon(a)} size={32} />
            ))}
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            {desktopApp
              ? "Works with Zoom, Google Meet, Teams, Webex, Slack and calls in your browser, with the desktop app for Mac and Windows, and with a meeting in the room."
              : "Works with Zoom, Google Meet, Teams, Webex, Slack and calls in your browser, with the desktop app for Mac and Windows, coming soon."}{" "}
            <Link href="/safety#recording" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              How recording stays fair <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </p>
        </div>
      </Container>
    </Section>
  );
}
