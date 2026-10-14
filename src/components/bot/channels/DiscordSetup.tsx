"use client";
import * as React from "react";
import { ExternalLink } from "lucide-react";
import { Button, Spinner } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { toast } from "@/components/ui/toaster";
import { str, type ChannelCtx } from "./context";
import type { ChannelView } from "./model";
import { DemoLine, Mono, Step, Steps } from "./parts";

export function DiscordActive({ channel, ctx }: { channel: ChannelView; ctx: ChannelCtx }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Linked to your Discord account. Type <Mono>/ask</Mono> in any DM or server to talk to {ctx.botName}.
      </p>
      {channel.simulated ? <DemoLine>In demo mode there&apos;s no real Discord app behind this yet.</DemoLine> : null}
    </div>
  );
}

export function DiscordSetup({ ctx }: { channel: ChannelView; ctx: ChannelCtx }) {
  const [busy, setBusy] = React.useState(false);
  const [link, setLink] = React.useState<{ code: string; installUrl: string | null } | null>(null);

  const start = async () => {
    setBusy(true);
    const data = await ctx.run("discord", "link");
    setBusy(false);
    if (!data) return;
    if (data.simulated) {
      await ctx.refresh();
      toast.success("Discord is on (simulated). In demo mode nothing is really sent.");
      return;
    }
    const code = str(data.code);
    if (code) {
      setLink({ code, installUrl: str(data.installUrl) });
      ctx.expect("discord");
    }
  };

  const command = link ? `/link code:${link.code}` : "";
  return (
    <Steps>
      <Step n={1} state={link ? "done" : "current"} title={`Add ${ctx.botName} to Discord`} hint="It works in your DMs and in any server you add it to.">
        <Button className="w-fit" onClick={() => void start()} loading={busy}>
          Link Discord
        </Button>
      </Step>
      <Step n={2} state={link ? "current" : "upcoming"} title="Install the app" hint="Discord asks you to confirm. Choose “Add to my apps”.">
        {link?.installUrl ? (
          <Button asChild className="w-fit">
            <a href={link.installUrl} target="_blank" rel="noreferrer">
              Add to Discord <ExternalLink className="opacity-70" />
            </a>
          </Button>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-muted-foreground">Then type this in any Discord chat:</span>
          <div className="flex flex-wrap items-center gap-2">
            <Mono big>{command}</Mono>
            <CopyButton value={command} label="Copy" />
          </div>
          <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
            <Spinner className="size-3.5" /> Waiting for you to link…
          </span>
        </div>
      </Step>
      <Step n={3} state="upcoming" title="Say hi with /ask" last />
    </Steps>
  );
}
