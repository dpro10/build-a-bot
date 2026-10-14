"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Plus, Radio, ShieldCheck } from "lucide-react";
import { CHANNELS, type ChannelKind } from "@/lib/channels/catalog";
import { BrandTile } from "@/components/brand/icons";
import { channelIcon } from "@/components/catalog/channel-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toaster";
import { api, ApiError } from "@/lib/client/api";
import { Note, Section } from "@/components/bot/tools/Section";
import { useHashTarget } from "@/components/bot/tools/use-hash-target";
import { AddChannelGrid } from "./AddChannelGrid";
import { ChannelCard } from "./ChannelCard";
import type { ActionData, ChannelCtx } from "./context";
import { channelDef, isWaitingForOwner, planGate, sortChannels, toChannelView, type ChannelView } from "./model";

type Row = Parameters<typeof toChannelView>[0];

export type ChannelsProps = {
  bot: { id: string; name: string };
  channels: ChannelView[];
  planId: string;
  demo: boolean;
  /** Paid plans can be bought here (Stripe, or switched freely in demo mode). */
  plansOnSale: boolean;
  ownerEmail: string | null;
  botEmail: string | null;
  /** The integration behind each channel is usable here (live, or simulated in demo mode). */
  availability: Partial<Record<ChannelKind, boolean>>;
  /** Channel kinds the owner already joined the waitlist for. */
  joined: ChannelKind[];
};

const POLL_MS = 4000;
const EXPECT_MS = 4 * 60_000;

export function ChannelsView({ bot, channels: initial, planId, demo, plansOnSale, ownerEmail, botEmail, availability, joined: initialJoined }: ChannelsProps) {
  const router = useRouter();
  const [channels, setChannels] = React.useState<ChannelView[]>(() => sortChannels(initial));
  const [joined, setJoined] = React.useState<Set<ChannelKind>>(() => new Set(initialJoined));
  const [expecting, setExpecting] = React.useState<Partial<Record<ChannelKind, number>>>({});
  const { target, focus } = useHashTarget();
  const latest = React.useRef(channels);
  latest.current = channels;
  const expectingRef = React.useRef(expecting);
  expectingRef.current = expecting;

  const refresh = React.useCallback(async () => {
    try {
      const res = await api<{ channels: Row[] }>(`/api/bots/${bot.id}/channels`);
      const next = sortChannels(res.channels.map(toChannelView).filter((c): c is ChannelView => Boolean(c)));
      // Something finished outside the app (Telegram, Slack, Discord): say so.
      for (const ch of next) {
        const before = latest.current.find((c) => c.kind === ch.kind);
        if (before && before.status !== "active" && ch.status === "active" && !ch.simulated && (before.status === "pending" || isWaitingForOwner(before) || expectingRef.current[ch.kind])) {
          toast.success(`${channelDef(ch.kind).name} is connected! Say hi to ${bot.name} there.`);
        }
        if (ch.status === "active") {
          setExpecting((e) => {
            if (!e[ch.kind]) return e;
            const copy = { ...e };
            delete copy[ch.kind];
            return copy;
          });
        }
      }
      setChannels(next);
    } catch {
      /* keep what we have */
    }
  }, [bot.id, bot.name]);

  const run = React.useCallback(
    async (kind: ChannelKind, action: string, payload?: Record<string, unknown>): Promise<ActionData | null> => {
      try {
        return await api<ActionData>(`/api/bots/${bot.id}/channels`, { body: { kind, action, ...(payload ? { payload } : {}) } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong. Try again.";
        if (err instanceof ApiError && err.status === 402 && plansOnSale) {
          toast.error(message, { action: { label: "See plans", onClick: () => router.push("/app/billing") } });
        } else {
          toast.error(message);
        }
        return null;
      }
    },
    [bot.id, router, plansOnSale],
  );

  const expect = React.useCallback((kind: ChannelKind) => setExpecting((e) => ({ ...e, [kind]: Date.now() + EXPECT_MS })), []);

  // Poll while something outside the app is about to finish a setup.
  const waiting = channels.some((c) => isWaitingForOwner(c)) || Object.values(expecting).some((until) => (until ?? 0) > Date.now());
  React.useEffect(() => {
    if (!waiting) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
      setExpecting((e) => {
        const now = Date.now();
        const live = Object.fromEntries(Object.entries(e).filter(([, until]) => (until ?? 0) > now));
        return Object.keys(live).length === Object.keys(e).length ? e : live;
      });
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [waiting, refresh]);

  const ctx: ChannelCtx = React.useMemo(
    () => ({ botId: bot.id, botName: bot.name, demo, plansOnSale, ownerEmail, botEmail, run, refresh, expect }),
    [bot.id, bot.name, demo, plansOnSale, ownerEmail, botEmail, run, refresh, expect],
  );

  const join = async (kind: ChannelKind, email?: string) => {
    const data = await run(kind, "waitlist", email ? { email } : undefined);
    if (!data) return false;
    setJoined((s) => new Set(s).add(kind));
    toast.success(typeof data.message === "string" ? `${data.message} We'll email you when it's ready.` : "You're on the list.");
    return true;
  };

  const add = async (kind: ChannelKind) => {
    const data = await run(kind, "enable");
    if (!data) return;
    await refresh();
    toast.success(
      data.reusedPhone
        ? `${channelDef(kind).name} is on, using the number you already verified.`
        : data.status === "active"
          ? `${channelDef(kind).name} is on.`
          : `${channelDef(kind).name} added. Follow the steps to finish.`,
    );
    setTimeout(() => focus(kind, { block: "start" }), 120);
  };

  const have = new Set(channels.map((c) => c.kind));
  const planGates: Partial<Record<ChannelKind, string>> = {};
  for (const c of CHANNELS) {
    const gate = planGate(c.kind, planId, demo);
    if (gate) planGates[c.kind] = gate;
  }
  // Ready to add first, then plan upgrades, waitlists, and what's coming.
  const rank = (k: ChannelKind) => {
    const def = channelDef(k);
    if (def.availability === "soon" || (def.availability !== "waitlist" && availability[k] === false)) return 3;
    if (def.availability === "waitlist") return 2;
    return planGates[k] ? 1 : 0;
  };
  const toAdd = CHANNELS.map((c) => c.kind)
    .filter((k) => !have.has(k))
    .sort((a, b) => rank(a) - rank(b));
  const liveOn = channels.filter((c) => c.kind === "web" || c.status === "active");
  const simulatedCount = channels.filter((c) => c.simulated && c.status === "active").length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Channels</h1>
            <p className="max-w-2xl text-muted-foreground">Where you and {bot.name} talk. Turn on as many as you like; web chat is always on.</p>
          </div>
          <div className="flex items-center gap-2.5 rounded-full border border-border bg-card py-1.5 pr-3.5 pl-1.5 shadow-soft">
            <div className="flex -space-x-1.5">
              {liveOn.slice(0, 6).map((c) => {
                const def = channelDef(c.kind);
                return (
                  <Tooltip key={c.kind} content={`${def.name}${c.simulated ? " (simulated)" : ""}`}>
                    <span className="inline-flex rounded-[30%] ring-2 ring-card">
                      <BrandTile icon={channelIcon(def)} size={26} label={def.name} />
                    </span>
                  </Tooltip>
                );
              })}
            </div>
            <span className="text-sm font-semibold whitespace-nowrap">
              Live on {liveOn.length} {liveOn.length === 1 ? "channel" : "channels"}
            </span>
          </div>
        </header>

        <Section id="your-channels" title="Your channels" icon={<Radio />} description="Finish setup where it's needed, send yourself a test, or turn one off anytime.">
          {simulatedCount ? (
            <Note tone="primary" icon={<FlaskConical />} className="mb-4">
              <strong className="font-semibold">Simulated</strong> channels work here in demo mode, but nothing is really sent: codes show on screen, and test messages land in Activity so you can see exactly what would go out.
            </Note>
          ) : null}
          <div className="flex flex-col gap-4">
            {channels.map((ch) => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                ctx={ctx}
                planBadge={ch.kind === "web" ? null : !demo && (ch.locked || planGates[ch.kind]) ? (planGates[ch.kind] ?? (channelDef(ch.kind).minPlan === "pro" ? "Pro" : "Plus")) : null}
                available={ch.kind === "web" || availability[ch.kind] !== false}
                highlighted={target === ch.kind}
                joined={joined.has(ch.kind)}
                onJoin={(email) => join(ch.kind, email)}
              />
            ))}
          </div>
        </Section>

        {toAdd.length ? (
          <Section id="add-channel" title="Add a channel" icon={<Plus />} description="More ways to reach it. Each one proves it's really you before it takes your instructions.">
            <AddChannelGrid
              kinds={toAdd}
              planGates={planGates}
              plansOnSale={plansOnSale}
              availability={availability}
              joined={joined}
              ownerEmail={ownerEmail}
              onAdd={add}
              onJoin={join}
            />
          </Section>
        ) : null}

        <div className="flex flex-col gap-2 rounded-3xl border border-border bg-background-2/60 p-4 text-[13px] text-muted-foreground sm:flex-row sm:items-start sm:gap-3 sm:p-5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
            <ShieldCheck className="size-4" />
          </span>
          <div className="flex flex-col gap-1">
            <p>
              <strong className="font-semibold text-foreground">It always says it&apos;s an AI.</strong> Messages {bot.name} sends to other people are labeled as coming from your AI assistant, and
              it never pretends to be you or a person.
            </p>
            <p>
              Only your verified accounts can give it instructions. Say <span className="font-mono text-foreground">stop</span> on any channel (or text{" "}
              <span className="font-mono text-foreground">PAUSE</span>) and it stops everything right away.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
