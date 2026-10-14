"use client";
import * as React from "react";
import { Ban, Check, Eye, FlaskConical, Hand, Lock, Pencil, Send, ShieldAlert, ShieldCheck, Trash2, Wallet } from "lucide-react";
import type { ConnectorDef } from "@/lib/connectors";
import type { Effect, Risk } from "@/lib/connectors/types";
import { TRUST, type TrustLevel } from "@/lib/trust";
import { EFFECT_LABEL } from "@/components/catalog/connector-meta";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { effectiveVerdict, lockedChoices, trustDefault, type Permission } from "./model";

export const EFFECT_ICON: Record<Effect, React.ComponentType<{ className?: string }>> = {
  read: Eye,
  write: Pencil,
  send: Send,
  delete: Trash2,
  spend: Wallet,
  admin: ShieldAlert,
};

const RISK_LABEL: Record<Risk, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };

export function PermissionsPanel({
  def,
  permissions,
  trust,
  spendCapUsd,
  demo,
  disabled,
  onChange,
}: {
  def: ConnectorDef;
  permissions: Record<string, Permission>;
  trust: TrustLevel;
  spendCapUsd: number | undefined;
  /** Simulated connection (demo mode). */
  demo?: boolean;
  disabled?: boolean;
  onChange: (next: Record<string, Permission>) => void;
}) {
  const custom = def.capabilities.filter((c) => permissions[c.id]).length;

  return (
    <div className="rounded-2xl border border-border bg-background-2/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="text-[13px] text-muted-foreground">
          {custom ? (
            <>
              <span className="font-semibold text-foreground">
                {custom} rule{custom === 1 ? "" : "s"} you set
              </span>{" "}
              · the rest follow {TRUST[trust].name}
            </>
          ) : (
            <>
              Following <span className="font-semibold text-foreground">{TRUST[trust].emoji} {TRUST[trust].name}</span>. Change any action to set your own rule.
            </>
          )}
        </div>
        {custom ? (
          <button type="button" disabled={disabled} onClick={() => onChange({})} className="text-[13px] font-semibold text-primary hover:underline disabled:opacity-50">
            Reset to {TRUST[trust].name}
          </button>
        ) : null}
      </div>

      {trust === "look" && def.capabilities.some((c) => c.effect !== "read") ? (
        <p className="flex items-start gap-1.5 border-b border-border bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground sm:px-4">
          <Eye className="mt-0.5 size-3.5 shrink-0" />
          On Look only, it can read {def.name} but can&apos;t act there. Pick a higher trust level above to let it do more.
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {def.capabilities.map((cap) => {
          const rule = permissions[cap.id];
          const base = trustDefault(trust, def, cap, spendCapUsd);
          const locked = lockedChoices(trust, def, cap, spendCapUsd);
          const chosen = rule ?? base;
          const shown: Permission = locked[chosen] ? effectiveVerdict(trust, def, cap, spendCapUsd, rule) : chosen;
          const Icon = EFFECT_ICON[cap.effect];
          const newPeopleHint = cap.effect === "send" && shown === "allow" && trust === "trusted";
          return (
            <li key={cap.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4">
              <div className="flex min-w-0 items-start gap-2.5">
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-xl",
                    cap.effect === "read" ? "bg-muted text-muted-foreground" : cap.risk === "high" || cap.effect === "spend" || cap.effect === "delete" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
                  )}
                  aria-hidden
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{cap.label}</span>
                    {rule ? (
                      <Tooltip content={`You set this. ${TRUST[trust].name} alone would ${base === "allow" ? "allow it" : base === "ask" ? "ask you" : "keep it off"}.`}>
                        <span className="inline-flex size-1.5 shrink-0 rounded-full bg-primary" aria-label="Your rule" />
                      </Tooltip>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {EFFECT_LABEL[cap.effect]} · <span className={cn(cap.risk === "high" && "text-danger", cap.risk === "medium" && "text-warning")}>{RISK_LABEL[cap.risk]}</span>
                    {newPeopleHint ? " · asks before messaging someone new" : ""}
                  </div>
                </div>
              </div>
              <Segmented<Permission>
                size="sm"
                aria-label={`${cap.label}: allow, ask or off`}
                value={shown}
                onChange={(v) => {
                  if (disabled || locked[v]) return;
                  onChange({ ...permissions, [cap.id]: v });
                }}
                className="shrink-0 self-start sm:self-auto"
                options={(["allow", "ask", "deny"] as const).map((v) => ({
                  value: v,
                  disabled: disabled || Boolean(locked[v]),
                  title: locked[v] ?? (v === "allow" ? "Does it on its own" : v === "ask" ? "Asks you first, every time" : "Never does this"),
                  label: <ChoiceLabel value={v} active={shown === v} />,
                }))}
              />
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        {def.sensitive ? (
          <p className="flex items-start gap-1.5">
            <Lock className="mt-px size-3.5 shrink-0 text-warning" />
            Holds money, health or identity data, so changes always ask you first.
          </p>
        ) : null}
        {demo ? (
          <p className="flex items-start gap-1.5">
            <FlaskConical className="mt-px size-3.5 shrink-0 text-primary" />
            Simulated in demo mode. These rules apply to the sample data too, so you can watch them work.
          </p>
        ) : null}
        <p className="flex items-start gap-1.5">
          <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" />
          Hard limits always apply on top of these: no secrets leave, money stays under your cap, and new people get a check after it reads outside content.
        </p>
      </div>
    </div>
  );
}

function ChoiceLabel({ value, active }: { value: Permission; active: boolean }) {
  const Icon = value === "allow" ? Check : value === "ask" ? Hand : Ban;
  const color = value === "allow" ? "text-success" : value === "ask" ? "text-warning" : "text-danger";
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={cn("size-3", active ? color : "opacity-60")} strokeWidth={value === "allow" ? 3 : 2.25} aria-hidden />
      {value === "allow" ? "Allow" : value === "ask" ? "Ask" : "Off"}
    </span>
  );
}
