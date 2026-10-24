"use client";
import * as React from "react";
import { Blocks, FlaskConical, Plus, SlidersHorizontal, Sparkles, Wrench } from "lucide-react";
import { BUILTIN_CONNECTORS, getConnector, type ConnectorDef } from "@/lib/connectors";
import { DEFAULT_BUILTINS } from "@/lib/connectors/builtin";
import { TRUST, type TrustLevel } from "@/lib/trust";
import { BrandTile } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { ALWAYS_ON, AVAILABLE_APP_COUNT_ROUNDED, isAvailable } from "@/components/catalog/connector-meta";
import { AddAppsDialog, type ConnectOutcome } from "./AddAppsDialog";
import { ConnectionRow, type RowActions } from "./ConnectionRow";
import { LimitsCard } from "./LimitsCard";
import { Note, Section } from "./Section";
import { TokenDialog, type TokenRequest } from "./TokenDialog";
import { TrustSection } from "./TrustSection";
import { useHashTarget } from "./use-hash-target";
import { useSerialSaves } from "./use-serial-saves";
import {
  connectPlan,
  connectorFor,
  displayName,
  groupConnections,
  isCustomServer,
  PERMISSION_LABEL,
  toConnectionView,
  type ConnectionView,
  type ConnectPlan,
  type LimitsView,
  type Permission,
} from "./model";

const PENDING_KEY = "bab:connecting";

type Row = Parameters<typeof toConnectionView>[0];

export type AppsTrustProps = {
  bot: { id: string; name: string; trust: TrustLevel; jobs: string[]; limits: LimitsView };
  connections: ConnectionView[];
  composioLive: boolean;
  /** Built-ins and apps this server can't offer yet: "Coming soon", never added or listed as working. */
  comingSoon: string[];
  timezone: string;
  /** From the sign-in callbacks: ?connected=1 or ?connect_error=… */
  flash: { connected: boolean; error: string | null };
};

export function AppsTrustView({ bot, connections: initial, composioLive, comingSoon, timezone, flash }: AppsTrustProps) {
  const botId = bot.id;
  const soon = React.useMemo(() => new Set(comingSoon), [comingSoon]);
  const [trust, setTrust] = React.useState<TrustLevel>(bot.trust);
  const [limits, setLimits] = React.useState<LimitsView>(bot.limits);
  const [connections, setConnections] = React.useState<ConnectionView[]>(initial);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [busy, setBusy] = React.useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = React.useState(false);
  const [tokenRequest, setTokenRequest] = React.useState<TokenRequest | null>(null);
  const [removing, setRemoving] = React.useState<ConnectionView | null>(null);
  const [removeBusy, setRemoveBusy] = React.useState(false);
  const { target, focus } = useHashTarget();
  const saves = useSerialSaves();
  /** Last permissions the server confirmed, per connection (to roll back a failed save). */
  const confirmedPerms = React.useRef(new Map<string, Record<string, Permission>>());
  const focusAfterDialog = React.useRef<string | null>(null);

  const spendCapUsd = limits.spendCapUsd && limits.spendCapUsd > 0 ? limits.spendCapUsd : undefined;
  const { apps, builtins } = React.useMemo(() => groupConnections(connections), [connections]);
  const addedIds = React.useMemo(() => connections.map((c) => c.connectorId), [connections]);
  // For the trust preview: popular catalog apps first, the owner's own servers last, by the names they gave them.
  const pickerApps = React.useMemo(
    () =>
      [...apps, ...builtins]
        .filter((c) => c.status !== "disabled" && !soon.has(c.connectorId))
        .map((c) => {
          const def = connectorFor(c);
          return def ? { ...def, name: displayName(c, def) } : null;
        })
        .filter((d): d is ConnectorDef => Boolean(d))
        .sort((a, b) => Number(a.category === "custom") - Number(b.category === "custom") || Number(!!b.popular) - Number(!!a.popular)),
    [apps, builtins, soon],
  );

  const setBusyFor = (id: string, action: string | null) =>
    setBusy((b) => {
      const next = { ...b };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  const setRowError = (id: string, message: string | null) =>
    setRowErrors((r) => {
      const next = { ...r };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  const replace = (row: ConnectionView) => setConnections((list) => list.map((c) => (c.id === row.id ? row : c)));
  const patchLocal = (id: string, patch: Partial<ConnectionView>) => setConnections((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const resync = React.useCallback(async () => {
    try {
      const res = await api<{ connections: Row[] }>(`/api/bots/${botId}`);
      setConnections(res.connections.map(toConnectionView));
    } catch {
      /* keep what we have */
    }
  }, [botId]);

  // Coming back from a sign-in page (once, even when effects run twice in development).
  const flashHandled = React.useRef(false);
  React.useEffect(() => {
    if (flashHandled.current || (!flash.connected && !flash.error)) return;
    flashHandled.current = true;
    let pending: { id: string; connectorId: string; name: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      pending = null;
    }
    const name = pending?.name ?? "The app";
    if (flash.connected) toast.success(`${name} is connected. ${bot.name} can use it now.`);
    else toast.error(`${pending?.name ? `${pending.name}: ` : ""}${flash.error}`);
    if (pending && flash.error) setRowError(pending.id, flash.error);
    const url = new URL(window.location.href);
    url.searchParams.delete("connected");
    url.searchParams.delete("connect_error");
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + (pending ? `#${encodeURIComponent(pending.connectorId)}` : url.hash));
    if (pending) {
      const id = pending.connectorId;
      setTimeout(() => focus(id), 200);
    }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (conn: ConnectionView, plan: ConnectPlan): Promise<ConnectOutcome> => {
    const def = connectorFor(conn);
    const name = displayName(conn, def);
    if (plan.kind === "token") {
      setTokenRequest({ connectionId: conn.id, name, label: plan.label, url: plan.url });
      return "token";
    }
    setBusyFor(conn.id, "connect");
    setRowError(conn.id, null);
    try {
      const res = await api<{ redirect?: string; connected?: boolean; tools?: number | null }>(`/api/bots/${botId}/connections/${conn.id}/connect`, {
        body: { method: plan.kind },
      });
      if (res.redirect) {
        // Only ever leave for a web address (never "javascript:" or another scheme).
        if (!/^https:\/\//i.test(res.redirect)) throw new Error("That sign-in address isn't a secure web address.");
        try {
          sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: conn.id, connectorId: conn.connectorId, name }));
        } catch {
          /* private mode */
        }
        toast(`Taking you to ${name} to sign in…`);
        window.location.assign(res.redirect);
        return "redirect";
      }
      patchLocal(conn.id, { status: "connected", mode: conn.mode === "demo" ? "mcp" : conn.mode, error: null });
      toast.success(`${name} is connected${typeof res.tools === "number" && res.tools > 0 ? ` with ${res.tools} tools` : ""}. ${bot.name} can use it now.`);
      setBusyFor(conn.id, null);
      void resync();
      return "connected";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't start the sign-in.";
      setRowError(conn.id, message);
      toast.error(`${name}: ${message}`);
      setBusyFor(conn.id, null);
      return "failed";
    }
  };

  const askForToken = (conn: ConnectionView, reason?: string) => {
    const def = connectorFor(conn);
    const name = displayName(conn, def);
    const plan = connectPlan(conn, def, composioLive);
    setTokenRequest({
      connectionId: conn.id,
      name,
      label: plan?.kind === "token" ? plan.label : "Access token",
      url: plan?.kind === "token" ? plan.url : undefined,
      reason: reason ?? (isCustomServer(conn) ? `If ${name} uses API keys or personal tokens instead of a sign-in page, paste one here. ${bot.name} sends it only to that server.` : undefined),
    });
  };

  const submitToken = async (token: string): Promise<boolean> => {
    const req = tokenRequest;
    if (!req) return false;
    try {
      const res = await api<{ connected?: boolean; tools?: number | null }>(`/api/bots/${botId}/connections/${req.connectionId}/connect`, {
        body: { method: "token", token },
      });
      patchLocal(req.connectionId, { status: "connected", mode: "mcp", error: null, hasCredential: true });
      setRowError(req.connectionId, null);
      setTokenRequest(null);
      toast.success(`${req.name} is connected${typeof res.tools === "number" && res.tools > 0 ? ` with ${res.tools} tools` : ""}.`);
      void resync();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That token didn't work.");
      return false;
    }
  };

  const setPermissions = (conn: ConnectionView, next: Record<string, Permission>) => {
    const def = connectorFor(conn);
    const name = displayName(conn, def);
    const prev = conn.permissions;
    const changed = def?.capabilities.find((c) => prev[c.id] !== next[c.id] && next[c.id]);
    const message = !Object.keys(next).length
      ? `${name} follows ${TRUST[trust].name} again.`
      : changed
        ? `${name}: “${changed.label}” is set to ${PERMISSION_LABEL[next[changed.id]]}.`
        : `${name}: rules saved.`;
    if (!confirmedPerms.current.has(conn.id)) confirmedPerms.current.set(conn.id, prev);
    patchLocal(conn.id, { permissions: next });
    const key = `perm:${conn.id}`;
    saves.enqueue(key, async () => {
      try {
        const res = await api<{ connection: Row }>(`/api/bots/${botId}/connections/${conn.id}`, { method: "PATCH", body: { permissions: next } });
        confirmedPerms.current.set(conn.id, toConnectionView(res.connection).permissions);
        if (!saves.hasPending(key)) toast.success(message);
      } catch (err) {
        if (saves.hasPending(key)) return;
        patchLocal(conn.id, { permissions: confirmedPerms.current.get(conn.id) ?? prev });
        toast.error(err instanceof Error ? err.message : "Couldn't save that rule.");
      }
    });
  };

  const setEnabled = async (conn: ConnectionView, enabled: boolean) => {
    const def = connectorFor(conn);
    const name = displayName(conn, def);
    const prevStatus = conn.status;
    setBusyFor(conn.id, "enable");
    if (!enabled) patchLocal(conn.id, { status: "disabled" });
    try {
      const res = await api<{ connection: Row }>(`/api/bots/${botId}/connections/${conn.id}`, { method: "PATCH", body: { enabled } });
      replace(toConnectionView(res.connection));
      toast.success(enabled ? `${name} is back on.` : `${name} is off. ${bot.name} can't use it until you turn it back on.`);
    } catch (err) {
      patchLocal(conn.id, { status: prevStatus });
      toast.error(err instanceof Error ? err.message : "Couldn't change that.");
    } finally {
      setBusyFor(conn.id, null);
    }
  };

  const remove = async () => {
    const conn = removing;
    if (!conn) return;
    const name = displayName(conn, connectorFor(conn));
    setRemoveBusy(true);
    try {
      await api(`/api/bots/${botId}/connections/${conn.id}`, { method: "DELETE" });
      setConnections((list) => list.filter((c) => c.id !== conn.id));
      setRemoving(null);
      toast.success(`${name} removed. Its sign-in was deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't remove ${name}.`);
    } finally {
      setRemoveBusy(false);
    }
  };

  const actions: RowActions = {
    onConnect: (conn, plan) => void connect(conn, plan),
    onUseToken: (conn) => askForToken(conn),
    onPermissions: (conn, next) => setPermissions(conn, next),
    onEnabled: (conn, enabled) => void setEnabled(conn, enabled),
    onRemove: (conn) => setRemoving(conn),
  };

  const toggleExpanded = (id: string, open: boolean) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const renderRow = (conn: ConnectionView, builtin: boolean) => {
    const def = connectorFor(conn) ?? getConnector("custom_mcp")!;
    return (
      <ConnectionRow
        key={conn.id}
        conn={conn}
        def={def}
        name={displayName(conn, def)}
        botName={bot.name}
        trust={trust}
        spendCapUsd={spendCapUsd}
        plan={soon.has(conn.connectorId) ? null : connectPlan(conn, def, composioLive)}
        builtin={builtin}
        comingSoon={soon.has(conn.connectorId)}
        highlighted={target === conn.connectorId}
        expanded={expanded.has(conn.id)}
        onExpandedChange={(open) => toggleExpanded(conn.id, open)}
        busy={busy[conn.id] ?? null}
        localError={rowErrors[conn.id] ?? null}
        actions={actions}
      />
    );
  };

  const notAdded = BUILTIN_CONNECTORS.filter((d) => d.status !== "soon" && !ALWAYS_ON.has(d.id) && d.id !== "custom_mcp" && !addedIds.includes(d.id));
  const moreBuiltins = notAdded.filter((d) => isAvailable(d, soon));
  const soonBuiltins = notAdded.filter((d) => !isAvailable(d, soon));

  const addBuiltin = async (d: ConnectorDef) => {
    setBusyFor(`add:${d.id}`, "add");
    try {
      const res = await api<{ connection: Row }>(`/api/bots/${botId}/connections`, { body: { connectorId: d.id } });
      const conn = toConnectionView(res.connection);
      setConnections((list) => (list.some((c) => c.id === conn.id) ? list : [...list, conn]));
      toast.success(`${d.name} is on. No sign-in needed.`);
      setTimeout(() => focus(conn.connectorId), 150);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't add ${d.name}.`);
    } finally {
      setBusyFor(`add:${d.id}`, null);
    }
  };

  const simulated = apps.filter((c) => c.status === "demo").length;
  const attention = apps.filter((c) => c.status === "needs_auth" || c.status === "error").length;
  const alwaysOn = DEFAULT_BUILTINS.filter((id) => !soon.has(id))
    .map((id) => getConnector(id))
    .filter((d): d is ConnectorDef => Boolean(d));
  const removingName = removing ? displayName(removing, connectorFor(removing)) : "";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Apps & trust</h1>
          <p className="max-w-2xl text-muted-foreground">
            What {bot.name} can use, and how much it does on its own. Every action follows these rules and gets a receipt.
          </p>
        </header>

        <TrustSection botId={botId} botName={bot.name} trust={trust} onTrustChange={setTrust} apps={pickerApps} />

        <Section id="limits" title="Limits" icon={<SlidersHorizontal />} description="Guardrails that hold at every trust level.">
          <LimitsCard botId={botId} botName={bot.name} trust={trust} limits={limits} timezone={timezone} onSaved={setLimits} />
        </Section>

        <Section
          id="apps"
          title="Connected apps"
          icon={<Blocks />}
          description={
            apps.length
              ? attention
                ? `${attention} ${attention === 1 ? "app needs" : "apps need"} you to sign in. Open Permissions on any app to fine-tune what it can do.`
                : "Open Permissions on any app to fine-tune what it can do."
              : undefined
          }
          action={
            apps.length ? (
              <Button onClick={() => setAddOpen(true)}>
                <Plus /> Add apps
              </Button>
            ) : undefined
          }
        >
          {simulated ? (
            <Note tone="primary" icon={<FlaskConical />} className="mb-3">
              <strong className="font-semibold">Simulated apps</strong> use sample data in demo mode, so you can try everything safely.{" "}
              {simulated === apps.length ? "Connect any of them for real when you're ready." : null}
            </Note>
          ) : null}
          {apps.length ? (
            <ul className="flex flex-col gap-3">{apps.map((c) => renderRow(c, false))}</ul>
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
              <div className="flex -space-x-2">
                {["gmail", "google_calendar", "github", "notion", "spotify"].map((id) => {
                  const d = getConnector(id);
                  return d ? <BrandTile key={id} icon={d.icon} size={40} className="ring-4 ring-background" /> : null;
                })}
              </div>
              <div>
                <div className="font-display text-lg font-semibold">Give {bot.name} your apps</div>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Email, calendar, GitHub, Drive and {AVAILABLE_APP_COUNT_ROUNDED}+ more. You choose what it can do in each one.
                </p>
              </div>
              <Button onClick={() => setAddOpen(true)}>
                <Plus /> Add apps
              </Button>
            </div>
          )}
        </Section>

        <Section id="built-in" title="Built in" icon={<Wrench />} description="Tools that run on our side. No sign-in needed.">
          {builtins.length ? <ul className="grid gap-2 lg:grid-cols-2">{builtins.map((c) => renderRow(c, true))}</ul> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2.5">
            <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" /> Always included
            </span>
            {alwaysOn.map((d) => (
              <Tooltip key={d.id} content={d.description}>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-card py-1 pr-2.5 pl-1 text-xs font-medium shadow-soft ring-1 ring-border">
                  <BrandTile icon={d.icon} size={20} />
                  {d.name}
                </span>
              </Tooltip>
            ))}
          </div>
          {moreBuiltins.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-semibold text-muted-foreground">Add more:</span>
              {moreBuiltins.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => void addBuiltin(d)}
                  disabled={busy[`add:${d.id}`] === "add"}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-card py-1 pr-3 pl-1 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary disabled:opacity-60"
                  aria-label={`Add ${d.name}`}
                >
                  <BrandTile icon={d.icon} size={20} />
                  {d.name}
                  <Plus className="size-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : null}
          {soonBuiltins.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-semibold text-muted-foreground">Coming soon:</span>
              {soonBuiltins.map((d) => (
                <Tooltip key={d.id} content={d.description}>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 py-1 pr-3 pl-1 text-xs font-medium text-muted-foreground">
                    <BrandTile icon={d.icon} size={20} className="opacity-60 grayscale" />
                    {d.name}
                  </span>
                </Tooltip>
              ))}
            </div>
          ) : null}
        </Section>
      </div>

      <AddAppsDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          const id = focusAfterDialog.current;
          if (!open && id) {
            focusAfterDialog.current = null;
            setTimeout(() => focus(id), 320);
          }
        }}
        botId={botId}
        botName={bot.name}
        jobs={bot.jobs}
        added={addedIds}
        trust={trust}
        spendCapUsd={spendCapUsd}
        composioLive={composioLive}
        comingSoon={comingSoon}
        onAdded={(conn) => {
          setConnections((list) => (list.some((c) => c.id === conn.id) ? list.map((c) => (c.id === conn.id ? conn : c)) : [...list, conn]));
          // Scrolling behind an open dialog fights its scroll lock: show the row once it closes.
          focusAfterDialog.current = conn.connectorId;
        }}
        onConnect={(conn, plan) => connect(conn, plan)}
      />

      <TokenDialog request={tokenRequest} botName={bot.name} onClose={() => setTokenRequest(null)} onSubmit={submitToken} />

      <Dialog open={Boolean(removing)} onOpenChange={(o) => (!o && !removeBusy ? setRemoving(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removingName}?</DialogTitle>
            <DialogDescription>
              {bot.name} loses access right away and its sign-in is deleted. Your rules for it go too. You can add it again anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={removeBusy}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void remove()} loading={removeBusy}>
              Remove {removingName}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

