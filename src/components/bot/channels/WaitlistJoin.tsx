"use client";
import * as React from "react";
import { BellRing, Check } from "lucide-react";
import type { ChannelKind } from "@/lib/channels/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

/** The honest reason a channel is waitlisted, in plain words. */
export const WAITLIST_WHY: Partial<Record<ChannelKind, string>> = {
  whatsapp:
    "Meta's rules block general-purpose AI assistants on WhatsApp in the US. We'll open it where it's allowed and tell you the moment it's ready.",
  imessage:
    "Apple doesn't offer an approved way for assistants like this to use iMessage. Today it only works through gateways Apple hasn't sanctioned, so we're waiting for a proper path instead of risking your Apple ID.",
};

export function WaitlistJoin({
  name,
  joined,
  ownerEmail,
  onJoin,
  compact,
}: {
  name: string;
  joined: boolean;
  ownerEmail: string | null;
  onJoin: (email?: string) => Promise<boolean>;
  compact?: boolean;
}) {
  const [asking, setAsking] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (joined) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1.5 text-sm font-semibold text-success">
        <Check className="size-4" strokeWidth={3} /> You&apos;re on the list
      </span>
    );
  }

  const join = async (value?: string) => {
    setBusy(true);
    const ok = await onJoin(value);
    setBusy(false);
    if (ok) setAsking(false);
  };

  if (asking) {
    return (
      <form
        className="flex w-full flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
            toast.error("Enter a valid email so we can tell you.");
            return;
          }
          void join(email.trim());
        }}
      >
        <Input type="email" autoComplete="email" autoFocus placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 sm:w-64" aria-label={`Email for the ${name} waitlist`} />
        <Button type="submit" loading={busy} className="shrink-0">
          Join
        </Button>
      </form>
    );
  }

  return (
    <Button variant={compact ? "outline" : "soft"} size={compact ? "sm" : "md"} loading={busy} onClick={() => (ownerEmail ? void join() : setAsking(true))}>
      <BellRing /> Join the waitlist
    </Button>
  );
}
