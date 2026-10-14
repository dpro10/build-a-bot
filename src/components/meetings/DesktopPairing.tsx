"use client";
/**
 * Pairing for the desktop app: the same one-time code as the Bridge, typed into the
 * app's "Pair this computer" window. Watches for the new computer and says so.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, PartyPopper, RefreshCw, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { clock } from "./shared";

/** Where the desktop app pairs unless its "Server" field is changed. */
const DESKTOP_DEFAULT_SERVER = "https://build-a-bot.site";

type Device = { id: string; name: string; platform: string | null };

export function DesktopPairing() {
  const router = useRouter();
  const [pairing, setPairing] = React.useState<{ code: string; expiresAt: number; server: string } | null>(null);
  const [requesting, setRequesting] = React.useState(false);
  const [paired, setPaired] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const baseline = React.useRef<Set<string> | null>(null);
  const live = Boolean(pairing && pairing.expiresAt > now);

  React.useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairing]);

  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible" || !baseline.current) return;
      try {
        const { devices } = await api<{ devices: Device[] }>("/api/bridge/devices");
        const fresh = devices.find((d) => !baseline.current?.has(d.id));
        if (!fresh) return;
        baseline.current = null;
        setPairing(null);
        setPaired(fresh.name);
        toast.success(`${fresh.name} is paired!`, { description: "Your bot will pop up there when a call starts, and ask first." });
        router.refresh();
      } catch {
        /* next tick */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [live, router]);

  const getCode = async () => {
    setRequesting(true);
    try {
      const current = await api<{ devices: Device[] }>("/api/bridge/devices")
        .then((r) => r.devices)
        .catch(() => [] as Device[]);
      const res = await api<{ code: string; expiresInSeconds: number; server: string }>("/api/bridge/pairing-code", { method: "POST" });
      baseline.current = new Set(current.map((d) => d.id));
      setNow(Date.now());
      setPairing({ code: res.code, expiresAt: Date.now() + res.expiresInSeconds * 1000, server: res.server });
      setPaired(null);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't make a code. Try again.");
    } finally {
      setRequesting(false);
    }
  };

  if (pairing && live) {
    const left = pairing.expiresAt - now;
    return (
      <div className="animate-fade-up rounded-3xl border border-primary/30 bg-primary-soft/50 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold tracking-wide text-primary uppercase">Your pairing code</div>
          <div className={cn("inline-flex items-center gap-1 text-xs font-semibold tabular-nums", left < 120_000 ? "text-warning" : "text-muted-foreground")}>
            <Timer className="size-3.5" aria-hidden /> Expires in {clock(left)}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="font-mono text-[34px] leading-tight font-bold tracking-[0.14em] sm:text-[40px]" aria-label={pairing.code.split("").join(" ")}>
            {pairing.code}
          </span>
          <CopyButton value={pairing.code} label="Copy" aria-label="Copy the pairing code" />
        </div>
        {pairing.server.replace(/\/$/, "") !== DESKTOP_DEFAULT_SERVER ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Testing on another server? In the app, open <span className="font-medium text-foreground">Server</span> and enter{" "}
            <code className="rounded bg-card px-1 py-0.5 font-mono text-[11px] text-foreground">{pairing.server}</code>.
          </p>
        ) : null}
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          Waiting for the desktop app… this page updates by itself.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {paired ? (
        <p className="inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1 text-sm font-semibold text-success">
          <PartyPopper className="size-4" aria-hidden /> {paired} is paired.
        </p>
      ) : pairing ? (
        <p className="text-sm text-warning">That code expired. Codes last 15 minutes and work once.</p>
      ) : null}
      <Button onClick={getCode} loading={requesting} variant={paired ? "outline" : "primary"}>
        {!requesting ? pairing ? <RefreshCw /> : <KeyRound /> : null}
        {pairing ? "Get a new code" : paired ? "Pair another computer" : "Get a pairing code"}
      </Button>
    </div>
  );
}
