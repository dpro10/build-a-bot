"use client";
import * as React from "react";
import { TrustPicker } from "@/components/catalog/TrustPicker";
import { ALWAYS_ON } from "@/components/catalog/connector-meta";
import { getConnector, type ConnectorDef } from "@/lib/connectors";
import type { TrustLevel } from "@/lib/trust";
import { StepHeading } from "./StepHeading";

export function TrustStep({
  botName,
  trust,
  onTrust,
  connectors,
}: {
  botName: string;
  trust: TrustLevel;
  onTrust: (t: TrustLevel) => void;
  connectors: string[];
}) {
  const name = botName.trim() || "Your bot";
  // Third-party apps first: they make the preview concrete ("Send email in Gmail").
  const apps = React.useMemo(() => {
    const defs = connectors.filter((id) => !ALWAYS_ON.has(id)).map((id) => getConnector(id)).filter((d): d is ConnectorDef => Boolean(d));
    return [...defs.filter((d) => !d.via.some((v) => v.kind === "builtin")), ...defs.filter((d) => d.via.some((v) => v.kind === "builtin"))];
  }, [connectors]);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        title={`How much can ${name} do on its own?`}
        subtitle="From read-only to full faith. You can change this anytime, and fine-tune it per app."
      />
      <TrustPicker value={trust} onChange={onTrust} apps={apps} botName={name} />
    </div>
  );
}
