"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, AudioLines, CircleCheck, KeyRound, Laptop, LoaderCircle, Monitor, PartyPopper, Plus, RefreshCw, Settings, Timer, Unplug } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import type { AvatarId, ColorwayId } from "@/lib/avatars";
import { cliVersion, isDesktopApp, type DeviceView } from "./bridge-shared";
import { clock, useNow } from "./time";

export type SubscriptionBot = {
  id: string;
  name: string;
  avatar: AvatarId;
  color: ColorwayId;
  cli: "claude" | "codex";
  modelLabel: string;
  whenOffline: "wait" | "included";
  paused: boolean;
};
export type PlainBot = { id: string; name: string; avatar: AvatarId; color: ColorwayId };

type Pairing = { code: string; command: string; expiresAt: number };

const CLI_NAME = { claude: "Claude Code", codex: "Codex" } as const;
const SUB_NAME = { claude: "Your Claude", codex: "Your ChatGPT" } as const;

export function CommandBlock({ command, className }: { command: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-2xl border border-border bg-background-2 py-1.5 pr-1.5 pl-4", className)}>
      <code className="no-scrollbar min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-foreground">
        <span className="text-muted-foreground select-none">$ </span>
        {command}
      </code>
      <CopyButton value={command} label="Copy" className="shrink-0" aria-label={`Copy: ${command}`} />
    </div>
  );
}

export function BridgeLive({
  initialDevices,
  subscriptionBots,
  allBots,
  serverNow,
  prerequisites,
}: {
  initialDevices: DeviceView[];
  subscriptionBots: SubscriptionBot[];
  allBots: PlainBot[];
  serverNow: number;
  prerequisites: React.ReactNode;
}) {
  const router = useRouter();
  const [devices, setDevices] = React.useState(initialDevices);
  const [pairing, setPairing] = React.useState<Pairing | null>(null);
  const [requesting, setRequesting] = React.useState(false);
  const [justPaired, setJustPaired] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<DeviceView | null>(null);
  // Computers that existed when the current code was issued; anything else that shows up is the new one.
  const baseline = React.useRef<Set<string> | null>(null);
  // Decided once per visit, so pairing mid-visit doesn't shuffle the page under the person.
  const [returning] = React.useState(initialDevices.length > 0);
  const now = useNow(serverNow, pairing ? 1000 : 30_000);
  const pairingLive = Boolean(pairing && pairing.expiresAt > now);

  // Server re-renders (router.refresh, or another tab's change) bring fresh props.
  React.useEffect(() => {
    setDevices(initialDevices);
  }, [initialDevices]);

  // The new computer can arrive through polling or a server re-render; celebrate it either way.
  React.useEffect(() => {
    if (!pairing || !baseline.current) return;
    const seen = baseline.current;
    const fresh = devices.find((d) => !seen.has(d.id));
    if (!fresh) return;
    baseline.current = null;
    setJustPaired(fresh.id);
    setPairing(null);
    toast.success(`${fresh.name} is paired!`, {
      description: isDesktopApp(fresh.platform)
        ? "Your bot will pop up there when a call starts, and ask before it takes notes."
        : "Now start the Bridge on it so your bots can think there.",
    });
    router.refresh();
  }, [devices, pairing, router]);

  const poll = React.useCallback(async () => {
    try {
      const { devices: next } = await api<{ devices: DeviceView[] }>("/api/bridge/devices");
      setDevices(next);
    } catch {
      /* offline for a moment; the next tick retries */
    }
  }, []);

  // Watch for the new computer every few seconds while a code is out; otherwise just keep "online" honest.
  React.useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void poll();
      },
      pairingLive ? 3000 : 20_000,
    );
    return () => clearInterval(timer);
  }, [pairingLive, poll]);

  const getCode = async () => {
    setRequesting(true);
    try {
      // Snapshot what's paired right now, so only a computer that pairs with this code counts as new.
      const current = await api<{ devices: DeviceView[] }>("/api/bridge/devices")
        .then((r) => r.devices)
        .catch(() => devices);
      const res = await api<{ code: string; command: string; expiresInSeconds: number }>("/api/bridge/pairing-code", { method: "POST" });
      baseline.current = new Set(current.map((d) => d.id));
      setDevices(current);
      setPairing({ code: res.code, command: res.command, expiresAt: Date.now() + res.expiresInSeconds * 1000 });
      setJustPaired(null);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't make a code. Try again.");
    } finally {
      setRequesting(false);
    }
  };

  const revoke = async (device: DeviceView) => {
    setRevoking(null);
    setDevices((ds) => ds.filter((d) => d.id !== device.id));
    try {
      await api(`/api/bridge/devices/${device.id}`, { method: "DELETE" });
      toast(`${device.name} is unpaired.`, {
        description: isDesktopApp(device.platform)
          ? "The desktop app there stops taking notes right away."
          : "On that computer, run `npx build-a-bot-bridge unpair` to remove its saved key too.",
      });
      router.refresh();
    } catch (err) {
      setDevices((ds) => [device, ...ds]);
      toast.error((err as Error).message || "Couldn't revoke it. Try again.");
    }
  };

  const onlineWith = (cli: "claude" | "codex") => devices.some((d) => d.online && d.clis[cli]);
  // The desktop app (meeting notes) pairs here too, but only the Bridge thinks for subscription bots.
  const bridgeDevices = devices.filter((d) => !isDesktopApp(d.platform));
  const anyOnline = bridgeDevices.some((d) => d.online);
  const hasDevices = devices.length > 0;

  const setup = (
    <section aria-labelledby="setup-title" className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <h2 id="setup-title" className="font-display text-xl font-semibold">
          {returning ? "Pair another computer" : "Set it up"}
        </h2>
        <p className="mt-0.5 mb-5 text-sm text-muted-foreground">About two minutes. You&apos;ll copy two commands into your computer&apos;s terminal.</p>
        <ol className="flex flex-col gap-6">
          <Step n={1} title="Get a pairing code" done={Boolean(justPaired)}>
            {pairing && pairingLive ? (
              <div className="animate-fade-up rounded-3xl border border-primary/30 bg-primary-soft/50 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold tracking-wide text-primary uppercase">Your pairing code</div>
                  <div
                    className={cn(
                      "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
                      pairing.expiresAt - now < 120_000 ? "text-warning" : "text-muted-foreground",
                    )}
                  >
                    <Timer className="size-3.5" aria-hidden /> Expires in {clock(pairing.expiresAt - now)}
                  </div>
                </div>
                <div className="mt-1 font-mono text-[34px] leading-tight font-bold tracking-[0.14em] sm:text-5xl" aria-label={pairing.code.split("").join(" ")}>
                  {pairing.code}
                </div>
                <p className="mt-3 mb-2 text-sm">Run this on the computer you want to pair:</p>
                <CommandBlock command={pairing.command} />
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
                  Waiting for your computer… this page updates by itself.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3">
                {pairing ? (
                  <p className="text-sm text-warning">That code expired. Codes last 15 minutes and work once.</p>
                ) : justPaired ? (
                  <p className="inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1 text-sm font-semibold text-success">
                    <PartyPopper className="size-4" aria-hidden /> Paired! Now start the Bridge (step 2).
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">It works once and expires after 15 minutes, so get it when you&apos;re at your computer.</p>
                )}
                <Button onClick={getCode} loading={requesting} size="lg">
                  {!requesting ? pairing ? <RefreshCw /> : <KeyRound /> : null}
                  {pairing ? "Get a new code" : justPaired ? "Pair another computer" : "Get a pairing code"}
                </Button>
              </div>
            )}
          </Step>
          <Step n={2} title="Start the Bridge" next={Boolean(justPaired)}>
            <CommandBlock command="npx build-a-bot-bridge" />
            <p className="mt-2 text-sm text-muted-foreground">
              Leave that window open. Your bots can think on this computer whenever it&apos;s running. Press Ctrl+C to stop it.
            </p>
          </Step>
          <Step n={3} title="Point a bot at your subscription" last>
            <p className="text-sm text-muted-foreground">
              Open a bot&apos;s <span className="font-medium text-foreground">Settings → Brain</span> and choose{" "}
              <span className="font-medium text-foreground">Your Claude</span> or <span className="font-medium text-foreground">Your ChatGPT</span>.
            </p>
            {allBots.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {allBots.slice(0, 6).map((b) => (
                  <Link
                    key={b.id}
                    href={`/app/bots/${b.id}/settings`}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pr-3 pl-1 text-sm font-medium shadow-soft transition hover:border-primary/40"
                  >
                    <Avatar avatar={b.avatar} color={b.color} size={26} animated={false} />
                    {b.name}
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                  </Link>
                ))}
              </div>
            ) : null}
          </Step>
        </ol>
        <details className="group mt-6 rounded-2xl border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            Handy commands
            <Plus className="size-4 text-muted-foreground transition group-open:rotate-45" aria-hidden />
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <HandyCommand command="npx build-a-bot-bridge status" text="Is this computer paired, and which server is it talking to?" />
            <HandyCommand command="npx build-a-bot-bridge doctor" text="Checks Node, Claude Code and Codex, with tips to fix what's missing." />
            <HandyCommand command="npx build-a-bot-bridge unpair" text="Forgets this computer's key. Revoke it below too." />
          </div>
        </details>
      </div>
      <aside className="lg:col-span-2">{prerequisites}</aside>
    </section>
  );

  const deviceList = (
    <section aria-labelledby="devices-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="devices-title" className="font-display text-xl font-semibold">
            Your computers
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {hasDevices
              ? anyOnline
                ? "Your subscription bots think on whichever one is online."
                : bridgeDevices.length
                  ? "None are online right now. Start the Bridge on one to wake your bots."
                  : "The desktop app takes meeting notes. To use your own Claude or ChatGPT, pair a computer with the Bridge too."
              : "Computers you pair show up here."}
          </p>
        </div>
        {hasDevices ? (
          <Badge tone={devices.some((d) => d.online) ? "success" : "neutral"} className="px-3 py-1 text-sm">
            <span className={cn("size-2 rounded-full", devices.some((d) => d.online) ? "bg-success" : "bg-muted-foreground")} />
            {devices.filter((d) => d.online).length} of {devices.length} online
          </Badge>
        ) : null}
      </div>
      {hasDevices ? (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {devices.map((d) => (
            <DeviceRow key={d.id} device={d} now={now} fresh={justPaired === d.id} onRevoke={() => setRevoking(d)} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-border px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            {pairingLive ? <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden /> : <Laptop className="size-6" aria-hidden />}
          </span>
          <div className="font-semibold">{pairingLive ? "Waiting for your computer…" : "No computers yet"}</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            {pairingLive ? "Run the pair command above. It pops up here the moment it connects." : "Get a pairing code above and run the command on your computer."}
          </p>
        </div>
      )}
    </section>
  );

  const botList = (
    <section aria-labelledby="subscription-bots-title">
      <div className="mb-4">
        <h2 id="subscription-bots-title" className="font-display text-xl font-semibold">
          Bots on your subscription
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          While your computer is asleep or offline, these bots wait and answer once it&apos;s back — or use the included brain instead, if you
          turned that on in the bot&apos;s Settings.
        </p>
      </div>
      {subscriptionBots.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {subscriptionBots.map((b) => {
            const ready = onlineWith(b.cli);
            const status = b.paused
              ? { tone: "neutral" as const, label: "Paused" }
              : ready
                ? { tone: "success" as const, label: "Ready" }
                : anyOnline
                  ? { tone: "warning" as const, label: `${CLI_NAME[b.cli]} isn't on your computer` }
                  : b.whenOffline === "included"
                    ? { tone: "neutral" as const, label: "Using the included brain for now" }
                    : { tone: "warning" as const, label: "Waiting for your computer" };
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5">
                <Avatar avatar={b.avatar} color={b.color} size={44} mood={b.paused ? "sleeping" : ready ? "idle" : "sleeping"} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{b.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {SUB_NAME[b.cli]} · {b.modelLabel} · {b.whenOffline === "included" ? "falls back to the included brain when offline" : "waits when offline"}
                  </div>
                </div>
                <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                  <Badge tone={status.tone}>
                    {status.tone === "success" ? <CircleCheck /> : null}
                    {status.label}
                  </Badge>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/app/bots/${b.id}/settings`}>
                      <Settings /> Brain
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-3xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
          None of your bots use a subscription yet. Open a bot&apos;s <span className="font-medium text-foreground">Settings → Brain</span> and pick{" "}
          <span className="font-medium text-foreground">Your Claude</span> or <span className="font-medium text-foreground">Your ChatGPT</span>.
        </div>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-12">
      {returning ? (
        <>
          {deviceList}
          {botList}
          {setup}
        </>
      ) : (
        <>
          {setup}
          {deviceList}
          {botList}
        </>
      )}

      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpair {revoking?.name}?</DialogTitle>
            <DialogDescription>
              {revoking && isDesktopApp(revoking.platform)
                ? "Your bots won't take meeting notes on this computer anymore. Its saved key stops working right away, so pairing again needs a new code."
                : "Your bots won't think on this computer anymore. Its saved key stops working right away, so pairing again needs a new code."}
            </DialogDescription>
          </DialogHeader>
          {revoking && isDesktopApp(revoking.platform) ? null : (
            <DialogBody>
              <p className="text-sm text-muted-foreground">To clean up on that computer too, run:</p>
              <CommandBlock command="npx build-a-bot-bridge unpair" className="mt-2" />
            </DialogBody>
          )}
          <DialogFooter className="flex-col-reverse items-stretch sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
            <DialogClose asChild>
              <Button variant="ghost">Keep it</Button>
            </DialogClose>
            <Button variant="danger" onClick={() => revoking && void revoke(revoking)}>
              <Unplug /> Unpair
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Step({ n, title, children, done, last, next }: { n: number; title: string; children: React.ReactNode; done?: boolean; last?: boolean; next?: boolean }) {
  return (
    <li className="relative flex gap-4">
      {!last ? <span className="absolute top-10 bottom-[-18px] left-[15px] w-px bg-border" aria-hidden /> : null}
      <span
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          done ? "bg-success text-success-foreground" : next ? "bg-primary text-primary-foreground shadow-glow" : "bg-primary-soft text-primary",
        )}
        aria-hidden
      >
        {done ? <CircleCheck className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <h3 className="mb-2.5 flex flex-wrap items-center gap-2 font-semibold">
          {title}
          {next ? (
            <Badge tone="primary" className="animate-pop">
              Do this next
            </Badge>
          ) : null}
        </h3>
        {children}
      </div>
    </li>
  );
}

function HandyCommand({ command, text }: { command: string; text: string }) {
  return (
    <div>
      <CommandBlock command={command} />
      <p className="mt-1.5 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function DeviceRow({ device, now, fresh, onRevoke }: { device: DeviceView; now: number; fresh: boolean; onRevoke: () => void }) {
  const Icon = device.platform?.startsWith("win") || device.platform?.startsWith("linux") ? Monitor : Laptop;
  const paired = new Date(device.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5", fresh && "animate-fade-up bg-success-soft/40")}>
      <span className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
        <Icon className="size-5" aria-hidden />
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-[3px] ring-card",
            device.online ? "bg-success" : "bg-muted-foreground/60",
          )}
          aria-hidden
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold">{device.name}</span>
          <span className={cn("text-xs font-semibold", device.online ? "text-success" : "text-muted-foreground")}>
            {device.online ? "Online" : device.lastSeenAt ? `Last seen ${relativeTime(device.lastSeenAt, Math.max(now, Date.parse(device.lastSeenAt)))}` : "Never connected"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {device.platformLabel} · paired {paired}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {isDesktopApp(device.platform) ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
              <AudioLines className="size-3" aria-hidden /> Desktop app (meeting notes)
            </span>
          ) : null}
          {(isDesktopApp(device.platform) ? [] : (["claude", "codex"] as const)).map((cli) => {
            const version = cliVersion(device.clis[cli]);
            return (
              <span
                key={cli}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  version ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
                )}
              >
                {version ? <CircleCheck className="size-3" aria-hidden /> : null}
                {CLI_NAME[cli]} {version ?? "not found"}
              </span>
            );
          })}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onRevoke} className="text-danger hover:bg-danger-soft">
        <Unplug /> Revoke
      </Button>
    </li>
  );
}
