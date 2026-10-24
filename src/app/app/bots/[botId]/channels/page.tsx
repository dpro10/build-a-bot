import { redirect } from "next/navigation";
import { movedTabHref } from "@/lib/bots/tab-links";

/** Channels lives in Apps & channels now. */
export default async function ChannelsPage({ params, searchParams }: { params: Promise<{ botId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ botId }, query] = await Promise.all([params, searchParams]);
  redirect(movedTabHref(botId, "channels", query));
}
