"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import type { ChannelKind } from "@/lib/channels/catalog";
import { BrandTile } from "@/components/brand/icons";
import { channelIcon } from "@/components/catalog/channel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { channelDef } from "./model";
import { WAITLIST_WHY, WaitlistJoin } from "./WaitlistJoin";

export function AddChannelGrid({
  kinds,
  availability,
  joined,
  ownerEmail,
  onAdd,
  onJoin,
}: {
  kinds: ChannelKind[];
  availability: Partial<Record<ChannelKind, boolean>>;
  joined: Set<ChannelKind>;
  ownerEmail: string | null;
  onAdd: (kind: ChannelKind) => Promise<void>;
  onJoin: (kind: ChannelKind, email?: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = React.useState<ChannelKind | null>(null);

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {kinds.map((kind) => {
        const def = channelDef(kind);
        const soon = def.availability === "soon" || (def.availability !== "waitlist" && !availability[kind]);
        const waitlist = def.availability === "waitlist";
        return (
          <li key={kind} id={kind} className="flex scroll-mt-28 flex-col gap-3 rounded-3xl border border-border bg-card p-4 transition hover:border-foreground/15">
            <div className="flex items-start gap-3">
              <BrandTile icon={channelIcon(def)} size={40} className={cn(soon && "opacity-60 grayscale")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{def.name}</span>
                  {soon ? <Badge className="px-2 py-0 text-[11px]">Soon</Badge> : null}
                </div>
                <p className="text-[13px] text-muted-foreground">{def.tagline}</p>
              </div>
            </div>
            <p className="flex-1 text-[13px] leading-snug text-foreground/75">{waitlist ? (WAITLIST_WHY[kind] ?? def.description) : def.description}</p>
            {def.note && !soon && !waitlist ? <p className="-mt-1.5 text-xs text-muted-foreground">{def.note}</p> : null}
            <div className="flex items-center">
              {waitlist ? (
                <WaitlistJoin name={def.name} joined={joined.has(kind)} ownerEmail={ownerEmail} onJoin={(email) => onJoin(kind, email)} compact />
              ) : soon ? (
                <span className="text-sm font-medium text-muted-foreground">Coming soon</span>
              ) : (
                <Button
                  size="sm"
                  variant="soft"
                  loading={adding === kind}
                  onClick={async () => {
                    setAdding(kind);
                    await onAdd(kind);
                    setAdding(null);
                  }}
                >
                  <Plus /> Add {def.name}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
