"use client";
import * as React from "react";
import { AtSign, BadgeCheck, Mail, Pencil, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { str, type ChannelCtx } from "./context";
import type { ChannelView } from "./model";
import { DemoLine, InfoRow, Mono, Step, Steps } from "./parts";
import { VerifyCodeForm } from "./VerifyCodeForm";

export function EmailSetup({ channel, ctx }: { channel: ChannelView; ctx: ChannelCtx }) {
  const [changing, setChanging] = React.useState(false);
  const botAddress = channel.address ?? ctx.botEmail ?? "";
  if (channel.ownerVerified && channel.status !== "needs_setup" && !changing) {
    return <EmailActive channel={channel} ctx={ctx} botAddress={botAddress} onChange={() => setChanging(true)} />;
  }
  return <EmailVerify channel={channel} ctx={ctx} botAddress={botAddress} onCancel={changing ? () => setChanging(false) : undefined} onDone={() => setChanging(false)} />;
}

function EmailVerify({
  channel,
  ctx,
  botAddress,
  onCancel,
  onDone,
}: {
  channel: ChannelView;
  ctx: ChannelCtx;
  botAddress: string;
  onCancel?: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = React.useState(channel.pendingOwnerAddress ?? (onCancel ? channel.ownerAddress : null) ?? ctx.ownerEmail ?? "");
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [demoCode, setDemoCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const emailId = React.useId();

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }
    setBusy(true);
    const data = await ctx.run("email", "send_code", { email: email.trim() });
    setBusy(false);
    if (!data) return;
    setSentTo(email.trim().toLowerCase());
    setDemoCode(str(data.demoCode));
    if (data.sent) toast.success(`Code sent from ${ctx.botName}'s own address. Check your inbox.`);
  };

  const verify = async (code: string) => {
    const data = await ctx.run("email", "verify", { code });
    if (!data) return false;
    await ctx.refresh();
    onDone();
    toast.success(`Verified! Email or forward anything to ${str(data.botAddress) ?? botAddress}.`);
    return true;
  };

  return (
    <div className="flex flex-col gap-4">
      <Steps>
        <Step
          n={1}
          state={sentTo ? "done" : "current"}
          title={sentTo ? `Code sent to ${sentTo}` : "Verify your email"}
          hint={sentTo ? undefined : `So ${ctx.botName} knows which emails are really from you. Only your address can give it instructions.`}
        >
          <form onSubmit={sendCode} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={emailId} className="text-[13px] text-muted-foreground">
                Your email
              </Label>
              <Input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 sm:w-72"
              />
            </div>
            <Button type="submit" loading={busy} className="h-11 shrink-0">
              <Mail /> Email me a code
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
                Keep my email
              </Button>
            ) : null}
          </form>
        </Step>
        <Step n={2} state={sentTo ? "current" : "upcoming"} title="Enter the 6-digit code" last>
          <VerifyCodeForm
            demoCode={demoCode}
            demoNote="Demo mode: no email was sent."
            onVerify={verify}
            onResend={() => void sendCode()}
            onChangeTarget={() => {
              setSentTo(null);
              setDemoCode(null);
            }}
            changeLabel="Use a different email"
          />
        </Step>
      </Steps>
      {botAddress ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border px-3 py-2.5 text-[13px] text-muted-foreground">
          <AtSign className="size-4 shrink-0" />
          Its own address will be <span className="font-mono text-foreground">{botAddress}</span>
        </div>
      ) : null}
    </div>
  );
}

function EmailActive({ channel, ctx, botAddress, onChange }: { channel: ChannelView; ctx: ChannelCtx; botAddress: string; onChange: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <InfoRow label="Its address">
        <Mono big className="text-[15px]">
          {botAddress}
        </Mono>
        <CopyButton value={botAddress} label="Copy" />
        <Button asChild size="sm" variant="soft">
          <a href={`mailto:${botAddress}`}>
            <Mail /> Email it
          </a>
        </Button>
      </InfoRow>
      <InfoRow label="Your email">
        <Mono>{channel.ownerAddress}</Mono>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
          <BadgeCheck className="size-3.5" /> Verified
        </span>
        <Button variant="ghost" size="sm" onClick={onChange} className="text-muted-foreground">
          <Pencil /> Change
        </Button>
      </InfoRow>
      <p className="text-[13px] text-muted-foreground">
        Email or forward anything to it: receipts, newsletters, long threads. {ctx.botName} reads them and replies from its own address.
      </p>
      <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" />
        The address is {ctx.botName}&apos;s own and never includes our product name, so it stays the same even if we rename.
      </p>
      {channel.simulated ? <DemoLine>In demo mode, mail to this address isn&apos;t really delivered.</DemoLine> : null}
    </div>
  );
}
