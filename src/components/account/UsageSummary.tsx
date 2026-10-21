/**
 * What an account used this month and what it cost. There are no plan limits to measure against:
 * people pay for what they use (prices.ts), so this is a receipt, not a meter. Server-component safe.
 */
import * as React from "react";
import { AudioLines, Bot, KeyRound, MessageCircle, MessageSquareText, Mic, Phone, Search } from "lucide-react";
import { callMinuteMicros } from "@/lib/billing/call-rate";
import { FAIR_USE, UNIT_PRICES, formatMicros } from "@/lib/billing/prices";
import { cn } from "@/lib/utils";

export type UsageNumbers = {
  includedMessages: number;
  byoMessages: number;
  searches: number;
  voiceMinutes: number;
  smsSegments: number;
  meetingMinutes: number;
  dictationWords: number;
  bots: number;
  /** What it all cost this month, in micro-dollars (what credit paid for). */
  costMicros: number;
};

type Tile = { key: Exclude<keyof UsageNumbers, "costMicros">; label: string; unit: (n: number) => string; note: string; icon: React.ReactNode; free?: boolean };

const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (one: string, many = `${one}s`) => (n: number) => (n === 1 ? one : many);

function tiles(callsAndTexts: boolean): Tile[] {
  const all: Tile[] = [
    { key: "includedMessages", label: "Messages on included models", unit: plural("message"), note: "Paid from your credit, per token.", icon: <MessageCircle className="size-4" /> },
    {
      key: "byoMessages",
      label: "Messages on your own AI",
      unit: plural("message"),
      note: `Free here. Fair use: ${fmt(FAIR_USE.ownBrainMessages)} a month.`,
      icon: <KeyRound className="size-4" />,
      free: true,
    },
    { key: "searches", label: "Web lookups", unit: plural("search", "searches"), note: `${formatMicros(UNIT_PRICES.lookup)} each.`, icon: <Search className="size-4" /> },
    { key: "meetingMinutes", label: "Meeting notes", unit: plural("minute"), note: "Heard on your computer, free. The notes are one message.", icon: <AudioLines className="size-4" />, free: true },
    { key: "dictationWords", label: "Voice typing", unit: plural("word"), note: "Heard on your computer, free. The AI cleanup is a fraction of a cent.", icon: <Mic className="size-4" />, free: true },
    { key: "voiceMinutes", label: "Calls", unit: plural("minute"), note: `${formatMicros(callMinuteMicros())} a minute, plus the thinking.`, icon: <Phone className="size-4" /> },
    { key: "smsSegments", label: "Texts", unit: plural("segment"), note: "Counted in segments of about 160 characters.", icon: <MessageSquareText className="size-4" /> },
    { key: "bots", label: "Bots", unit: plural("bot"), note: `Up to ${FAIR_USE.bots}. Having a bot costs nothing.`, icon: <Bot className="size-4" />, free: true },
  ];
  return callsAndTexts ? all : all.filter((t) => t.key !== "voiceMinutes" && t.key !== "smsSegments");
}

export function UsageSummary({ used, callsAndTexts, className }: { used: UsageNumbers; callsAndTexts: boolean; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3", className)}>
      {tiles(callsAndTexts).map((t) => {
        const value = used[t.key];
        return (
          <div key={t.key} className="flex flex-col rounded-2xl border border-border bg-card p-3.5 sm:p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-xl", t.free ? "bg-success-soft text-success" : "bg-primary-soft text-primary")} aria-hidden>
                {t.icon}
              </span>
              <span className="min-w-0">{t.label}</span>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5 tabular-nums">
              <span className="font-display text-2xl font-bold text-foreground">{fmt(value)}</span>
              <span className="text-sm text-muted-foreground">{t.unit(value)}</span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{t.note}</p>
          </div>
        );
      })}
    </div>
  );
}
