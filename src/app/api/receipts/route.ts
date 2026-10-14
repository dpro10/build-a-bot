import { authed, json } from "@/lib/api";
import { listReceipts } from "@/lib/data";

export async function GET(req: Request) {
  const a = await authed();
  if (!a.ok) return a.res;
  const url = new URL(req.url);
  const before = url.searchParams.get("before");
  const receipts = await listReceipts(a.db, a.user.id, {
    botId: url.searchParams.get("botId") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    before: before ? new Date(before) : undefined,
    limit: Math.min(100, Number(url.searchParams.get("limit") ?? 40)),
  });
  return json({ receipts, nextBefore: receipts.length ? receipts[receipts.length - 1].createdAt : null });
}
