import Link from "next/link";
import { ArrowRight, KeyRound, Laptop, Sparkles } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { AVATAR_IDS } from "@/lib/avatars";
import { CHANNEL_BY_KIND, channelUsable, comingSoonLine, talkChannels } from "@/lib/channels/catalog";
import { getConnector } from "@/lib/connectors";
import { demoMode, live } from "@/lib/env";
import { TRUST, TRUST_LEVELS } from "@/lib/trust";
import { cn, joinList } from "@/lib/utils";
import { Container, Section, SectionHeader } from "../ui";
import { channelIcon } from "../icons";

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative flex h-40 items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-background-2 p-3", className)}
    >
      {children}
    </div>
  );
}

function FaceVisual() {
  return (
    <Frame className="flex-col gap-2">
      <Avatar avatar="nimbus" size={84} mood="happy" />
      <div className="flex items-center gap-1 rounded-full bg-card p-1 shadow-soft ring-1 ring-border">
        {AVATAR_IDS.map((id) => (
          <span key={id} className={cn("flex items-center justify-center rounded-full p-0.5", id === "nimbus" && "bg-primary-soft ring-2 ring-primary")}>
            <Avatar avatar={id} size={22} animated={false} />
          </span>
        ))}
      </div>
    </Frame>
  );
}

function NameVisual() {
  return (
    <Frame className="flex-col gap-2.5">
      <div className="w-full max-w-[200px]">
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Name</div>
        <div className="flex h-10 items-center rounded-xl border border-primary/50 bg-card px-3 font-display text-lg font-semibold ring-4 ring-primary/10">
          Misty
          <span className="mk-caret ml-0.5 inline-block h-5 w-[2px] rounded bg-primary" />
        </div>
      </div>
      <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
        <Sparkles className="size-3.5" /> Surprise me
      </span>
    </Frame>
  );
}

function BrainVisual() {
  const rows = [
    { label: "Included", tag: "At cost", icon: <Sparkles className="size-3.5" />, on: true },
    { label: "Your API key", icon: <KeyRound className="size-3.5" /> },
    { label: "Your subscription", icon: <Laptop className="size-3.5" /> },
  ];
  return (
    <Frame className="flex-col gap-1.5">
      {rows.map((r) => (
        <div
          key={r.label}
          className={cn(
            "flex w-full max-w-[210px] items-center gap-2 rounded-xl border bg-card px-2.5 py-1.5 text-xs font-semibold",
            r.on ? "border-primary/50 ring-2 ring-primary/10" : "border-border text-muted-foreground",
          )}
        >
          <span className={cn("flex size-5 items-center justify-center rounded-md", r.on ? "bg-primary text-primary-foreground" : "bg-muted")}>{r.icon}</span>
          <span className="truncate">{r.label}</span>
          {r.tag ? <span className="ml-auto rounded-full bg-success-soft px-1.5 py-px text-[10px] text-success">{r.tag}</span> : null}
        </div>
      ))}
    </Frame>
  );
}

function AppsVisual() {
  const apps = ["gmail", "google_calendar", "notion", "github"].map((id) => getConnector(id)).filter((c) => c !== undefined);
  return (
    <Frame className="flex-col gap-3">
      <div className="flex gap-1.5">
        {apps.map((c) => (
          <BrandTile key={c.id} icon={c.icon} size={34} />
        ))}
      </div>
      <div className="flex rounded-full bg-card p-0.5 shadow-soft ring-1 ring-border">
        {TRUST_LEVELS.map((t) => (
          <span key={t} className={cn("rounded-full px-2 py-0.5 text-sm", t === "ask" && "bg-primary-soft")}>
            {TRUST[t].emoji}
          </span>
        ))}
      </div>
      <div className="text-[11px] font-semibold text-muted-foreground">{TRUST.ask.name}</div>
    </Frame>
  );
}

function TalkVisual() {
  const kinds = ["voice", "sms", "email", "telegram", "discord", "slack"] as const;
  return (
    <Frame>
      <div className="grid grid-cols-3 gap-2">
        {kinds.map((k) => (
          // The ones that aren't offered here yet stay greyed out.
          <BrandTile key={k} icon={channelIcon(CHANNEL_BY_KIND[k])} size={36} className={channelUsable(CHANNEL_BY_KIND[k], demoMode, live) ? undefined : "opacity-60 grayscale"} />
        ))}
      </div>
    </Frame>
  );
}

function talkBody(): string {
  const words = talkChannels(demoMode, live);
  return `Web chat is always on. Add ${joinList(words.ready, "or")}. ${comingSoonLine(words.soon)}`.trim();
}

export function HowItWorks() {
  const steps = [
    { title: "Pick a face", body: "Five original characters, each with its own personality. Pick a colorway too.", visual: <FaceVisual /> },
    { title: "Name it", body: "Anything you like. Stuck? Tap Surprise me.", visual: <NameVisual /> },
    {
      title: "Give it a brain",
      body: "Open models we run (at cost), your own API key, or the Claude or ChatGPT plan you already pay for.",
      visual: <BrainVisual />,
    },
    { title: "Apps & trust", body: "Connect the apps it can use, then decide how much it may do on its own.", visual: <AppsVisual /> },
    { title: "Talk anywhere", body: talkBody(), visual: <TalkVisual /> },
  ];
  return (
    <Section id="how" aria-labelledby="how-title" className="bg-background">
      <Container>
        <SectionHeader id="how-title" eyebrow="How it works" title="Five quick choices. One bot that's all yours.">
          The builder asks one thing per screen, in this order. You can change any of it later.
        </SectionHeader>

        <ol className="relative mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:gap-3">
          <div aria-hidden="true" className="absolute top-[22px] right-[10%] left-[10%] hidden border-t-2 border-dashed border-border lg:block" />
          {steps.map((step, i) => (
            <li key={step.title} className={cn("relative flex flex-col", i === steps.length - 1 && "sm:col-span-2 lg:col-span-1")}>
              <div className="relative z-10 mx-auto mb-4 hidden size-11 items-center justify-center rounded-full border-4 border-background bg-primary font-display text-base font-bold text-primary-foreground shadow-glow lg:flex">
                {i + 1}
              </div>
              <div className="flex h-full flex-col gap-4 rounded-3xl border border-border bg-card p-3 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift">
                {step.visual}
                <div className="px-2 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary lg:hidden">{i + 1}</span>
                    <h3 className="font-display text-lg font-semibold">{step.title}</h3>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-12 flex flex-col items-center gap-4 text-center">
          <p className="text-muted-foreground">
            Then your bot <span className="font-semibold text-foreground">messages you first</span>, ready to help.
          </p>
          <Button asChild size="lg">
            <Link href="/build">
              Start building <ArrowRight />
            </Link>
          </Button>
        </div>
      </Container>
    </Section>
  );
}
