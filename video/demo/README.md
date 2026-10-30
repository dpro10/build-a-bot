# The demo video

A walkthrough of the real product for the hackathon (Devpost and YouTube, under 3 minutes), narrated throughout: the website and its recipes, signing in, building Juno (all 12 open models on Nebius, and Gmail, Google Docs and Meeting notes picked by hand), files into flashcards, a web search, a real call with a cut-in, voice typing and meeting notes in the desktop app, and how it's built. The script, the shot list and where every claim is true: [`SCRIPT.md`](SCRIPT.md). The promo, its one-minute sibling, is one folder up ([`../README.md`](../README.md)); this video reuses its end card.

Everything is rebuilt from here, and the media lands in `video/out/demo/` (gitignored):

| Step | Command | What it makes |
| - | - | - |
| Class files | `node video/demo/props/build.mjs` | a syllabus PDF, a lecture PDF, a photo of handwritten notes (made up for the video) |
| The website and an account | `BAB_VIDEO_EMAIL=… node video/demo/record/site.mjs` | the landing page, the recipes and the sign-in in one take, then it waits for the sign-in link in `signin-link.txt` and saves the account |
| Web scenes | `node video/demo/record/<scene>.mjs` | `clips/<scene>.mp4` + markers, in this order: `builder` (makes Juno), `files`, `web`, `call`, then `pages` (the meeting's notes, after the meeting) |
| Desktop scenes | `BAB_SPEECH_FILES=… node video/demo/record/desktop.mjs voice` (then `meeting`) | the real desktop app, paired to the account: voice typing, and meeting notes |
| Narration | one take as a WAV, transcribed by Parakeet, then `vo/split.py` (below) | `vo3/S01.wav` … one file per sentence (S07 to S09, the brain step, are from a second take, `el/narr4.1.wav`, level-matched to the first) |
| Brand pieces | `npx tsx video/scripts/export-assets.tsx` | the app's characters, icons and fonts for the cards |
| Score | `python3 video/demo/music.py` | an original score in the promo's world, under the demo's beats |
| The cut | `node video/demo/assemble.mjs [--sheet]` | `build-a-bot-demo.mp4` (1920×1080, 60 fps, BT.709, −14 LUFS) |
| Checks | `node video/demo/check-voice.mjs` | every narration line, cut from the final mix, transcribed word for word |

Needs: Node 22 with the repo's packages (and `desktop/`'s, for the desktop scenes), Playwright's Chromium (its headless shell for the web scenes), ffmpeg, Xvfb and xdotool for the call and the desktop scenes (Linux), Python 3 with numpy, scipy and OpenCV for the compositor and the score, and NeMo-Speech.cpp with Parakeet's GGUF for the desktop scenes and the checks (`BAB_SPEECH_FILES` is a folder with the runtime archive and the model; `NEMO_SPEECH_BIN` and `PARAKEET_GGUF` for the scripts). The score follows the cut, so after changing the edit run `assemble.mjs --plan`, then `music.py`, then `assemble.mjs`.

## How the recordings are made

- **Web scenes, frame by frame** (`record/frames.mjs`): Chromium's headless shell on virtual time. Each frame of the video is a frame the browser drew after its clock moved exactly 1/60 of a second (`HeadlessExperimental.beginFrame`), so scrolling, the cursor and every animation move perfectly evenly at 60 frames a second, however long the browser took to draw. The network runs in real time, so a wait for the model shows about six times shorter than it was, and the edit speeds through what's left. The cursor is drawn in the page and placed every frame; clicks ripple; typing is at a human pace. Uploads go through XMLHttpRequest while recording, because a streamed upload stalls on virtual time.
- **The call, in real time** (`record/call.mjs`): a real Chromium window on a virtual display, the call panel's column grabbed by ffmpeg at 60 frames a second. The page gets a microphone the script can make talk (it plays the caller's lines into it, turn by turn, watching the voice server's own events), and a copy of everything the voice server sends. The call's sound is rebuilt exactly as the page played it, including the moment a cut-in stops Juno mid-sentence (`call.wav`).
- **Markers:** each scene marks its moments ("cards-made", "cut-in"), and `edit.mjs` cuts on them.
- **One account, one bot:** `site.mjs` signs in by email; `builder.mjs` deletes the account's previous bot and builds Juno, and the later scenes use that bot (`BAB_VIDEO_ACCOUNT` and `BAB_VIDEO_SESSION` pick other files for another account).
- **The desktop app** (`record/desktop.mjs`) runs from `desktop/` under its own virtual display with a compositor, on a made-up desktop (`desktop/scene.cjs`: a compose window and a video call), paired to the account. Its microphone is a test file (`--use-file-for-fake-audio-capture`): what it hears is real speech, heard by NVIDIA Parakeet in the app. Clicks and the Right Ctrl key go through XTest (`desktop/xinput.py`), so the app sees a real key.

## The cut

`edit.mjs` is the edit list: each segment is pieces of one recording (sped up, held, pushed into), the call (its panel beside big captions, with the waits trimmed), or a card from `cards/cards.html`. `compose.py` draws each segment frame by frame: a web recording in a browser window on a stage, with a camera that pushes in and follows (eased, sub-pixel); a recording filling the frame (the desktop app); the call's panel through a rounded window; a card. Every frame of the video is a real frame of a recording: speeds are whole numbers (2× is every other frame) and ease into each other, and a held frame only where nothing moves. Narration cues and the sound each take recorded are placed on one timeline, the music ducks under every voice, and the mix is brought to −14 LUFS. `assemble.mjs` refuses a cut where the narration talks over itself, the call, or the desktop app's sound.

- `--plan` lists where every segment and line lands (and writes `timeline.json`, which `music.py` and `check-voice.mjs` follow) without rendering.
- `--reuse --only build` renders one segment again and keeps the rest; `--reuse --sound-only` remixes the sound only.
- The narration take sits at about −25.5 LUFS; `VO_GAIN` in `edit.mjs` brings it level with the call and the desktop's sound (about −18 each before the mix), and the music sits about 9 dB under the voices.
- The sound gets one gain for the whole video, to −14 LUFS, and a limiter keeps the loudest syllables under −1.5 dBTP, so the music stays at the level the edit sets (loudnorm alone would turn into an automatic gain and push the music up between voices).

## Swapping in Diego's own voice

- **The narration:** read `vo/lines.json` in order, in one take, and save it as `video/out/demo/el/narr.diego.wav`. Then:

  ```sh
  nemo-speech transcribe video/out/demo/el/narr.diego.wav --model parakeet-tdt-0.6b-v3.q8_0.gguf -f json --quiet > video/out/demo/el/narr.diego.json
  python3 video/demo/vo/split.py video/out/demo/el/narr.diego.wav video/out/demo/el/narr.diego.json video/out/demo/vo-diego
  ```

  set `VO_DIR` in `edit.mjs` to `vo-diego` (and `VO_GAIN` to bring his take to about −18 LUFS), split `S06` at its comma into `S06a` and `S06b` as for the synthesized take, and run `assemble.mjs --plan`, `music.py` and `assemble.mjs`. Lines that run long move the next one (the assembler says which).
- **His half of the call:** put his four lines (`call.mjs` lists them) in a folder as 48 kHz mono WAVs and run `CALLER_DIR=/that/folder node video/demo/record/call.mjs`. Then update the call's ranges and captions in `edit.mjs` from the new `clips/call.transcript.json`.
