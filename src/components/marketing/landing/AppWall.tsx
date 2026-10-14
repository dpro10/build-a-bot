import Link from "next/link";
import { ArrowRight, Plug } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { ALL_CONNECTORS } from "@/lib/connectors";
import { CATEGORY_LABELS, type ConnectorCategory } from "@/lib/connectors/types";
import { Container, Section, SectionHeader } from "../ui";

const ROWS = 4;

/** Apps a bot can really connect today (the catalog lists "soon" ones too; those are left out). */
export function availableApps() {
  return ALL_CONNECTORS.filter((c) => c.status !== "soon" && c.category !== "custom");
}

/** "143" → "140+": a floor that stays true as the catalog grows. */
export function appCountLabel(n: number) {
  return n >= 20 ? `${Math.floor(n / 10) * 10}+` : String(n);
}

export function AppWall() {
  const apps = availableApps();
  // Popular first, then deal round-robin into rows so each row mixes colors and categories.
  const ordered = [...apps.filter((a) => a.popular), ...apps.filter((a) => !a.popular)];
  const rows: (typeof apps)[] = Array.from({ length: ROWS }, () => []);
  ordered.forEach((app, i) => rows[i % ROWS].push(app));

  const counts = new Map<ConnectorCategory, number>();
  for (const a of apps) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  const categories = [...counts.entries()].filter(([cat]) => cat !== "essentials").sort((a, b) => b[1] - a[1]);
  const label = appCountLabel(apps.length);

  return (
    <Section id="apps" aria-labelledby="apps-title" className="overflow-hidden bg-background">
      <Container>
        <SectionHeader id="apps-title" eyebrow="Apps" title={<>{label} apps. And any MCP server.</>}>
          Email, calendars, docs, code, tasks, money, music, smart home. Connect what you use, and your bot only touches what you allow.
        </SectionHeader>
      </Container>

      <div className="relative mt-14">
        <p className="sr-only">
          Apps include {ordered.slice(0, 24).map((a) => a.name).join(", ")}, and {apps.length - 24} more.
        </p>
        <div aria-hidden="true" className="mk-wall flex flex-col gap-3 sm:gap-4">
          {rows.map((row, i) => (
            <div
              key={i}
              className={i % 2 ? "mk-drift mk-drift--reverse flex gap-3 sm:gap-4" : "mk-drift flex gap-3 sm:gap-4"}
              style={{ ["--mk-duration" as string]: `${120 + i * 16}s`, ["--mk-delay" as string]: `-${18 + i * 23}s` }}
            >
              {row.map((app) => (
                <div
                  key={app.id}
                  title={app.name}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card py-2 pr-4 pl-2 shadow-soft"
                >
                  <BrandTile icon={app.icon} size={40} />
                  <span className="text-sm font-semibold whitespace-nowrap">{app.name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <Container>
        <div className="mt-12 flex flex-col items-center gap-6">
          <ul className="flex max-w-4xl flex-wrap justify-center gap-2">
            {categories.slice(0, 14).map(([cat, n]) => (
              <li key={cat} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm">
                <span className="font-medium">{CATEGORY_LABELS[cat]}</span>
                <span className="text-muted-foreground tabular-nums">{n}</span>
              </li>
            ))}
            {categories.length > 14 ? (
              <li className="inline-flex items-center rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted-foreground">
                + {categories.length - 14} more categories
              </li>
            ) : null}
          </ul>
          <div className="flex w-full max-w-2xl flex-col items-center gap-4 rounded-3xl border border-dashed border-primary/40 bg-primary-soft/40 p-5 text-center sm:flex-row sm:text-left">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-card text-primary shadow-soft ring-1 ring-border">
              <Plug className="size-6" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <div className="font-display text-lg font-semibold">Plus any MCP server</div>
              <p className="text-sm text-muted-foreground">
                Paste the address of any remote MCP server and its tools become your bot&apos;s apps, under the same trust rules.
              </p>
            </div>
            <Link href="/build" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline">
              Connect yours <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </Container>
    </Section>
  );
}
