"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Check, Hand, KeyRound, Plug, Plus, Rocket, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ConnectorDef } from "@/lib/connectors";
import { getConnector } from "@/lib/connectors";
import type { TrustLevel } from "@/lib/trust";
import { TRUST } from "@/lib/trust";
import { ConnectorBrowser } from "@/components/catalog/ConnectorBrowser";
import { BrandTile } from "@/components/brand/icons";
import { Button, Spinner } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import {
  connectPlan,
  displayName,
  effectiveVerdict,
  toConnectionView,
  type ConnectionView,
  type ConnectPlan,
} from "./model";
import { EFFECT_ICON } from "./PermissionsPanel";

type View = "browse" | "custom" | "added";
export type ConnectOutcome = "redirect" | "connected" | "failed" | "token";

export function AddAppsDialog({
  open,
  onOpenChange,
  botId,
  botName,
  jobs,
  added,
  unavailable,
  trust,
  spendCapUsd,
  composioLive,
  onAdded,
  onConnect,
  startInCustom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: string;
  botName: string;
  jobs: string[];
  /** Connector ids the bot already has. */
  added: string[];
  /** Built-ins whose service isn't set up on this server: shown as coming soon. */
  unavailable: string[];
  trust: TrustLevel;
  spendCapUsd: number | undefined;
  composioLive: boolean;
  onAdded: (conn: ConnectionView) => void;
  /** Starts sign-in; resolves with what happened. */
  onConnect: (conn: ConnectionView, plan: ConnectPlan, opts?: { fromDialog?: boolean }) => Promise<ConnectOutcome>;
  startInCustom?: boolean;
}) {
  const [view, setView] = React.useState<View>("browse");
  const [pending, setPending] = React.useState<ConnectorDef | null>(null);
  const [conn, setConn] = React.useState<ConnectionView | null>(null);
  const [upgrade, setUpgrade] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setView(startInCustom ? "custom" : "browse");
      setPending(null);
      setConn(null);
      setUpgrade(null);
      setConnectError(null);
      setConnected(false);
    }
  }, [open, startInCustom]);

  const add = async (def: ConnectorDef, body: Record<string, unknown> = { connectorId: def.id }) => {
    setView("added");
    setPending(def);
    setConn(null);
    setUpgrade(null);
    setConnectError(null);
    setConnected(false);
    try {
      const res = await api<{ connection: Parameters<typeof toConnectionView>[0] }>(`/api/bots/${botId}/connections`, { body });
      const view = toConnectionView(res.connection);
      setConn(view);
      onAdded(view);
      return view;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 402 || err.upgrade)) {
        setUpgrade(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Couldn't add that app.");
        setView(body.connectorId === "custom_mcp" ? "custom" : "browse");
      }
      return null;
    }
  };

  const connect = async (c: ConnectionView, plan: ConnectPlan) => {
    setConnecting(true);
    setConnectError(null);
    if (plan.kind === "token") onOpenChange(false);
    const outcome = await onConnect(c, plan, { fromDialog: true });
    if (outcome === "connected") {
      setConnected(true);
      setConn((x) => (x ? { ...x, status: "connected", error: null } : x));
    }
    if (outcome === "failed") setConnectError("failed");
    if (outcome !== "redirect") setConnecting(false);
  };

  const def = conn ? getConnector(conn.connectorId) : pending;
  const name = conn && def ? displayName(conn, def) : (pending?.name ?? "");
  const plan = conn && def ? connectPlan(conn, def, composioLive) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        side="bottom"
        className={cn(view === "browse" && "h-[var(--sheet-h)] [--sheet-h:92dvh] sm:w-[min(1000px,calc(100vw-48px))] sm:[--sheet-h:min(820px,90dvh)]")}
      >
        {view === "browse" ? (
          <>
            <DialogHeader className="pb-3">
              <DialogTitle>Add apps</DialogTitle>
              <DialogDescription>
                Pick an app to give {botName} access. You decide exactly what it can do after.
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-6 sm:pb-6">
              <ConnectorBrowser
                selected={[]}
                onToggle={(d) => void add(d)}
                jobs={jobs}
                added={added}
                unavailable={unavailable}
                onCustomMcp={() => setView("custom")}
                autoFocus
                maxHeight="calc(var(--sheet-h) - 234px)"
                className="min-h-0 flex-1"
              />
            </div>
          </>
        ) : view === "custom" ? (
          <CustomServerForm
            botName={botName}
            onBack={() => setView("browse")}
            onSubmit={async (url, label) => {
              const d = getConnector("custom_mcp")!;
              const c = await add(d, { connectorId: "custom_mcp", url, ...(label ? { name: label } : {}) });
              if (c) {
                const p = connectPlan(c, getConnector(c.connectorId), composioLive);
                if (p) await connect(c, p);
              }
            }}
          />
        ) : (
          <>
            <DialogHeader className="items-center pt-8 text-center sm:px-10">
              {def ? (
                <div className="relative mb-2">
                  <BrandTile icon={def.icon} size={64} className="animate-pop" />
                  {conn ? (
                    <span className="absolute -right-1.5 -bottom-1.5 flex size-6 animate-pop items-center justify-center rounded-full bg-success text-success-foreground ring-4 ring-card">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  ) : null}
                </div>
              ) : null}
              <DialogTitle className="text-center">
                {upgrade ? `Add ${name} with Plus` : !conn ? `Adding ${name}…` : connected || conn.status === "connected" ? `${name} is connected` : `${name} is added`}
              </DialogTitle>
              <DialogDescription className="max-w-sm text-center">
                {upgrade
                  ? upgrade
                  : !conn
                    ? "One moment."
                    : connected || conn.status === "connected"
                      ? conn.mode === "builtin"
                        ? `It's on, no sign-in needed. ${botName} can use it right away.`
                        : `${botName} can use it now, following your trust settings.`
                      : conn.status === "demo"
                        ? "Simulated in demo mode: it uses sample data so you can try it right now."
                        : plan?.kind === "token"
                          ? `Paste an access token so ${botName} can use it.`
                          : plan
                            ? `Sign in to ${name} so ${botName} can use it.`
                            : `${name} can't be connected on this server yet.`}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="sm:px-10">
              {!conn && !upgrade ? (
                <div className="flex justify-center py-6">
                  <Spinner className="size-6 text-primary" />
                </div>
              ) : null}
              {upgrade ? (
                <div className="flex flex-col items-center gap-3 py-2">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                    <Rocket className="size-5" />
                  </span>
                  <p className="max-w-sm text-center text-sm text-muted-foreground">Plus connects as many apps as you like, plus phone calls, texts and Full faith.</p>
                </div>
              ) : null}
              {conn && def ? (
                <div className="flex flex-col gap-3">
                  {connectError ? (
                    <div className="flex items-start gap-2 rounded-2xl bg-danger-soft px-3 py-2 text-[13px] text-foreground/80">
                      <TriangleAlert className="mt-px size-4 shrink-0 text-danger" />
                      <span>
                        That didn&apos;t work, so {name} is waiting in your list. You can try again from there anytime
                        {conn.connectorId.startsWith("custom_mcp:") ? ", or use an access token instead" : ""}.
                      </span>
                    </div>
                  ) : null}
                  <CapabilityPreview def={def} conn={conn} trust={trust} spendCapUsd={spendCapUsd} botName={botName} />
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter className="justify-center sm:px-10">
              {upgrade ? (
                <>
                  <Button variant="ghost" onClick={() => setView("browse")}>
                    <ArrowLeft /> Back
                  </Button>
                  <Button asChild>
                    <Link href="/app/billing">See Plus</Link>
                  </Button>
                </>
              ) : conn ? (
                <>
                  <Button variant="ghost" onClick={() => setView("browse")} disabled={connecting}>
                    <Plus /> Add another
                  </Button>
                  {plan && !connected && (conn.status === "needs_auth" || conn.status === "error" || conn.status === "demo") ? (
                    <>
                      <Button variant={conn.status === "demo" ? "outline" : "primary"} onClick={() => void connect(conn, plan)} loading={connecting}>
                        {plan.kind === "token" ? <KeyRound /> : <Plug />}
                        {conn.status === "demo" ? "Connect for real" : plan.kind === "token" ? "Paste a token" : `Sign in to ${name}`}
                      </Button>
                      {conn.status === "demo" ? <Button onClick={() => onOpenChange(false)}>Try it</Button> : null}
                    </>
                  ) : (
                    <Button onClick={() => onOpenChange(false)} disabled={connecting}>
                      Done
                    </Button>
                  )}
                </>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CapabilityPreview({
  def,
  conn,
  trust,
  spendCapUsd,
  botName,
}: {
  def: ConnectorDef;
  conn: ConnectionView;
  trust: TrustLevel;
  spendCapUsd: number | undefined;
  botName: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background-2/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" />
        At {TRUST[trust].emoji} {TRUST[trust].name}, {botName}:
      </div>
      <ul className="flex flex-col gap-1.5">
        {def.capabilities.map((cap) => {
          const v = effectiveVerdict(trust, def, cap, spendCapUsd, conn.permissions[cap.id]);
          const Icon = EFFECT_ICON[cap.effect];
          return (
            <li key={cap.id} className="flex items-center gap-2 text-sm">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{cap.label}</span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  v === "allow" ? "bg-success-soft text-success" : v === "ask" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground",
                )}
              >
                {v === "allow" ? <Check className="size-3" strokeWidth={3} /> : v === "ask" ? <Hand className="size-3" /> : <Ban className="size-3" />}
                {v === "allow" ? "On its own" : v === "ask" ? "Asks first" : "Off"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-xs text-muted-foreground">Change any of these from its row in your list.</p>
    </div>
  );
}

function CustomServerForm({ botName, onBack, onSubmit }: { botName: string; onBack: () => void; onSubmit: (url: string, name: string) => Promise<void> }) {
  const [url, setUrl] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const urlId = React.useId();
  const nameId = React.useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = url.trim();
    let parsed: URL | null = null;
    try {
      parsed = new URL(value);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:") {
      setError("Use the server's full https:// address.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(value, label.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <button type="button" onClick={onBack} className="mb-1 inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All apps
        </button>
        <DialogTitle>Connect any MCP server</DialogTitle>
        <DialogDescription>
          Paste the address of a remote MCP server (Streamable HTTP). If it needs a sign-in, we&apos;ll take you there next.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={urlId}>Server address</Label>
          <Input
            id={urlId}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            placeholder="https://mcp.example.com/mcp"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            aria-invalid={Boolean(error)}
            className="font-mono text-sm"
          />
          {error ? <p className="text-xs font-medium text-danger">{error}</p> : <FieldHint>Only https:// addresses. Your server must be reachable from the internet.</FieldHint>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={nameId}>
            Name <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id={nameId} maxLength={60} placeholder="Home Assistant, my n8n…" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="flex items-start gap-2 rounded-2xl bg-muted/70 px-3 py-2 text-[13px] text-foreground/80">
          <ShieldCheck className="mt-px size-4 shrink-0 text-success" />
          <span>Only add servers you trust. {botName} can use their tools, and everything still follows your trust level and limits.</span>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} disabled={!url.trim()}>
          <Plug /> Add and connect
        </Button>
      </DialogFooter>
    </form>
  );
}

