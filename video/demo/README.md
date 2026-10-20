# The demo video

A 2:48 walkthrough of the real product for the hackathon (Devpost and YouTube): a real call, building a bot, approvals, the Library's flashcards and quizzes, the desktop app, and how it's built. The script, the shot list and where every claim is true: [`SCRIPT.md`](SCRIPT.md). The promo, its one-minute sibling, is one folder up ([`../README.md`](../README.md)); this video reuses its characters, scenes, synthesizer and end card.

Everything is rebuilt from here, and the media lands in `video/out/demo/` (gitignored):

| Step | Command | What it makes |
| - | - | - |
| Class files | `node video/demo/props/build.mjs` | a syllabus PDF, a lecture deck PDF, a photo of handwritten notes (made up for the video) |
| Recordings | `node video/demo/record/<scene>.mjs` | `clips/<scene>.mp4` + markers: `builder`, `chat`, `library`, `call`, `pages` |
| Narration | `node video/demo/vo/make.mjs` | Otto's lines in its own voice (NVIDIA Magpie, Sofia), picked by NVIDIA Parakeet |
| Brand pieces | `npx tsx video/scripts/export-assets.tsx` | the app's characters, logo and fonts for the cards and the promo's scenes |
| Score | `video/out/venv/bin/python video/demo/music.py` | an original score in the promo's world, under the demo's beats |
| The cut | `node video/demo/assemble.mjs [--sheet]` | `build-a-bot-demo.mp4` (1920×1080, 60 fps, −14 LUFS) |
| Checks | `node video/demo/check-voice.mjs` | every narration line, cut from the final mix, transcribed word for word |

Needs: Node 22 with the repo's packages, Google Chrome (the recorder uses it), ffmpeg, NeMo-Speech.cpp and Parakeet (the desktop app's copies are used by default; Magpie downloads itself the first time), and Python 3 with numpy and scipy for the score (`python3 -m venv video/out/venv && video/out/venv/bin/pip install numpy scipy`). The score follows the cut, so after changing the edit run `assemble.mjs`, then `music.py`, then `assemble.mjs --reuse` again.

## How the recordings are made

`record/recorder.mjs` drives Chrome against build-a-bot.site:

- **Picture:** Chrome's own screencast of a 1280×720 window at 2× (2560×1440, about 60 frames a second), with a visible cursor that clicks with a ripple, mouse moves along gentle curves, and typing at a human pace. The window itself is sized (Chrome's screencast ignores viewport emulation).
- **Markers:** each scene marks its moments ("cards-made", "approved"), and `edit.mjs` cuts on them.
- **A real call with both voices:** the page gets a microphone the script can make talk (it plays WAV files into it at the right moments, turn by turn, watching the voice server's own events), and a copy of everything the voice server sends. The call's sound is rebuilt exactly as the page played it, including the moment a cut-in stops Otto mid-word.
- **Hidden while recording:** the demo site's yellow "Demo mode" strip and a guest account's "Save your account" nudges.
- Each scene makes its own guest account and Otto and deletes it afterwards (guests get 5 messages before signing in, so the call scene adds its files on the Library page, which costs none).

## Swapping in Diego's own recordings

- **His half of the call:** put his six files (SCRIPT.md lists them) in a folder, convert them to 48 kHz mono WAV (`ffmpeg -i in.m4a -ar 48000 -ac 1 line1.wav`), and run `CALLER_DIR=/that/folder node video/demo/record/call.mjs`. Then update the call ranges and captions in `edit.mjs` from the new `clips/call.transcript.json` (speech runs and Otto's replies), and run `assemble.mjs`.
- **Voice typing and meeting notes:** save his screen recordings as `clips/voice.mp4` and `clips/meetings.mp4` (any size; they're scaled to 1080p), set each segment's `pieces` in `edit.mjs` to the seconds worth showing, and drop the `zoom`.
- **His voice as the narrator:** record each line of `vo/lines.json` as `vo/<id>.wav` in `video/out/demo/`, and keep the timing in `edit.mjs` (lines that run long move the next one).
