/**
 * Demo mode: voice typing without a speech-to-text key. A recording "hears" one of these lines
 * (the way people really talk, ums and all), and the cleanup types what the AI would, so the whole
 * flow can be tried and tested end to end. "Hey {bot}, …" is heard only when it's asked for.
 */
export const DEMO_DICTATIONS: { heard: string; typed: string }[] = [
  {
    heard: "Um, so I was thinking we could, uh, move the team meeting to Thursday. No wait, Friday at three.",
    typed: "I was thinking we could move the team meeting to Friday at 3.",
  },
  {
    heard: "Hey, can you send me the slides from yesterday's call? New line. Thanks so much.",
    typed: "Hey, can you send me the slides from yesterday's call?\nThanks so much!",
  },
  {
    heard: "I'll pick up eggs, milk and, uh, bread on the way home. Should be there around six thirty.",
    typed: "I'll pick up eggs, milk and bread on the way home. Should be there around 6:30.",
  },
  {
    heard: "Quick update, the the beta has about two hundred people and, um, the feedback is mostly positive.",
    typed: "Quick update: the beta has about 200 people and the feedback is mostly positive.",
  },
];

/** What the demo hears for a command to the bot. */
export function demoCommand(botName: string): string {
  return `Hey ${botName}, remind me to call Mom tomorrow at 5.`;
}

/** What the demo hears when editing by voice: a change to the selection, or something to write. */
export const DEMO_INSTRUCTIONS = { edit: "Make this friendlier.", write: "Write a short thank-you note." } as const;

export type DemoSample = number | "command" | keyof typeof DEMO_INSTRUCTIONS;

/** The line a recording hears: the asked-for one, or one picked by the recording's size. */
export function demoHeard(sample: DemoSample | undefined, audioBytes: number, botName: string | null): string {
  if (sample === "command" && botName) return demoCommand(botName);
  if (sample === "edit" || sample === "write") return DEMO_INSTRUCTIONS[sample];
  const i = typeof sample === "number" && sample >= 0 ? sample % DEMO_DICTATIONS.length : audioBytes % DEMO_DICTATIONS.length;
  return DEMO_DICTATIONS[i].heard;
}

/** The demo's "AI" cleanup: the typed line for a line it knows, nothing otherwise. */
export function demoPolish(heard: string): string | null {
  return DEMO_DICTATIONS.find((d) => d.heard === heard)?.typed ?? null;
}

const sentences = (text: string) => text.match(/[^.!?\n]+[.!?]*/g)?.map((t) => t.trim()).filter(Boolean) ?? [];
const ending = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/**
 * Editing by voice in demo mode, with no model: a few simple changes done by rule, so the whole flow
 * (selection, instruction, replacing it) can be tried and tested. The pill and the page say "demo".
 */
export function demoEdit(instruction: string, selection: string | null): { kind: "replace" | "answer"; text: string } {
  const ask = instruction.toLowerCase();
  const sel = selection?.trim() ?? "";
  if (!sel) {
    if (/\?\s*$/.test(instruction.trim())) return { kind: "answer", text: "This is the demo: with a real model, I'd answer that here." };
    return { kind: "replace", text: "Thank you so much for your help today. It made a real difference!" };
  }
  if (/\?\s*$/.test(instruction.trim()) || /^(?:is|are|does|do|what|why|how|can|should)\b/.test(ask)) {
    return { kind: "answer", text: "It reads clearly. (This is the demo: with a real model, I'd look at your text properly.)" };
  }
  if (/\b(?:bullet|list)/.test(ask)) return { kind: "replace", text: sentences(sel).map((t) => `- ${ending(t)}`).join("\n") };
  if (/\b(?:short|brief|concise|summar|trim|condense)/.test(ask)) return { kind: "replace", text: ending(sentences(sel)[0] ?? sel) };
  if (/\b(?:upper ?case|all caps|capital)/.test(ask)) return { kind: "replace", text: sel.toUpperCase() };
  if (/\b(?:formal|professional|polite)/.test(ask)) return { kind: "replace", text: `Hello,\n\n${ending(sel)}\n\nBest regards` };
  // Friendlier, and anything else the demo doesn't know.
  return { kind: "replace", text: `Hi! ${ending(sel)} Thanks so much!` };
}
