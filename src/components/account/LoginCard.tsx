"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, FlaskConical, Mail, MailCheck, RotateCw, TriangleAlert } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api, ApiError } from "@/lib/client/api";
import { cn, isEmail } from "@/lib/utils";
import type { AvatarId, AvatarMood, ColorwayId } from "@/lib/avatars";
import { clock } from "./time";

export type PeekBot = { name: string; avatar: AvatarId; color: ColorwayId };

const RESEND_COOLDOWN_MS = 30_000;

const FRIENDS: PeekBot[] = [
  { name: "Blip", avatar: "blip", color: "ocean" },
  { name: "Otto", avatar: "otto", color: "grape" },
  { name: "Sprout", avatar: "sprout", color: "mint" },
  { name: "Ember", avatar: "ember", color: "coral" },
  { name: "Nimbus", avatar: "nimbus", color: "sky" },
];

const LINK_ERRORS: Record<string, { title: string; text: string }> = {
  expired: {
    title: "That link has expired",
    text: "Sign-in links work once and last 20 minutes. Enter your email and we'll send you a fresh one.",
  },
  missing: {
    title: "That link looks incomplete",
    text: "Make sure you opened the whole link from the email, or get a new one below.",
  },
};

function listNames(bots: PeekBot[]): string {
  if (bots.length === 1) return bots[0].name;
  if (bots.length === 2) return `${bots[0].name} and ${bots[1].name}`;
  return `your ${bots.length} bots`;
}

const SPARE_COLORS: ColorwayId[] = ["grape", "mint", "sunny", "rose", "coral", "sky", "ocean"];

/** Three characters peeking over the top of the card: the visitor's own bots first. */
function peekers(bots: PeekBot[]): PeekBot[] {
  const mine = bots.slice(0, 3);
  const used = new Set(mine.map((m) => m.color));
  const fill = FRIENDS.filter((f) => !mine.some((m) => m.avatar === f.avatar)).map((f) => {
    // Keep the trio colorful: no two characters in the same colorway.
    const color = used.has(f.color) ? (SPARE_COLORS.find((c) => !used.has(c)) ?? f.color) : f.color;
    used.add(color);
    return { ...f, color };
  });
  const three = [...mine, ...fill].slice(0, 3);
  // Their own (first) bot takes the middle spot.
  return [three[1], three[0], three[2]];
}

export function LoginCard({
  next,
  error,
  mode,
  bots,
}: {
  next: string;
  error: string | null;
  mode: "signin" | "save";
  bots: PeekBot[];
}) {
  const [email, setEmail] = React.useState("");
  const [step, setStep] = React.useState<"form" | "sent">("form");
  const [sending, setSending] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [linkError, setLinkError] = React.useState<string | null>(error);
  const [sentTo, setSentTo] = React.useState("");
  const [demoLink, setDemoLink] = React.useState<string | null>(null);
  // Demo servers ask the operator's own (admin) emails for the admin code too.
  const [needsAdminCode, setNeedsAdminCode] = React.useState(false);
  const [adminCode, setAdminCode] = React.useState("");
  const adminCodeRef = React.useRef<HTMLInputElement>(null);
  const [cooldownUntil, setCooldownUntil] = React.useState(0);
  const [now, setNow] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const sentHeadingRef = React.useRef<HTMLHeadingElement>(null);

  // Tick once a second only while the resend button is cooling down.
  React.useEffect(() => {
    if (!cooldownUntil) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= cooldownUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  React.useEffect(() => {
    if (step === "sent") sentHeadingRef.current?.focus();
  }, [step]);

  const saving = mode === "save";
  const valid = isEmail(email);
  const coolingMs = Math.max(0, cooldownUntil - now);
  const friends = peekers(bots);
  const moods: AvatarMood[] = sending
    ? ["thinking", "thinking", "thinking"]
    : step === "sent"
      ? ["happy", "happy", "happy"]
      : fieldError || linkError
        ? ["idle", "alert", "idle"]
        : valid
          ? ["happy", "happy", "happy"]
          : ["idle", "idle", "idle"];

  const send = async (address: string, opts: { resend?: boolean } = {}) => {
    const value = address.trim().toLowerCase();
    if (!isEmail(value)) {
      setFieldError("That doesn't look like an email address yet.");
      inputRef.current?.focus();
      return;
    }
    setSending(true);
    setFieldError(null);
    try {
      const res = await api<{ sent: boolean; demoLink: string | null }>("/api/auth/magic", {
        body: { email: value, next, ...(needsAdminCode && adminCode.trim() ? { adminCode: adminCode.trim() } : {}) },
      });
      // Keep the link on whatever host this page is on (the server builds it from APP_URL).
      let link = res.demoLink;
      if (link) {
        try {
          const u = new URL(link);
          link = `${u.pathname}${u.search}`;
        } catch {
          /* keep as is */
        }
      }
      setSentTo(value);
      setDemoLink(link);
      setLinkError(null);
      setStep("sent");
      setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      if (opts.resend) toast.success(res.sent ? "Sent a fresh link. Check your inbox." : "Here's a fresh link.");
    } catch (err) {
      const message = (err as Error).message || "Couldn't send the link. Try again.";
      if (err instanceof ApiError && err.data.needsAdminCode) {
        setNeedsAdminCode(true);
        setFieldError(message);
        requestAnimationFrame(() => adminCodeRef.current?.focus());
      } else if (opts.resend) toast.error(message);
      else setFieldError(message);
    } finally {
      setSending(false);
    }
  };

  const differentEmail = () => {
    setStep("form");
    setDemoLink(null);
    setCooldownUntil(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const linkProblem = linkError ? (LINK_ERRORS[linkError] ?? { title: "We couldn't sign you in", text: "Please try again with a new link." }) : null;

  return (
    <div className="w-full max-w-[440px]">
      <style>{`
        @keyframes bab-peek { 0% { transform: translateY(75%); opacity: 0 } 55% { opacity: 1 } 80% { transform: translateY(-6%) } 100% { transform: translateY(0); opacity: 1 } }
        .bab-peek { animation: bab-peek 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both }
      `}</style>

      {/* The characters sit behind the card; its top edge hides their lower half. */}
      <div aria-hidden className="pointer-events-none relative z-0 -mb-[26px] flex items-end justify-center">
        <div className="bab-peek -mr-1 -translate-y-1 -rotate-[8deg]" style={{ animationDelay: "140ms" }}>
          <Avatar avatar={friends[0].avatar} color={friends[0].color} size={84} mood={moods[0]} />
        </div>
        <div className="bab-peek relative z-[1]" style={{ animationDelay: "0ms" }}>
          <Avatar avatar={friends[1].avatar} color={friends[1].color} size={108} mood={moods[1]} />
        </div>
        <div className="bab-peek -ml-1 -translate-y-1 rotate-[8deg]" style={{ animationDelay: "260ms" }}>
          <Avatar avatar={friends[2].avatar} color={friends[2].color} size={84} mood={moods[2]} />
        </div>
      </div>

      <div className="relative z-10 rounded-3xl border border-border bg-card p-6 shadow-lift sm:p-8">
        {step === "form" ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void send(email);
            }}
            className="flex flex-col"
          >
            <h1 className="text-center font-display text-[28px] leading-tight font-bold">{saving ? "Save your account" : "Welcome back"}</h1>
            <p className="mt-2 text-center text-[15px] text-muted-foreground">
              {saving ? (
                <>
                  Add your email so you never lose <span className="font-semibold text-foreground">{listNames(bots)}</span>. Then you can sign in from any device.
                </>
              ) : (
                "Enter your email and we'll send you a magic link. No password to remember."
              )}
            </p>

            {linkProblem ? (
              <div role="alert" className="mt-5 flex gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-3.5 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div>
                  <div className="font-semibold">{linkProblem.title}</div>
                  <div className="text-foreground/80">{linkProblem.text}</div>
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-2">
              <Label htmlFor="login-email">Email</Label>
              <Input
                ref={inputRef}
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldError) setFieldError(null);
                  if (needsAdminCode) setNeedsAdminCode(false);
                }}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? "login-email-error" : saving ? "login-email-hint" : undefined}
                className={cn(fieldError && "border-danger focus:border-danger focus:ring-danger/15")}
              />
              {fieldError ? (
                <p id="login-email-error" className="text-sm font-medium text-danger">
                  {fieldError}
                </p>
              ) : saving ? (
                <FieldHint id="login-email-hint">
                  Already have an account? Use its email and we&apos;ll move {bots.length === 1 ? bots[0].name : "these bots"} into it.
                </FieldHint>
              ) : null}
            </div>

            {needsAdminCode ? (
              <div className="mt-4 flex flex-col gap-2">
                <Label htmlFor="login-admin-code">Admin code</Label>
                <Input
                  ref={adminCodeRef}
                  id="login-admin-code"
                  type="password"
                  autoComplete="current-password"
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                />
              </div>
            ) : null}

            <Button type="submit" size="lg" className="mt-5 w-full" loading={sending}>
              {sending ? "Sending…" : (
                <>
                  <Mail /> Email me a magic link
                </>
              )}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <MailCheck className="size-7" aria-hidden />
            </span>
            <h1 ref={sentHeadingRef} tabIndex={-1} className="mt-4 font-display text-[28px] leading-tight font-bold outline-none">
              Check your email
            </h1>
            <p className="mt-2 text-[15px] text-muted-foreground">
              We sent a magic link to <span className="font-semibold break-all text-foreground">{sentTo}</span>. Open it on this device to{" "}
              {saving ? "save your account" : "sign in"}. It works once and expires in 20 minutes.
            </p>

            {demoLink ? (
              <div className="mt-5 w-full rounded-2xl border border-dashed border-warning/50 bg-warning-soft/70 p-4 text-left">
                <div className="flex items-center gap-2 text-sm font-semibold text-warning">
                  <FlaskConical className="size-4" aria-hidden /> Demo mode
                </div>
                <p className="mt-1 text-sm text-foreground/80">No email is sent on this demo server, so here&apos;s your link:</p>
                <Button asChild size="xl" className="mt-3 w-full">
                  <a href={demoLink}>
                    Open the sign-in link <ArrowRight />
                  </a>
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">Demo only — on the real site this link only ever arrives in your inbox.</p>
              </div>
            ) : (
              <p className="mt-4 rounded-2xl bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
                Can&apos;t find it? Check spam or promotions. It&apos;s from Build-a-bot.
              </p>
            )}

            <div className="mt-5 flex w-full flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void send(sentTo, { resend: true })}
                disabled={coolingMs > 0}
                loading={sending}
                aria-live="polite"
              >
                {!sending ? <RotateCw /> : null}
                {coolingMs > 0 ? `Resend in ${clock(coolingMs)}` : "Resend link"}
              </Button>
              <Button variant="ghost" className="flex-1" onClick={differentEmail}>
                <ArrowLeft /> Use a different email
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 text-center text-sm">
        {saving ? (
          <Link href={next} className="text-muted-foreground transition hover:text-foreground">
            Not now? <span className="font-semibold text-foreground underline-offset-4 hover:underline">Back to your bots</span>
          </Link>
        ) : (
          <Link href="/build" className="group text-muted-foreground transition hover:text-foreground">
            New here?{" "}
            <span className="font-semibold text-primary underline-offset-4 group-hover:underline">
              Build your bot — no account needed <ArrowRight className="inline size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        )}
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Build-a-bot is for adults 18+. By continuing, you agree to our{" "}
          <Link href="/legal/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
