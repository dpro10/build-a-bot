"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { SettingsSection, useApiErrorToast } from "./ui";

export function DangerSection({ botId, botName }: { botId: string; botName: string }) {
  const router = useRouter();
  const onError = useApiErrorToast();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const matches = typed.trim() === botName.trim();

  const remove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    try {
      await api(`/api/bots/${botId}`, { method: "DELETE" });
      toast.success(`${botName} was deleted`);
      setOpen(false);
      router.push("/app?all=1");
      router.refresh();
    } catch (err) {
      onError(err, "Couldn't delete it. Try again.");
      setBusy(false);
    }
  };

  return (
    <SettingsSection id="danger" icon={TriangleAlert} tone="danger" title="Danger zone" description="Careful: this can't be undone.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Delete {botName}</div>
          <p className="text-muted-foreground">
            Erases {botName} for good: its chats, memories, notes, meetings, routines, receipts, channels and app connections.
          </p>
        </div>
        <Button
          variant="danger-soft"
          onClick={() => {
            setTyped("");
            setOpen(true);
          }}
          className="self-start sm:self-auto"
        >
          <Trash2 /> Delete {botName}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <form onSubmit={remove} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
              <DialogTitle>Delete {botName}?</DialogTitle>
              <DialogDescription>
                Everything goes: chats, memories, notes, meetings, routines, receipts and connections. Your account and your other bots stay.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-2">
              <label htmlFor="confirm-name" className="text-sm">
                Type <span className="font-semibold">{botName}</span> to confirm.
              </label>
              <Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus placeholder={botName} spellCheck={false} />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Keep {botName}
              </Button>
              <Button type="submit" variant="danger" disabled={!matches} loading={busy}>
                <Trash2 /> Delete forever
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
