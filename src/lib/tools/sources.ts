/**
 * Pages a bot's lookups returned, from their receipts (agent/run.ts records each lookup's sources).
 * A study set may cite only these, so a link on a card is always a page the bot really looked at,
 * never one a model made up.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db";

/** A link in a form that compares: http(s) only, host in lowercase, no fragment or trailing slash. */
export function sameLink(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** The pages the bot's lookups returned in the last `hours`, as sameLink() forms. */
export async function pagesReadRecently(db: Db, botId: string, hours = 24): Promise<Set<string>> {
  const rows = await db
    .select({ detail: schema.receipts.detail })
    .from(schema.receipts)
    .where(
      and(
        eq(schema.receipts.botId, botId),
        eq(schema.receipts.kind, "tool"),
        gt(schema.receipts.createdAt, new Date(Date.now() - hours * 3_600_000)),
        sql`${schema.receipts.detail}->'sources' is not null`,
      ),
    )
    .orderBy(desc(schema.receipts.createdAt))
    .limit(300);
  const pages = new Set<string>();
  for (const { detail } of rows) {
    for (const url of Array.isArray(detail.sources) ? detail.sources : []) {
      const link = typeof url === "string" ? sameLink(url) : null;
      if (link) pages.add(link);
    }
  }
  return pages;
}
