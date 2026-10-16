/**
 * "Your computer" page: the desktop app, where meeting notes (and voice typing) happen, next to the
 * Bridge. What it does, where to get it (its signed download once published; until then "Coming
 * soon", or the repo in demo mode), and pairing.
 */
import { Bell, CircleDot, Download, Hand, Laptop, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import type { DesktopApp } from "@/lib/meetings";
import { BuddyMock } from "./BuddyMock";
import { DesktopPairing } from "./DesktopPairing";

const DEV_COMMAND = "cd desktop && npm install && npm start";

const POINTS = [
  {
    icon: <Bell />,
    title: "Notices when a call starts",
    body: "In Zoom, Google Meet, Teams, Webex, Slack and more. It only checks which app is using the microphone, never what's said.",
  },
  { icon: <Hand />, title: "Asks first", body: "Your bot peeks up from the bottom of your screen: “Want me to take notes?” Nothing is recorded until you say yes." },
  {
    icon: <CircleDot />,
    title: "Stays where you can see it",
    body: "While it listens, it sits at the bottom of your screen with a red dot and a timer. It never records without showing itself.",
  },
  {
    icon: <ShieldCheck />,
    title: "Heard on your computer",
    body: "NVIDIA Parakeet turns the call into text right on your computer, so the audio never leaves it. Only the words come to Build-a-bot, and your notes land in your chat.",
  },
];

export function DesktopAppSection({
  app,
  devices,
  bot,
}: {
  app: DesktopApp;
  devices: { id: string; name: string; online: boolean }[];
  bot?: { id: string; name: string; avatar: AvatarId; color: ColorwayId };
}) {
  const online = devices.filter((d) => d.online).length;
  const soon = app.status === "soon";
  return (
    <section id="desktop" aria-labelledby="desktop-title" className="scroll-mt-6">
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">Meeting notes</Badge>
              <Badge tone="outline">{soon ? "Coming soon" : "Beta"}</Badge>
            </div>
            <h2 id="desktop-title" className="mt-3 font-display text-2xl font-bold">
              The desktop app
            </h2>
            <p className="mt-1.5 text-muted-foreground">Your bot takes notes in your calls, right on your computer. Nobody has to let a bot into the meeting.</p>
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

        {soon ? (
          // Nothing to install yet.
          <div className="border-t border-border p-5 sm:p-6">
            <p className="text-sm text-muted-foreground">Signed downloads for Mac and Windows are coming soon. Meeting notes and voice typing come with them.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-px border-t border-border bg-border md:grid-cols-2">
            <div className="min-w-0 bg-card p-5 sm:p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary" aria-hidden>
                  1
                </span>
                Get the app
              </h3>
              {app.status === "download" ? (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">Download it for Mac or Windows, then open it.</p>
                  <Button asChild className="mt-3">
                    <a href={app.url} target="_blank" rel="noopener noreferrer">
                      <Download /> Download the desktop app
                    </a>
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Signed downloads for Mac and Windows are coming. Developers can run it today from the repo:
                  </p>
                  <div className="mt-3 flex items-start gap-2 rounded-2xl border border-border bg-background-2 py-1.5 pr-1.5 pl-4">
                    <code className="min-w-0 flex-1 py-1.5 font-mono text-[13px] leading-relaxed break-words text-foreground">
                      <span className="text-muted-foreground select-none">$ </span>
                      {DEV_COMMAND}
                    </code>
                    <CopyButton value={DEV_COMMAND} label="Copy" className="shrink-0" aria-label={`Copy: ${DEV_COMMAND}`} />
                  </div>
                </>
              )}
            </div>
            <div className="min-w-0 bg-card p-5 sm:p-6">
              <h3 className="flex items-center gap-2 font-semibold">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary" aria-hidden>
                  2
                </span>
                Pair this computer
              </h3>
              <p className="mt-2 mb-3 text-sm text-muted-foreground">
                In the desktop app, choose <span className="font-medium text-foreground">Pair this computer</span>, then enter the code you get here. It&apos;s
                the same kind of code as the Bridge&apos;s.
              </p>
              <DesktopPairing />
            </div>
          </div>
        )}
        {soon && !devices.length ? null : (
          <div className={cn("flex items-center gap-2 border-t border-border px-5 py-3 text-sm sm:px-6", devices.length ? "text-foreground" : "text-muted-foreground")}>
            <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {devices.length ? (
              <span>
                Paired on {devices.map((d) => d.name).join(", ")} · {online ? `${online} online` : "offline right now"}
              </span>
            ) : (
              <span>No computers paired with the desktop app yet.</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
