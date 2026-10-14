import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import type { Approval } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { listApprovals, listBots } from "@/lib/data";
import { getConnector } from "@/lib/connectors";
import { BrandTile } from "@/components/brand/icons";
import { ApprovalsBoard } from "@/components/account/ApprovalsBoard";
import { readResult, type ApprovalBot, type ApprovalField, type ApprovalItem } from "@/components/account/approvals-shared";
import { PageContainer, PageHeader } from "@/components/account/PageHeader";
import { TRUST, isTrustLevel } from "@/lib/trust";
import { truncate } from "@/lib/utils";
import { readWebFormPreview } from "@/lib/web-actions/types";
import type { AvatarId, ColorwayId } from "@/lib/avatars";

export const metadata: Metadata = { title: "Approvals" };

const FIELD_LABELS: Record<string, string> = {
  to: "To",
  cc: "Cc",
  bcc: "Bcc",
  subject: "Subject",
  body: "Message",
  text: "Message",
  message: "Message",
  content: "Content",
  title: "Title",
  at: "When",
  when: "When",
  start: "Starts",
  end: "Ends",
  amount: "Amount",
  url: "Link",
  repo: "Repository",
  channel: "Channel",
};

/** Who/what first, the message itself last (jsonb doesn't keep the tool's key order). */
const FIELD_ORDER = ["to", "cc", "bcc", "channel", "repo", "subject", "title", "name", "at", "when", "start", "end", "amount", "url"];
const LAST = ["body", "text", "message", "content"];
const rank = (key: string) => (FIELD_ORDER.includes(key) ? FIELD_ORDER.indexOf(key) : LAST.includes(key) ? 100 + LAST.indexOf(key) : 50);

/** Exactly what will run, as label/value rows. */
function fieldsFromArgs(args: Record<string, unknown> | null | undefined): ApprovalField[] {
  const entries = Object.entries(args ?? {}).sort(([a], [b]) => rank(a) - rank(b));
  const fields: ApprovalField[] = [];
  for (const [key, raw] of entries) {
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Array.isArray(raw)
      ? raw.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")
      : typeof raw === "object"
        ? JSON.stringify(raw, null, 2)
        : String(raw);
    const words = key.replace(/_/g, " ");
    const label = FIELD_LABELS[key] ?? words.charAt(0).toUpperCase() + words.slice(1);
    fields.push({ label, value: truncate(value, 2000), long: value.length > 90 || value.includes("\n") });
  }
  // Long text sinks to the bottom so the short facts stay scannable.
  return fields.sort((a, b) => Number(a.long) - Number(b.long));
}

function toItem(a: Approval, now: number): ApprovalItem {
  const app = a.connectorId ? getConnector(a.connectorId) : undefined;
  return {
    id: a.id,
    botId: a.botId,
    title: a.title,
    risk: a.risk,
    reasons: a.reasons ?? [],
    status: a.status === "pending" && a.expiresAt.getTime() <= now ? "expired" : a.status,
    createdAt: a.createdAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decidedVia: a.decidedVia,
    // A web form's preview replaces the raw tool arguments (session ids mean nothing to people).
    webForm: readWebFormPreview(a.args),
    fields: readWebFormPreview(a.args) ? [] : fieldsFromArgs(a.args),
    result: readResult(a.result),
    app: app ? { name: app.name, icon: <BrandTile icon={app.icon} size={40} variant="soft" /> } : null,
  };
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ focus?: string | string[] }> }) {
  const user = await requireUser("/app/approvals");
  const db = await getDb();
  const [bots, pending, recent, sp] = await Promise.all([
    listBots(db, user.id),
    listApprovals(db, user.id, { status: "pending", limit: 200 }),
    listApprovals(db, user.id, { limit: 80 }),
    searchParams,
  ]);
  const now = Date.now();
  const focus = typeof sp.focus === "string" ? sp.focus : null;

  const botViews: ApprovalBot[] = bots.map(({ bot }) => ({
    id: bot.id,
    name: bot.name,
    avatar: bot.avatar as AvatarId,
    color: bot.color as ColorwayId,
    paused: bot.status === "paused",
    trustName: TRUST[isTrustLevel(bot.trust) ? bot.trust : "ask"].name,
  }));
  const pendingIds = new Set(pending.map((a) => a.id));
  const history = recent.filter((a) => !pendingIds.has(a.id) && !(a.status === "pending" && a.expiresAt.getTime() > now));

  return (
    <PageContainer narrow>
      <PageHeader title="Approvals" description="Everything your bots are waiting on you for. Nothing happens until you tap." />
      <ApprovalsBoard
        bots={botViews}
        pending={pending.map((a) => toItem(a, now))}
        history={history.map((a) => toItem(a, now))}
        focusId={focus}
        serverNow={now}
      />
    </PageContainer>
  );
}
