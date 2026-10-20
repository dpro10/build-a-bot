"use client";
import * as React from "react";
import Link from "next/link";
import { Bot, Brain, CalendarClock, Check, Clock, Info, MessageCircle, Puzzle, ShieldCheck, Sun, UserRound, Wallet } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { channelIcon } from "@/components/catalog/channel-icon";
import { ALWAYS_ON } from "@/components/catalog/connector-meta";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AVATARS, COLORWAYS } from "@/lib/avatars";
import { FAIR_USE, UNIT_PRICES, formatMicros, perMessageMicros } from "@/lib/billing/prices";
import { CHANNEL_BY_KIND } from "@/lib/channels/catalog";
import { appKinds, getConnector, type ConnectorDef } from "@/lib/connectors";
import { briefParts, type BriefPart } from "@/lib/jobs";
import { INCLUDED_MODELS, PROVIDER_BY_ID } from "@/lib/models/catalog";
import { TRUST } from "@/lib/trust";
import { ROLE_BY_ID } from "@/lib/roles";
import type { RecipeData } from "@/lib/recipes";
import { cn, joinList } from "@/lib/utils";
import { formatDays, formatTime as formatRoutineTime } from "@/components/marketing/recipes/format";
import { brainSummary, colorwayTint } from "../BotPreview";
import { countedApps, type BuilderState, type StepId } from "../state";
import { StepHeading } from "./StepHeading";

/** What running it costs, in a sentence or two: there are no plans, so this is the whole story (prices.ts). */
export function costLine(s: BuilderState): string {
  const parts: string[] = [];
  const brain = s.brain;
  if (brain.kind === "included") {
    const m = INCLUDED_MODELS.find((x) => x.id === brain.model) ?? INCLUDED_MODELS.find((x) => x.default)!;
    parts.push(`About ${formatMicros(perMessageMicros(m))} a message on ${m.label}, paid from your credit at cost.`);
  } else {
    parts.push(`Free here: ${PROVIDER_BY_ID[brain.provider]?.name ?? "your provider"} bills you for the thinking.`);
  }
  if (s.connectors.includes("web_search") || s.connectors.includes("news") || s.connectors.includes("web_reader")) parts.push(`Each web lookup is ${formatMicros(UNIT_PRICES.lookup)}.`);
  if (s.channels.includes("sms") || s.channels.includes("voice")) parts.push("Texts and calls are paid from credit too.");
  return parts.join(" ");
}

/** What the server will adjust (it does the same check): only the fair-use limit on apps is left. */
export function adjustmentsFor(s: BuilderState, demo: boolean): string[] {
  if (demo || countedApps(s.connectors, s.customMcp) <= FAIR_USE.appsPerBot) return [];
  return [`A bot can connect up to ${FAIR_USE.appsPerBot} apps. The first ${FAIR_USE.appsPerBot} are added now.`];
}

const BRIEF_TIMES = Array.from({ length: 13 }, (_, i) => {
  const h = 5 + Math.floor(i / 2);
  const m = i % 2 ? "30" : "00";
  return `${String(h).padStart(2, "0")}:${m}`;
});

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const BRIEF_TOPICS: Record<BriefPart, string> = {
  calendar: "your calendar",
  email: "emails that need a reply",
  reminders: "your reminders",
  headline: "a headline worth knowing",
  bills: "bills coming due",
  habits: "a nudge on your habits",
  weather: "the weather",
};

/** What the morning brief covers, from the jobs and apps picked (the same parts as briefPrompt() in src/lib/bots/create.ts). */
export function briefTopics(jobs: string[], connectors: string[]): string {
  return joinList(briefParts(jobs, appKinds(connectors)).map((part) => BRIEF_TOPICS[part]));
}

export function ReviewStep({
  state: s,
  onInstructions,
  onBrief,
  onAge,
  goTo,
  demo,
  timezone,
  atBotLimit,
  routines = [],
}: {
  state: BuilderState;
  onInstructions: (v: string) => void;
  onBrief: (v: BuilderState["brief"]) => void;
  onAge: (v: boolean) => void;
  goTo: (step: StepId) => void;
  demo: boolean;
  timezone: string;
  atBotLimit: boolean;
  /** Routines the recipe brings along (made with the bot). */
  routines?: NonNullable<RecipeData["routines"]>;
}) {
  const name = s.name.trim() || "Your bot";
  const a = AVATARS[s.avatar];
  const apps = s.connectors.filter((id) => !ALWAYS_ON.has(id)).map((id) => getConnector(id)).filter((d): d is ConnectorDef => Boolean(d));
  const brain = brainSummary(s);
  const trust = TRUST[s.trust];
  const channels = ["web", ...s.channels].map((k) => CHANNEL_BY_KIND[k as keyof typeof CHANNEL_BY_KIND]).filter(Boolean);
  const adjustments = adjustmentsFor(s, demo);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading title={`Ready to meet ${name}?`} subtitle="Check everything over. You can change any of it later from the dashboard." />

      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        <div className="flex items-center gap-4 p-4 sm:p-5" style={{ background: `linear-gradient(90deg, ${colorwayTint(s.color)}, transparent)` }}>
          <Avatar avatar={s.avatar} color={s.color} size={84} mood="happy" />
          <div className="min-w-0">
            <div className="font-display text-2xl font-bold">{name}</div>
            <div className="text-sm text-muted-foreground">
              {s.role ? (
                <span className="font-semibold text-foreground">
                  {ROLE_BY_ID[s.role].emoji} {ROLE_BY_ID[s.role].label} ·{" "}
                </span>
              ) : null}
              {a.character} the {a.species} · {COLORWAYS[s.color].name}
              {s.ownerName.trim() ? ` · calls you ${s.ownerName.trim()}` : ""}
            </div>
          </div>
          <button type="button" onClick={() => goTo("face")} className="ml-auto self-start text-sm font-semibold text-primary hover:underline" aria-label="Change face">
            Change
          </button>
        </div>
        <dl className="divide-y divide-border border-t border-border">
          <Row icon={<Brain className="size-4" />} label="Brain" onEdit={() => goTo("brain")}>
            <span className="font-semibold">{brain.title}</span> <span className="text-muted-foreground">· {brain.sub}</span>
          </Row>
          <Row icon={<Puzzle className="size-4" />} label="Apps" onEdit={() => goTo("apps")}>
            {apps.length || s.customMcp.length ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {apps.map((d) => (
                  <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2.5 pl-0.5 text-xs font-semibold">
                    <BrandTile icon={d.icon} size={20} /> {d.name}
                  </span>
                ))}
                {s.customMcp.map((m) => (
                  <span key={m.url} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2.5 pl-0.5 text-xs font-semibold">
                    <BrandTile icon={{ lucide: "Plug", color: "64748B" }} size={20} /> {m.name || new URL(m.url).host}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">Built-in tools only (memory, reminders, weather, math)</span>
            )}
          </Row>
          <Row icon={<ShieldCheck className="size-4" />} label="Trust" onEdit={() => goTo("trust")}>
            <span className="font-semibold">
              {trust.emoji} {trust.name}
            </span>{" "}
            <span className="text-muted-foreground">· {trust.short}</span>
          </Row>
          <Row icon={<MessageCircle className="size-4" />} label="Talk" onEdit={() => goTo("channels")}>
            <span className="flex flex-wrap gap-1.5">
              {channels.map((c) => (
                <span key={c.kind} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2.5 pl-0.5 text-xs font-semibold">
                  <BrandTile icon={channelIcon(c)} size={20} />
                  {c.name}
                  {c.availability === "waitlist" ? <span className="font-normal text-muted-foreground">(waitlist)</span> : null}
                </span>
              ))}
            </span>
          </Row>
          <Row icon={<Clock className="size-4" />} label="Time" onEdit={null}>
            <span className="text-muted-foreground">{timezone.replace(/_/g, " ")} (from your device)</span>
          </Row>
          <Row icon={<Wallet className="size-4" />} label="Cost" onEdit={null}>
            <span className="text-muted-foreground">
              {costLine(s)}{" "}
              <Link href="/pricing" target="_blank" className="font-semibold text-primary hover:underline">
                Prices
              </Link>
            </span>
          </Row>
        </dl>
      </div>

      <div className={cn("rounded-3xl border p-4 transition sm:p-5", s.brief?.on ? "border-accent/70 bg-accent/10" : "border-border bg-card")}>
        <div className="flex items-start gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-2xl", s.brief?.on ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>
            <Sun className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <label htmlFor="brief-on" className="font-display text-lg font-semibold">
              Morning brief
            </label>
            <p className="text-sm text-muted-foreground">
              {name} reaches out {s.brief?.on && s.brief.weekdays ? "every weekday morning" : "every morning"} with what matters today: {briefTopics(s.jobs, s.connectors)}. Turn
              it off anytime.
            </p>
          </div>
          <Switch id="brief-on" checked={Boolean(s.brief?.on)} onCheckedChange={(on) => onBrief({ ...s.brief, on })} aria-label="Morning brief" />
        </div>
        {s.brief?.on ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 pl-[52px]">
            <Select size="sm" aria-label="Brief time" value={s.brief.time} onChange={(e) => onBrief({ ...s.brief, time: e.target.value })} className="w-32">
              {BRIEF_TIMES.map((t) => (
                <option key={t} value={t}>
                  {formatTime(t)}
                </option>
              ))}
            </Select>
            <Segmented
              size="sm"
              aria-label="Which days"
              value={s.brief.weekdays ? "weekdays" : "daily"}
              onChange={(v) => onBrief({ ...s.brief, weekdays: v === "weekdays" })}
              options={[
                { value: "daily", label: "Every day" },
                { value: "weekdays", label: "Weekdays" },
              ]}
            />
          </div>
        ) : null}
      </div>

      {routines.length ? (
        <div className="rounded-3xl border border-border bg-card p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <CalendarClock className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-semibold">Routines from the recipe</h2>
              <p className="text-sm text-muted-foreground">{name} starts with these. Change or pause them anytime in Routines.</p>
              <ul className="mt-3 flex flex-col gap-2">
                {routines.map((r) => (
                  <li key={r.title} className="rounded-2xl bg-background-2/70 px-3.5 py-2.5 text-sm">
                    <span className="font-semibold">{r.title}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatDays(r.days)} at {formatRoutineTime(r.time)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="instructions" className="font-display text-lg font-semibold">
          Anything {name} should know? <span className="text-sm font-normal text-muted-foreground">Optional</span>
        </label>
        <Textarea
          id="instructions"
          value={s.instructions}
          maxLength={4000}
          onChange={(e) => onInstructions(e.target.value)}
          placeholder={`e.g. Keep replies short. My manager is Sam — flag anything from him. I'm vegetarian. Never book anything before 9am.`}
          className="min-h-28"
        />
      </div>

      {adjustments.length ? (
        <div className="flex items-start gap-2 rounded-3xl border border-accent/60 bg-accent/15 p-4 text-sm text-foreground/80">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>{adjustments.join(" ")}</span>
        </div>
      ) : null}

      {atBotLimit ? (
        <div className="rounded-3xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          You have {FAIR_USE.bots} bots, the most one account can have. To make another, delete one first, in its Settings.
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-3xl border border-border bg-background-2/60 p-4 sm:p-5">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={s.ageConfirmed} onChange={(e) => onAge(e.target.checked)} className="peer sr-only" />
          <span
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition peer-focus-visible:ring-4 peer-focus-visible:ring-primary/25",
              s.ageConfirmed ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
            )}
            aria-hidden
          >
            {s.ageConfirmed ? <Check className="size-4" strokeWidth={3} /> : null}
          </span>
          <span className="text-sm">
            <span className="font-semibold">I&apos;m 18 or older</span> and I agree to the{" "}
            <Link href="/legal/terms" target="_blank" className="text-primary underline underline-offset-2">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" target="_blank" className="text-primary underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <p className="flex items-start gap-3 text-sm text-muted-foreground">
          <Bot className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>
            {name} will always say it&apos;s an AI assistant — it never pretends to be a person, and messages it sends to other people say they&apos;re from your AI assistant.
          </span>
        </p>
        <p className="flex items-start gap-3 text-sm text-muted-foreground">
          <UserRound className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>You&apos;re in charge: STOP pauses it instantly from any channel, and every action it takes gets a receipt.</span>
        </p>
      </div>
    </div>
  );
}

function Row({ icon, label, children, onEdit }: { icon: React.ReactNode; label: string; children: React.ReactNode; onEdit: (() => void) | null }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <dt className="flex w-20 shrink-0 items-center gap-1.5 pt-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-start gap-3 text-sm">
        <span className="min-w-0 flex-1">{children}</span>
        {onEdit ? (
          <button type="button" onClick={onEdit} className="shrink-0 text-sm font-semibold text-primary hover:underline" aria-label={`Change ${label === "Talk" ? "channels" : label.toLowerCase()}`}>
            Change
          </button>
        ) : null}
      </dd>
    </div>
  );
}
