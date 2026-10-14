import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { AVATAR_IDS, type AvatarMood } from "@/lib/avatars";
import { Button } from "@/components/ui/button";
import { Container } from "../ui";

const MOODS: AvatarMood[] = ["happy", "idle", "happy", "working", "idle"];

export function FinalCta({
  title = "Your bot is about a minute away.",
  body,
  primary = { href: "/build", label: "Build your bot" },
}: {
  title?: string;
  body?: string;
  primary?: { href: string; label: string };
}) {
  return (
    <section aria-labelledby="final-cta-title" className="pt-2 pb-16 sm:pb-24">
      <Container>
        <div className="relative overflow-hidden rounded-[2.5rem] bg-linear-135 from-grape-600 to-grape-800 px-6 pt-14 pb-0 text-center text-white shadow-glow sm:px-12 sm:pt-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 60% at 15% 0%, rgb(255 255 255 / 0.22), transparent 60%), radial-gradient(50% 70% at 100% 100%, rgb(255 207 74 / 0.35), transparent 60%), radial-gradient(40% 50% at 0% 100%, rgb(255 111 89 / 0.3), transparent 60%)",
            }}
          />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(circle,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(180deg,#000,transparent_80%)]" />
          <div className="relative mx-auto max-w-2xl">
            <h2 id="final-cta-title" className="font-display text-4xl leading-[1.04] font-extrabold tracking-[-0.03em] text-balance sm:text-6xl">
              {title}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-lg text-white/85">
              {body ?? "Pick a face, give it a name and a brain, and say hi. Free to start, no card needed."}
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="xl" className="bg-white text-grape-900 shadow-lift hover:bg-white/90 hover:shadow-lift">
                <Link href={primary.href}>
                  {primary.label} <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="xl" variant="ghost" className="text-white hover:bg-white/15">
                <Link href="/explore">Explore recipes</Link>
              </Button>
            </div>
          </div>
          <div aria-hidden="true" className="relative mx-auto mt-10 flex max-w-xl items-end justify-center gap-1 sm:mt-12 sm:gap-4">
            {AVATAR_IDS.map((id, i) => (
              <div key={id} className="mk-bob" style={{ animationDelay: `-${i * 0.9}s` }}>
                <Avatar avatar={id} size={130} mood={MOODS[i]} className="h-auto w-[18vw] max-w-[120px] sm:w-[120px]" />
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
