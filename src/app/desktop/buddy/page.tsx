import type { Metadata } from "next";
import { AVATAR_IDS, COLORWAY_IDS, type AvatarId, type ColorwayId } from "@/lib/avatars";
import { MEETING_APPS, isMeetingApp } from "@/lib/meetings/apps";
import type { BuddyPhase, BuddyState } from "@/components/meetings/desktop-api";
import { BuddySurface } from "./BuddySurface";

export const metadata: Metadata = { title: "Meeting notes", robots: { index: false, follow: false } };

const PHASES: BuddyPhase[] = ["asking", "listening", "paused", "saving", "done", "error"];

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Preview state from the URL: ?phase=listening&name=Inky&avatar=otto&color=grape&app=zoom&elapsed=754&level=0.6&caption=… */
function initialState(q: Search): BuddyState {
  const phase = PHASES.find((p) => p === one(q.phase)) ?? "asking";
  const avatar = (AVATAR_IDS as readonly string[]).includes(one(q.avatar) ?? "") ? (one(q.avatar) as AvatarId) : "otto";
  const color = (COLORWAY_IDS as readonly string[]).includes(one(q.color) ?? "") ? (one(q.color) as ColorwayId) : "grape";
  const appId = one(q.app);
  const caption = one(q.caption);
  return {
    phase,
    bot: { name: (one(q.name) ?? "Inky").slice(0, 32), avatar, color },
    app: isMeetingApp(appId) ? { id: appId, name: MEETING_APPS[appId].name } : undefined,
    elapsedMs: Number(one(q.elapsed) ?? 0) * 1000 || 0,
    runningSince: null,
    level: Math.min(1, Math.max(0, Number(one(q.level) ?? 0.45) || 0)),
    caption: caption ? { speaker: caption.split(":")[0] || "Others", text: caption.split(":").slice(1).join(":").trim() || caption, at: Date.now() + 3_600_000 } : null,
    message: one(q.message),
    minutesLeft: one(q.left) ? Number(one(q.left)) : null,
  };
}

export default async function DesktopBuddyPage({ searchParams }: { searchParams: Promise<Search> }) {
  const state = initialState(await searchParams);
  return (
    <>
      {/* Transparent from the first paint, before any script runs. */}
      <style>{`html,body{background:transparent!important;overflow:hidden}`}</style>
      <BuddySurface initial={state} />
    </>
  );
}
