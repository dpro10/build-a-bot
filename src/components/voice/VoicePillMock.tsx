/**
 * The voice typing pill as it looks at the bottom of the screen (a picture of it, for the site and
 * the Voice typing page): listening with its waveform, or done with what it typed.
 */
import { Check, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bar heights, then delays, so the waveform looks like speech rather than a metronome. */
const BARS = [0.35, 0.6, 0.9, 0.55, 0.75, 1, 0.65, 0.4, 0.8, 0.95, 0.5, 0.7, 0.45, 0.85, 0.6, 0.3];

export function VoicePillMock({ state = "listening", text, time = "0:04", className }: { state?: "listening" | "done"; text?: string; time?: string; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "inline-flex h-11 max-w-full items-center gap-2.5 rounded-full border border-white/10 bg-[#16141f] pr-4 pl-2 text-[13px] font-medium text-[#f4f2f9] shadow-[0_12px_32px_-10px_rgb(0_0_0/0.5)]",
        className,
      )}
    >
      {state === "listening" ? (
        <>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
            <Mic className="size-3.5" />
          </span>
          <span className="flex h-6 items-center gap-[3px]">
            {BARS.map((h, i) => (
              <span
                key={i}
                className="block w-[3px] origin-center animate-voice-wave rounded-full bg-[#9d86ff]"
                style={{ height: `${Math.round(h * 22)}px`, animationDelay: `${(i * 0.13) % 1.1}s`, opacity: 0.45 + (i / BARS.length) * 0.55 }}
              />
            ))}
          </span>
          <span className="tabular-nums text-[#a9a4ba]">{time}</span>
        </>
      ) : (
        <>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#34d399] text-[#062b1d]">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          <span className="truncate">{text ?? "Typed"}</span>
        </>
      )}
    </div>
  );
}
