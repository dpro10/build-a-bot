import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { CHANNELS, channelAvailability, comingSoonLine, talkChannels, type ChannelDef } from "@/lib/channels/catalog";
import { demoMode, live } from "@/lib/env";
import { cn, joinList } from "@/lib/utils";
import { Container, Section, SectionHeader } from "../ui";
import { channelIcon } from "../icons";

function PlanBadge({ def }: { def: ChannelDef }) {
  if (def.availability === "waitlist") return <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning">Waitlist</span>;
  if (def.availability === "beta") return <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">Beta</span>;
  if (def.minPlan === "plus") return <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary">Plus</span>;
  if (def.minPlan === "pro") return <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary">Pro</span>;
  return <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success">Free</span>;
}

function Orbit({ items }: { items: ChannelDef[] }) {
  return (
    <div aria-hidden="true" className="relative mx-auto aspect-square w-full max-w-[420px]">
      <div className="absolute inset-[6%] rounded-full border border-dashed border-border" />
      <div className="absolute inset-[22%] rounded-full border border-border/70 bg-card/40" />
      <div className="absolute inset-[31%] rounded-full bg-primary/10 blur-2xl" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Avatar avatar="sprout" color="mint" size={150} mood="happy" className="h-auto w-[34%]" />
      </div>
      <div className="mk-orbit absolute inset-0">
        {items.map((def, i) => {
          const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2;
          const r = 44;
          return (
            <div
              key={def.kind}
              className="mk-orbit-item absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${50 + r * Math.cos(angle)}%`, top: `${50 + r * Math.sin(angle)}%` }}
            >
              <div className={cn("rounded-[30%] bg-card p-1 shadow-lift ring-1 ring-border", def.availability !== "available" && "opacity-55 grayscale-[35%]")}>
                <BrandTile icon={channelIcon(def)} size={44} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Channels() {
  // Channels this server can't run yet count as coming soon, like the ones we haven't built.
  const availability = (def: ChannelDef) => channelAvailability(def, demoMode, live);
  const web = CHANNELS.find((c) => c.kind === "web");
  const listed = CHANNELS.filter((c) => c.kind !== "web" && availability(c) !== "soon");
  const later = CHANNELS.filter((c) => availability(c) === "soon");
  const words = talkChannels(demoMode, live);

  return (
    <Section id="channels" aria-labelledby="channels-title" className="bg-background">
      <Container>
        <SectionHeader id="channels-title" eyebrow="Channels" title="Talk to it anywhere.">
          {words.soon.length
            ? `Web chat is always on. Add ${joinList(words.ready)}. ${comingSoonLine(words.soon)} Same bot, same memory, everywhere.`
            : "Web chat is always on. Add calls, texts, email and the chat apps you already live in. Same bot, same memory, everywhere."}
        </SectionHeader>

        <div className="mt-14 grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
          <Orbit items={listed} />

          <div className="flex flex-col gap-3">
            {web ? (
              <div className="flex items-center gap-4 rounded-3xl border border-primary/30 bg-primary-soft/50 p-4">
                <BrandTile icon={channelIcon(web)} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{web.name}</span>
                    <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success">{web.tagline}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{web.description}</p>
                </div>
              </div>
            ) : null}
            <ul className="grid gap-3 sm:grid-cols-2">
              {listed.map((def) => (
                <li key={def.kind} className="flex gap-3.5 rounded-3xl border border-border bg-card p-4 shadow-soft">
                  <BrandTile icon={channelIcon(def)} size={40} className={def.availability === "waitlist" ? "opacity-70" : undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">{def.name}</span>
                      <PlanBadge def={def} />
                    </div>
                    <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{def.description}</p>
                    {def.note ? <p className="mt-1 text-xs text-muted-foreground">{def.note}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
            {later.length ? <p className="px-1 text-sm text-muted-foreground">Coming soon: {later.map((c) => c.name).join(", ")}.</p> : null}
          </div>
        </div>
      </Container>
    </Section>
  );
}
