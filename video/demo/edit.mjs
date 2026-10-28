/**
 * The demo video's edit: what plays when, beat by beat (SCRIPT.md). Times are seconds in each
 * recording (video/out/demo/clips/*.json have their markers). assemble.mjs renders it.
 *
 * A clip segment is pieces of one recording back to back (jump cuts): `from`/`to` with an optional
 * `speed` and `zoom` (a slow push from `zoom.from`, or the full frame, to `zoom`, in the recording's
 * pixels), or `freeze` (hold that moment for `dur`). `audio` is sound recorded alongside the take
 * (what the desktop app heard, placed where it started in the recording); `subs` are subtitles for
 * it, at the moment in the recording they're said; `patches` paste a still from another moment over
 * part of the frame (Chromium's link bubble, which isn't the app).
 *
 * The call (call kind) is shown as its panel with big captions beside it. Its `ranges` skip the
 * waits while Juno looks something up and trim the pauses between sentences; a range's third number
 * is its volume (0: seen, not heard, under the narration). Captions are placed at the moment in the
 * recording they were said (`src`).
 *
 * `vo` places narration cues (video/out/demo/vo2/S01.wav … from vo/split.py) from the segment's
 * start; `fade` crossfades from the segment before.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "demo");
const PROMO = path.join(OUT, "..", "build-a-bot-promo-music-only.mp4");
const DESK = path.join(OUT, "el", "desk");

/** Where the narration cues are (one wav per sentence, S01 …). */
export const VO_DIR = path.join(OUT, "vo2");

export const SEGMENTS = [
  // 1. Cold open: a real call. When's the midterm? Juno looked in the syllabus.
  {
    id: "cold-open",
    kind: "call",
    ranges: [
      [11.0, 14.35],
      [14.85, 15.85],
      [18.95, 22.85],
      [25.4, 32.7],
      [32.7, 34.55, 0],
    ],
    lines: [
      { src: 11.04, who: "you", text: "Hey Juno, when's my bio midterm?" },
      { src: 15.0, who: "juno", text: "Let me check." },
      { src: 19.07, who: "juno", text: "Your BIO 101 midterm 2 is on Thursday, November 12, during your regular lecture time (9:30–10:45 AM in Science Hall 204)." },
    ],
    vo: [{ id: "S01", at: 15.9 }],
  },

  // 2. Who that was, and where it came from (the promo's reveal).
  {
    id: "reveal",
    kind: "clip",
    file: PROMO,
    fade: 0.4,
    pieces: [
      { from: 5.0, to: 9.45, speed: 0.8 },
      { freeze: 9.4, dur: 1.25 },
    ],
    vo: [
      { id: "S02", at: 0.55 },
      { id: "S03", at: 3.45 },
    ],
  },

  // 3. Sign in with an email (the link's click is skipped).
  {
    id: "signin",
    kind: "clip",
    src: "signin",
    fade: 0.3,
    pieces: [
      { from: 1.7, to: 5.4, speed: 1.85, zoom: { from: { z: 1.3, x: 1280, y: 700 }, z: 1.45, x: 1280, y: 700 } },
      { from: 5.4, to: 7.7, zoom: { from: { z: 1.45, x: 1280, y: 700 }, z: 1.5, x: 1280, y: 700 } },
    ],
    vo: [{ id: "S04", at: 1.2 }],
  },

  // 4. The builder: ready-made recipes, then Diego makes his own.
  {
    id: "recipes",
    kind: "clip",
    src: "builder",
    fade: 0.3,
    patches: [{ from: 2.8, to: 7.1, src: 7.6, x: 0, y: 1384, w: 760, h: 56 }],
    pieces: [{ from: 1.2, to: 7.3, speed: 1.75, zoom: { z: 1.25, x: 1000, y: 420 } }],
    vo: [{ id: "S05", at: 0.2 }],
  },
  {
    id: "face-name",
    kind: "clip",
    src: "builder",
    pieces: [
      { from: 7.4, to: 9.4, speed: 1.4 },
      { from: 12.5, to: 15.0, speed: 1.8 },
      { from: 16.6, to: 22.4, speed: 2.8 },
    ],
    vo: [{ id: "S06", at: 0.25 }],
  },
  // The brain: open models on Nebius, at cost, $5 to start (≈ $0.00042 a message).
  {
    id: "brain",
    kind: "clip",
    src: "builder",
    pieces: [
      { from: 22.3, to: 25.4 },
      { from: 25.4, to: 28.6, zoom: { z: 1.35, x: 900, y: 840 } },
      { freeze: 28.6, dur: 5.3, zoom: { from: { z: 1.35, x: 900, y: 840 }, z: 1.6, x: 700, y: 1000 } },
    ],
    vo: [
      { id: "S07", at: 0.3 },
      { id: "S08", at: 5.4 },
      { id: "S09", at: 9.4 },
    ],
  },
  { id: "apps", kind: "clip", src: "builder", pieces: [{ from: 29.95, to: 37.2, speed: 2.0 }], vo: [{ id: "S10", at: 0.2 }] },
  // Trust: Ask me first, and what's enforced in code.
  {
    id: "trust",
    kind: "clip",
    src: "builder",
    pieces: [{ from: 37.2, to: 43.3, speed: 0.85, zoom: { z: 1.22, x: 900, y: 900 } }],
    vo: [{ id: "S11", at: 0.1 }],
  },
  {
    id: "born",
    kind: "clip",
    src: "builder",
    pieces: [
      { from: 47.65, to: 53.6, speed: 3.0 },
      { from: 53.6, to: 57.4, speed: 1.4 },
      { from: 58.6, to: 60.0 },
    ],
    vo: [{ id: "S12", at: 0.5 }],
  },

  // 5. Files in (a syllabus, a lecture, a photo of handwritten notes), flashcards out, with sources.
  {
    id: "files",
    kind: "clip",
    src: "files",
    fade: 0.4,
    pieces: [
      { from: 2.0, to: 5.6, speed: 1.3 },
      { from: 5.6, to: 9.8, speed: 2.5 },
      { from: 14.0, to: 15.6, speed: 1.2 },
      { from: 35.8, to: 38.4, speed: 1.4 },
      { from: 44.0, to: 48.2 },
    ],
    vo: [
      { id: "S13", at: 0.2 },
      { id: "S14", at: 5.9 },
    ],
  },

  // 6. A web search with Tavily, sources shown.
  {
    id: "web",
    kind: "clip",
    src: "web",
    fade: 0.3,
    pieces: [
      { from: 9.4, to: 10.9 },
      { from: 22.3, to: 25.3 },
      { from: 25.3, to: 29.8, speed: 1.8 },
    ],
    vo: [{ id: "S15", at: 1.1 }],
  },

  // 7. Just call it: the call starting (narrated), then a cut-in, an answer and a reminder.
  {
    id: "call-start",
    kind: "call",
    fade: 0.4,
    ranges: [[2.5, 10.0, 0]],
    lines: [],
    title: "Just call it.",
    sub: "NVIDIA Parakeet hears you. NVIDIA Magpie talks back.",
    vo: [
      { id: "S16", at: 0.2 },
      { id: "S17", at: 1.85 },
    ],
  },
  {
    id: "call",
    kind: "call",
    ranges: [
      [32.8, 34.62, 0],
      [34.62, 41.1],
      [44.15, 49.4],
      [51.3, 55.55],
      [62.95, 65.62],
    ],
    lines: [
      { src: 34.72, who: "juno", text: "It covers Weeks 6–10: energy and enzymes, cellular respiration…" },
      { src: 35.89, who: "you", cut: true, text: "Perfect. Quick one: what's the first stable molecule in the Calvin cycle?" },
      { src: 44.4, who: "juno", text: "The first stable molecule in the Calvin cycle is 3-phosphoglycerate (3-PGA)." },
      { src: 51.43, who: "you", text: "Got it. Remind me to study tomorrow at 7 p.m." },
      { src: 63.17, who: "juno", text: "I've set a reminder for 7:00 PM tomorrow." },
    ],
    vo: [{ id: "S18", at: 0.02 }],
  },

  // 8. Voice typing in the desktop app: hold Right Ctrl, talk; the words land, cleaned up.
  {
    id: "voice",
    kind: "clip",
    src: "voice",
    fade: 0.4,
    pieces: [
      { freeze: 0.0, dur: 2.0 },
      { from: 0.0, to: 3.3 },
      { from: 3.3, to: 12.6 },
      { from: 12.6, to: 16.0, speed: 2.0 },
      // The words landed: hold on them beside what was said ("um", "Thursday. Actually, Wednesday.").
      { from: 16.0, to: 19.0 },
    ],
    audio: [{ file: path.join(DESK, "dictation.wav"), at: 3.933, gain: 1.8 }],
    subs: [
      { src: 4.04, who: "YOU SAY", y: 560, text: "“Hey team, um, the lab report draft is in the shared folder.”" },
      { src: 7.9, who: "YOU SAY", y: 560, text: "“I'll finish the methods by Thursday. Actually, Wednesday.”" },
      { src: 12.55, who: "YOU SAID", y: 540, text: "“Hey team, um, the lab report draft is in the shared folder.\nI'll finish the methods by Thursday. Actually, Wednesday.”" },
    ],
    vo: [
      { id: "S20", at: 0.55 },
      { id: "S21", at: 3.7 },
      { id: "S22", at: 13.75 },
    ],
  },

  // 9. Meeting notes: Juno asks first, hears the call on the computer, writes the notes.
  {
    id: "meeting",
    kind: "clip",
    src: "meeting",
    fade: 0.4,
    pieces: [
      { from: 4.9, to: 9.3 },
      { from: 13.35, to: 19.1 },
      { from: 41.55, to: 42.45 },
      { from: 49.9, to: 51.9 },
    ],
    audio: [{ file: path.join(DESK, "meeting.wav"), at: 10.44, gain: 1.2 }],
    subs: [
      { src: 13.55, until: 16.1, who: "MAYA", color: "#ff8fc0", y: 590, text: "“Diego, you're on the methods section, right?”" },
      { src: 16.45, until: 19.1, who: "DIEGO", color: "#a99bff", y: 590, text: "“Yeah, I'll have methods done by Thursday.”" },
    ],
    vo: [
      { id: "S23", at: 0.85 },
      { id: "S24", at: 10.1 },
    ],
  },
  // The notes it wrote: who's doing what, by when.
  { id: "notes", kind: "clip", src: "notes", fade: 0.4, pieces: [{ from: 0.4, to: 6.2, zoom: { z: 1.12, x: 1700, y: 820 } }] },

  // 10. How it's built.
  {
    id: "built",
    kind: "card",
    card: "built",
    fade: 0.4,
    duration: 16.8,
    vo: [
      { id: "S25", at: 0.35 },
      { id: "S26", at: 5.35 },
      { id: "S27", at: 12.2 },
    ],
  },

  // 11. The end card (the promo's).
  {
    id: "end",
    kind: "clip",
    file: PROMO,
    fade: 0.5,
    pieces: [{ from: 52.6, to: 61.5 }],
    vo: [
      { id: "S28", at: 0.5 },
      { id: "S29", at: 1.95 },
      { id: "S30", at: 5.75 },
    ],
  },
];

/**
 * The call's two voices, evened out with the narration (about −18 LUFS each): Magpie's voice is
 * quieter in the recording than the caller's lines.
 */
export const CALL_MIX = { bot: 2.0, caller: 1.15 };

/** The music bed, if there is one (made by music.py); ducked under every voice. */
export const MUSIC = { file: path.join(OUT, "music.wav"), gain: 0.3 };
