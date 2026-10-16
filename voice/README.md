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
    idle and time limits, a latency report per turn.
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
  app's Account page). A PIN never reaches the model.
- **Anyone else**: a contact. The bot is polite, takes a message, and does nothing for them.

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
npm test                      # 60+ tests on fakes: no models needed
npm run typecheck

# With the real models (as the CI's real-models job sets them up): NeMo-Speech.cpp v0.2.0 and
# native/ built into ~/nemo-speech, and the models from scripts/fetch-models.sh ~/models
NEMO_VOICE_BIN=~/nemo-speech/bin/nemo-voice \
NEMO_VOICE_ARGS="--asr-model … --tts-model … --codec-model … --tokenizer-dir … --no-cfg" \
SILERO_VAD_MODEL=~/models/silero_vad.onnx \
node --test test/real-call.test.ts   # whole calls: Magpie's caller, Parakeet, Magpie's answer

# The server (APP_URL, VOICE_SERVER_SECRET and TOKEN_FACTORY_API_KEY are required):
docker build -t build-a-bot-voice --build-arg CPU_LEVEL=native .
docker run -p 8080:8080 --env-file voice.env build-a-bot-voice
```

Settings: `APP_URL`, `VOICE_SERVER_SECRET` (shared with the app, 32+ characters),
`TOKEN_FACTORY_API_KEY`, and optionally `TALKER_MODEL` (default `nvidia/Nemotron-3_5-Lightning`),
`VOICE` (Aria, Sofia, John, Jason or Leo), `MAX_CALLS` (default 1: the engine speaks for one call at
a time), `TTS_THREADS`, `CODEC_THREADS`, `TTS_CFG=1`, `SPEECH_URL` (use a stock `nemo-speech serve`
instead of the sidecar), `ALLOWED_ORIGINS`.

Logs are one JSON object a line and never contain what anyone said.
