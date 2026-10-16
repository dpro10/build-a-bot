"use client";
/**
 * A finished call in the chat: how long, how fast it answered, and the transcript (folded away).
 */
import * as React from "react";
import { ChevronDown, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatCallRef = {
  kind: "web" | "phone";
  durationS: number;
  latencyP50Ms: number | null;
  turns: { role: "caller" | "bot"; text: string; interrupted?: boolean }[];
};

export function ChatCall({ call, botName }: { call: ChatCallRef; botName: string }) {
  const [open, setOpen] = React.useState(false);
  const minutes = call.durationS < 60 ? `${call.durationS} s` : `${Math.round(call.durationS / 60)} min`;
  return (
    <div className="max-w-xl self-start overflow-hidden rounded-3xl rounded-tl-lg border border-border bg-bubble-bot shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Phone className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{call.kind === "phone" ? "Phone call" : "Call"} with {botName}</span>
          <span className="block text-sm text-muted-foreground">
            {minutes}
            {call.latencyP50Ms !== null ? ` · answered in about ${(call.latencyP50Ms / 1000).toFixed(1)} s` : ""}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition", open && "rotate-180")} />
      </button>
      {open ? (
        <ol className="flex flex-col gap-1.5 border-t border-border px-4 py-3 text-sm" aria-label="Transcript">
          {call.turns.map((t, i) => (
            <li key={i}>
              <span className="font-semibold">{t.role === "caller" ? "You" : botName}:</span> {t.text}
              {t.interrupted ? <span className="text-muted-foreground"> (you cut in)</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
