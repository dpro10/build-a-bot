import Link from "next/link";
import { ArrowRight, CircleDashed } from "lucide-react";
import { getDb } from "@/lib/db";
import { getUser, isAnonymous } from "@/lib/auth/session";
import { getBotSetup, getOwnedBot, listBridgeDevices } from "@/lib/data";
import { CHANNEL_BY_KIND, type ChannelKind } from "@/lib/channels/catalog";
import { getConnector } from "@/lib/connectors";

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
    if (c.kind === "web" || c.status === "active" || c.status === "disabled" || c.status === "waitlist") continue;
    const def = CHANNEL_BY_KIND[c.kind as ChannelKind];
    if (def) todo.push({ label: `Set up ${def.name}`, href: `/app/bots/${botId}/channels#${c.kind}` });
  }
  for (const c of connections) {
    if (c.status !== "needs_auth" && c.status !== "error") continue;
    const def = getConnector(c.connectorId);
    todo.push({ label: `Sign in to ${def?.name ?? c.connectorId}`, href: `/app/bots/${botId}/tools#${c.connectorId}` });
  }
  if (isAnonymous(user)) todo.push({ label: "Save your account", href: `/login?next=/app/bots/${botId}` });
  if (!todo.length) return null;

  return (
    <div className="border-b border-border bg-primary-soft/50">
      <div className="no-scrollbar mx-auto flex w-full max-w-5xl items-center gap-2 overflow-x-auto px-4 py-2 sm:px-6">
        <span className="shrink-0 text-xs font-bold tracking-wide text-primary uppercase">Finish setup</span>
        {todo.slice(0, 5).map((t) => (
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
