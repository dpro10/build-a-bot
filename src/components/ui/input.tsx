import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-2xl border border-input bg-card px-4 text-base text-foreground shadow-[inset_0_1px_2px_rgb(0_0_0/0.03)] outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full rounded-2xl border border-input bg-card px-4 py-3 text-base text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/15",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export function FieldHint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

/**
 * What someone typed after "+1", tidied as they type: "(512) 555-0123". A 1 or +1 in front is
 * dropped, since the box already shows +1 (and no US or Canada area code starts with 1).
 */
export function tidyUsPhone(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^1/, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** A US or Canada mobile number, with +1 shown in front so it's clear what to type. */
export const UsPhoneInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & { value: string; onValueChange: (value: string) => void }
>(({ className, value, onValueChange, ...props }, ref) => (
  <div
    className={cn(
      "flex h-12 w-full items-center rounded-2xl border border-input bg-card shadow-[inset_0_1px_2px_rgb(0_0_0/0.03)] transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15 has-[input:disabled]:opacity-60 has-[input[aria-invalid=true]]:border-danger",
      className,
    )}
  >
    <span aria-hidden className="select-none pl-4 pr-1.5 text-base text-muted-foreground">
      +1
    </span>
    <input
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      placeholder="(512) 555-0123"
      value={value}
      onChange={(e) => onValueChange(tidyUsPhone(e.target.value))}
      className="h-full min-w-0 flex-1 rounded-r-2xl bg-transparent pr-4 text-base text-foreground outline-none placeholder:text-muted-foreground/70"
      {...props}
    />
  </div>
));
UsPhoneInput.displayName = "UsPhoneInput";
