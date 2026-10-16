import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Ban, CalendarClock, Check, Hand, MessageCircle, ScrollText, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { FinalCta } from "@/components/marketing/landing/FinalCta";
import { Container } from "@/components/marketing/ui";
import { channelIcon } from "@/components/marketing/icons";
import { colorwayWash } from "@/components/marketing/recipes/RecipeCard";
import { formatDays, formatTime } from "@/components/marketing/recipes/format";
import { loadRecipe } from "@/components/marketing/recipes/load";
import { AVATARS } from "@/lib/avatars";
import { CHANNEL_BY_KIND, channelAvailability, isChannelKind } from "@/lib/channels/catalog";
import { getConnector } from "@/lib/connectors";
import { demoMode, live } from "@/lib/env";
import { JOB_BY_ID, isJobId } from "@/lib/jobs";
import { TRUST } from "@/lib/trust";
import { cn, truncate } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const recipe = await loadRecipe(slug);
  if (!recipe) return { title: "Recipe not found" };
  const title = recipe.featured ? `${recipe.title} bot recipe` : `${recipe.title}, a bot recipe`;
  return {
    title,
    description: recipe.tagline,
    alternates: { canonical: `/r/${recipe.slug}` },
    openGraph: { title: `${title} · Build-a-bot`, description: recipe.tagline, url: `/r/${recipe.slug}`, type: "website", siteName: "Build-a-bot" },
    twitter: { card: "summary_large_image", title: `${title} · Build-a-bot`, description: recipe.tagline },
    robots: recipe.featured ? undefined : { index: false },
  };
}

function Block({ id, icon, title, children, aside }: { id: string; icon: React.ReactNode; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary [&_svg]:size-[18px]" aria-hidden="true">
            {icon}
          </span>
          <h2 id={`${id}-h`} className="font-display text-xl font-bold tracking-tight">
            {title}
          </h2>
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function RecipePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const recipe = await loadRecipe(slug);
  if (!recipe) notFound();

  const trust = TRUST[recipe.trust];
  const apps = recipe.connectors.map((id) => getConnector(id)).filter((c) => c !== undefined);
  const channels = recipe.channels.filter(isChannelKind).map((k) => CHANNEL_BY_KIND[k]);
  const jobs = recipe.jobs.filter(isJobId).map((j) => JOB_BY_ID[j]);
  const routines = recipe.routines ?? [];
  const character = AVATARS[recipe.avatar];
  const makeHref = `/build?recipe=${encodeURIComponent(recipe.slug)}`;
  const instructions = recipe.instructions.trim();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 opacity-90" style={{ background: colorwayWash(recipe.color) }} aria-hidden="true" />
        <div aria-hidden="true" className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(60%_70%_at_70%_50%,#000,transparent)]" />
        <Container className="relative grid items-center gap-8 py-12 sm:py-16 lg:grid-cols-[1.2fr_0.8fr] lg:py-20">
          <div className="order-2 lg:order-1">
            <Link href="/explore" className="inline-flex items-center gap-1 text-sm font-medium text-foreground/70 transition hover:text-foreground">
              <ArrowRight className="size-4 rotate-180" aria-hidden="true" /> All recipes
            </Link>
            <h1 className="mt-4 font-display text-[2.6rem] leading-[1.02] font-extrabold tracking-[-0.035em] text-balance sm:text-6xl">{recipe.title}</h1>
            <p className="mt-2 text-base font-medium text-foreground/70">{recipe.subtitle}</p>
            <p className="mt-5 max-w-xl text-xl leading-relaxed text-pretty">{recipe.tagline}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-card/85 px-3 py-1 text-sm font-semibold shadow-soft backdrop-blur">
                <span aria-hidden="true">{trust.emoji}</span> {trust.name}
              </span>
              {jobs.map((j) => (
                <span key={j.id} className="inline-flex items-center gap-1.5 rounded-full bg-card/70 px-3 py-1 text-sm shadow-soft backdrop-blur">
                  <span aria-hidden="true">{j.emoji}</span> {j.label}
                </span>
              ))}
              {recipe.clones ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-card/70 px-3 py-1 text-sm shadow-soft backdrop-blur">
                  <Users className="size-4" aria-hidden="true" /> Made {recipe.clones.toLocaleString("en-US")} time{recipe.clones === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="xl">
                <Link href={makeHref}>
                  <Sparkles /> Make this bot
                </Link>
              </Button>
              <Button asChild size="xl" variant="outline">
                <Link href="/explore">Explore more</Link>
              </Button>
            </div>
            <p className="mt-3 text-sm text-foreground/65">Free to start. You pick its brain and sign in to each app yourself.</p>
          </div>
          <div className="order-1 flex justify-center lg:order-2">
            <div className="relative">
              <div className="absolute inset-x-6 bottom-2 h-10 rounded-full bg-black/10 blur-xl" aria-hidden="true" />
              <Avatar
                avatar={recipe.avatar}
                color={recipe.color}
                size={300}
                mood="happy"
                className="relative h-auto w-[200px] sm:w-[260px] lg:w-[300px]"
                title={recipe.name === character.character ? `${character.character} the ${character.species}` : `${recipe.name}, ${character.character} the ${character.species}`}
              />
            </div>
          </div>
        </Container>
      </section>

      <Container className="grid grid-cols-1 gap-5 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-5">
          <Block id="does" icon={<Sparkles />} title="What it does">
            {recipe.highlights.length ? (
              <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {recipe.highlights.map((h) => (
                  <li key={h} className="flex gap-2.5 rounded-2xl bg-background-2 p-3.5 text-[15px] leading-snug font-medium">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> {h}
                  </li>
                ))}
              </ul>
            ) : null}
            {jobs.length ? (
              <ul className={recipe.highlights.length ? "mt-4 flex flex-col gap-3" : "flex flex-col gap-3"}>
                {jobs.map((j) => (
                  <li key={j.id} className="flex gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-lg" aria-hidden="true">
                      {j.emoji}
                    </span>
                    <div>
                      <div className="font-semibold">{j.label}</div>
                      <p className="text-sm text-muted-foreground">{j.blurb}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-4 text-sm text-muted-foreground">
              Comes with {character.character}&apos;s personality: {character.personality.tone}.
            </p>
          </Block>

          <Block id="apps" icon={<ShieldCheck />} title="Apps it uses" aside={<span className="text-sm text-muted-foreground">{apps.length}</span>}>
            {apps.length ? (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {apps.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                    <BrandTile icon={a.icon} size={40} />
                    <div className="min-w-0">
                      <div className="font-semibold">{a.name}</div>
                      <p className="truncate text-sm text-muted-foreground">{a.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Just the built-ins: web search, reminders, notes and memory.</p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">You sign in to each app yourself, and it only gets the access you allow.</p>
          </Block>

          <Block id="channels" icon={<MessageCircle />} title="Where you'll talk">
            <ul className="flex flex-wrap gap-2">
              <li className="inline-flex items-center gap-2 rounded-full border border-border py-1 pr-3.5 pl-1 text-sm font-medium">
                <BrandTile icon={channelIcon(CHANNEL_BY_KIND.web)} size={26} /> Web &amp; app
              </li>
              {channels.map((c) => {
                // Not offered here yet: still listed, but marked as such.
                const availability = channelAvailability(c, demoMode, live);
                const later = availability === "soon" || availability === "waitlist";
                return (
                  <li
                    key={c.kind}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border border-border py-1 pr-3.5 pl-1 text-sm font-medium",
                      later && "border-dashed text-muted-foreground",
                    )}
                  >
                    <BrandTile icon={channelIcon(c)} size={26} className={later ? "opacity-60 grayscale" : undefined} /> {c.name}
                    {later ? (
                      <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-bold">{availability === "waitlist" ? "Waitlist" : "Coming soon"}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Block>

          {routines.length ? (
            <Block id="routines" icon={<CalendarClock />} title="Routines">
              <ul className="flex flex-col gap-3">
                {routines.map((r) => (
                  <li key={r.title} className="rounded-2xl bg-background-2 p-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{r.title}</span>
                      <span className="rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold text-muted-foreground shadow-soft">
                        {formatDays(r.days)} at {formatTime(r.time)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">{r.instruction}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">Times follow your time zone. Change or pause them any time.</p>
            </Block>
          ) : null}

          {instructions ? (
            <Block id="instructions" icon={<ScrollText />} title="Its instructions">
              <blockquote className="rounded-2xl border-l-4 border-primary/50 bg-background-2 px-4 py-3 text-[15px] leading-relaxed whitespace-pre-line">
                {truncate(instructions, 600)}
              </blockquote>
              <p className="mt-3 text-sm text-muted-foreground">Rewrite these in your own words once it&apos;s yours.</p>
            </Block>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
            <div>
              <div className="flex items-center gap-2 font-display text-lg font-bold">
                <span aria-hidden="true">{trust.emoji}</span> {trust.name}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{trust.long}</p>
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <TrustList icon={<Check />} tone="success" title="Does on its own" items={trust.can} />
              <TrustList icon={<Hand />} tone="warning" title="Asks you first" items={trust.asks.length ? trust.asks : ["Nothing: it never acts"]} />
              <TrustList icon={<Ban />} tone="danger" title="Never" items={trust.never} />
            </div>
            <p className="text-xs text-muted-foreground">
              Change the trust level any time. Hard limits apply at every level.{" "}
              <Link href="/safety" className="font-medium text-primary hover:underline">
                How safety works
              </Link>
            </p>
            <Button asChild size="lg" className="w-full">
              <Link href={makeHref}>
                Make this bot <ArrowRight />
              </Link>
            </Button>
          </div>
        </aside>
      </Container>

      <FinalCta
        title={`Make ${recipe.name} yours.`}
        body="One tap brings everything in this recipe into the builder. Change anything before you say hi."
        primary={{ href: makeHref, label: "Make this bot" }}
      />
    </>
  );
}

function TrustList({ icon, tone, title, items }: { icon: React.ReactNode; tone: "success" | "warning" | "danger"; title: string; items: string[] }) {
  const tones = { success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger" } as const;
  return (
    <div>
      <div className="flex items-center gap-2 font-semibold">
        <span className={`flex size-5 items-center justify-center rounded-full [&_svg]:size-3 ${tones[tone]}`} aria-hidden="true">
          {icon}
        </span>
        {title}
      </div>
      <ul className="mt-1.5 flex flex-col gap-1 pl-7 text-muted-foreground">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
