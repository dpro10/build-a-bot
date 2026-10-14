"use client";
/**
 * The builder: face → name → brain → apps → trust → channels → review.
 * One screen per decision, a live preview of the bot assembling itself, and the
 * bot greets its owner first the moment it's born.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { api, ApiError } from "@/lib/client/api";
import { AVATARS } from "@/lib/avatars";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import type { RecipeData } from "@/lib/recipes";
import { cn } from "@/lib/utils";
import { BotPreview, BotPreviewStrip } from "./BotPreview";
import { clearDraft, initialState, loadDraft, saveDraft, STEPS, stepError, type BuilderState, type StepId } from "./state";
import { AppsStep } from "./steps/AppsStep";
import { BrainStep, type KeyStatus } from "./steps/BrainStep";
import { ChannelsStep, type LiveFlags } from "./steps/ChannelsStep";
import { FaceStep } from "./steps/FaceStep";
import { NameStep } from "./steps/NameStep";
import { ReviewStep } from "./steps/ReviewStep";
import { TrustStep } from "./steps/TrustStep";

export type BuilderProps = {
  plan: PlanId;
  demo: boolean;
  live: LiveFlags;
  recipe: (RecipeData & { slug: string; tagline?: string }) | null;
  botCount: number;
  signedIn: boolean;
};

export function Builder({ plan, demo, live, recipe, botCount, signedIn }: BuilderProps) {
  const router = useRouter();
  const [state, setState] = React.useState<BuilderState>(() => initialState(recipe));
  const [stepIndex, setStepIndex] = React.useState(0);
  const [maxReached, setMaxReached] = React.useState(recipe ? STEPS.length - 1 : 0);
  const [apiKey, setApiKeyState] = React.useState("");
  const [keyStatus, setKeyStatus] = React.useState<KeyStatus>("idle");
  const [keyMessage, setKeyMessage] = React.useState<string | null>(null);
  const [typing, setTyping] = React.useState(false);
  const [showError, setShowError] = React.useState(false);
  const [creating, setCreating] = React.useState<null | "working" | "done">(null);
  const [timezone, setTimezone] = React.useState("UTC");
  const [hydrated, setHydrated] = React.useState(false);
  const topRef = React.useRef<HTMLDivElement>(null);

  const step = STEPS[stepIndex].id;
  const atBotLimit = botCount >= PLANS[plan].limits.bots;
  const error = stepError(step, state, { apiKey, keyStatus });

  const update = React.useCallback((patch: Partial<BuilderState>) => {
    setState((s) => ({ ...s, ...patch }));
    setShowError(false);
  }, []);

  // Restore a saved draft (unless a recipe link brought them here) and detect the time zone.
  const restoredOnce = React.useRef(false);
  React.useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    if (!recipe) {
      const draft = loadDraft();
      if (draft && (draft.state.name || draft.step > 0)) {
        setState((s) => ({ ...s, ...draft.state, brief: draft.state.brief ?? s.brief, ageConfirmed: false }));
        setStepIndex(draft.step);
        setMaxReached(draft.step);
        toast("Picked up where you left off", {
          action: {
            label: "Start over",
            onClick: () => {
              clearDraft();
              setState(initialState(null));
              setStepIndex(0);
              setMaxReached(0);
            },
          },
        });
      }
    }
    setHydrated(true);
  }, [recipe]);

  React.useEffect(() => {
    if (hydrated && !creating) saveDraft(state, stepIndex);
  }, [state, stepIndex, hydrated, creating]);

  const setApiKey = (k: string) => {
    setApiKeyState(k);
    setKeyStatus("idle");
    setKeyMessage(null);
  };

  const validateKey = React.useCallback(async (): Promise<boolean> => {
    if (state.brain.kind !== "byok" || apiKey.trim().length < 8) return false;
    setKeyStatus("checking");
    setKeyMessage(null);
    try {
      const res = await api<{ ok: boolean; message?: string; unverified?: boolean }>("/api/brain/validate", {
        body: { provider: state.brain.provider, apiKey: apiKey.trim(), ...(state.brain.provider === "custom" && state.brain.baseUrl ? { baseUrl: state.brain.baseUrl } : {}) },
      });
      if (res.ok) {
        setKeyStatus("ok");
        setKeyMessage(res.unverified ? (res.message ?? "Saved without a live check.") : "Key works. It's encrypted the moment you finish.");
        return true;
      }
      setKeyStatus("error");
      setKeyMessage(res.message ?? "That key didn't work.");
      return false;
    } catch (err) {
      setKeyStatus("error");
      setKeyMessage((err as Error).message);
      return false;
    }
  }, [apiKey, state.brain]);

  const goTo = (i: number) => {
    setStepIndex(i);
    setMaxReached((m) => Math.max(m, i));
    setShowError(false);
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const next = async () => {
    if (step === "brain" && state.brain.kind === "byok" && keyStatus === "idle" && apiKey.trim().length >= 8) {
      const ok = await validateKey();
      if (!ok) {
        setShowError(true);
        return;
      }
    } else if (error) {
      setShowError(true);
      return;
    }
    if (stepIndex < STEPS.length - 1) goTo(stepIndex + 1);
  };

  const back = () => stepIndex > 0 && goTo(stepIndex - 1);

  const create = async () => {
    const err = stepError("review", state, { apiKey, keyStatus });
    if (err) {
      setShowError(true);
      toast.error(err);
      return;
    }
    if (state.brain.kind === "byok" && apiKey.trim().length < 8) {
      toast.error("Your API key is missing — add it again on the Brain step.");
      goTo(STEPS.findIndex((s) => s.id === "brain"));
      return;
    }
    setCreating("working");
    const started = Date.now();
    try {
      const needsPhone = state.channels.includes("sms") || state.channels.includes("voice") || state.channels.includes("whatsapp") || state.channels.includes("imessage");
      const b = state.brain;
      const brain =
        b.kind === "included"
          ? { kind: "included", model: b.model, effort: b.effort }
          : b.kind === "subscription"
            ? { kind: "subscription", subscription: b.subscription, model: b.model, whenOffline: b.whenOffline }
            : { kind: "byok", provider: b.provider, model: b.model, apiKey: apiKey.trim(), ...(b.provider === "custom" && b.baseUrl ? { baseUrl: b.baseUrl } : {}) };
      const res = await api<{ id: string; notes: string[]; upgrade: string | null }>("/api/bots", {
        body: {
          avatar: state.avatar,
          color: state.color,
          name: state.name.trim(),
          jobs: state.jobs,
          ...(state.instructions.trim() ? { instructions: state.instructions.trim() } : {}),
          brain,
          connectors: state.connectors,
          customMcp: state.customMcp,
          trust: state.trust,
          channels: state.channels,
          contact: {
            ...(needsPhone && state.phone.trim() ? { phone: state.phone.trim() } : {}),
            ...(state.channels.includes("email") && state.email.trim() ? { email: state.email.trim() } : {}),
          },
          ...(state.ownerName.trim() ? { ownerName: state.ownerName.trim() } : {}),
          timezone,
          ageConfirmed: true,
          ...(state.recipeSlug ? { recipeId: state.recipeSlug } : {}),
          morningBrief: state.brief?.on ? { time: state.brief.time, ...(state.brief.weekdays ? { days: [1, 2, 3, 4, 5] } : {}) } : null,
        },
      });
      clearDraft();
      setApiKeyState("");
      await new Promise((r) => setTimeout(r, Math.max(0, 2400 - (Date.now() - started))));
      setCreating("done");
      res.notes.forEach((n, i) => setTimeout(() => toast(n, { duration: 9000 }), 1200 + i * 400));
      await new Promise((r) => setTimeout(r, 900));
      router.push(`/app/bots/${res.id}`);
      router.refresh();
    } catch (err) {
      setCreating(null);
      const e = err as ApiError;
      if (e.status === 402) toast.error(e.message, { action: { label: "See plans", onClick: () => router.push("/app/billing") } });
      else toast.error(e.message || "Couldn't create your bot. Try again.");
    }
  };

  // Ctrl/Cmd+Enter moves forward from anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (step === "review") void create();
        else void next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const name = state.name.trim();
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  return (
    <div className="relative min-h-dvh bg-background">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px] overflow-hidden" aria-hidden>
        <div className="aurora opacity-70" />
      </div>

      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="shrink-0" aria-label="Home">
            <Logo className="text-lg" />
          </Link>
          <nav aria-label="Builder steps" className="mx-auto hidden items-center gap-1 md:flex">
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              const reachable = i <= maxReached;
              return (
                <React.Fragment key={s.id}>
                  {i > 0 ? <span className={cn("h-px w-4 lg:w-6", i <= stepIndex ? "bg-primary/50" : "bg-border")} aria-hidden /> : null}
                  <button
                    type="button"
                    disabled={!reachable || Boolean(creating)}
                    onClick={() => goTo(i)}
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold transition",
                      current ? "bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_rgb(109_77_255/0.8)]" : done ? "text-foreground hover:bg-muted" : reachable ? "text-muted-foreground hover:bg-muted" : "text-muted-foreground/60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full text-[11px]",
                        current ? "bg-white/20" : done ? "bg-primary text-primary-foreground" : "bg-muted",
                      )}
                    >
                      {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                    </span>
                    {s.label}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
            <span className="mr-1 text-sm font-semibold text-muted-foreground md:hidden">
              {stepIndex + 1}/{STEPS.length} · {STEPS[stepIndex].label}
            </span>
            <ThemeToggle />
            <Button asChild variant="ghost" size="icon-sm" aria-label="Exit the builder">
              <Link href={botCount > 0 ? "/app" : "/"}>
                <X />
              </Link>
            </Button>
          </div>
        </div>
        <div className="h-1 bg-muted/60 md:hidden" aria-hidden>
          <div className="h-full rounded-r-full bg-primary transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div ref={topRef} className="relative mx-auto max-w-6xl scroll-mt-20 px-4 sm:px-6">
        {recipe ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary-soft/70 px-4 py-2.5 text-sm">
            <Avatar avatar={recipe.avatar} color={recipe.color} size={36} animated={false} />
            <span className="min-w-0 flex-1">
              Making your own <span className="font-semibold">{recipe.name}</span>
              {recipe.tagline ? <span className="text-muted-foreground"> — {recipe.tagline}</span> : null}. Everything&apos;s filled in; change anything you like.
            </span>
            {step === "face" || step === "name" ? (
              <Button size="sm" variant="soft" onClick={() => goTo(STEPS.findIndex((s) => s.id === "brain"))}>
                Skip to the brain <ArrowRight />
              </Button>
            ) : null}
          </div>
        ) : null}
        {atBotLimit && step === "face" ? (
          <div className="mt-4 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning">
            Your {PLANS[plan].name} plan includes {PLANS[plan].limits.bots} bot{PLANS[plan].limits.bots === 1 ? "" : "s"} and you&apos;ve made {PLANS[plan].limits.bots === 1 ? "it" : "them all"}.{" "}
            <Link href="/app/billing" className="font-semibold underline">
              {demo ? "Switch plans (demo)" : "Upgrade"}
            </Link>{" "}
            to make another — or keep going and upgrade at the end.
          </div>
        ) : null}
      </div>

      <main className="relative mx-auto grid max-w-6xl gap-8 px-4 pt-6 pb-40 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10 lg:pt-10">
        <div className="lg:hidden">
          <BotPreviewStrip state={state} step={step} typing={typing} />
        </div>
        <section key={step} className="min-w-0 animate-fade-up" aria-live="polite">
          {step === "face" ? (
            <FaceStep
              avatar={state.avatar}
              color={state.color}
              onAvatar={(avatar) => update({ avatar, ...(state.colorPicked ? {} : { color: AVATARS[avatar].defaultColor }) })}
              onColor={(color) => update({ color, colorPicked: true })}
            />
          ) : null}
          {step === "name" ? (
            <NameStep avatar={state.avatar} name={state.name} ownerName={state.ownerName} onName={(n) => update({ name: n })} onOwnerName={(n) => update({ ownerName: n })} onSubmit={next} onTyping={setTyping} />
          ) : null}
          {step === "brain" ? (
            <BrainStep
              brain={state.brain}
              onBrain={(brain) => {
                if (brain.kind !== state.brain.kind || (brain.kind === "byok" && state.brain.kind === "byok" && brain.provider !== state.brain.provider)) {
                  setKeyStatus("idle");
                  setKeyMessage(null);
                }
                update({ brain });
              }}
              apiKey={apiKey}
              onApiKey={setApiKey}
              keyStatus={keyStatus}
              keyMessage={keyMessage}
              onValidate={() => void validateKey()}
              plan={plan}
              demo={demo}
              botName={name}
            />
          ) : null}
          {step === "apps" ? (
            <AppsStep
              botName={name}
              jobs={state.jobs}
              connectors={state.connectors}
              customMcp={state.customMcp}
              onJobs={(jobs, connectors) => update({ jobs, connectors })}
              onConnectors={(connectors) => update({ connectors })}
              onCustomMcp={(customMcp) => update({ customMcp })}
              plan={plan}
              demo={demo}
            />
          ) : null}
          {step === "trust" ? <TrustStep botName={name} trust={state.trust} onTrust={(trust) => update({ trust })} connectors={state.connectors} plan={plan} demo={demo} /> : null}
          {step === "channels" ? (
            <ChannelsStep
              botName={name}
              channels={state.channels}
              onChannels={(channels) => update({ channels })}
              phone={state.phone}
              onPhone={(phone) => update({ phone })}
              email={state.email}
              onEmail={(email) => update({ email })}
              plan={plan}
              demo={demo}
              live={live}
            />
          ) : null}
          {step === "review" ? (
            <ReviewStep
              state={state}
              onInstructions={(instructions) => update({ instructions })}
              onBrief={(brief) => update({ brief })}
              onAge={(ageConfirmed) => update({ ageConfirmed })}
              goTo={(id: StepId) => goTo(STEPS.findIndex((s) => s.id === id))}
              plan={plan}
              demo={demo}
              timezone={timezone}
              atBotLimit={atBotLimit}
            />
          ) : null}
          {!signedIn && step === "review" ? (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              No account needed to start — add your email later to keep your bot safe.{" "}
              <Link href="/login?next=/build" className="font-semibold text-primary hover:underline">
                Already have an account?
              </Link>
            </p>
          ) : null}
        </section>
        <aside className="hidden lg:block" aria-label="Your bot so far">
          <div className="sticky top-24">
            <BotPreview state={state} step={step} stepIndex={stepIndex} typing={typing} />
            {demo ? <p className="mt-3 px-2 text-center text-xs text-muted-foreground">Demo mode: apps and channels are simulated, so you can try everything.</p> : null}
          </div>
        </aside>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Button variant="ghost" size="lg" onClick={back} disabled={stepIndex === 0 || Boolean(creating)} className="px-3 sm:px-5">
            <ArrowLeft /> <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="min-w-0 flex-1 text-center text-sm" aria-live="polite">
            {showError && error ? (
              <span className="font-medium text-danger">{error}</span>
            ) : (
              <span className="hidden text-muted-foreground sm:inline">
                Step {stepIndex + 1} of {STEPS.length}
                <span className="text-muted-foreground"> · Ctrl+Enter to continue</span>
              </span>
            )}
          </div>
          {step !== "review" ? (
            <Button size="lg" onClick={() => void next()} loading={keyStatus === "checking" && step === "brain"} className="min-w-36">
              Continue <ArrowRight />
            </Button>
          ) : (
            <Button size="lg" onClick={() => void create()} loading={creating === "working"} disabled={Boolean(creating) || atBotLimit} className="min-w-44">
              <Sparkles /> Bring {name || "it"} to life
            </Button>
          )}
        </div>
      </footer>

      {creating ? <BirthOverlay state={state} done={creating === "done"} /> : null}
    </div>
  );
}

function BirthOverlay({ state, done }: { state: BuilderState; done: boolean }) {
  const name = state.name.trim() || "your bot";
  const lines = React.useMemo(
    () => [
      `Giving ${name} a brain…`,
      state.connectors.length ? "Plugging in your apps…" : "Packing its built-in tools…",
      "Setting the ground rules…",
      state.channels.length ? "Opening its channels…" : "Warming up the chat…",
      `Teaching ${name} your name…`,
    ],
    [name, state.connectors.length, state.channels.length],
  );
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(lines.length - 1, x + 1)), 520);
    return () => clearInterval(t);
  }, [lines.length]);

  return (
    <div className="fixed inset-0 z-50 flex animate-[fade-up_0.3s_ease-out] flex-col items-center justify-center gap-5 bg-background/95 px-6 text-center backdrop-blur-md" role="status" aria-live="assertive">
      <div className="relative">
        <div className="absolute inset-6 rounded-full animate-pulse-ring" aria-hidden />
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <Sparkles
            key={k}
            className="absolute size-5 animate-float text-accent"
            style={{ left: `${50 + 58 * Math.cos((k / 6) * Math.PI * 2)}%`, top: `${50 + 58 * Math.sin((k / 6) * Math.PI * 2)}%`, animationDelay: `${k * 0.25}s`, transform: "translate(-50%,-50%)" }}
            aria-hidden
          />
        ))}
        <div className={cn("transition-transform duration-500", done && "scale-110")}>
          <Avatar avatar={state.avatar} color={state.color} size={200} mood={done ? "happy" : "working"} />
        </div>
      </div>
      <div className="font-display text-3xl font-bold sm:text-4xl">{done ? `Say hi to ${name}!` : `Bringing ${name} to life`}</div>
      <div key={done ? "done" : i} className="h-6 animate-fade-up text-muted-foreground">
        {done ? "Opening your chat…" : lines[i]}
      </div>
    </div>
  );
}
