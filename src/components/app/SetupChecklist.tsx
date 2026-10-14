import Link from "next/link";
import { ArrowRight, CircleDashed } from "lucide-react";
import { getDb } from "@/lib/db";
import { getUser, isAnonymous } from "@/lib/auth/session";
import { getBotSetup, getOwnedBot, listBridgeDevices } from "@/lib/data";
import { CHANNEL_BY_KIND, channelUsable, isChannelKind } from "@/lib/channels/catalog";
import { connectionName } from "@/lib/connectors";
import { demoMode, live } from "@/lib/env";
import { planGate } from "@/components/bot/channels/model";

const MAX_CHIPS = 5;

/** What's left to finish for this bot — one quiet line above the chat. */
export async function SetupChecklist({ botId }: { botId: string }) {
  const user = await getUser();
  if (!user) return null;
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) return null;
  const { channels, connections } = await getBotSetup(db, botId);
  const todo: { label: string; href: string }[] = [];

  if (bot.brain.kind === "subscription") {
    const devices = await listBridgeDevices(db, user.id);
    if (!devices.some((d) => !d.revokedAt)) todo.push({ label: "Pair your computer (Bridge)", href: "/app/bridge" });
  }
  for (const c of channels) {
    if (c.kind === "web" || c.status === "active" || c.status === "disabled" || c.status === "waitlist" || !isChannelKind(c.kind)) continue;
    // Only what can be finished here: not a channel that's coming soon, or one their plan doesn't include.
    const def = CHANNEL_BY_KIND[c.kind];
    if (!channelUsable(def, demoMode, live) || planGate(c.kind, user.plan, demoMode)) continue;
    todo.push({ label: `Set up ${def.name}`, href: `/app/bots/${botId}/channels#${c.kind}` });
  }
  for (const c of connections) {
    if (c.status !== "needs_auth" && c.status !== "error") continue;
    todo.push({ label: `Sign in to ${connectionName(c)}`, href: `/app/bots/${botId}/tools#${c.connectorId}` });
  }
  // Saving the account always makes the cut: without it, the bot is lost with this browser.
  const shown = todo.slice(0, isAnonymous(user) ? MAX_CHIPS - 1 : MAX_CHIPS);
  if (isAnonymous(user)) shown.push({ label: "Save your account", href: `/login?next=/app/bots/${botId}` });
  if (!shown.length) return null;

  return (
    <div className="border-b border-border bg-primary-soft/50">
      <div className="no-scrollbar mx-auto flex w-full max-w-5xl items-center gap-2 overflow-x-auto px-4 py-2 sm:px-6">
        <span className="shrink-0 text-xs font-bold tracking-wide text-primary uppercase">Finish setup</span>
        {shown.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-medium text-foreground shadow-soft ring-1 ring-border transition hover:ring-primary/40"
          >
            <CircleDashed className="size-3.5 text-primary" />
            {t.label}
            <ArrowRight className="size-3 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
