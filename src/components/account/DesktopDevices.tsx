"use client";
/**
 * The owner's paired computers on the Desktop app page: online or not, and Unpair. Polls
 * GET /api/bridge/devices so "Online" stays honest; a computer paired from this page arrives
 * through DesktopPairing's refresh.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Laptop, Monitor, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";
import type { DeviceView } from "./bridge-shared";
import { useNow } from "./time";

export function DesktopDevices({ initialDevices, serverNow }: { initialDevices: DeviceView[]; serverNow: number }) {
  const router = useRouter();
  const [devices, setDevices] = React.useState(initialDevices);
  const [revoking, setRevoking] = React.useState<DeviceView | null>(null);
  const now = useNow(serverNow);

  // Server re-renders (a computer just paired, or another tab's change) bring fresh props.
  React.useEffect(() => {
    setDevices(initialDevices);
  }, [initialDevices]);

  React.useEffect(() => {
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { devices: next } = await api<{ devices: DeviceView[] }>("/api/bridge/devices");
        setDevices(next);
      } catch {
        /* offline for a moment; the next tick retries */
      }
    }, 20_000);
    return () => clearInterval(timer);
  }, []);

  const revoke = async (device: DeviceView) => {
    setRevoking(null);
    setDevices((ds) => ds.filter((d) => d.id !== device.id));
    try {
      await api(`/api/bridge/devices/${device.id}`, { method: "DELETE" });
      toast(`${device.name} is unpaired.`, { description: "The desktop app there stops taking notes and typing for you right away." });
      router.refresh();
    } catch (err) {
      setDevices((ds) => [device, ...ds]);
      toast.error((err as Error).message || "Couldn't unpair it. Try again.");
    }
  };

  const online = devices.filter((d) => d.online).length;

  return (
    <section aria-labelledby="devices-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="devices-title" className="font-display text-xl font-semibold">
            Your computers
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {devices.length ? "Computers where the desktop app is paired with your account." : "Computers you pair show up here."}
          </p>
        </div>
        {devices.length ? (
          <Badge tone={online ? "success" : "neutral"} className="px-3 py-1 text-sm">
            <span className={cn("size-2 rounded-full", online ? "bg-success" : "bg-muted-foreground")} />
            {online} of {devices.length} online
          </Badge>
        ) : null}
      </div>
      {devices.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {devices.map((d) => (
            <DeviceRow key={d.id} device={d} now={now} onRevoke={() => setRevoking(d)} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-border px-6 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Laptop className="size-6" aria-hidden />
          </span>
          <div className="font-semibold">No computers yet</div>
          <p className="max-w-sm text-sm text-muted-foreground">Open the desktop app, then get a pairing code above and type it there.</p>
        </div>
      )}

      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unpair {revoking?.name}?</DialogTitle>
            <DialogDescription>
              Your bots won&apos;t take meeting notes or type for you on this computer anymore. Its saved key stops working right away, so pairing
              again needs a new code.
            </DialogDescription>
          </DialogHeader>
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
    </section>
  );
}

function DeviceRow({ device, now, onRevoke }: { device: DeviceView; now: number; onRevoke: () => void }) {
  const os = device.platform?.replace(/^desktop-/, "") ?? "";
  const Icon = os.startsWith("win") || os.startsWith("linux") ? Monitor : Laptop;
  const paired = new Date(device.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
      <span className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground">
        <Icon className="size-5" aria-hidden />
        <span
          className={cn("absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-[3px] ring-card", device.online ? "bg-success" : "bg-muted-foreground/60")}
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
        {/* The date is in the viewer's time zone, which the server can't know. */}
        <div className="text-xs text-muted-foreground" suppressHydrationWarning>
          {`${device.platformLabel} · paired ${paired}`}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onRevoke} className="text-danger hover:bg-danger-soft" aria-label={`Unpair ${device.name}`}>
        <Unplug /> Unpair
      </Button>
    </li>
  );
}
