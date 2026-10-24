import { redirect } from "next/navigation";
import { movedTabHref } from "@/lib/bots/tab-links";

/** The Library is Memory › Files now. */
export default async function LibraryPage({ params, searchParams }: { params: Promise<{ botId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ botId }, query] = await Promise.all([params, searchParams]);
  redirect(movedTabHref(botId, "library", query));
}
