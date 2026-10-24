"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CirclePause, Play } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { useBotLive } from "./live-state";
import { TRUST, isTrustLevel } from "@/lib/trust";
import { roleBadge } from "@/lib/roles";
import { CallButton } from "@/components/call/CallPanel";
import { cn } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

// Six tabs (Diego, 2026-10-24): Memory holds the files too (the Library), Apps & channels holds the
// channels, and Settings holds the activity. The old addresses redirect (src/lib/bots/tab-links.ts).
const TABS = [
  { href: "", label: "Chat" },
  { href: "/meetings", label: "Meetings" },
  { href: "/memory", label: "Memory" },
  { href: "/tools", label: "Apps & channels" },
  { href: "/routines", label: "Routines" },
  { href: "/settings", label: "Settings" },
];

export function BotHeader({
  bot,
  brain,
  callable = false,
}: {
  bot: { id: string; name: string; avatar: string; color: string; trust: string; status: string; role?: string | null };
  brain: string;
  /** Voice calls are set up on this server (the voice server). */
  callable?: boolean;
}) {
  const live = useBotLive();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = React.useState(false);
  const activeTab = React.useRef<HTMLAnchorElement>(null);
  const base = `/app/bots/${bot.id}`;

  // On phones the tab bar scrolls sideways: keep the current tab in view.
  React.useEffect(() => {
    activeTab.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
  }, [pathname]);
  const trust = TRUST[isTrustLevel(bot.trust) ? bot.trust : "ask"];

  const togglePause = async () => {
    const pause = !live.paused;
    setBusy(true);
    live.setPaused(pause);
    try {
      const res = await fetch(`/api/bots/${bot.id}/pause`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: pause }),
      });
      if (!res.ok) throw new Error();
      toast(pause ? `${bot.name} is paused. Nothing will run until you resume.` : `${bot.name} is back!`);
      router.refresh();
    } catch {
      live.setPaused(!pause);
      toast.error("Couldn't change that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 pt-3 pb-2 sm:px-6">
        <div className="relative">
          <Avatar avatar={bot.avatar as AvatarId} color={bot.color as ColorwayId} size={56} mood={live.mood} />
          {live.pendingApprovals > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white ring-2 ring-background">
              {live.pendingApprovals}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-xl font-bold">{bot.name}</h1>
            <Badge tone="outline" className="hidden sm:inline-flex">{roleBadge(bot.role)}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn("size-2 rounded-full", live.paused ? "bg-muted-foreground" : "bg-success shadow-[0_0_0_3px] shadow-success/20")}
              />
              {live.paused ? "Paused" : live.activity ? `${live.activity}…` : "Online"}
            </span>
            <span aria-hidden className="hidden sm:inline">·</span>
            <span className="w-full truncate sm:w-auto">{brain}</span>
            <span aria-hidden className="hidden sm:inline">·</span>
            <Link href={`${base}/tools`} className="hidden hover:text-foreground sm:inline">
              {trust.emoji} {trust.name}
            </Link>
          </div>
        </div>
        {callable ? <CallButton bot={bot} disabled={live.paused} /> : null}
        <Button
          variant={live.paused ? "primary" : "danger-soft"}
          size="md"
          onClick={togglePause}
          loading={busy}
          className="shrink-0"
          aria-label={live.paused ? "Resume" : "Stop everything"}
        >
          {live.paused ? <Play /> : <CirclePause />}
          <span className="hidden sm:inline">{live.paused ? "Resume" : "Stop"}</span>
        </Button>
      </div>
      {/* On phones the tabs scroll sideways; soft edges hint that there's more. */}
      <nav
        className="no-scrollbar mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-3 [mask-image:linear-gradient(to_right,transparent,black_14px,black_calc(100%-14px),transparent)] sm:px-5 md:[mask-image:none]"
        aria-label="Bot sections"
      >
        {TABS.map((t) => {
          const href = `${base}${t.href}`;
          const active = t.href === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={t.label}
              href={href}
              ref={active ? activeTab : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative shrink-0 rounded-t-xl px-3 py-2.5 text-sm font-medium transition",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {active ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
