import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getOwnedBot, listContacts, listMemories, listNotes } from "@/lib/data";
import { available } from "@/lib/env";
import { fileView, listFiles, ownerUsage } from "@/lib/library";
import { MAX_OWNER_BYTES } from "@/lib/library/limits";
import { dueCards, listStudySets, summarize } from "@/lib/library/study";
import { MemoryView, type MemoryTab } from "@/components/bot/memory/MemoryView";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = { title: "Memory" };

const TABS: MemoryTab[] = ["memories", "files", "notes", "people"];

/** Memory: what the bot remembers, the files it was given (?tab=files), its notes and the people it knows. */
export default async function MemoryPage({ params, searchParams }: { params: Promise<{ botId: string }>; searchParams: Promise<{ tab?: string; import?: string }> }) {
  const { botId } = await params;
  const { tab, import: openImport } = await searchParams;
  const user = await requireUser(`/app/bots/${botId}/memory`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
  const [memories, notes, contacts, files, used, sets] = await Promise.all([
    listMemories(db, botId),
    listNotes(db, botId),
    listContacts(db, botId),
    listFiles(db, botId),
    ownerUsage(db, user.id),
    listStudySets(db, botId),
  ]);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24 sm:px-6">
        <MemoryView
          botId={botId}
          botName={bot.name}
          avatar={bot.avatar as AvatarId}
          color={bot.color as ColorwayId}
          role={bot.role ?? null}
          trust={bot.trust}
          serverNow={new Date().toISOString()}
          initialTab={TABS.find((t) => t === tab) ?? "memories"}
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
          library={{
            canAdd: available("library"),
            initialFiles: files.map(fileView),
            initialUsage: { bytes: used.bytes, maxBytes: MAX_OWNER_BYTES },
            initialSets: sets.map((s) => ({ ...summarize(s), due: dueCards(s).length, lastScore: s.progress?.attempts?.at(-1) ?? null, createdAt: s.createdAt.toISOString() })),
          }}
        />
      </div>
    </div>
  );
}
