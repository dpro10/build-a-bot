# The demo video

A walkthrough of the real product for the hackathon (Devpost and YouTube, under 3 minutes): a real call with Juno, signing in and building it, files into flashcards, a web search, the call again, voice typing and meeting notes in the desktop app, and how it's built. The script, the shot list and where every claim is true: [`SCRIPT.md`](SCRIPT.md). The promo, its one-minute sibling, is one folder up ([`../README.md`](../README.md)); this video reuses its reveal and end card.

Everything is rebuilt from here, and the media lands in `video/out/demo/` (gitignored):

| Step | Command | What it makes |
| - | - | - |
| Class files | `node video/demo/props/build.mjs` | a syllabus PDF, a lecture PDF, a photo of handwritten notes (made up for the video) |
| An account | `BAB_VIDEO_EMAIL=… node video/demo/record/signin.mjs` | records the sign-in, waits for the link in `signin-link.txt`, saves the session |
| Web scenes | `node video/demo/record/<scene>.mjs` | `clips/<scene>.mp4` + markers, in this order: `builder` (makes Juno), `files`, `web`, `call`, then `pages` (after the meeting) |
| Desktop scenes | `BAB_SPEECH_FILES=… node video/demo/record/desktop.mjs voice` (then `meeting`) | the real desktop app, paired to the account: voice typing, and meeting notes |
| Narration | one take as a WAV, then `vo/split.py` (below) | `vo2/S01.wav` … one file per sentence |
| Brand pieces | `npx tsx video/scripts/export-assets.tsx` | the app's characters, icons and fonts for the cards |
| Score | `python3 video/demo/music.py` | an original score in the promo's world, under the demo's beats |
| The cut | `node video/demo/assemble.mjs [--sheet]` | `build-a-bot-demo.mp4` (1920×1080, 60 fps, −14 LUFS) |
| Checks | `node video/demo/check-voice.mjs` | every narration line, cut from the final mix, transcribed word for word |

Needs: Node 22 with the repo's packages (and `desktop/`'s, for the desktop scenes), Playwright's Chromium, ffmpeg, Xvfb and xdotool for the recordings (Linux), NeMo-Speech.cpp and Parakeet's GGUF for the desktop scenes and the checks (`BAB_SPEECH_FILES` is a folder with the runtime archive and the model; `NEMO_SPEECH_BIN` and `PARAKEET_GGUF` for the scripts), and Python 3 with numpy and scipy for the score. The score follows the cut, so after changing the edit run `assemble.mjs`, then `music.py`, then `assemble.mjs --reuse` again.

## How the recordings are made

`record/recorder.mjs` drives Chromium against build-a-bot.site:

- **Picture:** a real (headful) Chromium window on a virtual display, 1280×720 at 2× (2560×1440), grabbed by ffmpeg at 60 frames a second. The cursor is drawn in the page and glides along gentle curves while the real mouse follows; clicks ripple; typing is at a human pace.
- **Markers:** each scene marks its moments ("cards-made", "cut-in"), and `edit.mjs` cuts on them.
- **A real call with both voices:** the page gets a microphone the script can make talk (it plays the caller's lines into it, turn by turn, watching the voice server's own events), and a copy of everything the voice server sends. The call's sound is rebuilt exactly as the page played it, including the moment a cut-in stops Juno mid-sentence (`call.wav`).
- **One account, one bot:** `signin.mjs` signs in by email once; `builder.mjs` deletes the account's previous bot and builds Juno, and the other scenes use that bot.
- **The desktop app** (`record/desktop.mjs`) runs from `desktop/` under its own virtual display with a compositor, on a made-up desktop (`desktop/scene.cjs`: a compose window and a video call), paired to the account. Its microphone is a test file (`--use-file-for-fake-audio-capture`): what it hears is real speech, heard by NVIDIA Parakeet in the app. Clicks and the Right Ctrl key go through XTest (`desktop/xinput.py`), so the app sees a real key.

## The cut

`edit.mjs` is the edit list: each segment is pieces of one recording (sped up, held, pushed into), a call (its panel beside big captions, with the waits trimmed), or a card from `cards/cards.html` (rendered frame by frame). Narration cues and the sound each take recorded are placed on one timeline, the music ducks under every voice, and the mix is brought to −14 LUFS. `assemble.mjs` refuses a cut where the narration talks over itself, the call, or the desktop app's sound.

## Swapping in Diego's own voice

- **Narration:** read `SCRIPT.md`'s lines in one take (or `vo/lines.json`, in order) and save it as `video/out/demo/el/narr.diego.wav`. Then:

  ```sh
  nemo-speech transcribe video/out/demo/el/narr.diego.wav --model parakeet-tdt-0.6b-v3.q8_0.gguf -f json --quiet > video/out/demo/el/narr.diego.json
  python3 video/demo/vo/split.py video/out/demo/el/narr.diego.wav video/out/demo/el/narr.diego.json video/out/demo/vo-diego
  ```

  set `VO_DIR` in `edit.mjs` to `vo-diego`, and run `assemble.mjs`. Lines that run long move the next one (the assembler says which).
- **His half of the call:** put his four lines (`call.mjs` lists them) in a folder as 48 kHz mono WAVs and run `CALLER_DIR=/that/folder node video/demo/record/call.mjs`. Then update the call ranges and captions in `edit.mjs` from the new `clips/call.transcript.json`.
