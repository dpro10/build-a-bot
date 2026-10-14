import { Code2, Receipt, ShieldAlert, ShieldCheck } from "lucide-react";
import { Container, Eyebrow } from "../ui";
import { InjectionStory } from "./InjectionStory";

const POINTS = [
  { icon: <ShieldCheck />, title: "Holds at every trust level", body: "Including Full faith. It's one of the limits no setting turns off." },
  { icon: <Code2 />, title: "Code, not a prompt", body: "The check runs outside the AI, so a sneaky message can't argue its way past it." },
  { icon: <Receipt />, title: "Every block leaves a receipt", body: "You see what was tried, where it came from and what happened." },
];

/** A dark band in both themes: data-theme="dark" switches every token inside it. */
export function InjectionSection() {
  return (
    <section data-theme="dark" id="injection" aria-labelledby="injection-title" className="relative scroll-mt-20 overflow-hidden bg-background py-20 text-foreground sm:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50% 45% at 85% 30%, rgb(255 107 111 / 0.16), transparent 70%), radial-gradient(45% 50% at 10% 80%, rgb(139 114 255 / 0.22), transparent 70%)",
        }}
      />
      <div aria-hidden="true" className="dot-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(60%_60%_at_50%_50%,#000,transparent)]" />
      <Container className="relative grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div>
          <Eyebrow icon={<ShieldAlert />}>Prompt-injection guard</Eyebrow>
          <h2 id="injection-title" className="mt-5 font-display text-[2.15rem] leading-[1.05] font-bold tracking-[-0.03em] text-balance sm:text-5xl">
            Even on Full faith, it can&apos;t be tricked into leaking your data.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Scammers hide instructions in emails and web pages, hoping an AI will follow them. Once your bot has read anything you didn&apos;t write, it
            can&apos;t send your data to someone new without your tap.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card text-primary ring-1 ring-border [&_svg]:size-5" aria-hidden="true">
                  {p.icon}
                </span>
                <div>
                  <div className="font-semibold">{p.title}</div>
                  <p className="text-sm text-muted-foreground">{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <InjectionStory />
      </Container>
    </section>
  );
}
