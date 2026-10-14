"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { clock, isOwnerLine, speakerName, type SegmentView } from "./shared";

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) {
      out.push(text.slice(i));
      break;
    }
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={k++} className="rounded-[4px] bg-accent px-0.5 text-accent-foreground">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    i = at + needle.length;
  }
  return out;
}

export function SpeakerChip({ seg, ownerName, className }: { seg: Pick<SegmentView, "speaker" | "track">; ownerName: string; className?: string }) {
  const owner = isOwnerLine(seg);
  const room = seg.speaker === "Room";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2 py-px text-xs font-semibold",
        owner ? "bg-primary-soft text-primary" : room ? "bg-success-soft text-success" : "bg-muted text-foreground/80",
        className,
      )}
    >
      {speakerName(seg, ownerName)}
    </span>
  );
}

/** Transcript lines, grouped when the same speaker keeps talking. */
export const TranscriptList = React.memo(function TranscriptList({
  segments,
  ownerName,
  query = "",
  className,
  dense,
}: {
  segments: SegmentView[];
  ownerName: string;
  query?: string;
  className?: string;
  dense?: boolean;
}) {
  return (
    <ol className={cn("flex flex-col", dense ? "gap-2.5" : "gap-3.5", className)}>
      {segments.map((s, i) => {
        const prev = segments[i - 1];
        const sameSpeaker = prev && prev.speaker === s.speaker && prev.track === s.track && s.startMs - prev.startMs < 60_000;
        return (
          <li key={s.id} className={cn("grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2", sameSpeaker && (dense ? "-mt-1" : "-mt-2"))}>
            <span className="pt-[3px] text-right font-mono text-xs text-muted-foreground tabular-nums">{clock(s.startMs)}</span>
            <div className="min-w-0">
              {sameSpeaker ? null : <SpeakerChip seg={s} ownerName={ownerName} className="mb-0.5" />}
              <p className={cn("leading-relaxed text-pretty", dense ? "text-sm" : "text-[15px]")}>{highlight(s.text, query)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
});
