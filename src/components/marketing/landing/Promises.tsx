import { Ban, Bot, Check, Download, Hourglass, KeyRound, Lock, OctagonX, Trash2 } from "lucide-react";
import { BrandTile } from "@/components/brand/icons";
import { getConnector } from "@/lib/connectors";
import { disclosureLine } from "@/lib/safety";
import { cn } from "@/lib/utils";
import { Container, Section, SectionHeader } from "../ui";

function Tile({ className, title, body, children }: { className?: string; title: string; body: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-soft", className)}>
      <div aria-hidden="true" className="relative flex-1 border-b border-border/70 bg-background-2/70 p-4 sm:p-5">
        {children}
      </div>
      <div className="p-5 sm:p-6">
        <h3 className="font-display text-xl font-bold tracking-tight">{title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function ReceiptsVisual() {
  const gmail = getConnector("gmail");
  const cal = getConnector("google_calendar");
  const rows = [
    { status: "ok", title: "Drafted a reply to Dana", app: gmail, time: "9:02 AM", cost: "$0.0004" },
    { status: "ok", title: "Added “Dentist, Thu 3 PM” to your calendar", app: cal, time: "9:03 AM", cost: "$0.0003" },
    { status: "pending", title: "Waiting for your OK: email someone new", app: gmail, time: "9:05 AM", cost: "—" },
    { status: "blocked", title: "Blocked: send invoices to an unknown address", app: gmail, time: "9:06 AM", cost: "—" },
  ] as const;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.title} className="flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5 shadow-soft ring-1 ring-border">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5",
              r.status === "ok" && "bg-success-soft text-success",
              r.status === "pending" && "bg-warning-soft text-warning",
              r.status === "blocked" && "bg-danger-soft text-danger",
            )}
          >
            {r.status === "ok" ? <Check /> : r.status === "pending" ? <Hourglass /> : <Ban />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
          {r.app ? <BrandTile icon={r.app.icon} size={22} variant="soft" className="hidden sm:inline-flex" /> : null}
          <span className="hidden w-16 text-right text-xs text-muted-foreground tabular-nums sm:block">{r.time}</span>
          <span className="w-14 text-right font-mono text-xs text-muted-foreground">{r.cost}</span>
        </div>
      ))}
    </div>
  );
}

function StopVisual() {
  return (
    <div className="flex flex-col gap-2.5 text-sm">
      <div className="ml-auto max-w-[80%] rounded-[1.2rem] rounded-br-md bg-bubble-owner px-3.5 py-2 font-semibold text-bubble-owner-foreground shadow-soft">STOP</div>
      <div className="mr-auto max-w-[88%] rounded-[1.2rem] rounded-bl-md bg-card px-3.5 py-2 shadow-soft ring-1 ring-border">
        Paused. I&apos;ve stopped everything, including routines and pending work. Say START when you want me back.
      </div>
      <div className="mx-auto mt-1 inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-xs font-bold text-danger">
        <OctagonX className="size-3.5" /> Paused on every channel
      </div>
    </div>
  );
}

function KeysVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 shadow-soft ring-1 ring-border">
        <KeyRound className="size-4 text-muted-foreground" />
        <span className="font-mono text-sm tracking-wider">•••• •••• 7f3a</span>
        <Lock className="ml-auto size-4 text-success" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-[11px] font-bold text-success">AES-256-GCM</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Never shown again</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Never logged</span>
      </div>
    </div>
  );
}

function DataVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 text-sm font-semibold shadow-soft ring-1 ring-border">
        <Download className="size-4 text-primary" /> Export everything (JSON)
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 text-sm font-semibold text-danger shadow-soft ring-1 ring-border">
        <Trash2 className="size-4" /> Delete my account
      </div>
    </div>
  );
}

function DisclosureVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-2 text-sm">
      <div className="mr-auto max-w-[92%] rounded-[1.2rem] rounded-bl-md bg-card px-3.5 py-2 shadow-soft ring-1 ring-border">
        Hi Sam! I&apos;m following up for Dana about Saturday&apos;s pickup.
        <div className="mt-1 text-xs text-muted-foreground">{disclosureLine("Misty")}</div>
      </div>
      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Bot className="size-3.5" /> Labeled on every channel
      </div>
    </div>
  );
}

export function Promises() {
  return (
    <Section id="promises" aria-labelledby="promises-title" className="bg-background">
      <Container>
        <SectionHeader id="promises-title" eyebrow="Peace of mind" title="Built to be trusted with real things.">
          Receipts for everything, a STOP that always works, and your data treated like it&apos;s yours. Because it is.
        </SectionHeader>
        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <Tile
            className="md:col-span-2"
            title="Every action gets a receipt"
            body="What it did, on which app, why, and what it cost. Receipts are append-only, so they can't be quietly edited later."
          >
            <ReceiptsVisual />
          </Tile>
          <Tile title="STOP works from anywhere" body="Text STOP on any channel or tap Stop in the app. Everything pauses at once, everywhere.">
            <StopVisual />
          </Tile>
          <Tile title="Keys locked away" body="Your API keys and app logins are encrypted at rest, never shown again and never written to logs.">
            <KeysVisual />
          </Tile>
          <Tile title="Your data isn't the product" body="We don't sell it and we don't train AI models on it. Export everything or delete your account whenever you like.">
            <DataVisual />
          </Tile>
          <Tile title="Always says it's an AI" body="Bots introduce themselves as AI assistants, remind you every few hours, and label what they send to others. Never a fake human.">
            <DisclosureVisual />
          </Tile>
        </div>
      </Container>
    </Section>
  );
}
