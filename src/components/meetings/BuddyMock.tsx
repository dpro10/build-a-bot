/**
 * A picture of the meeting buddy on a computer screen: a call in a window, and the
 * bot peeking up from the bottom edge, asking first or listening with its red dot.
 * Decorative (aria-hidden): the text around it says the same thing.
 */
import { Mic, Pause, Square } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { cn } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { meetingAppIcon } from "./shared";

const PEOPLE = [
  { initials: "SR", tone: "from-sky-300/70 to-sky-500/60" },
  { initials: "PK", tone: "from-coral-300/70 to-coral-400/60" },
  { initials: "AM", tone: "from-mint-300/70 to-mint-500/60" },
  { initials: "You", tone: "from-grape-200/80 to-grape-400/60" },
];

export function BuddyMock({
  phase,
  avatar = "otto",
  color = "grape",
  name = "Inky",
  className,
  app = "zoom",
  title = "Design sync",
}: {
  phase: "asking" | "listening";
  avatar?: AvatarId;
  color?: ColorwayId;
  name?: string;
  className?: string;
  app?: "zoom" | "meet" | "teams";
  title?: string;
}) {
  return (
    <div aria-hidden="true" className={cn("relative w-full overflow-hidden rounded-2xl border border-border bg-background-2 shadow-lift", className)}>
      <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-2">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <BrandTile icon={meetingAppIcon(app)} size={14} />
          <span className="truncate">{title}</span>
        </span>
      </div>
      <div className={cn("grid grid-cols-2 gap-1.5 p-2", phase === "asking" ? "pb-28 sm:pb-32" : "pb-16 sm:pb-20")}>
        {PEOPLE.map((p) => (
          <div key={p.initials} className={cn("flex aspect-video items-center justify-center rounded-lg bg-gradient-to-br", p.tone)}>
            <span className="flex size-8 items-center justify-center rounded-full bg-card/80 text-[11px] font-bold text-foreground sm:size-10 sm:text-xs">{p.initials}</span>
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center px-3">
        {phase === "asking" ? (
          <div className="relative mb-1 w-[min(260px,100%)] rounded-2xl border border-border bg-card px-3 py-2.5 text-left shadow-lift">
            <p className="font-display text-[13px] leading-tight font-bold text-foreground">Want me to take notes?</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">Looks like you&apos;re on a call.</p>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground">
                <Mic className="size-3" /> Take notes
              </span>
              <span className="inline-flex h-6 items-center rounded-full px-2 text-[11px] font-semibold text-foreground">Not now</span>
            </div>
            <span className="absolute -bottom-[6px] left-1/2 size-3 -translate-x-1/2 rotate-45 rounded-[2px] border-r border-b border-border bg-card" />
          </div>
        ) : null}
        <div className="relative flex items-end">
          <Avatar avatar={avatar} color={color} mood={phase === "asking" ? "happy" : "listening"} size={phase === "asking" ? 76 : 68} animated={false} className="-mb-3" title={name} />
          {phase === "listening" ? (
            <div className="absolute bottom-4 left-full ml-1 flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-1 pl-2.5 shadow-soft">
              <span className="size-2 rounded-full bg-danger" />
              <span className="font-mono text-[11px] font-semibold text-foreground tabular-nums">12:04</span>
              <span className="flex h-3 items-center gap-[2px]">
                {[6, 11, 8, 4].map((h, i) => (
                  <span key={i} className="w-[2px] rounded-full bg-danger" style={{ height: h }} />
                ))}
              </span>
              <span className="flex size-5 items-center justify-center rounded-full bg-muted text-foreground">
                <Pause className="size-2.5" />
              </span>
              <span className="flex size-5 items-center justify-center rounded-full bg-danger text-white">
                <Square className="size-2 fill-current" />
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
