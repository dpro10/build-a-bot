"use client";
import * as React from "react";
import { KeyRound, PlugZap, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { SettingsSection, useApiErrorToast } from "./ui";

type Created = { token: string; url: string; snippets: { claudeCode: string; json: { mcpServers: Record<string, unknown> } } };
type SnippetTab = "code" | "desktop" | "json";

export function McpSection({ botId, botName, mcpUrl, hasToken: initialHasToken }: { botId: string; botName: string; mcpUrl: string; hasToken: boolean }) {
  const onError = useApiErrorToast();
  const [hasToken, setHasToken] = React.useState(initialHasToken);
  const [created, setCreated] = React.useState<Created | null>(null);
  const [busy, setBusy] = React.useState<"create" | "revoke" | null>(null);
  const [confirm, setConfirm] = React.useState<"rotate" | "revoke" | null>(null);
  const [tab, setTab] = React.useState<SnippetTab>("code");

  const create = async () => {
    setBusy("create");
    try {
      const res = await api<Created>(`/api/bots/${botId}/mcp-token`, { method: "POST" });
      setCreated(res);
      setHasToken(true);
      setConfirm(null);
      toast.success(hasToken ? "New token made. The old one stopped working." : "Token created", { description: "Copy it now. You won't see it again." });
    } catch (err) {
      onError(err, "Couldn't make a token.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    try {
      await api(`/api/bots/${botId}/mcp-token`, { method: "DELETE" });
      setHasToken(false);
      setCreated(null);
      setConfirm(null);
      toast.success("Token revoked", { description: "Apps using it lost access right away." });
    } catch (err) {
      onError(err, "Couldn't revoke the token.");
    } finally {
      setBusy(null);
    }
  };

  const url = created?.url ?? mcpUrl;
  const serverName = created ? (Object.keys(created.snippets.json.mcpServers)[0] ?? "my-bot") : "my-bot";
  const desktop = created
    ? JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              command: "npx",
              args: ["-y", "mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: `Bearer ${created.token}` },
            },
          },
        },
        null,
        2,
      )
    : "";
  const snippet = created ? (tab === "code" ? created.snippets.claudeCode : tab === "desktop" ? desktop : JSON.stringify(created.snippets.json, null, 2)) : "";

  return (
    <SettingsSection
      id="mcp"
      icon={PlugZap}
      title="Use it from other AI apps"
      description={`Give Claude, Claude Code, Cursor or any MCP app access to ${botName}'s apps and tools. Your trust level, approvals and receipts still apply to every call.`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-semibold">Server address</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-2.5 font-mono text-sm">{url}</code>
            <CopyButton value={url} label="Copy" className="h-10 shrink-0" />
          </div>
        </div>

        {created ? (
          <div className="flex flex-col gap-4 animate-fade-up">
            <div className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning-soft p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <KeyRound className="size-4 text-warning" aria-hidden /> Your token, shown once
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 rounded-xl bg-card px-3 py-2.5 font-mono text-sm break-all ring-1 ring-border">{created.token}</code>
                <CopyButton value={created.token} label="Copy token" className="h-10 shrink-0 self-start sm:self-auto" />
              </div>
              <p className="text-xs text-muted-foreground">
                Copy it somewhere safe now. For your safety we keep only a fingerprint, so it can&apos;t be shown again. Anyone with it can use {botName}&apos;s tools.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Segmented
                aria-label="App"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "code", label: "Claude Code" },
                  { value: "desktop", label: "Claude Desktop" },
                  { value: "json", label: "Other apps" },
                ]}
                size="sm"
                className="self-start"
              />
              <p className="text-sm text-muted-foreground">
                {tab === "code"
                  ? "Run this in your terminal, then ask Claude to use your bot's tools."
                  : tab === "desktop"
                    ? "In Claude Desktop, open Settings → Developer → Edit Config, add this to claude_desktop_config.json and restart Claude. It needs Node.js."
                    : "For Cursor, VS Code and other apps that connect to MCP servers over HTTP. Paste it into the app's MCP settings, like .cursor/mcp.json or a project's .mcp.json."}
              </p>
              <div className="relative">
                <pre className="scrollbar-thin max-h-80 overflow-auto rounded-2xl border border-border bg-muted/70 p-4 pt-12 font-mono text-xs leading-relaxed whitespace-pre text-foreground">
                  {snippet}
                </pre>
                <span className="pointer-events-none absolute top-3.5 left-4 font-mono text-[11px] text-muted-foreground">
                  {tab === "code" ? "Terminal" : tab === "desktop" ? "claude_desktop_config.json" : "mcp.json"}
                </span>
                <CopyButton value={snippet} label="Copy" className="absolute top-2 right-2" />
              </div>
            </div>
          </div>
        ) : hasToken ? (
          <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm">
            <ShieldCheck className="size-5 shrink-0 text-success" aria-hidden />
            <p className="min-w-0 flex-1">
              <span className="font-semibold">A token is active.</span>{" "}
              <span className="text-muted-foreground">Lost it? Make a new one; the old one stops working.</span>
            </p>
            <Badge tone="success">On</Badge>
          </div>
        ) : (
          <p className="rounded-2xl bg-background-2/70 px-4 py-3 text-sm text-muted-foreground">
            No token yet, so nothing outside this app can use {botName}&apos;s tools.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {hasToken ? (
            <>
              <Button variant="danger-soft" onClick={() => setConfirm("revoke")} disabled={busy !== null}>
                <Trash2 /> Revoke
              </Button>
              <Button variant="outline" onClick={() => setConfirm("rotate")} disabled={busy !== null}>
                <RefreshCw /> Make a new token
              </Button>
            </>
          ) : (
            <Button onClick={create} loading={busy === "create"}>
              <KeyRound /> Create a token
            </Button>
          )}
        </div>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "revoke" ? "Revoke the token?" : "Make a new token?"}</DialogTitle>
            <DialogDescription>
              {confirm === "revoke"
                ? `Apps using it lose access to ${botName}'s tools right away.`
                : "The current token stops working right away. You'll need to paste the new one into your apps."}
            </DialogDescription>
          </DialogHeader>
          <div className="mx-6 flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            Claude Code, Claude Desktop or Cursor setups that use the old token will stop connecting.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            {confirm === "revoke" ? (
              <Button variant="danger" onClick={revoke} loading={busy === "revoke"}>
                Revoke
              </Button>
            ) : (
              <Button onClick={create} loading={busy === "create"}>
                Make a new token
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
