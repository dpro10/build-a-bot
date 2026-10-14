import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { listBots } from "@/lib/data";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { plainPreview } from "@/components/app/preview";
import { TRUST, isTrustLevel } from "@/lib/trust";
import { relativeTime } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export default async function BotsHome({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const user = await requireUser("/app");
  const db = await getDb();
  const bots = await listBots(db, user.id);
  const { all } = await searchParams;
  if (bots.length === 0) redirect("/build");
  if (bots.length === 1 && !all) redirect(`/app/bots/${bots[0].bot.id}`);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Your bots</h1>
          <p className="text-muted-foreground">Everyone you&apos;ve built, and what they&apos;re up to.</p>
        </div>
        <Button asChild>
          <Link href="/build">
            <Plus /> New bot
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {bots.map(({ bot, pendingApprovals, lastMessage }) => (
          <Link
            key={bot.id}
            href={`/app/bots/${bot.id}`}
            className="group flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div className="flex items-center gap-4">
              <Avatar avatar={bot.avatar as AvatarId} color={bot.color as ColorwayId} size={72} mood={bot.status === "paused" ? "sleeping" : pendingApprovals ? "alert" : "idle"} />
              <div className="min-w-0">
                <div className="font-display text-xl font-semibold">{bot.name}</div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge tone={bot.status === "paused" ? "neutral" : "success"}>{bot.status === "paused" ? "Paused" : "Active"}</Badge>
                  <Badge tone="outline">{TRUST[isTrustLevel(bot.trust) ? bot.trust : "ask"].name}</Badge>
                  {pendingApprovals ? <Badge tone="danger">{pendingApprovals} to approve</Badge> : null}
                </div>
              </div>
            </div>
            <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{lastMessage ? plainPreview(lastMessage.text, 160) : "No messages yet. Say hi!"}</p>
            <div className="text-xs text-muted-foreground">{bot.lastActiveAt ? `Active ${relativeTime(bot.lastActiveAt)}` : `Born ${relativeTime(bot.createdAt)}`}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
