import { Hand, Lock, ReceiptText, Send, ShieldX, Zap } from "lucide-react";
import { getDb } from "@/lib/db";
import { getBotSetup, listDeliveries } from "@/lib/data";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTimeline } from "./ActivityTimeline";
import { DeliveriesList } from "./DeliveriesList";
import { appsFor, isActivityFilter, queryReceipts, receiptStats, toReceiptView } from "./receipts-query";
import { safeTimeZone } from "./time";

/** Settings › Activity: everything the bot has done (?filter=), and what it sent (?view=deliveries). */
export async function ActivityPanel({ botId, botName, timeZone, filter: wanted, view }: { botId: string; botName: string; timeZone: string | null; filter?: string; view?: string }) {
  const db = await getDb();
  const filter = isActivityFilter(wanted) ? wanted : "all";
  const [receipts, stats, deliveries, setup] = await Promise.all([
    queryReceipts(db, { botId }, { filter, limit: 30 }),
    receiptStats(db, botId),
    listDeliveries(db, botId, 50),
    getBotSetup(db, botId),
  ]);
  const timezone = safeTimeZone(timeZone);
  const serverNow = new Date().toISOString();
  const ownerAddresses = setup.channels.map((c) => c.ownerAddress).filter((a): a is string => Boolean(a));

  const tiles = [
    { label: "Actions done", value: stats.actions, icon: Zap, tone: "bg-primary-soft text-primary" },
    { label: "Messages sent", value: stats.messages, icon: Send, tone: "bg-success-soft text-success" },
    { label: "Times it asked you", value: stats.asked, icon: Hand, tone: "bg-warning-soft text-warning" },
    { label: "Blocked by your rules", value: stats.blocked, icon: ShieldX, tone: "bg-danger-soft text-danger" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary-soft via-card to-card p-5 shadow-soft sm:p-6">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:gap-x-4 sm:gap-y-1">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow sm:row-span-2 sm:size-11 sm:self-start">
            <ReceiptText className="size-5" aria-hidden />
          </span>
          <h3 className="font-display text-lg leading-tight font-semibold sm:self-end">Every action gets a receipt</h3>
          <div className="col-span-2 sm:col-span-1 sm:col-start-2">
            <p className="max-w-2xl text-sm text-muted-foreground">
              Actions, messages, approvals and setting changes are written down the moment they happen. Receipts can&apos;t be edited after the fact. They
              only go away if you delete {botName} or your account.
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <Lock className="size-3.5" aria-hidden /> Append-only, enforced by the database
            </p>
          </div>
        </div>
        <h4 id="activity-week" className="mt-5 mb-2 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          Last 7 days
        </h4>
        <ul aria-labelledby="activity-week" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {tiles.map((t) => (
            <li key={t.label} className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-3 sm:gap-3">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl sm:size-9 ${t.tone}`} aria-hidden>
                <t.icon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-display text-xl leading-none font-bold tabular-nums">{t.value.toLocaleString("en-US")}</span>
                <span className="mt-1 text-xs leading-tight text-muted-foreground">{t.label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Tabs defaultValue={view === "deliveries" ? "deliveries" : "timeline"} className="flex flex-col gap-4">
        <TabsList className="self-start">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="deliveries">
            Deliveries{deliveries.length ? <span className="ml-1.5 text-muted-foreground">{deliveries.length >= 50 ? "50+" : deliveries.length}</span> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="timeline">
          <ActivityTimeline
            botId={botId}
            botName={botName}
            timezone={timezone}
            serverNow={serverNow}
            initialFilter={filter}
            initial={{
              receipts: receipts.map(toReceiptView),
              nextBefore: receipts.length ? receipts[receipts.length - 1].createdAt.toISOString() : null,
              apps: appsFor(receipts),
            }}
          />
        </TabsContent>
        <TabsContent value="deliveries">
          <DeliveriesList
            botId={botId}
            botName={botName}
            timezone={timezone}
            serverNow={serverNow}
            ownerAddresses={ownerAddresses}
            initial={deliveries.map((d) => ({
              id: d.id,
              channelKind: d.channelKind,
              to: d.to,
              subject: d.subject,
              body: d.body,
              status: d.status,
              error: d.error,
              createdAt: d.createdAt.toISOString(),
            }))}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
