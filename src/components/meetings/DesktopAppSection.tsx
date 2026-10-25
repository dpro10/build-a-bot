/**
 * The Desktop app page: the app where meeting notes, voice typing and a bot's synced folder
 * happen. What it does, where to get it, and pairing (the paired computers are listed below it).
 */
import { Download, FolderSync, Hand, Keyboard, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import type { DesktopApp } from "@/lib/meetings";
import { audioStaysOnComputer } from "@/lib/transcribe";
import { BuddyMock } from "./BuddyMock";
import { DesktopPairing } from "./DesktopPairing";

const POINTS = [
  {
    icon: <Hand />,
    title: "Takes notes, only after a yes",
    body: "When a call starts in Zoom, Meet, Teams or another app, your bot peeks up and asks first. While it listens, it stays at the bottom of your screen, unless you hide it for a screen share.",
  },
  { icon: <Keyboard />, title: "Types what you say", body: "Hold a key in any app and talk. What you meant is typed where your cursor is." },
  {
    icon: <FolderSync />,
    title: "Gives your bot a folder",
    body: "Pick one folder: its files go to your bot's Memory › Files and stay in step. Nothing else on your computer is read.",
  },
  {
    icon: <ShieldCheck />,
    title: "Heard on your computer",
    body: `NVIDIA Parakeet turns calls and dictation into text right on your computer${audioStaysOnComputer() ? ", so your audio never leaves it. Only the words come to Build-a-bot." : ". Where it can't, our server does, without keeping the audio."}`,
  },
];

export function DesktopAppSection({ app, bot }: { app: DesktopApp; bot?: { id: string; name: string; avatar: AvatarId; color: ColorwayId } }) {
  return (
    <section id="desktop" aria-labelledby="desktop-title" className="scroll-mt-6">
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">Mac and Windows</Badge>
            </div>
            <h2 id="desktop-title" className="mt-3 font-display text-2xl font-bold">
              The desktop app
            </h2>
            <p className="mt-1.5 text-muted-foreground">
              One small app in your menu bar or tray: your bot takes notes in your calls, types what you say, and reads the folder you give it.
            </p>
            <ul className="mt-6 flex flex-col gap-4">
              {POINTS.map((p) => (
                <li key={p.title} className="flex gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary [&_svg]:size-[18px]" aria-hidden>
                    {p.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{p.title}</div>
                    <p className="text-sm text-muted-foreground">{p.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <div className="absolute -inset-6 rounded-[2.5rem] bg-primary/10 blur-2xl" aria-hidden />
            <BuddyMock phase="asking" avatar={bot?.avatar} color={bot?.color} name={bot?.name} className="relative" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-px border-t border-border bg-border md:grid-cols-2">
          <div className="min-w-0 bg-card p-5 sm:p-6">
            <h3 className="flex items-center gap-2 font-semibold">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary" aria-hidden>
                1
              </span>
              Get the app
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">Download it for Mac or Windows, then open it. It keeps itself up to date.</p>
            <Button asChild className="mt-3">
              <a href={app.url} target="_blank" rel="noopener noreferrer">
                <Download /> Download the desktop app
              </a>
            </Button>
          </div>
          <div className="min-w-0 bg-card p-5 sm:p-6">
            <h3 className="flex items-center gap-2 font-semibold">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary" aria-hidden>
                2
              </span>
              Pair this computer
            </h3>
            <p className="mt-2 mb-3 text-sm text-muted-foreground">The app asks for a code when it opens. Type the one you get here.</p>
            <DesktopPairing />
          </div>
        </div>
      </div>
    </section>
  );
}
