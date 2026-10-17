"use client";
import * as React from "react";
import { BadgeCheck, MessageSquareText, Phone, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Label, tidyUsPhone, UsPhoneInput } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { str, type ChannelCtx } from "./context";
import { formatPhone, type ChannelView } from "./model";
import { DemoLine, InfoRow, Mono, Step, Steps } from "./parts";
import { VerifyCodeForm } from "./VerifyCodeForm";

/** Texts and calls: prove the owner's number with a code, then show how to reach the bot. */
export function PhoneSetup({ channel, ctx }: { channel: ChannelView; ctx: ChannelCtx }) {
  const kind = channel.kind as "sms" | "voice";
  const [changing, setChanging] = React.useState(false);
  const verified = channel.ownerVerified && channel.status !== "needs_setup" && !changing;

  if (verified) return <PhoneActive channel={channel} ctx={ctx} onChange={() => setChanging(true)} />;
  return <PhoneVerify channel={channel} ctx={ctx} kind={kind} onCancel={changing ? () => setChanging(false) : undefined} onDone={() => setChanging(false)} />;
}

function PhoneVerify({
  channel,
  ctx,
  kind,
  onCancel,
  onDone,
}: {
  channel: ChannelView;
  ctx: ChannelCtx;
  kind: "sms" | "voice";
  onCancel?: () => void;
  onDone: () => void;
}) {
  const [phone, setPhone] = React.useState(tidyUsPhone(channel.pendingOwnerAddress ?? (onCancel ? channel.ownerAddress : null) ?? ""));
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [sentVia, setSentVia] = React.useState<"sms" | "call">("sms");
  const [demoCode, setDemoCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"sms" | "call" | null>(null);
  const phoneId = React.useId();
  // Calls first for the calls channel. Either works for both: a call also reaches numbers a new
  // bot number can't text yet.
  const order: ("sms" | "call")[] = kind === "voice" ? ["call", "sms"] : ["sms", "call"];

  const sendCode = async (via: "sms" | "call", e?: React.FormEvent) => {
    e?.preventDefault();
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Enter your 10-digit mobile number, area code first.");
      return;
    }
    setBusy(via);
    const data = await ctx.run(kind, "send_code", { phone, via });
    setBusy(null);
    if (!data) return;
    setSentTo(phone);
    setSentVia(via);
    setDemoCode(str(data.demoCode));
    if (data.sent) toast.success(via === "call" ? "Calling you now. Pick up to hear your code." : "Code sent. It can take a few seconds to arrive.");
  };

  const verify = async (code: string) => {
    const data = await ctx.run(kind, "verify", { code });
    if (!data) return false;
    await ctx.refresh();
    onDone();
    toast.success(kind === "voice" ? `Verified! You can call ${ctx.botName} now, and it can call you.` : `Verified! Text ${ctx.botName} anytime.`);
    return true;
  };

  return (
    <div className="flex flex-col gap-4">
      <Steps>
        <Step
          n={1}
          state={sentTo ? "done" : "current"}
          title={sentTo ? (sentVia === "call" ? `Calling ${formatPhone(sentTo) || sentTo} with your code` : `Code sent to ${formatPhone(sentTo) || sentTo}`) : "Verify your mobile number"}
          hint={sentTo ? undefined : `Only this number can give ${ctx.botName} commands. US and Canada numbers to start.`}
        >
          <form onSubmit={(e) => void sendCode(order[0], e)} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={phoneId} className="text-[13px] text-muted-foreground">
                Your mobile number
              </Label>
              <UsPhoneInput id={phoneId} value={phone} onValueChange={setPhone} className="h-11 sm:w-60" />
            </div>
            {order.map((via, i) => (
              <Button
                key={via}
                type={i === 0 ? "submit" : "button"}
                variant={i === 0 ? undefined : "outline"}
                loading={busy === via}
                disabled={busy !== null && busy !== via}
                onClick={i === 0 ? undefined : () => void sendCode(via)}
                className="h-11 shrink-0"
              >
                {via === "call" ? <Phone /> : <MessageSquareText />} {via === "call" ? "Call me with a code" : "Text me a code"}
              </Button>
            ))}
            {onCancel ? (
              <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
                Keep my number
              </Button>
            ) : null}
          </form>
        </Step>
        <Step n={2} state={sentTo ? "current" : "upcoming"} title="Enter the 6-digit code" last>
          <VerifyCodeForm
            demoCode={demoCode}
            demoNote={sentVia === "call" ? "Demo mode: no call was made." : "Demo mode: no text was sent."}
            onVerify={verify}
            onResend={() => void sendCode(sentVia)}
            other={sentVia === "sms" ? { label: "No text? Call me with it", onClick: () => void sendCode("call") } : { label: "Text it to me instead", onClick: () => void sendCode("sms") }}
            onChangeTarget={() => {
              setSentTo(null);
              setDemoCode(null);
            }}
            changeLabel="Use a different number"
          />
        </Step>
      </Steps>
    </div>
  );
}

function PhoneActive({ channel, ctx, onChange }: { channel: ChannelView; ctx: ChannelCtx; onChange: () => void }) {
  const isVoice = channel.kind === "voice";
  const botNumber = channel.address;
  return (
    <div className="flex flex-col gap-3">
      <InfoRow label="Your number">
        <Mono>{formatPhone(channel.ownerAddress) || channel.ownerAddress}</Mono>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
          <BadgeCheck className="size-3.5" /> Verified
        </span>
        <Button variant="ghost" size="sm" onClick={onChange} className="text-muted-foreground">
          <Pencil /> Change
        </Button>
      </InfoRow>
      <InfoRow label="Its number">
        {botNumber ? (
          <>
            <Mono big>{formatPhone(botNumber)}</Mono>
            <CopyButton value={botNumber} label="Copy" />
            {isVoice ? (
              <Button asChild size="sm">
                <a href={`tel:${botNumber}`}>
                  <Phone /> Call it
                </a>
              </Button>
            ) : (
              <Button asChild size="sm">
                <a href={`sms:${botNumber}`}>
                  <MessageSquareText /> Text it
                </a>
              </Button>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Its number shows up here once {isVoice ? "calling" : "texting"} is live.</span>
        )}
      </InfoRow>
      {channel.simulated ? (
        <DemoLine>Nothing is really {isVoice ? "dialed" : "texted"} in demo mode. {isVoice ? "Test calls" : "Test messages"} show up in Activity, so you can see exactly what would go out.</DemoLine>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {isVoice
            ? `Call ${ctx.botName} to talk out loud, or let it call you with your morning brief. Say "stop" anytime to pause it.`
            : `Text ${ctx.botName} like a friend from your verified number. Text PAUSE anytime to stop everything it's doing.`}
        </p>
      )}
    </div>
  );
}
