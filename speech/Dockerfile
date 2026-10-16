# Build-a-bot's speech server: NVIDIA Parakeet TDT 0.6B v3 and NVIDIA Nemotron 3.5 ASR on
# NVIDIA's NeMo-Speech.cpp, behind server.mjs (OpenAI-compatible /v1/audio/transcriptions).
#
#   docker build -t build-a-bot-speech:cpu speech/
#   docker build -t build-a-bot-speech:cuda --build-arg BACKEND=cuda speech/
#   docker run -p 8000:8000 -e SPEECH_API_KEY=... build-a-bot-speech:cpu
#
# Everything downloaded here is pinned and checked against its SHA-256: NeMo-Speech.cpp's release
# archive (the hashes NVIDIA publishes with it), its inverse text normalization grammars, and the
# two models (the hashes in the release's share/nemo-speech/model-index.json).

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS fetch
ARG BACKEND=cpu
ARG NEMO_SPEECH_VERSION=0.2.0
ARG NEMO_SPEECH_SHA256_CPU=f396057150f1b774935c7414fd32ebc04195a795a34120d78d8c9ecefa1b7507
ARG NEMO_SPEECH_SHA256_CUDA=aef573fcc6c2c759401d2ed03e5ca9e401ed23b0e38cb852d917080c1e2d4515
ARG ITN_SHA256=880c9365d1d52c17450bd930950b0e58eca294421b7be62eb71666fb21b8997f
ARG PARAKEET_REVISION=541d1f99c6b0c3cd0b11a95167540bb8edefd82b
ARG PARAKEET_SHA256=e3880d0aaaaf2c308ea2c35016b2b895c423eb3fda924c1b463d1c19b7f4d32e
ARG NEMOTRON_REVISION=1c8deaecc64b91f034d73e08dd8b64625eb3395d
ARG NEMOTRON_SHA256=a5c435f294eea8f88ce68dd27b8c3bfea7f777cb2fbba04fcd30eaa555f429ae
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl bzip2 && rm -rf /var/lib/apt/lists/*
WORKDIR /fetch
RUN set -eux; \
    case "$BACKEND" in cpu) sum="$NEMO_SPEECH_SHA256_CPU";; cuda) sum="$NEMO_SPEECH_SHA256_CUDA";; *) echo "BACKEND must be cpu or cuda" >&2; exit 1;; esac; \
    base="https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v${NEMO_SPEECH_VERSION}"; \
    curl -fsSL -o nemo-speech.tar.gz "$base/nemo-speech-${NEMO_SPEECH_VERSION}-linux-x86_64-${BACKEND}.tar.gz"; \
    echo "$sum  nemo-speech.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/nemo-speech; tar -xzf nemo-speech.tar.gz -C /opt/nemo-speech --strip-components=1; \
    curl -fsSL -o itn.tar.bz2 "$base/itn_configs.tar.bz2"; \
    echo "$ITN_SHA256  itn.tar.bz2" | sha256sum -c -; \
    tar -xjf itn.tar.bz2 -C /opt/nemo-speech; \
    rm -f nemo-speech.tar.gz itn.tar.bz2
RUN set -eux; mkdir -p /models; \
    curl -fsSL -o /models/parakeet-tdt-0.6b-v3.q8_0.gguf "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/resolve/${PARAKEET_REVISION}/parakeet-tdt-0.6b-v3.q8_0.gguf"; \
    echo "$PARAKEET_SHA256  /models/parakeet-tdt-0.6b-v3.q8_0.gguf" | sha256sum -c -; \
    curl -fsSL -o /models/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/${NEMOTRON_REVISION}/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf"; \
    echo "$NEMOTRON_SHA256  /models/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf" | sha256sum -c -

FROM ${NODE_IMAGE}
ARG BACKEND=cpu
LABEL org.opencontainers.image.title="build-a-bot-speech" \
      org.opencontainers.image.description="NVIDIA Parakeet and Nemotron speech recognition behind an OpenAI-compatible API, for Build-a-bot"
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY --from=fetch /opt/nemo-speech /opt/nemo-speech
COPY --from=fetch /models /models
WORKDIR /app
COPY package.json lib.mjs server.mjs ./
COPY LICENSES.md /licenses/LICENSES.md
# The GPU image needs the NVIDIA container runtime to hand it the driver; the CPU image ignores these.
ENV NODE_ENV=production \
    PORT=8000 \
    NEMO_SPEECH_BIN=/opt/nemo-speech/bin/nemo-speech \
    ITN_DIR=/opt/nemo-speech/itn_configs \
    PARAKEET_MODEL=/models/parakeet-tdt-0.6b-v3.q8_0.gguf \
    NEMOTRON_MODEL=/models/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf \
    SPEECH_DEVICE=auto \
    SPEECH_BACKEND=${BACKEND} \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility
# The CUDA build needs the GPU driver to start, so only the CPU build can be checked here.
RUN if [ "$BACKEND" = cpu ]; then /opt/nemo-speech/bin/nemo-speech --version; fi
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
