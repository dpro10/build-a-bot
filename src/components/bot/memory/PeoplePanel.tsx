"use client";
import * as React from "react";
import Link from "next/link";
import { SearchX, ShieldCheck, UserMinus, Users } from "lucide-react";
import { BrandTile, type IconSpec } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { TRUST, isTrustLevel } from "@/lib/trust";
import { maskPhone } from "@/lib/utils";
import { ago } from "@/components/bot/activity/time";
import { channelIcon } from "@/components/bot/activity/receipt-meta";
import { usePendingDelete } from "./use-pending-delete";
import { matches, type ContactItem } from "./types";

const KIND_LABEL: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  sms: "Phone",
  telegram: "Telegram",
  slack: "Slack",
  discord: "Discord",
};

function kindIcon(kind: string): IconSpec {
  if (kind === "email") return { lucide: "Mail", color: "F59E0B" };
  if (kind === "phone" || kind === "sms") return { lucide: "Phone", color: "19B57A" };
  return channelIcon(kind);
}

function showAddress(c: ContactItem) {
  return /^\+\d{8,15}$/.test(c.address) ? maskPhone(c.address) : c.address;
}

export function PeoplePanel({
  botId,
  botName,
  trust,
  items,
  setItems,
  query,
  now,
}: {
  botId: string;
  botName: string;
  trust: string;
  items: ContactItem[];
  setItems: React.Dispatch<React.SetStateAction<ContactItem[]>>;
  query: string;
  now: Date;
}) {
  const scheduleDelete = usePendingDelete();
  const shown = items.filter((c) => matches(query, c.name, c.address, KIND_LABEL[c.kind]));
  const level = TRUST[isTrustLevel(trust) ? trust : "ask"];

  const forget = (c: ContactItem) => {
    const index = items.findIndex((x) => x.id === c.id);
    setItems((cur) => cur.filter((x) => x.id !== c.id));
    scheduleDelete(`ctc:${c.id}`, `/api/bots/${botId}/contacts/${c.id}`, {
      message: `Forgot ${c.name || showAddress(c)}`,
      description: `${botName} will ask you before messaging them again.`,
      onUndo: () =>
        setItems((cur) => {
          if (cur.some((x) => x.id === c.id)) return cur;
          const next = [...cur];
          next.splice(Math.min(index, next.length), 0, c);
          return next;
        }),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-3xl border border-border bg-background-2/70 p-4 sm:p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold">People {botName} already knows</p>
          <p className="mt-1 text-muted-foreground">
            These are people you&apos;ve approved {botName} to contact. Under <span className="font-medium text-foreground">Trusted helper</span>, it
            can reply to them without asking. Someone new always needs your OK first, which is also how the prompt-injection guard keeps a sneaky
            email or web page from getting {botName} to send your things to a stranger.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {botName} is set to{" "}
            <Link href={`/app/bots/${botId}/tools`} className="font-semibold text-primary hover:underline">
              {level.emoji} {level.name}
            </Link>
            .
          </p>
        </div>
      </div>

      {!items.length ? (
        <EmptyState icon={<Users className="size-8" />} title="No one yet" className="bg-card/50">
          When you approve a message to someone new, they show up here so {botName} recognizes them next time.
        </EmptyState>
      ) : !shown.length ? (
        <EmptyState icon={<SearchX className="size-8" />} title="No matches" className="bg-card/50">
          No one here matches “{query}”.
        </EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {shown.map((c, i) => (
            <li key={c.id} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${i ? "border-t border-border" : ""}`}>
              <BrandTile icon={kindIcon(c.kind)} size={36} variant="soft" className="rounded-xl" label={KIND_LABEL[c.kind] ?? c.kind} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{c.name || showAddress(c)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.name ? `${showAddress(c)} · ` : ""}
                  {KIND_LABEL[c.kind] ?? c.kind} · {c.approvedAt ? `approved ${ago(c.approvedAt, now)}` : `added ${ago(c.createdAt, now)}`}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => forget(c)} className="shrink-0 hover:text-danger" aria-label={`Forget ${c.name || c.address}`}>
                <UserMinus /> <span className="hidden sm:inline">Forget</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
