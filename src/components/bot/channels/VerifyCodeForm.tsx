"use client";
import * as React from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { CodeDisplay } from "./parts";

/** "Enter the 6-digit code" with resend, change, and the demo-mode code shown on screen. */
export function VerifyCodeForm({
  demoCode,
  demoNote,
  onVerify,
  onResend,
  other,
  onChangeTarget,
  changeLabel,
}: {
  demoCode: string | null;
  demoNote: string;
  onVerify: (code: string) => Promise<boolean>;
  onResend: () => void;
  /** Another way to get the code (a call instead of a text). */
  other?: { label: string; onClick: () => void };
  onChangeTarget: () => void;
  changeLabel: string;
}) {
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const inputId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const inFlight = React.useRef(false);
  const submit = async (e?: React.FormEvent, value = code) => {
    e?.preventDefault();
    if (value.length !== 6 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const ok = await onVerify(value);
    inFlight.current = false;
    setBusy(false);
    if (!ok) {
      setCode("");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      {demoCode ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-primary-soft/70 px-3 py-2.5 text-[13px] text-foreground/80">
          <FlaskConical className="size-4 shrink-0 text-primary" />
          <span>
            {demoNote} Your code is
          </span>
          <CodeDisplay code={demoCode} />
          <Button
            type="button"
            variant="soft"
            size="sm"
            onClick={() => {
              setCode(demoCode);
              void submit(undefined, demoCode);
            }}
          >
            Use it
          </Button>
        </div>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId} className="text-[13px] text-muted-foreground">
            6-digit code
          </Label>
          <Input
            ref={inputRef}
            id={inputId}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="••••••"
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              if (v.length === 6) void submit(undefined, v);
            }}
            className="h-11 text-center font-mono text-lg tracking-[0.4em] sm:w-44"
          />
        </div>
        <Button type="submit" loading={busy} disabled={code.length !== 6} className="h-11 shrink-0">
          Verify
        </Button>
      </form>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <button type="button" onClick={onResend} className="font-medium text-primary hover:underline">
          Send a new code
        </button>
        {other ? (
          <button type="button" onClick={other.onClick} className="font-medium text-primary hover:underline">
            {other.label}
          </button>
        ) : null}
        <button type="button" onClick={onChangeTarget} className="font-medium text-muted-foreground hover:text-foreground hover:underline">
          {changeLabel}
        </button>
      </div>
    </div>
  );
}
