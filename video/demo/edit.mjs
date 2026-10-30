/**
 * The demo video's edit: what plays when, beat by beat (SCRIPT.md). assemble.mjs renders it.
 *
 * Times come from each recording's markers (video/out/demo/clips/*.json): at("builder")("brain", 0.3)
 * is 0.3 s after the builder take marked "brain". Web scenes were recorded frame by frame
 * (record/frames.mjs), so they play at their own pace: whole-number speeds only (2× is every other
 * frame), and the waits for the network fast-forwarded with `blend` (frames averaged, a time-lapse).
 *
 * A `screen` segment shows a recording in a browser window on the stage; its `camera` pushes in at
 * moments in the recording (`src`): zoom `z` on (x, y) of the page, in its CSS px (1280×720). A
 * `full` segment fills the frame (the desktop app). `call` is the call's panel beside big captions,
 * its waits trimmed (`ranges`). `vo` places narration (video/out/demo/vo3/S01.wav …) at a moment
 * in the recording (`src`) or the segment (`at`); `fade` crossfades from the segment before.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "demo");
const CLIPS = path.join(OUT, "clips");
const PROMO = path.join(OUT, "..", "build-a-bot-promo-music-only.mp4");
const DESK = path.join(OUT, "el", "desk");

/** A recording's markers: at(clip)(label, plus, n) is the n-th time it marked label, plus seconds. */
function at(clip) {
  const { marks } = JSON.parse(fs.readFileSync(path.join(CLIPS, `${clip}.json`), "utf8"));
  return (label, plus = 0, n = 1) => {
    const m = marks.filter((x) => x.label === label)[n - 1];
    if (!m) throw new Error(`${clip} has no mark "${label}"${n > 1 ? ` (#${n})` : ""}`);
    return Number((m.t + plus).toFixed(3));
  };
}
const site = at("site");
const b = at("builder");
const files = at("files");
const web = at("web");

/** The narration: one take, cut into sentences (vo/split.py). */
export const VO_DIR = path.join(OUT, "vo3");
/** The take is at about −25.5 LUFS; this brings it to about −18, level with the call and the desktop's sound. */
export const VO_GAIN = 2.37;

/** The stage's browser window (cards.html's stage), where the page shows. */
export const STAGE = { win: { x: 128, y: 94, w: 1664, h: 936 }, host: "build-a-bot.site" };

export const SEGMENTS = [
  // 1. The landing page: the hero, the five choices, a run down the page to the recipes, the gallery.
  {
    id: "landing",
    kind: "screen",
    src: "site",
    pieces: [{ from: site("hero", -0.3), to: site("explore", 1.15) }],
    camera: [
      { src: site("hero", 0.1), z: 1.35, x: 420, y: 330, dur: 2.4 },
      { src: site("how-scroll"), z: 1, dur: 1.1 },
      { src: site("how", 0.2), z: 1.3, x: 640, y: 470, dur: 1.3 },
      { src: site("run"), z: 1, dur: 0.9 },
      { src: site("recipes", 0.2), z: 1.3, x: 480, y: 460, dur: 1.1 },
      { src: site("explore-click", 0.3), z: 1, dur: 0.9 },
    ],
    vo: [
      { id: "S01", src: site("hero", -0.1) },
      { id: "S02", src: site("how-scroll", 0.15) },
      { id: "S03", src: site("how", 0.9) },
      { id: "S04", src: site("recipes", -0.1) },
    ],
  },
  // 2. Start from scratch, then sign in with an email: "Check your email".
  {
    id: "signin",
    kind: "screen",
    src: "site",
    fade: 0.3,
    pieces: [
      { from: site("scratch", 0.1), to: site("signin", 0.1) },
      // Up to Sign in, and the page that asks for an email, a little quicker.
      { from: site("signin", 0.1), to: site("login"), speed: 2 },
      { from: site("login"), to: site("email") },
      // The address, typed quickly (people's browsers fill it in).
      { from: site("email"), to: site("sent", -0.1), speed: 2 },
      { from: site("sent", -0.1), to: site("check", 1.4) },
    ],
    camera: [
      { src: site("scratch", 0.1), z: 1.45, x: 270, y: 450, dur: 0.01 },
      { src: site("signin", 0.1), z: 1, dur: 0.7 },
      { src: site("login", 0.3), z: 1.5, x: 640, y: 400, dur: 1.0 },
    ],
    vo: [{ id: "S05", src: site("login", 0.15) }],
  },

  // 3. Building a bot, start to finish. The app's own scroll back to the top between two steps is
  // cut (a quick whoosh up the page), and still moments held where the narration needs them.
  {
    id: "build",
    kind: "screen",
    src: "builder",
    fade: 0.35,
    pieces: [
      { from: b("face", -0.35), to: b("name", 0.25) },
      // Typing the name and what to call you, quicker.
      { from: b("name", 0.25), to: b("brain", -0.3), speed: 2 },
      // The open models only: the take's detour to "Your own API key" and back is left out. The
      // cursor rests on "Open models on Nebius" just before it and just after it, on the same page,
      // so the cut doesn't show; the second moment is held while the open models are introduced.
      { from: b("brain", -0.3), to: b("byok", -1.03) },
      { freeze: b("open-models", 0.217), dur: 2.2 },
      { from: b("open-models", 0.217), to: b("fast", 0.75) },
      // The list held where the cursor rests, while the narration says what the open models bring.
      { freeze: b("fast", 0.75), dur: 0.8 },
      { from: b("fast", 0.75), to: b("balanced", 0.72) },
      { freeze: b("balanced", 0.72), dur: 1.6 },
      { from: b("balanced", 0.72), to: b("smart", 0.67) },
      { freeze: b("smart", 0.67), dur: 0.78 },
      { from: b("smart", 0.67), to: b("smart", 1.35) },
      { freeze: b("smart", 1.35), dur: 0.75 },
      { from: b("smart", 1.35), to: b("apps", -0.24) },
      { from: b("apps", 0.6), to: b("trust", -0.23) },
      { from: b("trust", 0.45), to: b("talk", -1.6) },
      { freeze: b("talk", -1.6), dur: 0.5 },
      { from: b("talk", -1.6), to: b("talk", 1.6) },
      { freeze: b("talk", 1.6), dur: 0.4 },
      { from: b("talk", 1.6), to: b("review", 0.8) },
      { from: b("review", 0.8), to: b("go", -0.5), speed: 2 },
      { from: b("go", -0.5), to: b("go", 0.6) },
      // "Bringing Juno to life" while its bot is made, quicker.
      { from: b("go", 0.6), to: b("born", -0.2), speed: 3 },
      { from: b("born", -0.2), to: b("born", 1.9) },
    ],
    camera: [
      { src: b("face", 0.1), z: 1.45, x: 450, y: 390, dur: 1.0 },
      { src: b("name", -0.3), z: 1.6, x: 330, y: 330, dur: 0.8 },
      { src: b("brain", -0.2), z: 1, dur: 0.8 },
      // In on the open models and what they cost ("…$5.00 of credit … Your chats aren't used to train models").
      { src: b("brain", 0.9), z: 1.55, x: 380, y: 400, dur: 1.6 },
      { src: b("open-models", 1.2), z: 1.35, x: 450, y: 380, dur: 1.0 },
      { src: b("fast", 0.3), z: 1.45, x: 450, y: 380, dur: 7.0 },
      { src: b("apps", 0.6), z: 1, dur: 0.6 },
      { src: b("app-grid", -0.4), z: 1.45, x: 450, y: 340, dur: 0.9 },
      { src: b("included", -0.2), z: 1.5, x: 450, y: 460, dur: 0.9 },
      { src: b("trust", 0.45), z: 1.25, x: 450, y: 300, dur: 0.9 },
      { src: b("trust", 2.3), z: 1.45, x: 450, y: 560, dur: 1.0 },
      { src: b("talk", -0.2), z: 1.3, x: 450, y: 330, dur: 0.8 },
      { src: b("review", -0.2), z: 1, dur: 0.8 },
      { src: b("born", 0.1), z: 1, dur: 0.4 },
      { src: b("born", 0.5), z: 1.35, x: 800, y: 250, dur: 1.2 },
    ],
    vo: [
      // "Pick a face and a color," then "give it any name, like Juno, and tell it what to call you.",
      // starting as the face step ends so "like Juno" lands as Juno is typed.
      { id: "S06a", src: b("face", 1.2) },
      { id: "S06b", src: b("name", -0.95) },
      // The open models, Juno getting smarter as you use it, your data and zero data retention.
      { id: "S07", src: b("brain", 0.15) },
      // Each just after a held moment (a cue can't start inside one).
      { id: "S08", src: b("fast", 0.751) },
      { id: "S09", src: b("smart", 0.671) },
      { id: "S10", src: b("apps", 0.7) },
      { id: "S11", src: b("app-grid", 0.15) },
      { id: "S12", src: b("included", 0.7) },
      { id: "S13", src: b("trust", 0.5) },
      { id: "S14", src: b("talk", 0.6) },
      { id: "S15", src: b("go", -0.4) },
    ],
  },

  // 4. Files in (a syllabus, a lecture, a photo of handwritten notes), flashcards out, with sources.
  {
    id: "files",
    kind: "screen",
    src: "files",
    fade: 0.4,
    pieces: [
      { from: files("drag", -0.3), to: files("typing") },
      // The question, typed quickly.
      { from: files("typing"), to: files("files-ready"), speed: 2 },
      { from: files("files-ready"), to: files("flipped", 1.7) },
    ],
    camera: [
      { src: files("dropped", 0.3), z: 1.4, x: 720, y: 590, dur: 1.0 },
      { src: files("asked", 0.1), z: 1, dur: 0.8 },
      { src: files("cards-made", -0.1), z: 1.3, x: 800, y: 400, dur: 1.0 },
      { src: files("studying", -0.3), z: 1.3, x: 640, y: 380, dur: 0.8 },
      { src: files("flipped", 0.3), z: 1.55, x: 640, y: 440, dur: 0.9 },
    ],
    vo: [
      { id: "S16", src: files("drag", 0.1) },
      { id: "S17", src: files("cards-made", 1.3) },
    ],
  },

  // 5. A web search with Tavily, its sources shown.
  {
    id: "web",
    kind: "screen",
    src: "web",
    fade: 0.35,
    pieces: [
      { from: web("typing", 1.8), to: web("asked", 0.2), speed: 2 },
      { from: web("asked", 0.2), to: web("read", 1.6) },
    ],
    camera: [
      { t: 0, z: 1.4, x: 760, y: 600, dur: 0.01 },
      { src: web("asked", 0.25), z: 1, dur: 0.8 },
      { src: web("read", -0.2), z: 1.45, x: 720, y: 420, dur: 1.0 },
    ],
    vo: [{ id: "S18", src: web("asked", 0.3) }],
  },

  // 6. Just call it: the call ringing and Juno picking up (under the narration), then the call as it
  // sounded: a question, Juno's answer from the syllabus in its files, a cut-in, the new answer.
  // Only the waits are trimmed (the panel still shows how long each answer took).
  {
    id: "call-start",
    kind: "call",
    fade: 0.4,
    ranges: [[2.6, 10.0, 0]],
    lines: [],
    title: "Just call it.",
    sub: "NVIDIA Parakeet hears you. NVIDIA Magpie talks back.",
    vo: [
      { id: "S19", at: 0.2 },
      { id: "S20", at: 1.75 },
      { id: "S21", at: 3.62 },
    ],
  },
  {
    id: "call",
    kind: "call",
    ranges: [
      [12.8, 17.95],
      [23.4, 27.05],
      [29.2, 36.3],
      [37.98, 44.15],
      [46.7, 49.6],
    ],
    lines: [
      { who: "you", text: "Hey Juno, when's my bio midterm?", src: 12.95 },
      { who: "juno", text: "Let me check.", src: 17.15 },
      { who: "juno", text: "Your BIO 101 midterm 2 is on Thursday, November 12,", src: 23.55 },
      { who: "juno", text: "during lecture from 9:30 to 10:45 AM in Science Hall 204.", src: 30.9 },
      { who: "juno", text: "It covers energy and enzymes, cellular…", src: 38.05 },
      { who: "you", cut: true, text: "Perfect! Quick one. What's the first stable molecule in the Calvin cycle?", src: 39.08 },
      { who: "juno", text: "3-phosphoglycerate (3-PGA).", src: 46.8 },
    ],
  },

  // 7. Voice typing in the desktop app: hold Right Ctrl, talk; the words land, cleaned up.
  {
    id: "voice",
    kind: "full",
    src: "voice",
    fade: 0.4,
    pieces: [
      { freeze: 0.0, dur: 1.1 },
      { from: 0.0, to: 12.6 },
      { from: 12.6, to: 16.0, speed: 2 },
      { from: 16.0, to: 18.0 },
    ],
    // The desktop's own pixels (1920×1080 here): the compose window and the pill below it.
    page: [1920, 1080],
    camera: [{ src: 0.2, z: 1.1, x: 960, y: 590, dur: 3.0 }],
    audio: [{ file: path.join(DESK, "dictation.wav"), at: 3.933, gain: 1.8 }],
    subs: [
      { src: 4.04, who: "YOU SAY", y: 560, text: "“Hey team, um, the lab report draft is in the shared folder.”" },
      { src: 7.9, who: "YOU SAY", y: 560, text: "“I'll finish the methods by Thursday. Actually, Wednesday.”" },
      { src: 12.55, until: 16.2, who: "YOU SAID", y: 540, text: "“Hey team, um, the lab report draft is in the shared folder.\nI'll finish the methods by Thursday. Actually, Wednesday.”" },
    ],
    vo: [
      // After the call's last word (the crossfade is 0.4 s), and done before the dictation starts.
      { id: "S22", at: 0.4 },
      { id: "S23", at: 3.28 },
      { id: "S24", src: 12.62 },
    ],
  },

  // 8. Meeting notes: Juno asks first, hears the call on the computer, writes the notes.
  {
    id: "meeting",
    kind: "full",
    src: "meeting",
    fade: 0.4,
    pieces: [{ from: 4.9, to: 9.3 }],
    page: [1920, 1080],
    camera: [{ src: 5.4, z: 1.25, x: 960, y: 800, dur: 1.0 }],
    vo: [{ id: "S25", at: 0.6 }],
  },
  {
    id: "meeting-talk",
    kind: "full",
    src: "meeting",
    fade: 0.3,
    pieces: [{ from: 13.4, to: 19.0 }],
    page: [1920, 1080],
    camera: [{ t: 0, z: 1.12, x: 960, y: 560, dur: 0.01 }],
    audio: [{ file: path.join(DESK, "meeting.wav"), at: 10.44, gain: 1.2 }],
    subs: [
      { src: 13.55, until: 16.1, who: "MAYA", color: "#ff8fc0", y: 590, text: "“Diego, you're on the methods section, right?”" },
      { src: 16.45, until: 19.0, who: "DIEGO", color: "#a99bff", y: 590, text: "“Yeah, I'll have methods done by Thursday.”" },
    ],
  },
  {
    id: "meeting-done",
    kind: "full",
    src: "meeting",
    fade: 0.3,
    pieces: [
      { from: 41.55, to: 42.5 },
      { from: 49.95, to: 51.8 },
    ],
    page: [1920, 1080],
    camera: [{ t: 0, z: 1.25, x: 960, y: 900, dur: 0.01 }],
    vo: [{ id: "S26", at: 0.4 }],
  },
  // The notes it wrote: who's doing what, by when.
  {
    id: "notes",
    kind: "screen",
    src: "notes",
    fade: 0.35,
    pieces: [{ from: 0.3, to: 5.6 }],
    camera: [
      { src: 0.5, z: 1.3, x: 760, y: 330, dur: 1.4 },
      { src: 3.3, z: 1.6, x: 1010, y: 300, dur: 1.2 },
    ],
  },

  // 9. How it's built.
  { id: "built", kind: "card", card: "built", fade: 0.4, duration: 10.4, opts: { times: [0.9, 5.3, 6.6, 8.2] }, vo: [{ id: "S27", at: 0.4 }, { id: "S28", at: 5.2 }] },

  // 10. The end card (the promo's).
  { id: "end", kind: "full", file: PROMO, size: [1920, 1080], fade: 0.5, pieces: [{ from: 52.6, to: 60.9 }], vo: [{ id: "S29", at: 0.5 }, { id: "S30", at: 5.0 }] },
];

/**
 * The call's two voices, evened out with the narration (about −18 LUFS each): Magpie's voice is
 * quieter in the recording than the caller's lines.
 */
export const CALL_MIX = { bot: 2.0, caller: 1.15 };

/** The music bed (music.py), ducked under every voice. */
export const MUSIC = { file: path.join(OUT, "music.wav"), gain: 0.55 };

/** Where the score turns: bright from the start, a groove, hushed under the call, a build, the end. */
export const SCORE = { t0: "landing", revealEnd: "build", callFrom: "call-start", callTo: "voice", buildFrom: "built", endFrom: "end" };
