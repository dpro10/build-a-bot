"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Hand, Rocket, ShieldCheck } from "lucide-react";
import type { ConnectorDef } from "@/lib/connectors";
import { TRUST, type TrustLevel } from "@/lib/trust";
import { TrustPicker, trustPreview } from "@/components/catalog/TrustPicker";
import { isBuiltin } from "@/components/catalog/connector-meta";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/button";
import { Section } from "./Section";
import { useSerialSaves } from "./use-serial-saves";
import { toast } from "@/components/ui/toaster";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

const CHANGED: Record<TrustLevel, (name: string) => string> = {
  look: (n) => `${n} is on Look only: it reads and researches, but never acts.`,
  ask: (n) => `${n} will ask you before every action.`,
  trusted: (n) => `${n} handles routine stuff and asks before anything big.`,
  full: (n) => `Full faith is on. ${n} acts for you; hard limits still apply.`,
};

/** The high-impact things Full faith unlocks in the bot's own apps ("Send email in Gmail"). */
function bigMoves(apps: ConnectorDef[], max: number): string[] {
  const queues = apps
    .filter((d) => !isBuiltin(d) && !d.sensitive)
    .map((d) => d.capabilities.filter((c) => c.effect === "send" || c.effect === "delete" || (c.risk === "high" && c.effect !== "spend")).map((c) => `${c.label} in ${d.name}`));
  const out: string[] = [];
  for (let i = 0; out.length < max && queues.some((q) => q.length > i); i++) {
    for (const q of queues) if (q[i] && out.length < max) out.push(q[i]);
  }
  return out;
}

export function TrustSection({
  botId,
  botName,
  trust,
  onTrustChange,
  apps,
  planBadges,
}: {
  botId: string;
  botName: string;
  trust: TrustLevel;
  onTrustChange: (level: TrustLevel) => void;
  apps: ConnectorDef[];
  planBadges: Partial<Record<TrustLevel, string>>;
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);
  React.useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2200);
    return () => clearTimeout(t);
  }, [justSaved]);
  const [upgradeFor, setUpgradeFor] = React.useState<TrustLevel | null>(null);
  const [confirmFull, setConfirmFull] = React.useState(false);

  const saves = useSerialSaves();
  /** The level the server last confirmed (to roll back a failed change). */
  const confirmed = React.useRef(trust);

  const save = (level: TrustLevel) => {
    onTrustChange(level);
    setUpgradeFor(null);
    setSaving(true);
    saves.enqueue("trust", async () => {
      try {
        await api(`/api/bots/${botId}`, { method: "PATCH", body: { trust: level } });
        confirmed.current = level;
        if (saves.hasPending("trust")) return;
        setSaving(false);
        setJustSaved(true);
        toast.success(CHANGED[level](botName));
        router.refresh();
      } catch (err) {
        if (saves.hasPending("trust")) return;
        setSaving(false);
        onTrustChange(confirmed.current);
        if (err instanceof ApiError && err.status === 402) setUpgradeFor(level);
        else toast.error(err instanceof Error ? err.message : "Couldn't change that. Try again.");
      }
    });
  };

  const choose = (level: TrustLevel) => {
    if (level === trust) return;
    if (planBadges[level]) {
      setUpgradeFor(level);
      return;
    }
    if (level === "full") {
      setConfirmFull(true);
      return;
    }
    save(level);
  };

  const fullPreview = trustPreview("full", apps);
  const unlocks = bigMoves(apps, 3);

  return (
    <Section
      id="trust"
      title="Trust"
      icon={<ShieldCheck />}
      description={`How much ${botName} does on its own. Enforced in code, not left to the AI.`}
    >
      <Card className="relative p-4 sm:p-6">
        <span
          aria-live="polite"
          className={cn(
            "pointer-events-none absolute -top-3 right-5 inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-soft ring-1 ring-border transition-opacity duration-300",
            saving || justSaved ? "opacity-100" : "opacity-0",
          )}
        >
          {saving ? (
            <>
              <Spinner className="size-3.5" /> Saving…
            </>
          ) : justSaved ? (
            <>
              <Check className="size-3.5 text-success" strokeWidth={3} /> Saved
            </>
          ) : null}
        </span>
        {upgradeFor ? (
          <div className="mb-4 flex animate-fade-up flex-col gap-3 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary-soft to-card p-4 sm:flex-row sm:items-center">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Rocket className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{TRUST[upgradeFor].name} is part of {planBadges[upgradeFor] ?? "Plus"}</div>
              <p className="text-sm text-muted-foreground">
                Let {botName} send, post and update across your apps without waiting for a tap. Every action still gets a receipt, and hard limits always apply.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" onClick={() => setUpgradeFor(null)}>
                Not now
              </Button>
              <Button asChild size="sm">
                <Link href="/app/billing">See {planBadges[upgradeFor] ?? "Plus"}</Link>
              </Button>
            </div>
          </div>
        ) : null}

        <TrustPicker value={trust} onChange={choose} apps={apps} botName={botName} planBadges={planBadges} />

        <Dialog open={confirmFull} onOpenChange={setConfirmFull}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Give {botName} full faith?</DialogTitle>
              <DialogDescription>It will act for you across everything you connect, without waiting for your tap. You get a receipt for every action and can hit Stop anytime.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                  <span className="flex size-6 items-center justify-center rounded-full bg-success-soft text-success">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  Does on its own
                </div>
                <ul className="flex flex-col gap-1 pl-8 text-sm text-foreground/85">
                  <li>Everything a Trusted helper does</li>
                  {(unlocks.length ? unlocks : fullPreview.alone.slice(0, 3)).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                  <li>Reach out to new people for you</li>
                </ul>
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                  <span className="flex size-6 items-center justify-center rounded-full bg-warning-soft text-warning">
                    <Hand className="size-3.5" />
                  </span>
                  Still asks you first
                </div>
                <ul className="flex flex-col gap-1 pl-8 text-sm text-foreground/85">
                  {fullPreview.asks.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                  <li>Anything in apps with money, health or identity data</li>
                </ul>
              </div>
              <div className="flex items-start gap-2 rounded-2xl bg-muted/70 px-3 py-2 text-[13px] text-foreground/80">
                <ShieldCheck className="mt-px size-4 shrink-0 text-success" />
                Per-app rules below still apply. Set any action to Ask or Off and it stays that way.
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmFull(false)}>
                Keep {TRUST[trust].name}
              </Button>
              <Button
                onClick={() => {
                  setConfirmFull(false);
                  save("full");
                }}
              >
                <Rocket /> Turn on Full faith
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </Section>
  );
}
