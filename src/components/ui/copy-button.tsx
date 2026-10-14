"use client";
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "./button";

/** Copies `value` to the clipboard and shows a check for a moment. */
export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", ...props }: { value: string; label?: string; copiedLabel?: string } & Omit<ButtonProps, "onClick" | "value">) {
  const [copied, setCopied] = React.useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older browsers / insecure origins: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} {...props}>
      {copied ? <Check /> : <Copy />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
