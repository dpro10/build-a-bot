"use client";
import * as React from "react";
import { ExternalLink, KeyRound, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldHint, Input, Label } from "@/components/ui/input";

export type TokenRequest = {
  connectionId: string;
  name: string;
  label: string;
  url?: string;
  /** Shown when OAuth didn't work for a custom server. */
  reason?: string;
};

export function TokenDialog({
  request,
  botName,
  onClose,
  onSubmit,
}: {
  request: TokenRequest | null;
  botName: string;
  onClose: () => void;
  onSubmit: (token: string) => Promise<boolean>;
}) {
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();

  React.useEffect(() => {
    if (request) {
      setToken("");
      setError(null);
      setBusy(false);
    }
  }, [request]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (value.length < 8) {
      setError("That looks too short to be a token.");
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await onSubmit(value);
    setBusy(false);
    if (ok) setToken("");
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
      <DialogContent>
        {request ? (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
              <div className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <KeyRound className="size-5" />
              </div>
              <DialogTitle>Connect {request.name} with a token</DialogTitle>
              <DialogDescription>
                {request.reason ?? `${request.name} lets you connect by pasting a token you create in your account. ${botName} only uses it to reach ${request.name}.`}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <ol className="flex flex-col gap-2 text-sm">
                <li className="flex gap-2.5">
                  <StepDot n={1} />
                  <span>
                    {request.url ? (
                      <a href={request.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                        Create your {request.label} <ExternalLink className="size-3.5" />
                      </a>
                    ) : (
                      <span className="font-semibold">Create your {request.label}</span>
                    )}
                    . Give it only the access you want {botName} to have.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <StepDot n={2} />
                  <span>Paste it below.</span>
                </li>
              </ol>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={inputId}>{request.label}</Label>
                <Input
                  id={inputId}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste it here"
                  aria-invalid={Boolean(error)}
                  className="font-mono text-sm"
                />
                {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
                <FieldHint className="flex items-start gap-1.5">
                  <Lock className="mt-px size-3.5 shrink-0" />
                  Stored encrypted. It&apos;s never shown again, and you can remove it anytime by removing the app.
                </FieldHint>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!token.trim()}>
                Connect {request.name}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StepDot({ n }: { n: number }) {
  return <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary">{n}</span>;
}
