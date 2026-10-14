"use client";
import * as React from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

export type ApprovalView = {
  id: string;
  title: string;
  detail: string | null;
  risk: string;
  reasons: string[];
  tool: string;
  status?: string;
  expiresAt?: string | Date;
};

const REASON_LABEL: Record<string, string> = {
  needs_approval: "You asked to approve actions",
  always_ask: "Website forms always wait for your OK",
  high_risk: "High-stakes action",
  new_recipient: "First message to this person",
  tainted_send_new_recipient: "Read outside content first — guarding against prompt injection",
  sensitive_app: "Money, health or identity app",
  bulk_delete: "Deletes a lot at once",
  daily_action_cap: "Over today's limit of unattended actions",
  quiet_hours: "It's your quiet hours",
  owner_rule_ask: "Your rule for this app",
  secret_in_payload: "Looks like it contains a secret",
};

export function ApprovalCard({
  approval,
  onDecided,
  compact,
}: {
  approval: ApprovalView;
  onDecided?: (approval: ApprovalView, followUp: string | null) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = React.useState<"approve" | "deny" | null>(null);
  const [status, setStatus] = React.useState(approval.status ?? "pending");
  // Follow the server: a decision made elsewhere (another tab, a channel, a remount) shows up here.
  React.useEffect(() => {
    if (approval.status) setStatus(approval.status);
  }, [approval.status]);

  const decide = async (decision: "approve" | "deny") => {
    setBusy(decision);
    try {
      const res = await fetch(`/api/approvals/${approval.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't do that");
        if (data.approval?.status) setStatus(data.approval.status);
        return;
      }
      setStatus(data.approval.status);
      onDecided?.({ ...approval, status: data.approval.status }, data.followUp ?? null);
    } finally {
      setBusy(null);
    }
  };

  const decided = status !== "pending";
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl border bg-card text-card-foreground shadow-soft",
        decided ? "border-border opacity-90" : "border-warning/50 ring-4 ring-warning/10",
        compact ? "p-4" : "p-5",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl", decided ? "bg-muted text-muted-foreground" : "bg-warning-soft text-warning")}>
          <ShieldAlert className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{decided ? "Decided" : "Needs your OK"}</span>
            <Badge tone={approval.risk === "high" ? "danger" : approval.risk === "medium" ? "warning" : "neutral"}>{approval.risk} risk</Badge>
          </div>
          <div className="mt-1 font-semibold leading-snug">{approval.title}</div>
          {approval.detail ? (
            <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto rounded-2xl bg-muted/70 p-3 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90">
              {approval.detail}
            </pre>
          ) : null}
          {approval.reasons.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {approval.reasons.map((r) => (
                <li key={r} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                  {REASON_LABEL[r] ?? r}
                </li>
              ))}
            </ul>
          ) : null}
          {decided ? (
            <div className="mt-3 text-sm font-semibold">
              {status === "executed" ? (
                <span className="text-success">✓ Approved and done</span>
              ) : status === "approved" ? (
                <span className="text-success">✓ Approved</span>
              ) : status === "denied" ? (
                <span className="text-muted-foreground">✖ You declined</span>
              ) : status === "failed" ? (
                <span className="text-danger">Approved, but it failed</span>
              ) : (
                <span className="text-muted-foreground">Expired</span>
              )}
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="md" onClick={() => decide("approve")} loading={busy === "approve"} disabled={busy !== null}>
                <Check /> Approve
              </Button>
              <Button size="md" variant="outline" onClick={() => decide("deny")} loading={busy === "deny"} disabled={busy !== null}>
                <X /> Deny
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
