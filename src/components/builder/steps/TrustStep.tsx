"use client";
import * as React from "react";
import { Info } from "lucide-react";
import { TrustPicker } from "@/components/catalog/TrustPicker";
import { ALWAYS_ON } from "@/components/catalog/connector-meta";
import { PLANS, planAllowsTrust, type PlanId } from "@/lib/billing/plans";
import { getConnector, type ConnectorDef } from "@/lib/connectors";
import type { TrustLevel } from "@/lib/trust";
import { StepHeading } from "./StepHeading";

export function TrustStep({
  botName,
  trust,
  onTrust,
  connectors,
  plan,
  demo,
}: {
  botName: string;
  trust: TrustLevel;
  onTrust: (t: TrustLevel) => void;
  connectors: string[];
  plan: PlanId;
  demo: boolean;
}) {
  const name = botName.trim() || "Your bot";
  // Third-party apps first: they make the preview concrete ("Send email in Gmail").
  const apps = React.useMemo(() => {
    const defs = connectors.filter((id) => !ALWAYS_ON.has(id)).map((id) => getConnector(id)).filter((d): d is ConnectorDef => Boolean(d));
    return [...defs.filter((d) => !d.via.some((v) => v.kind === "builtin")), ...defs.filter((d) => d.via.some((v) => v.kind === "builtin"))];
  }, [connectors]);
  const fullNeedsPlus = !planAllowsTrust(PLANS[plan], "full");
  const fullLocked = !demo && fullNeedsPlus;

  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        title={`How much can ${name} do on its own?`}
        subtitle="From read-only to full faith. You can change this anytime, and fine-tune it per app."
      />
      <TrustPicker value={trust} onChange={onTrust} apps={apps} botName={name} planBadges={fullLocked ? { full: "Plus" } : {}} />
      {trust === "full" && fullNeedsPlus ? (
        <div className="flex items-start gap-2 rounded-2xl bg-accent/25 px-4 py-3 text-sm text-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            {fullLocked
              ? `Full faith is part of Plus. ${name} will start as a Trusted helper, and you can switch to Full faith the moment you upgrade.`
              : `Full faith is part of Plus. This demo lets you try it on any plan.`}
          </span>
        </div>
      ) : null}
    </div>
  );
}
