import { PLANS, PLAN_ORDER, type Plan } from "@/lib/billing/plans";
import { CHANNEL_BY_KIND, type ChannelKind } from "@/lib/channels/catalog";
import { INCLUDED_MODELS, PROVIDERS } from "@/lib/models/catalog";
import { TRUST, TRUST_LEVELS } from "@/lib/trust";
import { cn } from "@/lib/utils";
import { CheckDot } from "../ui";

type Cell = string | boolean;
type Row = { label: React.ReactNode; hint?: string; cells: Cell[] };
type Group = { title: string; rows: Row[] };

const n = (x: number) => x.toLocaleString("en-US");
const per = (pick: (p: Plan) => Cell) => PLAN_ORDER.map((id) => pick(PLANS[id]));

const TIERS = [
  { tier: "fast", name: "Fast" },
  { tier: "balanced", name: "Balanced" },
  { tier: "smart", name: "Smart" },
] as const;

const CHANNEL_ROWS: ChannelKind[] = ["web", "email", "telegram", "discord", "slack", "sms", "voice"];

function groups(): Group[] {
  return [
    {
      title: "Bots & messages",
      rows: [
        { label: "Bots", cells: per((p) => n(p.limits.bots)) },
        { label: "Messages on included models", hint: "per month", cells: per((p) => n(p.limits.includedMessages)) },
        { label: "Messages on your own key or plan", hint: "per month, fair use", cells: per((p) => n(p.limits.byoMessages)) },
        { label: "Web searches", hint: "per month", cells: per((p) => n(p.limits.searches)) },
      ],
    },
    {
      title: "Apps, routines & meetings",
      rows: [
        { label: "Apps per bot", hint: "built-ins don't count", cells: per((p) => n(p.limits.connectors)) },
        { label: "Routines", hint: "morning briefs, check-ins", cells: per((p) => n(p.limits.routines)) },
        { label: "Meeting notes", hint: "hours per month", cells: per((p) => (p.limits.meetingMinutes ? n(Math.round((p.limits.meetingMinutes / 60) * 10) / 10) : false)) },
      ],
    },
    {
      title: "Talk to it",
      rows: CHANNEL_ROWS.map((kind) => {
        const def = CHANNEL_BY_KIND[kind];
        if (kind === "sms") return { label: def.name, hint: "per month; a long text can count as two or more", cells: per((p) => (p.channels.includes(kind) ? `${n(p.limits.smsSegments)}` : false)) };
        if (kind === "voice") return { label: def.name, hint: "minutes per month", cells: per((p) => (p.channels.includes(kind) ? `${n(p.limits.voiceMinutes)}` : false)) };
        return { label: def.name, cells: per((p) => p.channels.includes(kind)) };
      }),
    },
    {
      title: "Trust levels",
      rows: TRUST_LEVELS.map((t) => ({
        label: (
          <>
            <span aria-hidden="true">{TRUST[t].emoji}</span> {TRUST[t].name}
          </>
        ),
        cells: per((p) => p.trust.includes(t)),
      })),
    },
    {
      title: "Brains",
      rows: [
        ...TIERS.map(({ tier, name }) => ({
          label: `${name} included models`,
          hint: INCLUDED_MODELS.filter((m) => m.tier === tier)
            .map((m) => m.label)
            .join(", "),
          cells: per((p) => p.includedModels.includes(tier)),
        })),
        { label: "Your own API key", hint: `${PROVIDERS.filter((p) => p.id !== "custom").length} providers or any OpenAI-compatible endpoint`, cells: per(() => true) },
        { label: "Your Claude or ChatGPT plan", hint: "through the Bridge, on your computer", cells: per(() => true) },
      ],
    },
  ];
}

function Value({ cell }: { cell: Cell }) {
  if (cell === true)
    return (
      <span className="inline-flex justify-center">
        <CheckDot tone="success" className="mt-0" />
        <span className="sr-only">Included</span>
      </span>
    );
  if (cell === false)
    return (
      <span className="text-muted-foreground/60">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not included</span>
      </span>
    );
  return <span className="font-semibold tabular-nums">{cell}</span>;
}

export function CompareTable() {
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <caption className="sr-only">Compare plans</caption>
        <colgroup>
          <col className="w-[40%] sm:w-[46%]" />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-background-2/60">
            <th scope="col" className="px-3 py-4 align-bottom text-xs font-semibold text-muted-foreground sm:px-6">
              Monthly price
            </th>
            {PLAN_ORDER.map((id) => {
              const p = PLANS[id];
              return (
                <th key={id} scope="col" className={cn("px-1.5 py-4 text-center sm:px-3", id === "plus" && "bg-primary-soft/60")}>
                  <div className="font-display text-base font-bold sm:text-lg">{p.name}</div>
                  <div className="text-xs font-medium text-muted-foreground">{p.priceMonthly ? `$${p.priceMonthly}/mo` : "$0"}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        {groups().map((g) => (
          <tbody key={g.title}>
            <tr>
              <th colSpan={4} scope="colgroup" className="bg-background-2/40 px-3 pt-5 pb-2 text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase sm:px-6">
                {g.title}
              </th>
            </tr>
            {g.rows.map((row, i) => (
              <tr key={i} className="border-t border-border/70">
                <th scope="row" className="px-3 py-3 align-middle font-medium sm:px-6">
                  <div className="leading-snug">{row.label}</div>
                  {row.hint ? <div className="mt-0.5 text-xs leading-snug font-normal text-muted-foreground">{row.hint}</div> : null}
                </th>
                {row.cells.map((cell, j) => (
                  <td key={j} className={cn("px-1.5 py-3 text-center align-middle sm:px-3", PLAN_ORDER[j] === "plus" && "bg-primary-soft/40")}>
                    <Value cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
