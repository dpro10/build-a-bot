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

/** The line a recording hears: the asked-for one, or one picked by the recording's size. */
export function demoHeard(sample: number | "command" | undefined, audioBytes: number, botName: string | null): string {
  if (sample === "command" && botName) return demoCommand(botName);
  const i = typeof sample === "number" && sample >= 0 ? sample % DEMO_DICTATIONS.length : audioBytes % DEMO_DICTATIONS.length;
  return DEMO_DICTATIONS[i].heard;
}

/** The demo's "AI" cleanup: the typed line for a line it knows, nothing otherwise. */
export function demoPolish(heard: string): string | null {
  return DEMO_DICTATIONS.find((d) => d.heard === heard)?.typed ?? null;
}
