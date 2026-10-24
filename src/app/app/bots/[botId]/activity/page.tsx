import { redirect } from "next/navigation";
import { movedTabHref } from "@/lib/bots/tab-links";

/** Activity lives in Settings now. */
export default async function ActivityPage({ params, searchParams }: { params: Promise<{ botId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ botId }, query] = await Promise.all([params, searchParams]);
  redirect(movedTabHref(botId, "activity", query));
}
