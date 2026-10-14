import Link from "next/link";
import { Bot, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Avatar } from "@/components/avatar";
import { AVATAR_IDS } from "@/lib/avatars";
import { SITE, contactLink } from "@/lib/site";
import { Container } from "./ui";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/build", label: "Build your bot" },
      { href: "/#how", label: "How it works" },
      { href: "/explore", label: "Explore recipes" },
      { href: "/pricing", label: "Pricing" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/safety", label: "Safety" },
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/privacy", label: "Privacy" },
    ],
  },
];

export function SiteFooter() {
  const contact = contactLink("Hello from the website");
  return (
    <footer className="border-t border-border bg-background-2">
      <Container className="grid grid-cols-2 gap-x-6 gap-y-10 py-14 lg:grid-cols-[1.6fr_1fr_1fr]">
        <div className="col-span-2 flex flex-col gap-4 lg:col-span-1">
          <Link href="/" aria-label="Build-a-bot home" className="w-fit rounded-xl text-foreground">
            <Logo className="text-xl" />
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">
            {SITE.tagline} Pick a face, give it a brain and your apps, and talk to it anywhere.
          </p>
          <div className="flex items-end gap-1.5" aria-hidden="true">
            {AVATAR_IDS.map((id) => (
              <Avatar key={id} avatar={id} size={34} mood="idle" animated={false} />
            ))}
          </div>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">{col.title}</h2>
            <ul className="mt-4 flex flex-col gap-2.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-foreground/85 transition hover:text-primary">
                    {l.label}
                  </Link>
                </li>
              ))}
              {col.title === "Trust" ? (
                <li>
                  <a href={contact.href} className="text-sm text-foreground/85 transition hover:text-primary">
                    Contact us
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </Container>
      <div className="border-t border-border">
        <Container className="flex flex-col gap-3 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {SITE.year} {SITE.name}
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" aria-hidden="true" /> For adults 18+
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Bot className="size-3.5" aria-hidden="true" /> Bots are AI assistants, never people
            </li>
          </ul>
        </Container>
      </div>
    </footer>
  );
}
