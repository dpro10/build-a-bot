"use client";
import * as React from "react";
import { BellRing, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { cn, isEmail } from "@/lib/utils";

/**
 * A paid plan that's coming soon: join its waitlist (feature "plan:plus" or "plan:pro") so we can
 * email when it opens. With a known email it's one tap; otherwise it asks for one.
 */
export function PlanWaitlist({
  plan,
  email,
  size = "lg",
  className,
}: {
  plan: Exclude<PlanId, "free">;
  /** The signed-in person's email, if they have one. */
  email: string | null;
  size?: "md" | "lg";
  className?: string;
}) {
  const [asking, setAsking] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [joined, setJoined] = React.useState(false);
  const inputId = React.useId();
  const name = PLANS[plan].name;
  const height = size === "lg" ? "h-12" : "h-10";

  const join = async (address: string) => {
    if (!isEmail(address)) {
      toast.error("Enter a valid email so we can tell you.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/waitlist", { body: { email: address.trim().toLowerCase(), feature: `plan:${plan}` } });
      setJoined(true);
      toast.success(`You're on the list for ${name}. We'll email you when it's ready.`);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't add you. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (joined) {
    return (
      <p role="status" className={cn("inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-success-soft text-sm font-semibold text-success", height, className)}>
        <Check className="size-4" strokeWidth={3} aria-hidden /> You&apos;re on the list
      </p>
    );
  }

  if (asking) {
    return (
      <form
        className={cn("flex w-full gap-2", className)}
        onSubmit={(e) => {
          e.preventDefault();
          void join(value);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Email for the {name} waitlist
        </label>
        <Input
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={cn("min-w-0 flex-1 text-[15px]", height)}
        />
        <Button type="submit" size={size} loading={busy} className="shrink-0">
          Join
        </Button>
      </form>
    );
  }

  return (
    <Button variant="outline" size={size} className={cn("w-full", className)} loading={busy} onClick={() => (email ? void join(email) : setAsking(true))}>
      {!busy ? <BellRing /> : null} Join the waitlist
    </Button>
  );
}
