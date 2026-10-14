"use client";
import * as React from "react";
import { ExternalLink, FlaskConical, KeyRound } from "lucide-react";
import { Button, Spinner } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { Note } from "@/components/bot/tools/Section";
import { str, type ChannelCtx } from "./context";
import { isWaitingForOwner, type ChannelView } from "./model";
import { DemoLine, InfoRow, Mono, Step, Steps } from "./parts";

export function SlackActive({ channel, ctx }: { channel: ChannelView; ctx: ChannelCtx }) {
  return (
    <div className="flex flex-col gap-3">
      <InfoRow label="Workspace">
        <Mono>{channel.address ?? "Your workspace"}</Mono>
      </InfoRow>
      <p className="text-[13px] text-muted-foreground">Open Slack and DM {ctx.botName} like a teammate. Only you can give it commands there.</p>
      {channel.simulated ? <DemoLine>In demo mode there&apos;s no real Slack app behind this yet.</DemoLine> : null}
    </div>
  );
}

export function SlackSetup({ channel, ctx }: { channel: ChannelView; ctx: ChannelCtx }) {
  const waiting = isWaitingForOwner(channel);
  const [manifestUrl, setManifestUrl] = React.useState<string | null>(null);
  const [opened, setOpened] = React.useState(false);
  const [botToken, setBotToken] = React.useState("");
  const [signingSecret, setSigningSecret] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const tokenId = React.useId();
  const secretId = React.useId();

  // Get the "create app" link up front, so opening Slack is a real click (no popup blockers).
  React.useEffect(() => {
    if (waiting) return;
    let alive = true;
    void ctx.run("slack", "manifest").then((data) => {
      if (alive) setManifestUrl(str(data?.manifestUrl));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken.trim().startsWith("xoxb-")) {
      toast.error("The Bot User OAuth Token starts with xoxb-.");
      return;
    }
    if (signingSecret.trim().length < 16) {
      toast.error("Paste the full Signing Secret.");
      return;
    }
    setBusy("tokens");
    const data = await ctx.run("slack", "tokens", { botToken: botToken.trim(), signingSecret: signingSecret.trim() });
    setBusy(null);
    if (!data) return;
    setBotToken("");
    setSigningSecret("");
    setCode(str(data.code));
    ctx.expect("slack");
    await ctx.refresh();
    toast.success("Slack keys saved. Last step: say the code to it in Slack.");
  };

  const newCode = async () => {
    setBusy("code");
    const data = await ctx.run("slack", "new_code");
    setBusy(null);
    const c = str(data?.code);
    if (c) {
      setCode(c);
      ctx.expect("slack");
    }
  };

  const demoConnect = async () => {
    setBusy("demo");
    const data = await ctx.run("slack", "demo_connect");
    await ctx.refresh();
    setBusy(null);
    if (data) toast.success("Slack is on (simulated). In demo mode nothing is really sent.");
  };

  if (waiting) {
    return (
      <Steps>
        <Step n={1} state="done" title={`Created ${ctx.botName}'s Slack app`} />
        <Step n={2} state="done" title={`Connected to ${channel.address ?? "your workspace"}`} />
        <Step n={3} state="current" title={`DM ${ctx.botName} in Slack and send the code`} hint="This proves it's you. Only you can give it commands." last>
          {code ? (
            <div className="flex flex-wrap items-center gap-2">
              <Mono big>link {code}</Mono>
              <CopyButton value={`link ${code}`} label="Copy" />
              <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                <Spinner className="size-3.5" /> Waiting for your message…
              </span>
            </div>
          ) : (
            <Button className="w-fit" onClick={() => void newCode()} loading={busy === "code"}>
              Get my code
            </Button>
          )}
        </Step>
      </Steps>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {ctx.demo ? (
        <Note tone="primary" icon={<FlaskConical />}>
          <span className="mr-2">Demo mode: skip the setup and try a simulated Slack connection.</span>
          <Button size="sm" variant="soft" className="mt-1.5 sm:mt-0" onClick={() => void demoConnect()} loading={busy === "demo"}>
            Try it simulated
          </Button>
        </Note>
      ) : null}
      <Steps>
        <Step
          n={1}
          state={opened ? "done" : "current"}
          title={`Create ${ctx.botName}'s Slack app`}
          hint={
            opened && manifestUrl ? (
              <>
                Made it in Slack and installed it?{" "}
                <a href={manifestUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                  Open Slack again
                </a>
              </>
            ) : (
              "Slack opens with everything filled in. Pick your workspace, click Create, then Install to Workspace."
            )
          }
        >
          {manifestUrl ? (
            <Button asChild className="w-fit">
              <a href={manifestUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>
                Open Slack <ExternalLink className="opacity-70" />
              </a>
            </Button>
          ) : (
            <Button className="w-fit" disabled>
              <Spinner /> Preparing your app…
            </Button>
          )}
          <button type="button" onClick={() => setOpened(true)} className="w-fit text-[13px] font-medium text-muted-foreground hover:text-foreground hover:underline">
            I already made it
          </button>
        </Step>
        <Step n={2} state={opened ? "current" : "upcoming"} title="Paste two keys from your app">
          <form onSubmit={connect} className="flex flex-col gap-3 rounded-2xl border border-border bg-background-2/60 p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={tokenId} className="flex items-center gap-1.5 text-[13px]">
                <KeyRound className="size-3.5 text-muted-foreground" /> Bot User OAuth Token
              </Label>
              <Input id={tokenId} value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="xoxb-…" autoComplete="off" spellCheck={false} className="h-11 font-mono text-sm" />
              <FieldHint>In your Slack app: OAuth & Permissions.</FieldHint>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={secretId} className="flex items-center gap-1.5 text-[13px]">
                <KeyRound className="size-3.5 text-muted-foreground" /> Signing Secret
              </Label>
              <Input id={secretId} type="password" value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} autoComplete="off" spellCheck={false} className="h-11 font-mono text-sm" />
              <FieldHint>Basic Information → App Credentials. Both are stored encrypted and never shown again.</FieldHint>
            </div>
            <Button type="submit" className="w-fit" loading={busy === "tokens"} disabled={!botToken.trim() || !signingSecret.trim()}>
              Connect Slack
            </Button>
          </form>
        </Step>
        <Step n={3} state="upcoming" title={`DM ${ctx.botName} a code`} hint="We'll give you a short code to send it, so it knows it's you." last />
      </Steps>
    </div>
  );
}
