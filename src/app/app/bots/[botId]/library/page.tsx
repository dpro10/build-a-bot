import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getOwnedBot } from "@/lib/data";
import { available } from "@/lib/env";
import { fileView, listFiles, ownerUsage } from "@/lib/library";
import { MAX_OWNER_BYTES } from "@/lib/library/limits";
import { dueCards, listStudySets, summarize } from "@/lib/library/study";
import { LibraryView } from "@/components/library/LibraryView";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const user = await requireUser(`/app/bots/${botId}/library`);
  const db = await getDb();
  const bot = await getOwnedBot(db, user.id, botId);
  if (!bot) notFound();
  const [files, used, sets] = await Promise.all([listFiles(db, botId), ownerUsage(db, user.id), listStudySets(db, botId)]);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24 sm:px-6">
        <LibraryView
          botId={botId}
          bot={{ name: bot.name, avatar: bot.avatar as AvatarId, color: bot.color as ColorwayId }}
          canAdd={available("library")}
          initialFiles={files.map(fileView)}
          initialUsage={{ bytes: used.bytes, maxBytes: MAX_OWNER_BYTES }}
          initialSets={sets.map((s) => ({ ...summarize(s), due: dueCards(s).length, lastScore: s.progress?.attempts?.at(-1) ?? null, createdAt: s.createdAt.toISOString() }))}
        />
      </div>
    </div>
  );
}
