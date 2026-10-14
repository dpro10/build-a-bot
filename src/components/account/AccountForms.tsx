"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Clock, Download, LogOut, Mail, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Profile

type Zone = { id: string; city: string; region: string; offset: string };

function zoneParts(id: string, at: Date): Zone {
  const [region, ...rest] = id.split("/");
  const city = (rest.length ? rest[rest.length - 1] : region).replace(/_/g, " ");
  const sub = rest.length > 1 ? ` (${rest.slice(0, -1).join(", ").replace(/_/g, " ")})` : "";
  let offset = "";
  try {
    offset =
      new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    /* unknown zone */
  }
  return { id, city: `${city}${sub}`, region: rest.length ? region : "Other", offset };
}

function allZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  if (!zones.includes("UTC")) zones = [...zones, "UTC"];
  if (current && !zones.includes(current)) zones = [current, ...zones];
  return zones;
}

function localTime(zone: string, at: Date): string {
  try {
    return at.toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ProfileForm({
  initialName,
  email,
  verified,
  initialTimezone,
}: {
  initialName: string;
  email: string | null;
  verified: boolean;
  initialTimezone: string;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initialName);
  const [timezone, setTimezone] = React.useState(initialTimezone);
  const [saved, setSaved] = React.useState({ name: initialName, timezone: initialTimezone });
  const [saving, setSaving] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  // The zone list and the browser's zone only exist in the browser; fill them in after mount.
  const [zones, setZones] = React.useState<Zone[] | null>(null);
  const [browserZone, setBrowserZone] = React.useState<string | null>(null);
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    const at = new Date();
    setNow(at);
    setZones(allZones(initialTimezone).map((z) => zoneParts(z, at)));
    try {
      setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setBrowserZone(null);
    }
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [initialTimezone]);

  const dirty = name.trim() !== saved.name || timezone !== saved.timezone;

  const grouped = React.useMemo(() => {
    if (!zones) return null;
    const map = new Map<string, Zone[]>();
    for (const z of zones) {
      const list = map.get(z.region);
      if (list) list.push(z);
      else map.set(z.region, [z]);
    }
    for (const list of map.values()) list.sort((a, b) => a.city.localeCompare(b.city));
    return [...map.entries()].sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
  }, [zones]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed && saved.name) {
      setNameError("Tell your bots what to call you.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/account", { method: "PATCH", body: trimmed ? { name: trimmed, timezone } : { timezone } });
      setSaved({ name: trimmed, timezone });
      setName(trimmed);
      toast.success("Saved. Your bots will use this from now on.");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const zoneLabel = (z: Zone) => `${z.city}${z.offset ? ` · ${z.offset}` : ""}`;
  const suggest = browserZone && browserZone !== timezone ? browserZone : null;

  return (
    <form onSubmit={save} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="account-name">Your name</Label>
        <Input
          id="account-name"
          value={name}
          maxLength={60}
          autoComplete="name"
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          aria-invalid={nameError ? true : undefined}
          aria-describedby="account-name-hint"
          placeholder="What should your bots call you?"
        />
        {nameError ? (
          <p id="account-name-hint" className="text-sm font-medium text-danger">
            {nameError}
          </p>
        ) : (
          <FieldHint id="account-name-hint">What your bots call you.</FieldHint>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium" id="account-email-label">
          Email
        </span>
        {email && verified ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background-2/60 px-4 py-3" aria-labelledby="account-email-label">
            <Mail className="size-4 text-muted-foreground" aria-hidden />
            <span className="min-w-0 font-medium break-all">{email}</span>
            <Badge tone="success">
              <BadgeCheck /> Verified
            </Badge>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary-soft/50 p-4 sm:flex-row sm:items-center" aria-labelledby="account-email-label">
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold">No email yet</div>
              <p className="text-foreground/75">Right now your bots live only in this browser. Add your email so you can sign in anywhere and never lose them.</p>
            </div>
            <Button asChild className="shrink-0">
              <Link href="/login?next=/app/account">
                <Mail /> Add your email
              </Link>
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="account-timezone">Time zone</Label>
        <Select id="account-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} aria-describedby="account-timezone-hint">
          {grouped ? (
            <>
              {suggest ? (
                <optgroup label="Suggested (this device)">
                  <option value={suggest}>{zoneLabel(zones!.find((z) => z.id === suggest) ?? zoneParts(suggest, now ?? new Date()))}</option>
                </optgroup>
              ) : null}
              {grouped.map(([region, list]) => (
                <optgroup key={region} label={region}>
                  {list.map((z) => (
                    <option key={z.id} value={z.id}>
                      {zoneLabel(z)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </>
          ) : (
            <option value={timezone}>{timezone.replace(/_/g, " ")}</option>
          )}
        </Select>
        <div id="account-timezone-hint" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <FieldHint className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {now ? `It's ${localTime(timezone, now)} there now. ` : ""}For reminders, routines and quiet hours.
          </FieldHint>
          {suggest ? (
            <button type="button" onClick={() => setTimezone(suggest)} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">
              Use this device&apos;s zone ({suggest.replace(/_/g, " ")})
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving} disabled={!dirty}>
          Save changes
        </Button>
        {dirty ? (
          <button
            type="button"
            onClick={() => {
              setName(saved.name);
              setTimezone(saved.timezone);
              setNameError(null);
            }}
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Undo
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Your data: export, sign out, delete

export function DataActions({ anonymous, botCount, paid }: { anonymous: boolean; botCount: number; paid: boolean }) {
  const [exporting, setExporting] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const signOutForm = React.useRef<HTMLFormElement>(null);

  const download = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) throw new Error(res.status === 401 ? "Please sign in again." : "Couldn't prepare your data. Try again.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `build-a-bot-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success("Your data is downloading.", { description: "One JSON file with your bots, chats, memories, meetings and receipts. No keys or passwords." });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  // A real form post: the server clears the cookie and redirects home.
  const signOut = () => {
    setSigningOut(true);
    signOutForm.current?.submit();
  };

  return (
    <div className="divide-y divide-border">
      <Row
        icon={<Download className="size-4" />}
        title="Download my data"
        text="Everything we hold about you and your bots, as one JSON file."
        action={
          <Button variant="outline" onClick={download} loading={exporting}>
            {!exporting ? <Download /> : null} Download
          </Button>
        }
      />
      <Row
        icon={<LogOut className="size-4" />}
        title="Sign out"
        text={anonymous ? "Careful: without an email, you can't sign back in to these bots." : "Sign out on this device. Your bots keep working."}
        action={
          <>
            <form ref={signOutForm} action="/api/auth/logout" method="post" className="hidden" />
            {anonymous ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <LogOut /> Sign out
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add your email first?</DialogTitle>
                    <DialogDescription>
                      You haven&apos;t added an email, so once you sign out there&apos;s no way back to {botCount === 1 ? "your bot" : "your bots"}.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="flex-col-reverse items-stretch sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
                    <Button variant="ghost" onClick={signOut} loading={signingOut}>
                      Sign out anyway
                    </Button>
                    <Button asChild>
                      <Link href="/login?next=/app/account">
                        <Mail /> Add my email
                      </Link>
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              <Button variant="outline" onClick={signOut} loading={signingOut}>
                {!signingOut ? <LogOut /> : null} Sign out
              </Button>
            )}
          </>
        }
      />
      <Row
        danger
        icon={<Trash2 className="size-4" />}
        title="Delete my account"
        text="Permanently remove your account, your bots and everything they know."
        action={<DeleteAccount botCount={botCount} paid={paid} />}
      />
    </div>
  );
}

function Row({ icon, title, text, action, danger }: { icon: React.ReactNode; title: string; text: string; action: React.ReactNode; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", danger ? "bg-danger-soft text-danger" : "bg-muted text-foreground")}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className={cn("font-semibold", danger && "text-danger")}>{title}</div>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
      </div>
      <div className="shrink-0 pl-12 sm:pl-0">{action}</div>
    </div>
  );
}

function DeleteAccount({ botCount, paid }: { botCount: number; paid: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const ok = confirm.trim().toUpperCase() === "DELETE";

  const remove = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await api("/api/account", { method: "DELETE" });
      toast("Your account is deleted. Take care!");
      window.location.assign("/");
    } catch (err) {
      toast.error((err as Error).message || "Couldn't delete your account. Try again.");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setConfirm("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger-soft">
          <Trash2 /> Delete account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>This can&apos;t be undone. We&apos;ll permanently remove:</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-col gap-2 text-sm">
            {[
              botCount === 1
                ? "Your bot, with its chats, memories, notes, meetings and routines"
                : `All ${botCount} of your bots, with their chats, memories, notes, meetings and routines`,
              "Every receipt and approval",
              "Your saved API keys and app connections",
              paid ? "Paired computers and your plan (your subscription is canceled right away)" : "Paired computers (Bridge)",
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <Trash2 className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-start gap-2.5 rounded-2xl bg-muted/70 p-3 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>Want a copy first? Close this and use Download my data.</span>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <Label htmlFor="confirm-delete">
              Type <span className="font-mono font-bold">DELETE</span> to confirm
            </Label>
            <Input
              id="confirm-delete"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void remove();
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="DELETE"
            />
          </div>
        </DialogBody>
        <DialogFooter className="flex-col-reverse items-stretch sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
          <DialogClose asChild>
            <Button variant="ghost">Keep my account</Button>
          </DialogClose>
          <Button variant="danger" disabled={!ok} loading={busy} onClick={remove}>
            {!busy ? <Trash2 /> : null} Delete everything
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
