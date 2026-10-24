# Build-a-bot voice server

Talk to your bot: by phone, or with the **Call** button in the app. NVIDIA Parakeet hears you, NVIDIA
Magpie speaks, NVIDIA Nemotron 3.5 Lightning holds the conversation, and your bot's own agent does
the work: your apps, its memory, approvals, receipts, the same safeguards as a chat. The speech
models run on our own server through NVIDIA NeMo-Speech.cpp: no speech API sees your voice, and
the audio isn't kept.

```
caller ─┬─ phone: Twilio Media Streams (8 kHz μ-law, WebSocket /twilio)
        └─ browser: the app's Call button (16 kHz PCM, WebSocket /call)
           │
           ▼
   Silero VAD → turn detector ─┬─ first pause (~0.2 s): Parakeet hears the turn so far, and the
           │                   │   talker starts its answer, held back
           │                   ├─ they keep talking: drop it
           │                   └─ end of turn: release it at once
           ▼
   talker: Nemotron 3.5 Lightning (Token Factory), streamed sentence by sentence
           │      └─ ask_bot → the app's /api/calls/act → the bot's agent (tools, memory, approvals)
           ▼
   Magpie, streamed (~186 ms pieces), stoppable mid-word when the caller cuts in
```

## How it's built

- **`native/nemo-voice.cpp`**: a small C++ program on NeMo-Speech.cpp's stable C API (`asr.h`,
  `tts.h`). It keeps Parakeet and Magpie loaded for every call and talks to the server in binary
  frames over stdin/stdout. Magpie's audio streams out as it's made (NVIDIA's HTTP server buffers
  a whole sentence first), and a cancel stops it within a chunk.
- **`src/`**, TypeScript run directly by Node 22 (no build step):
  - `call/session.ts`: one call. Turn-taking with an early guess, held replies, barge-in (with
    what the caller actually heard), fillers, background work reported as `<update>`s, PIN unlock,
    idle and time limits, a latency report per turn. Keeping the talker honest (below).
  - `turn/detector.ts`, `vad/vad.ts`: Silero VAD (ONNX Runtime) and the turn state machine.
  - `speech/`: the sidecar client (`sidecar.ts`), a fallback for NVIDIA's stock HTTP server
    (`http.ts`), and text made speakable (`text.ts`: "$12.50", "3:30 PM", dates, phone numbers).
  - `brain/`: the talker (OpenAI-compatible streaming, tool calls, reasoning kept out of the voice)
    and the app's API.
  - `transports/`: Twilio Media Streams and the browser.
  - `audio/`: μ-law, a polyphase resampler, WAV.
- **`Dockerfile`**: builds NeMo-Speech.cpp v0.2.0 from source for a CPU level (`v3` AVX2, `v4`
  AVX-512 + AMX) and the sidecar. `scripts/fetch-models.sh` gets the models, each pinned by
  revision and SHA-256 (Magpie's are the files NVIDIA's `nemo-speech pull magpie` gets), and
  requantizes Magpie to Q8_0 (`scripts/magpie-q8.py`), the format NVIDIA benchmarks.
- **`deploy/`**: one Container-Optimized OS VM on Google Compute Engine with Caddy for HTTPS
  (`gce.sh`, run by `.github/workflows/voice.yml`).

## Who's calling

The app decides (`src/lib/calls/index.ts` in the app):
- **The app's Call button**: the owner, signed in.
- **The owner's phone, vouched for by the carrier** (STIR/SHAKEN attestation A): the owner.
- **The owner's phone otherwise**: unverified until they say or type their phone PIN (set in the
  app's Account page), on its own or in a short sentence ("Yes, 4481"). Until then the bot only
  takes a message. A PIN never reaches the model or the transcript: while one is wanted, digits
  that could be one are taken out of what the caller said.
- **Anyone else**: a contact. The bot is polite, takes a message, and does nothing for them.

## Keeping the talker honest

The talker runs without reasoning (it would add a second or two to every answer), so the server
checks its work instead:
- **The agent's real outcome**: `ask_bot`'s result carries the app's status (`ok`, `refused`,
  `limited`, `unavailable`, `error`, `paused`), the agent's own words, what waits for the owner's OK,
  and plainly what that means ("Nothing was done", "Not done yet: it's waiting for Diego's OK").
- **No claim before the job is back**: the talker's answer is spoken as it comes, a sentence at a
  time, except a sentence that says something was done or will be ("Done! I've booked it"): that
  one, and what follows it, waits for the end of the talker's step to be checked. With a hand-off
  it's never spoken: the caller hears "Let me check." (or what the talker said first, like "One
  moment") while the agent works, then the answer from the result. Waiting for each whole step
  instead, as first built, made every answer 1.3 to 2 s slower.
- **A claim that didn't happen is never spoken**: after a job that didn't succeed, a reply that
  still says it did is replaced by an honest line from the agent's own words ("That didn't go
  through. You're out of credit…"). A reply that says something was done when nothing was handed to
  the agent is sent back to the talker once ("use ask_bot, or say it isn't done"), then replaced.
- **No promises it can't keep**: no texts, emails or calls later; work still running is reported on
  the call.

## When things go wrong

- **The talker fails or hangs** (each request gets 10 s): the caller hears what's true (what the
  agent already did, or "Sorry, I lost my train of thought"), and the call carries on.
- **The speech engine is down or restarting**: `/health` says 503 and no call is taken. A call it
  fails during hears a short apology made at start-up (it can't be made then) and ends. A sentence
  the engine goes quiet on is given up on after 10 s.
- **A caller who hangs up at once** (even while the call is being set up) ends the call right away,
  and a call where the caller never said anything sends no transcript.
- **A deploy or restart** (SIGTERM or SIGINT): every call hears a short goodbye and its report goes
  to the app (`/api/calls/end`), within 15 s, then the server stops. The deploy stops the VM cleanly
  for this, rather than resetting it.
- **Calls at once**: a line is taken the moment a call is let in, so two callers at once can't both
  get the last one. Phone calls last at most 15 minutes, in-app calls as long as the app says (15).

## Speed

Measured on 4 vCPUs (Intel Sapphire Rapids, 2.1 GHz):

| | |
| - | - |
| Parakeet, one turn of speech | 8× faster than real time (a 4.4 s turn in 0.55 s) |
| Magpie Q8_0, AVX-512 + AMX build, 2 threads + 2 for its codec | 0.93× real time; first audio in about 0.8 s |
| Magpie F16, NVIDIA's prebuilt AVX2 build, 4 threads | 0.53× real time; first audio in about 1 s |
| Silero VAD | 0.23 ms of CPU per 32 ms of audio |
| Whole turn (caller stops → bot's first word), scripted talker, the `v4` build | 1.3 s, on the phone path and in the browser |

Magpie's codec is the slow part: on 4 vCPUs, 2 threads for Magpie and 2 for its codec is the best
split, at about 1.0× real time (1 + 3 streams faster, but first audio takes 1.5 s). That's just
enough, so the server measures its own speed (`speechRate` in `/health`), and when speech is made
slower than it plays, each sentence waits until enough of it is ready to play through without a
gap (`SpeechPace` in `call/speaker.ts`). An 8-vCPU machine has room to spare. With the real talker,
add Nemotron's first token (about 0.5 to 1 s from Token Factory); the early guess at the first
pause hides part of it.

The whole thing was also checked in a real browser: Chromium with a fake microphone playing a
Magpie-voiced question, the app's Call button, this server on the real models and the bot's agent
in demo mode. The question was heard, the answer spoken back, and the call landed in the chat.

## Run it

```bash
cd voice && npm install
npm test                      # 90+ tests on fakes: no models needed
npm run typecheck

# With the real models (as the CI's real-models job sets them up): NeMo-Speech.cpp v0.2.0 and
# native/ built into ~/nemo-speech, and the models from scripts/fetch-models.sh ~/models
NEMO_VOICE_BIN=~/nemo-speech/bin/nemo-voice \
NEMO_VOICE_ARGS="--asr-model … --tts-model … --codec-model … --tokenizer-dir … --voice Sofia" \
SILERO_VAD_MODEL=~/models/silero_vad.onnx \
node --test test/real-call.test.ts   # whole calls: Magpie's caller, Parakeet, Magpie's answer

# The server (APP_URL, VOICE_SERVER_SECRET and TOKEN_FACTORY_API_KEY are required):
docker build -t build-a-bot-voice --build-arg CPU_LEVEL=native .
docker run -p 8080:8080 --env-file voice.env build-a-bot-voice
```

Settings: `APP_URL`, `VOICE_SERVER_SECRET` (shared with the app, 32+ characters),
`TOKEN_FACTORY_API_KEY`, and optionally `TALKER_MODEL` (default `nvidia/Nemotron-3_5-Lightning`),
`VOICE` (default Sofia; or Aria, Jason, John or Leo), `MAX_CALLS` (default 1: the engine speaks for
one call at a time; anything but a whole number of 1 or more means 1), `TTS_THREADS`,
`CODEC_THREADS`, `TTS_CFG=0` (turns classifier-free guidance off: Magpie then reads slower),
`SPEECH_URL` (use a stock `nemo-speech serve` instead of the sidecar), `ALLOWED_ORIGINS`. The deploy
(`deploy/gce.sh`) takes `MAX_CALLS`, `TALKER_MODEL` and `TTS_CFG` from the GitHub variables
`VOICE_MAX_CALLS`, `TALKER_MODEL` and `TTS_CFG`.

Logs are one JSON object a line and never contain what anyone said.
