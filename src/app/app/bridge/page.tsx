import type { Metadata } from "next";
import { ArrowLeftRight, ExternalLink, Laptop, Lock, Power, ShieldCheck, UserRound } from "lucide-react";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { listBots, listBridgeDevices } from "@/lib/data";
import { DEVICE_ONLINE_MS } from "@/lib/bridge/jobs";
import { SUBSCRIPTIONS } from "@/lib/models/catalog";
import { Avatar } from "@/components/avatar";
import { BrandTile } from "@/components/brand/icons";
import { PageContainer, PageHeader } from "@/components/account/PageHeader";
import { BridgeLive, type PlainBot, type SubscriptionBot } from "@/components/account/BridgeLive";
import { toDeviceView } from "@/components/account/bridge-shared";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bridge" };

const CLAUDE = SUBSCRIPTIONS.find((s) => s.id === "claude")!;
const CHATGPT = SUBSCRIPTIONS.find((s) => s.id === "chatgpt")!;

export default async function BridgePage() {
  const user = await requireUser("/app/bridge");
  const db = await getDb();
  const [devices, bots] = await Promise.all([listBridgeDevices(db, user.id), listBots(db, user.id)]);
  const now = Date.now();

  const allBots: PlainBot[] = bots.map(({ bot }) => ({ id: bot.id, name: bot.name, avatar: bot.avatar as AvatarId, color: bot.color as ColorwayId }));
  const subscriptionBots: SubscriptionBot[] = bots
    .filter(({ bot }) => bot.brain.kind === "subscription")
    .map(({ bot }) => {
      const cli = bot.brain.provider === "codex" ? "codex" : "claude";
      const sub = cli === "codex" ? CHATGPT : CLAUDE;
      return {
        id: bot.id,
        name: bot.name,
        avatar: bot.avatar as AvatarId,
        color: bot.color as ColorwayId,
        cli,
        modelLabel: sub.models.find((m) => m.id === (bot.brain.model || "default"))?.label ?? bot.brain.model,
        whenOffline: bot.brain.whenOffline === "included" ? "included" : "wait",
        paused: bot.status === "paused",
      };
    });
  const star = subscriptionBots[0] ?? allBots[0];

  return (
    <PageContainer>
      <PageHeader
        title="Bridge"
        description="Let your bots think with the Claude or ChatGPT plan you already pay for — through your own Claude Code or Codex, on your own computer."
      />

      {/* What it is, in one picture. */}
      <section aria-label="How the Bridge works" className="mb-12 overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
        <div className="relative px-5 py-8 sm:px-8">
          <div className="dot-grid absolute inset-0 opacity-50" aria-hidden />
          <div className="relative flex flex-col items-center gap-4 md:flex-row md:justify-center md:gap-6">
            <Node
              label="Your bot"
              sub="answers you anywhere"
              icon={<Avatar avatar={star?.avatar ?? "blip"} color={star?.color} size={72} mood="thinking" />}
            />
            <Link2 />
            <div className="relative w-full max-w-[460px] rounded-3xl border-2 border-dashed border-primary/35 bg-background/70 px-4 pt-7 pb-4 backdrop-blur-sm sm:px-6">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-bold whitespace-nowrap text-primary-foreground">
                Your computer
              </span>
              <div className="flex items-center justify-center gap-3 sm:gap-5">
                <Node
                  label="The Bridge"
                  sub="a small helper app"
                  icon={
                    <span className="flex size-[60px] items-center justify-center rounded-[22px] bg-foreground text-background shadow-lift">
                      <Laptop className="size-7" aria-hidden />
                    </span>
                  }
                />
                <Link2 small />
                <Node
                  label="Claude Code or Codex"
                  sub="signed in by you"
                  icon={
                    <span className="flex items-center -space-x-3">
                      <BrandTile icon={CLAUDE.icon} size={52} className="ring-4 ring-card" label="Claude" />
                      <BrandTile icon={CHATGPT.icon} size={52} className="ring-4 ring-card" label="ChatGPT" />
                    </span>
                  }
                />
              </div>
              <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs font-semibold text-primary">
                <Lock className="size-3.5 shrink-0" aria-hidden /> Your Claude or ChatGPT login never leaves this box
              </p>
            </div>
          </div>
        </div>
        <ul className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
          <Assurance icon={<Lock className="size-4" />} title="Your login stays put">
            The Bridge never reads, copies or uploads your Claude or ChatGPT sign-in. We never see it.
          </Assurance>
          <Assurance icon={<ShieldCheck className="size-4" />} title="Your rules still apply">
            No shell, file or web access — only your bot&apos;s own tools, and every action still follows its trust level and approvals.
          </Assurance>
          <Assurance icon={<UserRound className="size-4" />} title="Only your bots">
            It answers turns for your own bots, using the plan you already pay for. Nothing extra to buy from us.
          </Assurance>
        </ul>
      </section>

      <BridgeLive
        initialDevices={devices.filter((d) => !d.revokedAt).map((d) => toDeviceView(d, now, DEVICE_ONLINE_MS))}
        subscriptionBots={subscriptionBots}
        allBots={allBots}
        serverNow={now}
        prerequisites={<Prerequisites />}
      />
    </PageContainer>
  );
}

function Node({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <div className="flex h-[76px] items-center justify-center">{icon}</div>
      <div className="mt-1.5 text-sm font-semibold">{label}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Link2({ small }: { small?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-soft",
        small ? "size-8" : "size-10 rotate-90 md:rotate-0",
      )}
      aria-hidden
    >
      <ArrowLeftRight className={small ? "size-4" : "size-5"} />
    </span>
  );
}

function Assurance({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="bg-card px-5 py-4 sm:px-6">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-7 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</span>
        {title}
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </li>
  );
}

function Prerequisites() {
  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
      <h2 className="font-display text-lg font-semibold">Before you start</h2>
      <ul className="mt-4 flex flex-col gap-5 text-sm">
        <li className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success-soft font-mono text-[11px] font-bold text-success">JS</span>
          <div>
            <div className="font-semibold">Node.js 18.17 or newer</div>
            <p className="text-muted-foreground">
              Check with <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">node -v</code>.{" "}
              <ExtLink href="https://nodejs.org">Get Node.js</ExtLink>
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <BrandTile icon={CLAUDE.icon} size={36} variant="soft" />
          <div>
            <div className="font-semibold">For Claude {CLAUDE.plans}: Claude Code</div>
            <p className="text-muted-foreground">
              Install it, then run <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">claude</code> once and sign in.{" "}
              <ExtLink href="https://code.claude.com">Get Claude Code</ExtLink>
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <BrandTile icon={CHATGPT.icon} size={36} variant="soft" />
          <div>
            <div className="font-semibold">For ChatGPT {CHATGPT.plans}: Codex</div>
            <p className="text-muted-foreground">
              Install it, then run <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">codex login</code>.{" "}
              <ExtLink href="https://developers.openai.com/codex">Get Codex</ExtLink>
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
            <Power className="size-4" aria-hidden />
          </span>
          <div>
            <div className="font-semibold">A computer that&apos;s awake</div>
            <p className="text-muted-foreground">Your bots think there while it&apos;s on and the Bridge is running.</p>
          </div>
        </li>
      </ul>
      <p className="mt-5 rounded-2xl bg-muted/70 px-4 py-3 text-xs text-muted-foreground">
        Using Gemini? Google only allows API keys, so add your key in a bot&apos;s Settings → Brain instead.
      </p>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-4 hover:underline">
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
