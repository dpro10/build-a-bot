/**
 * The demo video's edit: what plays when, beat by beat (SCRIPT.md). Times are seconds in each
 * recording (video/out/demo/clips/*.json have their markers); `speed` tightens a piece; `vo` places
 * Otto's narration lines (vo/lines.json) from the segment's start; `fade` crossfades from the
 * segment before. assemble.mjs renders it.
 *
 * The call (call kind) is shown as its panel with big captions beside it. Its `ranges` skip the
 * wait while Otto looks something up and trim dead air between sentences; captions are placed at
 * the moment in the recording they were said (`src`).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "demo");

export const SEGMENTS = [
  // 1. Cold open: a real call. When's the midterm (from the syllabus), and a cut-in.
  {
    id: "cold-open",
    kind: "call",
    ranges: [
      [12.35, 16.15],
      [26.75, 28.8],
      [31.0, 36.3],
      [36.4, 39.75],
    ],
    lines: [
      { src: 12.65, who: "diego", text: "Hey Otto, when's my bio midterm again?" },
      { src: 26.85, who: "otto", text: "Your bio midterm is on Thursday, October 29, during lecture time, 9:30 to 10:45 AM, in Science Hall 204." },
      { src: 36.55, who: "diego", text: "Perfect. Quiz me on my Calvin cycle notes.", cut: true },
    ],
  },

  // 2. Who that was.
  { id: "reveal", kind: "promo", from: 4.6, to: 10.2, speed: 0.9, vo: [{ id: "V02", at: 0.2 }] },

  // 3. Building Otto (the ready-made Tutor): face, name, brain, the price, apps, trust, born.
  {
    id: "builder-a",
    kind: "clip",
    src: "builder",
    fade: 0.4,
    pieces: [
      { from: 8.4, to: 12.6, speed: 1.4 },
      { from: 15.4, to: 19.8, speed: 1.5 },
      { from: 21.0, to: 27.2, speed: 1.7 },
    ],
    vo: [{ id: "V03a", at: 0.55 }],
  },
  { id: "credit", kind: "clip", src: "credit", pieces: [{ from: 0.4, to: 4.4 }], vo: [{ id: "V03b", at: 0.1 }] },
  {
    id: "builder-b",
    kind: "clip",
    src: "builder",
    pieces: [
      { from: 31.2, to: 38.5, speed: 2.4 },
      { from: 41.0, to: 45.6, speed: 1.3 },
      { from: 52.2, to: 61.6, speed: 3.0 },
      { from: 61.7, to: 65.5, speed: 1.2 },
    ],
    vo: [
      { id: "V03c", at: 0.15 },
      { id: "V03d", at: 6.55 },
    ],
  },

  // 4. Ask me first: an email to the professor waits for a tap.
  {
    id: "chat",
    kind: "clip",
    src: "chat",
    fade: 0.4,
    pieces: [
      { from: 1.0, to: 11.3, speed: 3.0 },
      { from: 11.3, to: 13.0, speed: 1.5 },
      { from: 13.0, to: 17.0 },
      { from: 17.0, to: 19.1 },
    ],
    vo: [
      { id: "V04a", at: 0.2 },
      { id: "V04b", at: 6.2 },
    ],
  },

  // 5. The Library: class files in, flashcards and a quiz out.
  {
    id: "library",
    kind: "clip",
    src: "library",
    fade: 0.4,
    pieces: [
      { from: 1.9, to: 7.4 },
      { from: 7.4, to: 17.9, speed: 4.5 },
      { from: 17.9, to: 26.6, speed: 2.0 },
      { from: 28.6, to: 36.8, speed: 1.5 },
      { from: 61.8, to: 68.6, speed: 1.5 },
      { from: 70.0, to: 76.4, speed: 1.5 },
      { from: 100.2, to: 103.4 },
    ],
    vo: [
      { id: "V05a", at: 0.3 },
      { id: "V05b", at: 8.3 },
      { id: "V05c", at: 12.9 },
      { id: "V05d", at: 18.4 },
    ],
  },

  // 6. A folder that stays in step: the desktop app's card, then the files in the Library.
  {
    id: "folder",
    kind: "card",
    card: "window",
    fade: 0.4,
    duration: 3.8,
    opts: { src: `file://${path.join(OUT, "props", "folder-crop.png")}`, width: 690 },
    vo: [{ id: "V06", at: 0.2 }],
  },
  { id: "library-tab", kind: "clip", src: "library", pieces: [{ from: 106.9, to: 109.6 }] },

  // 7. Just call it: the call starting (narrated), then the quiz out loud and a reminder.
  {
    id: "call-start",
    kind: "call",
    fade: 0.4,
    ranges: [[1.0, 12.6]],
    callGain: 0.18,
    lines: [],
    title: "Just call it.",
    sub: "From the app or from your phone. It's a real conversation: cut in anytime.",
    vo: [
      { id: "V07a", at: 0.15 },
      { id: "V07b", at: 4.15 },
    ],
  },
  {
    id: "call-quiz",
    kind: "call",
    ranges: [
      [44.55, 45.85],
      [47.25, 51.75],
      [53.95, 55.0],
      [62.25, 66.4],
      [66.55, 67.7],
      [68.35, 69.5],
      [71.25, 76.55],
      [82.35, 84.7],
      [89.7, 90.4],
      [92.2, 95.5],
      [95.8, 97.45],
    ],
    lines: [
      { src: 44.6, who: "otto", text: "Here's your first question: what is the first stable molecule produced during carbon fixation in the Calvin cycle?" },
      { src: 54.05, who: "diego", text: "The stroma." },
      { src: 62.3, who: "otto", text: "The first stable molecule is actually 3-phosphoglycerate, 3-PGA, not the stroma. The stroma's where it all happens." },
      { src: 82.45, who: "diego", text: "Remind me to study at seven tonight." },
      { src: 89.75, who: "otto", text: "Done! I've set a reminder for you to study at 7 PM tomorrow, Tuesday, October 20." },
    ],
  },

  // 8. Voice typing (Diego's own screen recording goes here; until then, the app's page for it).
  { id: "voice", kind: "clip", src: "voice", fade: 0.4, pieces: [{ from: 0.5, to: 9.4, zoom: { z: 1.8, x: 1880, y: 790 } }], vo: [{ id: "V08", at: 0.55 }] },

  // 9. Meeting notes (Diego's own recording goes here; until then, the Meetings tab).
  { id: "meetings", kind: "clip", src: "meetings", pieces: [{ from: 0.3, to: 5.8, speed: 0.7, zoom: { z: 1.5, x: 1060, y: 640 } }], vo: [{ id: "V09", at: 0.1 }] },

  // 10. How it's built.
  {
    id: "built",
    kind: "card",
    card: "built",
    fade: 0.4,
    duration: 13.4,
    vo: [
      { id: "V10a", at: 0.4 },
      { id: "V10b", at: 3.8 },
      { id: "V10c", at: 10.3 },
    ],
  },

  // 11. The end card (the promo's).
  { id: "end", kind: "promo", fade: 0.5, from: 52.4, to: 61.4, vo: [{ id: "V11", at: 0.7 }] },
];

/** The music bed, if there is one (made by music.py); ducked under the voice. */
export const MUSIC = { file: path.join(OUT, "music.wav"), gain: 0.5 };
