# The Build-a-bot promo

A one-minute promo (61.5 s, 1920×1080, 60 fps) on four ideas: **own your data**, **own your intelligence**, **an assistant that gets smarter the more you use it**, and **zero data retention**. Script, beats and the facts behind every claim: [`STORYBOARD.md`](STORYBOARD.md).

Everything in it is made here, from the product's own pieces:

- **Picture:** an HTML stage (`stage/`) drawn as a pure function of time, using the app's characters, logo, icons, fonts and colors (`scripts/export-assets.tsx` renders them from `src/`). Headless Chromium screenshots every frame (`scripts/render.mjs`).
- **Voice:** Otto's own voice, NVIDIA Magpie TTS (voice Sofia) on NeMo-Speech.cpp, the engine behind the bots' phone calls. Several takes of each line; NVIDIA Parakeet transcribed every take, and the picked ones match the script word for word (`audio/vo_pick.py`). Then a little more air at sentence breaks, a gentle formant-preserving slow-down, EQ, de-essing and compression (`audio/vo_build.py`). The finished lines are in `audio/vo/`.
- **Music:** an original score synthesized from scratch in F major at 96 BPM, with every scene change on a downbeat (`audio/music.py`, on `audio/synth.py`). No samples, no loops, nothing copyrighted (the hackathon asks for no copyrighted music).
- **Sound effects:** synthesized too, placed on the moments the stage reports (`audio/sfx.py`).
- **Mix:** the voice at its cues, the score ducked under it (deeper in the speech band), −14 LUFS integrated with true peaks under −1 dBTP for YouTube (`audio/mix.py`). Parakeet transcribes the finished mix word for word, a check that the voice stays clear over the music.
- **Captions:** an SRT file timed from Parakeet's word timings (`audio/captions.py`).

## Rebuild it

Needs Node 22 with the repo's packages (`npm ci` at the root, which brings Playwright), Playwright's Chromium, Python 3 with numpy and scipy, and ffmpeg built with rubberband and soxr.

```bash
bash video/build.sh          # everything below, then video/out/build-a-bot-promo.mp4
```

Or step by step:

```bash
npx tsx video/scripts/export-assets.tsx           # characters, logo, icons, fonts -> stage/generated
node video/scripts/render.mjs stills 12,30,50     # check frames -> out/stills
node video/scripts/render.mjs events              # on-screen moments -> out/events.json
python3 video/audio/music.py                      # -> audio/build/music.wav
python3 video/audio/sfx.py                        # -> audio/build/sfx.wav
python3 video/audio/mix.py                        # -> audio/build/mix.wav (add --no-vo for a music-only mix)
python3 video/audio/captions.py                   # -> out/build-a-bot-promo.en.srt
node video/scripts/render.mjs video               # -> out/final-frames.mkv (lossless, about 20 min on 4 cores)
```

Then mux (see `build.sh` for the exact command): H.264 High, CRF 16, BT.709, AAC 320 kb/s.

Open `stage/index.html` in a browser (after `render.mjs` has written `stage/generated/data.js`) and call `STAGE.render(t)` in the console to scrub by hand.

## Changing it

- **Timing:** `timeline.json` holds the scene boundaries (on the music's bars) and when each voice line starts. The stage keys its moments to the voice's word timings in `audio/vo/vo.json`, so moving a line moves its picture with it. After any change, re-run `render.mjs events`, then `sfx.py` and `mix.py`.
- **The voice:** to re-record a line, generate takes with NeMo-Speech.cpp's Magpie (voice Sofia, guidance on), score them with `vo_pick.py`, set `audio/vo/picks.json`, and run `vo_build.py`. Then update the word ranges in `captions.py` if the words changed.
- **Words on screen:** they live in `stage/stage.js`, next to the scene that shows them.
- **Checking the sound:** `python3 video/audio/analyze.py FILE.wav` prints the octave-band balance and level. To check the voice stays clear, transcribe the finished mix with NVIDIA Parakeet (NeMo-Speech.cpp's `nemo-speech transcribe`): it should come back word for word. One take of the brain line didn't survive the music ("NVIDIA *and* Nemotron"), so the pick is the take that did.
