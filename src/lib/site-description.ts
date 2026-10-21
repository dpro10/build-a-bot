/**
 * The site's description for search results, link previews and the web app manifest. Like the
 * landing page's hero, it names only the channels that work here, and it says what thinks: NVIDIA
 * Nemotron and other open models on Nebius. Server-only (reads env).
 */
import { talkChannels } from "@/lib/channels/catalog";
import { demoMode, live } from "@/lib/env";
import { joinList } from "@/lib/utils";

const CHAT_APPS = new Set(["Telegram", "Discord", "Slack"]);
const VERBS: Record<string, string> = { calls: "call", texts: "text", email: "email" };

export function siteDescription(): string {
  const { ready } = talkChannels(demoMode, live);
  const where = joinList(["on the web", ...ready.filter((w) => CHAT_APPS.has(w))], "or");
  const direct = ready.flatMap((w) => (VERBS[w] ? [VERBS[w]] : []));
  return `Your own AI agent in about a minute: pick a face, give it a brain (NVIDIA Nemotron and other open models on Nebius, at cost, or your own API key) and your apps, and talk to it ${where}${direct.length ? `, or ${joinList(direct, "or")} it` : ""}.`;
}
