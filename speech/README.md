# Build-a-bot speech server

Speech-to-text for Build-a-bot's voice typing and meeting notes, on NVIDIA's open models:

- **NVIDIA Parakeet TDT 0.6B v3** hears "detect it" and 25 languages (English and 24 European
  languages). It's the most accurate open model of its size, writes punctuation and capitals,
  writes numbers the way people do ("$142", "October 30th", "10 a.m."), and doesn't make up words
  in silence the way Whisper does.
- **NVIDIA Nemotron 3.5 ASR** hears the languages Parakeet doesn't: Japanese, Chinese, Korean,
  Hindi, Arabic, Vietnamese, Turkish and Norwegian.

Both run on **NVIDIA NeMo-Speech.cpp**, NVIDIA's native runtime for its speech models, behind
`server.mjs`: one OpenAI-compatible `POST /v1/audio/transcriptions`, so the app's speech-to-text
layer (`src/lib/transcribe`) talks to it like any other provider. It's built to run on a
**Nebius Serverless AI endpoint**, next to the app's brains on Nebius Token Factory.

## What it does with a recording

1. Checks the key (`Authorization: Bearer …`), the size (25 MB) and the length (30 minutes).
2. Turns any recording the apps make (webm and ogg from browsers and the desktop app, mp4 from
   Safari, wav, mp3, flac) into 16 kHz mono WAV with ffmpeg, and adds a second of silence after
   it: without it, a clip that stops mid-word loses its last word. The container is chosen from the
   file's first bytes and ffmpeg may only read local files, so an upload can't make it fetch
   anything.
3. Picks the model by language: none or one of Parakeet's 25 → Parakeet; Japanese and the others →
   Nemotron (with its locale prompt, `ja-JP`); anything else → `422 unsupported_language`, and the
   app uses its backup provider.
4. Answers in OpenAI's shape: `json` (`{text}`), `text`, or `verbose_json` with sentence-sized
   `segments` (meeting notes use them) and, when asked, `words`.

Audio is handled in memory (`/dev/shm`) and deleted as soon as it's text. Nothing that was said is
logged or kept: each request's log line has its time, length, model, language and status.

## Measured

On a 4-vCPU Intel Xeon (no GPU), with both models loaded:

| Clip | Time to text (webm in, JSON out) |
| - | - |
| 3.4 s ("Let's move the Nemotron demo to next Tuesday at 10 a.m.") | 1.0 s |
| 4.5 s | 1.2 s |
| 7 s ("…about $142 on October 30th.") | 1.6 s |

That's about 5× faster than real time, with Parakeet keeping 3 of the 4 cores busy: it uses the
cores it's given, so a bigger CPU preset answers faster, and a GPU much faster still (NVIDIA
measured its runtime about 12× faster on an RTX 4090 than on an 8-core desktop CPU). Nemotron is
about half Parakeet's speed on a CPU, and its first request in a language loads that language's
number rules (a few seconds, once).

Quality notes from testing both models on the same clips: Parakeet was more accurate on English,
Spanish and German (and on the LibriSpeech samples it was word-perfect where Nemotron wrote
"slashy" for "slushy"); Nemotron was the right pick for Hindi. Neither knows rare names
("Kowalczyk") without help: the app fixes those from the owner's dictionary afterwards. NVIDIA's
word boosting doesn't help here yet: Parakeet TDT ignores it, and the published Nemotron 3.5 GGUF
has no tokenizer for it.

## Run it

With Docker:

```bash
docker build -t build-a-bot-speech:cpu speech/
docker run --rm -p 8000:8000 -e SPEECH_API_KEY=$(openssl rand -hex 32) build-a-bot-speech:cpu
```

For an NVIDIA GPU: `--build-arg BACKEND=cuda` and `docker run --gpus all …` (the image picks the
GPU by itself).

The images are built by GitHub Actions on every change to `speech/`
(`.github/workflows/speech-image.yml`) and published as
`ghcr.io/dpro10/build-a-bot-speech:cpu` and `:cuda` (and `:cpu-<commit>` / `:cuda-<commit>`).

Without Docker, with NeMo-Speech.cpp's release, the two models and ffmpeg on the machine:

```bash
SPEECH_API_KEY=… NEMO_SPEECH_BIN=~/nemo-speech/bin/nemo-speech ITN_DIR=~/nemo-speech/itn_configs \
PARAKEET_MODEL=~/models/parakeet-tdt-0.6b-v3.q8_0.gguf \
NEMOTRON_MODEL=~/models/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf \
node speech/server.mjs
```

Try it:

```bash
curl -H "Authorization: Bearer $SPEECH_API_KEY" -F file=@clip.webm -F response_format=verbose_json \
  http://localhost:8000/v1/audio/transcriptions
```

Tests (no models needed; ffmpeg for the audio ones): `cd speech && npm test`.

## Deploy on Nebius (Serverless AI endpoint)

1. Make a key for it: `openssl rand -hex 32`. Keep it somewhere safe; it goes in two places
   below and nowhere else.
2. In the [Nebius console](https://console.nebius.com): **Serverless AI → Endpoints → Create
   endpoint → Custom**.
   - **Image path:** `ghcr.io/dpro10/build-a-bot-speech:cpu`. While the repository is private, its
     image is too: under **Private registry**, add `ghcr.io` with your GitHub username and a
     GitHub token that can read packages (or make the package public on GitHub: Packages →
     build-a-bot-speech → Package settings → Change visibility).
   - **Ports:** `8000` (HTTP).
   - **Secret environment variables → Create secret:** key `SPEECH_API_KEY`, value: the key from
     step 1.
   - **Authentication:** leave it off; the server checks the key itself.
   - **Computing resources:** without GPU, platform **Non-GPU AMD EPYC Genoa** (`cpu-d3`), preset
     **8 vCPUs, 32 GiB** (`8vcpu-32gb`), in a US region (`us-central1`), near the app on Vercel.
   - **Container disk:** 50 GiB is plenty (the image is about 2 GB).
   - **Network:** a subnet, and **Public static IP** isn't needed (the managed HTTPS URL works without it).
3. Create it and wait for **Running** (a couple of minutes: the image is pulled and both models
   load). Copy its HTTPS URL from **Public endpoints**, and check it:
   `curl https://<endpoint-url>/health` → `{"status":"ok",…}`.
4. In Vercel (Project → Settings → Environment Variables, Production), then redeploy:
   - `TRANSCRIBE_PROVIDER` = `nvidia`
   - `TRANSCRIBE_BASE_URL` = `https://<endpoint-url>/v1`
   - `TRANSCRIBE_API_KEY` = the key from step 1

The same from the Nebius CLI (after creating the secret in SecretStash with a `SPEECH_API_KEY` key):

```bash
nebius ai endpoint create \
  --name build-a-bot-speech \
  --image ghcr.io/dpro10/build-a-bot-speech:cpu \
  --container-port 8000 \
  --env-secret SPEECH_API_KEY=<secret_name> \
  --platform cpu-d3 --preset 8vcpu-32gb \
  --disk-size 50Gi
```

**What it costs** (Nebius prices from October 2026, billed per second while it runs; a stopped
endpoint costs nothing):

| Setup | About |
| - | - |
| CPU, `8vcpu-32gb` (recommended to start) | $0.26/hour, ~$190/month |
| CPU, `16vcpu-64gb` (about twice as fast) | $0.53/hour, ~$385/month |
| GPU, NVIDIA L40S, `gpu-l40s-a` `1gpu-8vcpu-32gb` in `eu-north1`, image `:cuda` | $1.55/hour, ~$1,130/month ($0.75/hour preemptible) |

For a GPU endpoint, use the `:cuda` image, choose **With GPU**, platform `gpu-l40s-a`, preset
`1gpu-8vcpu-32gb`.

## Settings

| Variable | Default | |
| - | - | - |
| `SPEECH_API_KEY` | (required) | The key callers send as `Authorization: Bearer …`. `SPEECH_ALLOW_NO_AUTH=1` runs without one, for your own machine only. |
| `PORT`, `HOST` | `8000`, `0.0.0.0` | Where it listens. |
| `SPEECH_DEVICE` | `auto` | `cpu`, `cuda`, or `auto` (the GPU when there is one). |
| `SPEECH_THREADS` | all cores | Threads per model. |
| `NEMOTRON_MODEL` | the bundled one | `off` to run Parakeet only (less memory; other languages get 422). |
| `PARAKEET_URL`, `NEMOTRON_URL` | | Use NeMo-Speech.cpp servers that are already running instead of starting them. |
| `MAX_UPLOAD_MB`, `MAX_AUDIO_SECONDS` | `25`, `1800` | Per-request limits. |
| `MAX_CONCURRENT`, `MAX_QUEUE`, `QUEUE_TIMEOUT_MS` | `4`, `32`, `20000` | Past these, `503 busy` with `Retry-After`. |

## API

`POST /v1/audio/transcriptions` (multipart), with the fields OpenAI's takes: `file` (required),
`model` (optional; `nemotron-3.5-asr-streaming-0.6b` asks for Nemotron), `language` (`en`,
`en-US`, `auto`), `response_format` (`json`, `text`, `verbose_json`),
`timestamp_granularities[]` (`segment`, `word`). `prompt` and `temperature` are accepted and
ignored. The response says which model ran in its `model` field and the `x-speech-model` header.

Errors use OpenAI's shape (`{"error": {"message", "type", "code", "param"}}`): `401
unauthorized`, `400 invalid_request`, `413 too_large` / `too_long`, `415 unsupported_format`,
`422 unsupported_language` / `unreadable_audio`, `503 busy` / `unavailable` (with `Retry-After`).

`GET /health` (no key): `200 {"status":"ok"}` once Parakeet is ready, `503` before.
`GET /v1/models`: the models and whether each is ready.

## Licenses

The image bundles NeMo-Speech.cpp (Apache 2.0), Parakeet TDT 0.6B v3 (CC BY 4.0) and Nemotron 3.5
ASR (NVIDIA Open Model License, OpenMDW 1.1), ffmpeg, Node.js and tini; see
[LICENSES.md](LICENSES.md).
