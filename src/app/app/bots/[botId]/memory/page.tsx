import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getOwnedBot, listContacts, listMemories, listNotes } from "@/lib/data";
import { MemoryView } from "@/components/bot/memory/MemoryView";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = { title: "Memory" };

export default async function MemoryPage({ params, searchParams }: { params: Promise<{ botId: string }>; searchParams: Promise<{ tab?: string; import?: string }> }) {
  const { botId } = await params;
  const { tab, import: openImport } = await searchParams;
  const user = await requireUser(`/app/bots/${botId}/memory`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
  const [memories, notes, contacts] = await Promise.all([listMemories(db, botId), listNotes(db, botId), listContacts(db, botId)]);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <MemoryView
          botId={botId}
          botName={bot.name}
          avatar={bot.avatar as AvatarId}
          color={bot.color as ColorwayId}
          trust={bot.trust}
          serverNow={new Date().toISOString()}
          initialTab={tab === "notes" || tab === "people" ? tab : "memories"}
          initialImport={openImport === "1"}
          initial={{
            memories: memories.map((m) => ({ id: m.id, text: m.text, source: m.source, pinned: m.pinned, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() })),
            notes: notes.map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() })),
            contacts: contacts.map((c) => ({
              id: c.id,
              kind: c.kind,
              address: c.address,
              name: c.name,
              approvedAt: c.approvedAt?.toISOString() ?? null,
              createdAt: c.createdAt.toISOString(),
            })),
          }}
        />
      </div>
    </div>
  );
}
