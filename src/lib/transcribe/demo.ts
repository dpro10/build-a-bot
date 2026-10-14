/**
 * Demo mode: a scripted meeting, so recording → live transcript → notes can be
 * clicked through without a speech-to-text key. The owner's mic says one line per
 * chunk and the call answers, then it goes quiet.
 */
import type { TranscriptSegment } from "./index";

const YOU = [
  "Okay, thanks everyone for joining. Let's go through the launch plan for the new onboarding.",
  "Sam, can you have the new signup screens ready by Thursday?",
  "Great. I'll write the launch email and send it to Priya for review by Friday.",
  "Let's also settle pricing. I think we keep Plus at twelve dollars.",
  "So we're decided: we launch on the 28th, and pricing stays as it is.",
  "I'll set up a check-in for next Tuesday. Thanks, everyone!",
];

const OTHERS = [
  "Sounds good. Quick update first: the beta has about two hundred people and the feedback is mostly positive.",
  "Yes, Thursday works. I'll share the mockups in the design channel.",
  "Happy to review it. Can we also fix the bug where the Telegram link expires too fast?",
  "Agreed on twelve. Let's look at it again after the first month of data.",
  "Works for me. I'll file the Telegram bug today and own the fix.",
  "Thanks, talk Tuesday!",
];

export function demoTranscription(track: "mic" | "system", chunk: number, durationMs: number): TranscriptSegment[] {
  const line = (track === "mic" ? YOU : OTHERS)[chunk];
  if (!line) return [];
  const [from, to] = track === "mic" ? [0.05, 0.45] : [0.5, 0.95];
  return [{ startMs: Math.round(durationMs * from), endMs: Math.round(durationMs * to), text: line }];
}

export const DEMO_SCRIPT_CHUNKS = YOU.length;
