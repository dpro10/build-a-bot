"use client";
import * as React from "react";
import { Check, Gauge, MoonStar, RotateCcw, Wallet } from "lucide-react";
import { TRUST, type TrustLevel } from "@/lib/trust";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { LimitsView } from "./model";

type Draft = { daily: string; spend: string; quietOn: boolean; start: string; end: string };

function toDraft(limits: LimitsView, trust: TrustLevel): Draft {
  return {
    daily: String(limits.dailyActions ?? TRUST[trust].dailyActions),
    spend: limits.spendCapUsd ? String(limits.spendCapUsd) : "",
    quietOn: Boolean(limits.quietHours),
    start: limits.quietHours?.start ?? "22:00",
    end: limits.quietHours?.end ?? "07:00",
  };
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: m ? "2-digit" : undefined });
}

export function LimitsCard({
  botId,
  botName,
  trust,
  limits,
  timezone,
  onSaved,
}: {
  botId: string;
  botName: string;
  trust: TrustLevel;
  limits: LimitsView;
  timezone: string;
  onSaved: (limits: LimitsView) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(limits, trust));
  const [saving, setSaving] = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);
  const baseline = React.useMemo(() => toDraft(limits, trust), [limits, trust]);
  const trustDefault = TRUST[trust].dailyActions;

  // Follow the trust level's default while the owner hasn't picked their own number.
  const prevBaseline = React.useRef(baseline);
  React.useEffect(() => {
    const prev = prevBaseline.current;
    prevBaseline.current = baseline;
    setDraft((d) => (limits.dailyActions === undefined && d.daily === prev.daily ? { ...d, daily: baseline.daily } : d));
  }, [baseline, limits.dailyActions]);

  const dailyNum = Number(draft.daily);
  const dailyValid = draft.daily.trim() !== "" && Number.isInteger(dailyNum) && dailyNum >= 0 && dailyNum <= 1000;
  const spendNum = draft.spend.trim() === "" ? 0 : Number(draft.spend);
  const spendValid = Number.isFinite(spendNum) && spendNum >= 0 && spendNum <= 10000;
  const timesValid = !draft.quietOn || (/^\d{2}:\d{2}$/.test(draft.start) && /^\d{2}:\d{2}$/.test(draft.end) && draft.start !== draft.end);
  const valid = dailyValid && spendValid && timesValid;

  const dirty =
    draft.daily !== baseline.daily ||
    (draft.spend.trim() === "" ? 0 : Number(draft.spend)) !== (baseline.spend === "" ? 0 : Number(baseline.spend)) ||
    draft.quietOn !== baseline.quietOn ||
    (draft.quietOn && (draft.start !== baseline.start || draft.end !== baseline.end));

  const set = (patch: Partial<Draft>) => {
    setJustSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid || !dirty) return;
    setSaving(true);
    const body: Record<string, unknown> = {
      spendCapUsd: Math.round(spendNum * 100) / 100,
      quietHours: draft.quietOn ? { start: draft.start, end: draft.end } : null,
    };
    // Only pin the daily number when the owner chose one (otherwise it follows the trust level).
    if (limits.dailyActions !== undefined || dailyNum !== trustDefault) body.dailyActions = dailyNum;
    try {
      const res = await api<{ bot: { limits: LimitsView } }>(`/api/bots/${botId}`, { method: "PATCH", body: { limits: body } });
      const saved = res.bot.limits ?? {};
      onSaved(saved);
      setDraft(toDraft(saved, trust));
      setJustSaved(true);
      toast.success("Limits saved. They apply right away.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your limits.");
    } finally {
      setSaving(false);
    }
  };

  const capApplies = trust === "trusted" || trust === "full";
  const spendOn = spendValid && spendNum > 0;

  return (
    <Card className="overflow-hidden">
      <form onSubmit={save} className="divide-y divide-border">
        {/* Daily actions */}
        <LimitRow
          icon={<Gauge />}
          title="Actions on its own, per day"
          htmlFor="limit-daily"
          help={
            capApplies ? (
              <>
                After this many changes or sends in a day, {botName} checks with you before doing more. 0 means it always asks.{" "}
                {limits.dailyActions !== undefined && limits.dailyActions !== trustDefault ? (
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => set({ daily: String(trustDefault) })}>
                    Use the {TRUST[trust].name} default ({trustDefault})
                  </button>
                ) : (
                  <span>Default for {TRUST[trust].name}: {trustDefault}.</span>
                )}
              </>
            ) : trust === "ask" ? (
              <>On Ask me first, every action already waits for your tap. This kicks in at Trusted helper and Full faith.</>
            ) : (
              <>On Look only, {botName} never acts, so there&apos;s nothing to count. This kicks in at Trusted helper and Full faith.</>
            )
          }
        >
          <div className="flex items-center gap-2">
            <Input
              id="limit-daily"
              type="number"
              inputMode="numeric"
              min={0}
              max={1000}
              step={1}
              value={draft.daily}
              onChange={(e) => set({ daily: e.target.value })}
              aria-invalid={!dailyValid}
              className={cn("h-11 w-24 text-center tabular-nums", !dailyValid && "border-danger focus:border-danger focus:ring-danger/15")}
            />
            <span className="text-sm text-muted-foreground">a day</span>
          </div>
        </LimitRow>

        {/* Money */}
        <LimitRow
          icon={<Wallet />}
          title="Monthly spending cap"
          htmlFor="limit-spend"
          help={
            spendOn ? (
              <>
                {botName} can spend up to <strong className="font-semibold text-foreground">{money(spendNum)}</strong> a month and can never go over it. Every
                purchase still asks you first.
              </>
            ) : (
              <>
                <strong className="font-semibold text-foreground">Money is off.</strong> {botName} can&apos;t buy or pay for anything unless you set a cap, and it can never go over the cap you set.
              </>
            )
          }
        >
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="limit-spend"
                type="number"
                inputMode="decimal"
                min={0}
                max={10000}
                step="1"
                placeholder="0"
                value={draft.spend}
                onChange={(e) => set({ spend: e.target.value })}
                aria-invalid={!spendValid}
                aria-describedby="limit-spend-state"
                className={cn("h-11 w-32 pl-7 tabular-nums", !spendValid && "border-danger focus:border-danger focus:ring-danger/15")}
              />
            </div>
            <span id="limit-spend-state" className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", spendOn ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>
              {spendOn ? "On" : "Off"}
            </span>
          </div>
        </LimitRow>

        {/* Quiet hours */}
        <LimitRow
          icon={<MoonStar />}
          title="Quiet hours"
          htmlFor="limit-quiet"
          help={
            draft.quietOn && timesValid ? (
              <>
                From {formatTime(draft.start)} to {formatTime(draft.end)}, messages to other people wait for your OK, so nothing goes out overnight without it. It can still message you. Times are in {timezone.replace(/_/g, " ")}.
              </>
            ) : (
              // Same rule as the policy engine (quiet_hours): during them, sends to other people ask first.
              <>During quiet hours, messages to other people wait for your OK. It can still message you.</>
            )
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Switch id="limit-quiet" checked={draft.quietOn} onCheckedChange={(v) => set({ quietOn: v })} aria-label="Quiet hours" />
            {draft.quietOn ? (
              <div className="flex items-center gap-1.5">
                <Input
                  type="time"
                  aria-label="Quiet hours start"
                  value={draft.start}
                  onChange={(e) => set({ start: e.target.value })}
                  className="h-11 w-[8.75rem] px-3 text-[15px] tabular-nums"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  aria-label="Quiet hours end"
                  value={draft.end}
                  onChange={(e) => set({ end: e.target.value })}
                  className="h-11 w-[8.75rem] px-3 text-[15px] tabular-nums"
                />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Off</span>
            )}
          </div>
        </LimitRow>

        <div className="flex flex-wrap items-center justify-end gap-2 bg-background-2/50 px-4 py-3 sm:px-6">
          {!valid ? <span className="mr-auto text-xs font-medium text-danger">{!dailyValid ? "Daily actions: use a whole number from 0 to 1,000." : !spendValid ? "Spending cap: use an amount from $0 to $10,000." : "Quiet hours need different start and end times."}</span> : null}
          {justSaved && !dirty ? (
            <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <Check className="size-3.5" strokeWidth={3} /> Saved
            </span>
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => setDraft(baseline)}>
            <RotateCcw /> Undo
          </Button>
          <Button type="submit" size="sm" disabled={!dirty || !valid} loading={saving}>
            Save limits
          </Button>
        </div>
      </form>
    </Card>
  );
}

function LimitRow({ icon, title, help, htmlFor, children }: { icon: React.ReactNode; title: string; help: React.ReactNode; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6 sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground/70 [&_svg]:size-[18px]">{icon}</span>
        <div className="min-w-0">
          <label htmlFor={htmlFor} className="font-semibold">
            {title}
          </label>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{help}</p>
        </div>
      </div>
      <div className="sm:pl-0 min-[420px]:pl-12">{children}</div>
    </div>
  );
}
