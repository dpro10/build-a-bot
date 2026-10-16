"use client";
import * as React from "react";
import { Info, Plug, Plus, X } from "lucide-react";
import { ConnectorBrowser } from "@/components/catalog/ConnectorBrowser";
import { ALWAYS_ON } from "@/components/catalog/connector-meta";
import { BrandTile } from "@/components/brand/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { FAIR_USE } from "@/lib/billing/prices";
import { ALL_CONNECTORS, getConnector, type ConnectorDef } from "@/lib/connectors";
import { JOBS, JOB_BY_ID } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { countedApps } from "../state";
import { StepHeading } from "./StepHeading";

export function AppsStep({
  botName,
  jobs,
  connectors,
  customMcp,
  onJobs,
  onConnectors,
  onCustomMcp,
  demo,
  comingSoon,
}: {
  botName: string;
  jobs: string[];
  connectors: string[];
  customMcp: { url: string; name?: string }[];
  onJobs: (jobs: string[], connectors: string[]) => void;
  onConnectors: (connectors: string[]) => void;
  onCustomMcp: (servers: { url: string; name?: string }[]) => void;
  demo: boolean;
  /** Built-ins this server can't run yet. */
  comingSoon: string[];
}) {
  const [mcpOpen, setMcpOpen] = React.useState(false);
  const name = botName.trim() || "your bot";
  const limit = FAIR_USE.appsPerBot;
  const thirdParty = countedApps(connectors, customMcp);
  const overLimit = !demo && thirdParty > limit;

  const toggleJob = (id: string) => {
    const on = !jobs.includes(id);
    const nextJobs = on ? [...jobs, id] : jobs.filter((j) => j !== id);
    // Jobs bring their built-in tools along (web search for research, and so on), when this server runs them.
    const builtins = new Set(JOB_BY_ID[id as keyof typeof JOB_BY_ID]?.builtins ?? []);
    const stillNeeded = new Set(nextJobs.flatMap((j) => JOB_BY_ID[j as keyof typeof JOB_BY_ID]?.builtins ?? []));
    let next = connectors;
    if (on) next = [...new Set([...connectors, ...[...builtins].filter((b) => !ALWAYS_ON.has(b) && !comingSoon.includes(b))])];
    else next = connectors.filter((c) => !builtins.has(c) || stillNeeded.has(c));
    onJobs(nextJobs, next);
  };

  const toggle = (def: ConnectorDef) => {
    onConnectors(connectors.includes(def.id) ? connectors.filter((c) => c !== def.id) : [...connectors, def.id]);
  };

  const alwaysOn = ALL_CONNECTORS.filter((c) => ALWAYS_ON.has(c.id));

  return (
    <div className="flex flex-col gap-7">
      <StepHeading title="Give it your apps" subtitle={`Pick what ${name} can use. You'll sign in to each one afterwards — nothing is connected until you say so.`} />

      <section className="flex flex-col gap-3" aria-labelledby="jobs-heading">
        <h2 id="jobs-heading" className="font-display text-lg font-semibold">
          What should {name} help with?
        </h2>
        <div className="flex flex-wrap gap-2">
          {JOBS.filter((j) => j.id !== "other").map((j) => {
            const active = jobs.includes(j.id);
            return (
              <button
                key={j.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggleJob(j.id)}
                title={j.blurb}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.97]",
                  active ? "border-primary bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_rgb(109_77_255/0.7)]" : "border-border bg-card hover:border-foreground/30",
                )}
              >
                <span aria-hidden>{j.emoji}</span>
                {j.label}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">{jobs.length ? "We picked some apps that fit. Add or remove anything below." : "Pick a few and we'll suggest apps that fit."}</p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="apps-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="apps-heading" className="font-display text-lg font-semibold">
            Apps
          </h2>
          {thirdParty > 0 ? (
            <span className={cn("text-sm", overLimit ? "font-semibold text-warning" : "text-muted-foreground")}>
              {thirdParty} app{thirdParty === 1 ? "" : "s"}
              {overLimit ? ` of ${limit}` : ""}
            </span>
          ) : null}
        </div>
        {overLimit ? (
          <div className="flex items-start gap-2 rounded-2xl bg-warning-soft px-3.5 py-2.5 text-sm text-warning">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              A bot can connect up to {limit} apps. The first {limit} will be added now.
            </span>
          </div>
        ) : null}
        <ConnectorBrowser selected={connectors} onToggle={toggle} jobs={jobs} comingSoon={comingSoon} onCustomMcp={() => setMcpOpen(true)} />
      </section>

      <section className="flex flex-col gap-2 rounded-3xl border border-border bg-background-2/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Your own MCP servers</h2>
          <Button variant="soft" size="sm" onClick={() => setMcpOpen(true)}>
            <Plus /> Add by URL
          </Button>
        </div>
        {customMcp.length ? (
          <ul className="flex flex-col gap-1.5">
            {customMcp.map((m) => (
              <li key={m.url} className="flex items-center gap-2.5 rounded-2xl bg-card px-3 py-2 ring-1 ring-border">
                <BrandTile icon={{ lucide: "Plug", color: "64748B" }} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{m.name || new URL(m.url).host}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{m.url}</span>
                </span>
                <button type="button" onClick={() => onCustomMcp(customMcp.filter((x) => x.url !== m.url))} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${m.name || m.url}`}>
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Got a tool that speaks MCP? Paste its URL and {name} can use it too.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Always included:</span>
        {alwaysOn.map((c) => (
          <Badge key={c.id} tone="outline" className="gap-1.5 py-1 text-[12px] font-medium">
            <BrandTile icon={c.icon} size={16} variant="plain" />
            {c.name}
          </Badge>
        ))}
      </div>

      <CustomMcpDialog
        open={mcpOpen}
        onOpenChange={setMcpOpen}
        onAdd={(server) => {
          if (!customMcp.some((m) => m.url === server.url)) onCustomMcp([...customMcp, server]);
          setMcpOpen(false);
        }}
        full={customMcp.length >= 5}
      />
    </div>
  );
}

function CustomMcpDialog({ open, onOpenChange, onAdd, full }: { open: boolean; onOpenChange: (o: boolean) => void; onAdd: (s: { url: string; name?: string }) => void; full: boolean }) {
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setUrl("");
      setName("");
      setError(null);
    }
  }, [open]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      setError("That doesn't look like a URL.");
      return;
    }
    if (parsed.protocol !== "https:") {
      setError("Use the server's https:// address.");
      return;
    }
    onAdd({ url: parsed.toString(), name: name.trim() || undefined });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="size-5" /> Add an MCP server
            </DialogTitle>
            <DialogDescription>Any remote MCP server (Streamable HTTP). If it needs a sign-in, you&apos;ll do that after your bot is born.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-url">Server URL</Label>
              <Input id="mcp-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" inputMode="url" autoFocus aria-invalid={Boolean(error)} />
              {error ? <FieldHint className="text-danger">{error}</FieldHint> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-name">Name (optional)</Label>
              <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Team wiki" maxLength={60} />
            </div>
            <p className="text-xs text-muted-foreground">Its tools follow your trust settings like any other app: reading is fine, actions ask or run based on what you choose next.</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim() || full}>
              {full ? "Up to 5 servers" : "Add server"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
