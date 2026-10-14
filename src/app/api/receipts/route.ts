import { apiError, authed, json } from "@/lib/api";
import { getOwnedBot } from "@/lib/data";
import { appsFor, isActivityFilter, queryReceipts } from "@/components/bot/activity/receipts-query";

/**
 * GET /api/receipts?botId=&kind=&filter=actions|messages|approvals|settings&before=ISO&limit=
 * Newest first. Page with `before` = the previous page's `nextBefore`.
 * `apps` names and icons the apps the returned receipts mention.
 */
export async function GET(req: Request) {
  const a = await authed();
  if (!a.ok) return a.res;
  const url = new URL(req.url);
  const before = url.searchParams.get("before");
  const filter = url.searchParams.get("filter");
  const limit = Number(url.searchParams.get("limit") ?? 40);
  const botId = url.searchParams.get("botId");
  if (botId && !(await getOwnedBot(a.db, a.user.id, botId))) return apiError(404, "Bot not found");
  const receipts = await queryReceipts(a.db, botId ? { botId } : { ownerId: a.user.id }, {
    kind: url.searchParams.get("kind") ?? undefined,
    filter: isActivityFilter(filter) ? filter : undefined,
    before: before ? new Date(before) : undefined,
    limit: Number.isFinite(limit) ? limit : 40,
  });
  return json({ receipts, nextBefore: receipts.length ? receipts[receipts.length - 1].createdAt : null, apps: appsFor(receipts) });
}
