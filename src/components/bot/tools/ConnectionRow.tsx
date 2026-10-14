"use client";
import * as React from "react";
import {
  ChevronDown,
  CircleCheck,
  Ellipsis,
  FlaskConical,
  KeyRound,
  Lock,
  Plug,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { ConnectorDef } from "@/lib/connectors";
import type { TrustLevel } from "@/lib/trust";
import { BrandTile } from "@/components/brand/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PermissionsPanel } from "./PermissionsPanel";
import { isCustomServer, permissionSummary, type ConnectionStatus, type ConnectionView, type ConnectPlan, type Permission } from "./model";

const STATUS: Record<ConnectionStatus, { label: string; tone: "success" | "primary" | "warning" | "danger" | "neutral"; icon: React.ComponentType<{ className?: string }> }> = {
  connected: { label: "Connected", tone: "success", icon: CircleCheck },
  demo: { label: "Simulated", tone: "primary", icon: FlaskConical },
  needs_auth: { label: "Needs sign-in", tone: "warning", icon: KeyRound },
  error: { label: "Error", tone: "danger", icon: TriangleAlert },
  disabled: { label: "Off", tone: "neutral", icon: PowerOff },
};

export function StatusPill({ status }: { status: ConnectionStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  const pill = (
    <Badge tone={s.tone} className="gap-1">
      <Icon className="size-3" aria-hidden />
      {s.label}
      {status === "demo" ? <span className="sr-only"> in demo mode: uses sample data so you can try it</span> : null}
    </Badge>
  );
  if (status !== "demo") return pill;
  return (
    <Tooltip content="Simulated in demo mode: uses sample data so you can try it.">
      <span tabIndex={0} className="inline-flex rounded-full">
        {pill}
      </span>
    </Tooltip>
  );
}

export type RowActions = {
  onConnect: (conn: ConnectionView, plan: ConnectPlan) => void;
  onUseToken: (conn: ConnectionView) => void;
  onPermissions: (conn: ConnectionView, next: Record<string, Permission>) => void;
  onEnabled: (conn: ConnectionView, enabled: boolean) => void;
  onRemove: (conn: ConnectionView) => void;
};

export function ConnectionRow({
  conn,
  def,
  name,
  botName,
  trust,
  spendCapUsd,
  plan,
  builtin,
  comingSoon,
  highlighted,
  expanded,
  onExpandedChange,
  busy,
  localError,
  actions,
}: {
  conn: ConnectionView;
  def: ConnectorDef;
  name: string;
  botName: string;
  trust: TrustLevel;
  spendCapUsd: number | undefined;
  /** How it can be signed in for real (null = no way on this server). */
  plan: ConnectPlan | null;
  /** Built-in tool (no sign-in): compact row with an on/off switch. */
  builtin?: boolean;
  /** A built-in this server can't run yet: no switch or permissions, only "Coming soon". */
  comingSoon?: boolean;
  highlighted?: boolean;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  busy?: string | null;
  localError?: string | null;
  actions: RowActions;
}) {
  const off = conn.status === "disabled";
  const summary = permissionSummary(trust, def, conn.permissions, spendCapUsd);
  const panelId = `perm-${conn.id}`;
  const canSignIn = conn.status === "needs_auth" || conn.status === "error";
  const errorText = conn.status === "error" ? (conn.error ?? localError ?? "Something went wrong. Reconnect to fix it.") : localError;
  const custom = isCustomServer(conn);
  // Custom servers often use API keys; some apps only accept pre-approved sign-ins and say to paste a token.
  const tokenFallback = !builtin && plan?.kind !== "token" && (custom || /access token/i.test(errorText ?? ""));

  let primary: React.ReactNode = null;
  if (!builtin) {
    if (off) {
      primary = (
        <Button variant="outline" size="sm" onClick={() => actions.onEnabled(conn, true)} loading={busy === "enable"}>
          <Power /> Turn on
        </Button>
      );
    } else if (canSignIn && plan) {
      primary = (
        <Button size="sm" onClick={() => actions.onConnect(conn, plan)} loading={busy === "connect"}>
          {plan.kind === "token" ? <KeyRound /> : <Plug />}
          {plan.kind === "token" ? "Paste token" : conn.status === "error" ? "Reconnect" : "Connect"}
        </Button>
      );
    } else if (conn.status === "demo" && plan) {
      primary = (
        <Button variant="outline" size="sm" onClick={() => actions.onConnect(conn, plan)} loading={busy === "connect"}>
          <Plug /> Connect for real
        </Button>
      );
    }
  }

  const menu = (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${name}`} className="text-muted-foreground">
          <Ellipsis />
        </Button>
      </DropdownTrigger>
      <DropdownContent>
        {!builtin ? (
          off ? (
            <DropdownItem onSelect={() => actions.onEnabled(conn, true)}>
              <Power /> Turn on
            </DropdownItem>
          ) : (
            <DropdownItem onSelect={() => actions.onEnabled(conn, false)}>
              <PowerOff /> Turn off
            </DropdownItem>
          )
        ) : null}
        {!builtin && conn.status === "connected" && plan && plan.kind !== "token" ? (
          <DropdownItem onSelect={() => actions.onConnect(conn, plan)}>
            <RefreshCw /> Sign in again
          </DropdownItem>
        ) : null}
        {!builtin && plan?.kind === "token" && conn.status === "connected" ? (
          <DropdownItem onSelect={() => actions.onConnect(conn, plan)}>
            <KeyRound /> Replace token
          </DropdownItem>
        ) : null}
        {tokenFallback ? (
          <DropdownItem onSelect={() => actions.onUseToken(conn)}>
            <KeyRound /> Use an access token
          </DropdownItem>
        ) : null}
        {!builtin ? <DropdownSeparator /> : null}
        <DropdownItem danger onSelect={() => actions.onRemove(conn)}>
          <Trash2 /> Remove
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );

  let statusLine: React.ReactNode = null;
  if (!builtin) {
    if (conn.status === "demo") {
      statusLine = !plan ? (
        <Line icon={<FlaskConical className="text-primary" />}>Uses sample data. A real connection is coming soon.</Line>
      ) : null;
    } else if (conn.status === "needs_auth") {
      statusLine = (
        <Line icon={<KeyRound className="text-warning" />}>
          {!plan
            ? `${name} is coming soon.`
            : plan.kind === "token"
              ? `Paste an access token so ${botName} can use ${name}.`
              : `Sign in to ${name} so ${botName} can use it.`}
        </Line>
      );
    } else if (off) {
      statusLine = <Line icon={<PowerOff className="text-muted-foreground" />}>Turned off. {botName} can&apos;t use it until you turn it back on.</Line>;
    }
  }

  return (
    <li
      id={conn.connectorId}
      className={cn(
        "scroll-mt-28 list-none rounded-3xl border bg-card transition-[box-shadow,border-color] duration-500",
        builtin ? "p-3" : "p-3.5 shadow-soft sm:p-4",
        highlighted ? "border-primary ring-4 ring-primary/20" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <BrandTile icon={def.icon} size={builtin ? 36 : 44} className={cn((off || comingSoon) && "opacity-50 grayscale")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("font-semibold", (off || comingSoon) && "text-muted-foreground")}>{name}</span>
            {comingSoon ? <Badge tone="neutral">Coming soon</Badge> : null}
            {def.sensitive ? (
              <Tooltip content="Money, health or identity data: changes always ask you first.">
                <span className="inline-flex text-warning" role="img" aria-label="Sensitive app">
                  <Lock className="size-3.5" />
                </span>
              </Tooltip>
            ) : null}
            {builtin ? null : <StatusPill status={conn.status} />}
          </div>
          <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
            {custom ? conn.config.url ?? def.description : def.description}
          </p>
          {statusLine}
          {errorText ? (
            <Line icon={<TriangleAlert className="text-danger" />} className="text-danger">
              {errorText}
            </Line>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {primary ? <div className="hidden sm:block">{primary}</div> : null}
          {builtin && !comingSoon ? (
            <Switch
              checked={!off}
              onCheckedChange={(v) => actions.onEnabled(conn, v)}
              disabled={busy === "enable"}
              aria-label={name}
            />
          ) : null}
          {menu}
        </div>
      </div>

      {primary ? <div className="mt-3 pl-14 sm:hidden [&>button]:w-full">{primary}</div> : null}

      {def.capabilities.length && !comingSoon && !(builtin && def.capabilities.every((c) => c.effect === "read")) ? (
        <div className={cn("mt-2.5", builtin ? "pl-12" : "pl-14")}>
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="group inline-flex max-w-full items-center gap-2 rounded-full py-1 pr-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            <span className="text-foreground">Permissions</span>
            <span className="truncate">
              {[
                summary.allow ? `${summary.allow} on its own` : null,
                summary.ask ? `asks before ${summary.ask}` : null,
                summary.deny ? `${summary.deny} off` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {summary.custom ? <span className="size-1.5 shrink-0 rounded-full bg-primary" role="img" aria-label="Has your rules" /> : null}
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      ) : null}

      {expanded ? (
        <div id={panelId} className="mt-2 animate-fade-up sm:pl-14">
          <PermissionsPanel
            def={def}
            permissions={conn.permissions}
            trust={trust}
            spendCapUsd={spendCapUsd}
            demo={conn.status === "demo"}
            disabled={busy === "permissions"}
            onChange={(next) => actions.onPermissions(conn, next)}
          />
        </div>
      ) : null}
    </li>
  );
}

function Line({ icon, children, className }: { icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-foreground/75", className)}>
      <span className="mt-px shrink-0 [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
