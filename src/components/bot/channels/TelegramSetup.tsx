"use client";
import * as React from "react";
import { ExternalLink, KeyRound, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { str, type ChannelCtx } from "./context";
import { isWaitingForOwner, type ChannelView } from "./model";
import { DemoLine, InfoRow, LinkQr, Mono, Step, Steps } from "./parts";

export function TelegramActive({ channel, ctx }: { channel: ChannelView; ctx: ChannelCtx }) {
  const handle = channel.address ?? (channel.username ? `@${channel.username}` : null);
  const username = (channel.username ?? handle ?? "").replace(/^@/, "");
  return (
    <div className="flex flex-col gap-3">
      {handle ? (
        <InfoRow label="Its handle">
          <Mono big>{handle}</Mono>
          <CopyButton value={handle} label="Copy" />
          {!channel.simulated && username ? (
            <Button asChild size="sm">
              <a href={`https://t.me/${username}`} target="_blank" rel="noreferrer">
                <Send /> Open in Telegram
              </a>
            </Button>
          ) : null}
        </InfoRow>
      ) : null}
      <p className="text-[13px] text-muted-foreground">Only you can give {ctx.botName} commands here. Anyone else who messages it gets a polite note that it&apos;s an AI assistant.</p>
      {channel.simulated ? <DemoLine>{handle ?? "This handle"} is a stand-in for demo mode; there&apos;s no real Telegram bot yet.</DemoLine> : null}
    </div>
  );
}

export function TelegramSetup({ channel, ctx }: { channel: ChannelView; ctx: ChannelCtx }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [managed, setManaged] = React.useState<{ link: string; suggested: string } | null>(null);
  const [tokenOpen, setTokenOpen] = React.useState(false);
  const [token, setToken] = React.useState("");
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const [start, setStart] = React.useState<{ username: string; startLink: string } | null>(null);
  const tokenId = React.useId();
  const waiting = isWaitingForOwner(channel);

  const createManaged = async () => {
    setBusy("managed");
    const data = await ctx.run("telegram", "managed");
    if (!data) {
      setBusy(null);
      setTokenOpen(true);
      return;
    }
    if (data.demo) {
      const done = await ctx.run("telegram", "demo_connect");
      await ctx.refresh();
      setBusy(null);
      if (done) toast.success(`Telegram is on (simulated): ${str(done.username) ?? "your bot"}. In demo mode nothing is really sent.`);
      return;
    }
    const link = str(data.link);
    if (link) {
      setManaged({ link, suggested: str(data.suggested) ?? "" });
      ctx.expect("telegram");
    }
    setBusy(null);
  };

  const connectToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(value)) {
      setTokenError("That doesn't look like a BotFather token (123456789:ABC…).");
      return;
    }
    setTokenError(null);
    setBusy("token");
    const data = await ctx.run("telegram", "token", { token: value });
    setBusy(null);
    if (!data) return;
    setToken("");
    const username = str(data.username);
    const startLink = str(data.startLink);
    if (username && startLink) setStart({ username, startLink });
    ctx.expect("telegram");
    await ctx.refresh();
    toast.success(`Connected @${username ?? "your bot"}. One more tap: open it and press Start.`);
  };

  const getStartLink = async () => {
    setBusy("start_link");
    const data = await ctx.run("telegram", "start_link");
    setBusy(null);
    const username = str(data?.username);
    const startLink = str(data?.startLink);
    if (username && startLink) {
      setStart({ username, startLink });
      ctx.expect("telegram");
    }
  };

  // Pasted token is in; the owner still has to press Start in Telegram.
  if (waiting) {
    const username = start?.username ?? channel.username ?? channel.address?.replace(/^@/, "") ?? "";
    return (
      <Steps>
        <Step n={1} state="done" title={`Connected @${username}`} hint="Your BotFather bot now runs on Build-a-bot." />
        <Step n={2} state="current" title="Open it and tap Start" hint="That's how it knows you're its owner. Only you can give it commands." last>
          {start ? (
            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-2">
                <Button asChild className="w-fit">
                  <a href={start.startLink} target="_blank" rel="noreferrer">
                    <Send /> Open @{start.username} in Telegram
                  </a>
                </Button>
                <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Spinner className="size-3.5" /> Waiting for you to tap Start…
                </span>
              </div>
              <LinkQr value={start.startLink} caption="Or scan with your phone" />
            </div>
          ) : (
            <Button className="w-fit" onClick={() => void getStartLink()} loading={busy === "start_link"}>
              <Send /> Get my link
            </Button>
          )}
        </Step>
      </Steps>
    );
  }

  return (
    <Steps>
      <Step
        n={1}
        state="current"
        title={`Create ${ctx.botName}'s Telegram bot`}
        hint={`Telegram makes a bot named ${ctx.botName} that only you can command. It's free.`}
      >
        {managed ? (
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-2">
              <Button asChild className="w-fit">
                <a href={managed.link} target="_blank" rel="noreferrer">
                  <Send /> Open Telegram <ExternalLink className="opacity-70" />
                </a>
              </Button>
              <p className="text-[13px] text-muted-foreground">
                Telegram asks you to confirm{managed.suggested ? <> <span className="font-mono text-foreground">@{managed.suggested}</span></> : null}. Tap Create and it turns on here by itself.
              </p>
              <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                <Spinner className="size-3.5" /> Waiting for Telegram…
              </span>
            </div>
            <LinkQr value={managed.link} caption="Or scan with your phone" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button onClick={() => void createManaged()} loading={busy === "managed"}>
              <Send /> Create my Telegram bot
            </Button>
            {!tokenOpen ? (
              <button type="button" onClick={() => setTokenOpen(true)} className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Use my own BotFather token
              </button>
            ) : null}
          </div>
        )}
        {tokenOpen && !managed ? (
          <form onSubmit={connectToken} className="flex flex-col gap-2 rounded-2xl border border-border bg-background-2/60 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="size-4 text-muted-foreground" /> Use your own bot
            </div>
            <ol className="list-decimal pl-5 text-[13px] text-muted-foreground">
              <li>
                In Telegram, message{" "}
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                  @BotFather
                </a>{" "}
                and send <span className="font-mono text-foreground">/newbot</span>.
              </li>
              <li>Pick a name and a username, then paste the token it gives you.</li>
            </ol>
            <Label htmlFor={tokenId} className="sr-only">
              BotFather token
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={tokenId}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setTokenError(null);
                }}
                placeholder="123456789:ABCdef…"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(tokenError)}
                className="h-11 font-mono text-sm"
              />
              <Button type="submit" loading={busy === "token"} disabled={!token.trim()} className="h-11 shrink-0">
                Connect
              </Button>
            </div>
            {tokenError ? <p className="text-xs font-medium text-danger">{tokenError}</p> : <FieldHint>Stored encrypted and never shown again.</FieldHint>}
          </form>
        ) : null}
      </Step>
      <Step n={2} state="upcoming" title="Say hi" hint={`Open it in Telegram and tap Start. ${ctx.botName} will introduce itself.`} last />
    </Steps>
  );
}
