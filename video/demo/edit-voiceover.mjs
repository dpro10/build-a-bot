/**
 * The demo video without a narrator, for Diego's own voice-over: the landing page, the recipes,
 * signing in, the builder step by step (each step explained beside it: every brain there is, and
 * Gmail, Google Docs and Meeting notes picked by hand), files, web search, a call, voice typing and
 * meeting notes, how it's built, and the end card. The app's own sounds and the music stay; notes on
 * screen say what each part is.
 *   node video/demo/assemble.mjs --edit video/demo/edit-voiceover.mjs   → video/out/demo/build-a-bot-demo-voiceover.mp4
 *
 * Pieces, calls and overlays work as in edit.mjs. A `frame` puts a recording in a rounded window on
 * a card that moves with it (the builder's steps); `notes` are cards over the picture.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALL_MIX as NARRATED_CALL_MIX, SEGMENTS as NARRATED } from "./edit.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "demo");
const PROMO = path.join(OUT, "..", "build-a-bot-promo-music-only.mp4");
const narrated = (id) => NARRATED.find((s) => s.id === id);
/** The landing take's frame, a little inside the window (2560×1440) so the link bubble stays out. */
const SITE_CROP = { w: 2460, h: 1384, x: 50, y: 0 };

/** This cut's folder (video/out/demo/voiceover) and its result's name. */
export const NAME = "voiceover";
/** No narration yet: Diego's lines go in once he's read them (SCRIPT-VOICEOVER.md). */
export const VO_DIR = path.join(OUT, NAME, "vo");

/** The builder's seven steps, what each one asks, and when it starts in the recording (builder2). */
const STEPS = [
  { name: "Face", desc: "Five original characters and eight colors. Change looks anytime.", src: 0 },
  { name: "Name", desc: "Name it, and tell it what to call you.", src: 14.05 },
  { name: "Brain", desc: "12 open models on Nebius Token Factory, three of them NVIDIA Nemotron, at cost. Or bring your own API key.", src: 20.7 },
  { name: "Apps", desc: "Pick its apps: 100+ to choose from, plus any MCP server. Web search and files come with every bot.", src: 40.63 },
  { name: "Trust", desc: "From Look only to Full faith. On Ask me first, it waits for your OK.", src: 55.91 },
  { name: "Talk", desc: "Web chat is always on. Add phone calls, Discord or Slack.", src: 62.26 },
  { name: "Go", desc: "Check it over, then bring it to life. It says hi first.", src: 66.55 },
];

export const SEGMENTS = [
  // 1. The landing page: the hero, the five choices, the recipes; then the recipe gallery, "Start
  //    from scratch", and Sign in.
  {
    id: "landing",
    kind: "clip",
    src: "site",
    // A hair tighter than the window: Chromium's link bubble (bottom left, over the recipe cards)
    // falls outside it.
    crop: SITE_CROP,
    pieces: [
      { from: 0.8, to: 4.0 },
      { from: 6.4, to: 10.0, speed: 1.4 },
      { from: 21.3, to: 26.6, speed: 1.45 },
      { from: 27.1, to: 29.05 },
      { from: 29.05, to: 33.0, speed: 1.8 },
      { from: 34.85, to: 40.3, speed: 1.6 },
      // The sign-in page, its characters settling, the cursor where the sign-in take starts.
      { from: 40.3, to: 41.5 },
    ],
  },

  // 2. Signing in with an email (the sign-in take, from the same frame; the link's click is skipped).
  {
    id: "signin",
    kind: "clip",
    src: "signin",
    pieces: [
      { from: 0.3, to: 1.7, zoom: { from: { z: 2560 / SITE_CROP.w, x: 1280, y: SITE_CROP.h / 2 }, z: 1.3, x: 1280, y: 700 } },
      { from: 1.7, to: 5.4, speed: 1.85, zoom: { from: { z: 1.3, x: 1280, y: 700 }, z: 1.45, x: 1280, y: 700 } },
      { from: 5.4, to: 7.7, zoom: { from: { z: 1.45, x: 1280, y: 700 }, z: 1.5, x: 1280, y: 700 } },
    ],
  },

  // 3. Building a bot: the recording in a window, the steps beside it.
  {
    id: "build",
    kind: "clip",
    src: "builder2",
    fade: 0.4,
    // Chromium's link bubble shows from 2.4 s while the cursor is over a recipe chip.
    patches: [{ from: 2.2, to: 7.6, src: 8.0, x: 0, y: 1384, w: 760, h: 56 }],
    frame: { card: "builderframe", x: 440, y: 135, w: 1440, h: 810, opts: { steps: STEPS, doneAt: 72.0 } },
    pieces: [
      { from: 5.1, to: 6.7, speed: 1.6 },
      { from: 6.7, to: 14.05, speed: 2.4 },
      { from: 14.05, to: 20.7, speed: 2.0 },
      // Every brain: your own key's providers, then all the open models on Nebius.
      { from: 20.7, to: 24.4, speed: 1.3 },
      { from: 24.4, to: 29.85, speed: 1.6 },
      { from: 29.85, to: 40.65, speed: 1.3 },
      // Gmail, Google Docs, Meeting notes; then what's always included.
      { from: 40.65, to: 50.95, speed: 1.7 },
      { from: 50.95, to: 55.95, speed: 2.0 },
      { from: 55.95, to: 62.3, speed: 1.3 },
      { from: 62.3, to: 66.6, speed: 1.6 },
      { from: 66.6, to: 72.3, speed: 2.0 },
      // "Bringing Juno to life", "Say hi to Juno!" (the chat comes up in the next scene).
      { from: 72.3, to: 75.95, speed: 1.4 },
    ],
  },

  // 4. Files in, flashcards out (each with its source); a web search with Tavily.
  {
    ...narrated("files"),
    vo: [],
    notes: [{ at: 0.4, end: -0.25, opts: { kicker: "FILES → FLASHCARDS", icon: "BookOpen", title: "Give it your files", text: "A syllabus, lecture slides, even a photo of handwritten notes. Each card shows where its answer came from." } }],
  },
  {
    ...narrated("web"),
    vo: [],
    notes: [{ at: 0.3, end: -0.2, opts: { kicker: "WEB SEARCH", icon: "Globe", title: "It looks things up", text: "Tavily search, with the sources it used under the answer." } }],
  },

  // 5. A real call: when's the midterm (from the syllabus), then a cut-in and an answer.
  { id: "call-start", kind: "call", fade: 0.4, ranges: [[2.5, 5.6]], lines: [], title: "Just call it.", sub: "NVIDIA Parakeet hears you. NVIDIA Magpie talks back." },
  {
    id: "call",
    kind: "call",
    ranges: [
      [10.85, 14.35],
      [14.85, 15.85],
      [18.95, 22.85],
      [25.4, 32.75],
      [34.62, 41.1],
      [44.15, 49.5],
    ],
    lines: [
      { src: 11.04, who: "you", text: "Hey Juno, when's my bio midterm?" },
      { src: 15.0, who: "juno", text: "Let me check." },
      { src: 19.07, who: "juno", text: "Your BIO 101 midterm 2 is on Thursday, November 12, during your regular lecture time (9:30–10:45 AM in Science Hall 204)." },
      { src: 34.72, who: "juno", text: "It covers Weeks 6–10: energy and enzymes, cellular respiration…" },
      { src: 35.89, who: "you", cut: true, text: "Perfect. Quick one: what's the first stable molecule in the Calvin cycle?" },
      { src: 44.4, who: "juno", text: "The first stable molecule in the Calvin cycle is 3-phosphoglycerate (3-PGA)." },
    ],
  },

  // 6. The desktop app: voice typing and meeting notes, as in the narrated cut.
  { ...narrated("voice"), vo: [] },
  { ...narrated("meeting"), vo: [] },
  {
    id: "notes",
    kind: "clip",
    src: "notes",
    fade: 0.4,
    pieces: [{ from: 0.4, to: 6.4 }],
    notes: [{ at: 0.5, end: -0.2, opts: { kicker: "MEETING NOTES", icon: "Mic", title: "Who's doing what", text: "Parakeet heard the call on the computer. Nemotron wrote the summary, decisions and action items." } }],
  },

  // 7. How it's built, then the end card.
  { id: "built", kind: "card", card: "built", fade: 0.4, duration: 9.5, opts: { times: [0.8, 2.4, 4.0, 5.6] } },
  { id: "end", kind: "clip", file: PROMO, fade: 0.5, pieces: [{ from: 52.6, to: 60.6 }] },
];

export const CALL_MIX = NARRATED_CALL_MIX;

/**
 * Where the score turns: bright from the start, a groove, hushed under the call, a build, the end
 * (its swell a little lower, with no narration over it).
 */
export const SCORE = { t0: "landing", revealEnd: "build", callFrom: "call-start", callTo: "voice", buildFrom: "built", endFrom: "end", endLevel: 0.8 };

/**
 * The music, up front with no narration over it (about 3 dB under the call); still ducked under the
 * call and the desktop app. Once Diego's lines are in, bring it back down to a bed (about 0.35).
 */
export const MUSIC = { file: path.join(OUT, NAME, "music.wav"), gain: 0.75 };
