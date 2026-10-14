import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandTile } from "@/components/brand/icons";
import { CHANNEL_BY_KIND } from "@/lib/channels/catalog";
import { Container } from "../ui";
import { channelIcon } from "../icons";
import { HeroStage } from "./HeroStage";

const TALK_ANYWHERE = ["voice", "sms", "email", "telegram", "discord", "slack"] as const;

export function Hero() {
  const tile = (kind: keyof typeof CHANNEL_BY_KIND) => <BrandTile icon={channelIcon(CHANNEL_BY_KIND[kind])} size={18} />;
  const channelIcons = {
    slack: tile("slack"),
    telegram: tile("telegram"),
    sms: tile("sms"),
    voice: tile("voice"),
    email: tile("email"),
  };

  return (
    <section className="relative overflow-hidden">
      <div className="aurora" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="dot-grid absolute inset-0 opacity-70 [mask-image:radial-gradient(60%_55%_at_30%_35%,#000,transparent)]"
      />
      <Container className="relative grid items-center gap-12 pt-12 pb-20 sm:pt-16 lg:grid-cols-[1.08fr_1fr] lg:gap-10 lg:pt-20 lg:pb-28">
        <div className="flex flex-col items-start">
          <Link
            href="/safety"
            className="group inline-flex items-center gap-2 rounded-full border border-border bg-card/80 py-1 pr-3 pl-1 text-sm shadow-soft backdrop-blur transition hover:border-primary/40"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
              <ShieldCheck className="size-3.5" aria-hidden="true" /> Safe by design
            </span>
            <span className="text-muted-foreground">
              Rules enforced <span className="font-medium text-foreground">in code</span>
            </span>
            <ArrowRight className="size-3.5 text-muted-foreground transition group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>

          <h1 className="mt-6 font-display text-[2.85rem] leading-[0.98] font-extrabold tracking-[-0.04em] text-balance sm:text-6xl lg:text-[3.75rem] xl:text-[4.6rem]">
            Your own AI agent, <span className="mk-gradient-text">in about a minute.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-pretty text-muted-foreground sm:text-xl sm:leading-relaxed">
            Pick a face, name it, give it a brain and your apps, and talk to it anywhere: calls, texts, email, Telegram, Discord, Slack.
          </p>

          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="xl" className="w-full sm:w-auto">
              <Link href="/build">
                Build your bot <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="xl" variant="outline" className="w-full sm:w-auto">
              <Link href="/explore">Explore recipes</Link>
            </Button>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {["Free to start, no card", "Use your Claude or ChatGPT plan", "Always says it's an AI"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check className="size-4 text-success" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>

          <div className="mt-9 flex items-center gap-3">
            <div className="flex -space-x-1.5" aria-hidden="true">
              {TALK_ANYWHERE.map((k) => (
                <span key={k} className="rounded-[30%] ring-2 ring-background">
                  <BrandTile icon={channelIcon(CHANNEL_BY_KIND[k])} size={28} />
                </span>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Talk anywhere.</span> Web chat is always on.
            </p>
          </div>
        </div>

        <HeroStage channelIcons={channelIcons} />
      </Container>
    </section>
  );
}
