# Build-a-bot's voice server: calls with your bot, by phone (Twilio Media Streams) or in the
# browser, heard by NVIDIA Parakeet and spoken by NVIDIA Magpie on NVIDIA NeMo-Speech.cpp, with
# Silero VAD for turn-taking. The talker (Nemotron 3.5 Lightning) runs on Nebius Token Factory.
#
#   docker build -t build-a-bot-voice:cpu-v4 --build-arg CPU_LEVEL=v4 voice/
#   docker run -p 8080:8080 --env-file voice.env build-a-bot-voice:cpu-v4
#
# CPU_LEVEL picks the instructions NVIDIA's engine is compiled for:
#   v3      AVX2, FMA, F16C: any x86-64 server from the last decade
#   v4      v3 + AVX-512 (VNNI, BF16) + AMX: Intel Sapphire Rapids and newer (GCP C3, C4, N4)
#   native  whatever the machine building it has
# Magpie is about 40% faster on v4 than on v3 (measured on 4 Sapphire Rapids vCPUs).
#
# Everything downloaded is pinned: NeMo-Speech.cpp at v0.2.0's commit (and its submodules at the
# commits that tag pins), and every model by revision and SHA-256 (scripts/fetch-models.sh: Magpie,
# its codec and tokenizer are the files of NVIDIA's own `nemo-speech pull magpie`, with Magpie's
# GGUF from NVIDIA's later revision, which names its voices right).

ARG NODE_IMAGE=node:22-bookworm-slim
ARG BUILD_IMAGE=node:22-bookworm

FROM ${BUILD_IMAGE} AS engine
ARG CPU_LEVEL=v3
ARG NEMO_SPEECH_COMMIT=6a3ca369370782acee0dd155e34394ba60b920c4
RUN set -eux; \
    echo "deb http://deb.debian.org/debian bookworm-backports main" > /etc/apt/sources.list.d/backports.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends build-essential git ninja-build libsentencepiece-dev ca-certificates; \
    apt-get install -y --no-install-recommends -t bookworm-backports cmake; \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN set -eux; \
    git clone --depth 1 --branch v0.2.0 https://github.com/NVIDIA/NeMo-Speech.cpp.git nemo-speech; \
    cd nemo-speech; \
    test "$(git rev-parse HEAD)" = "$NEMO_SPEECH_COMMIT"; \
    git submodule update --init --depth 1 llama.cpp third_party/cpp-httplib
RUN set -eux; \
    cd nemo-speech; \
    case "$CPU_LEVEL" in \
      native) flags="-DGGML_NATIVE=ON";; \
      # (.github/workflows/voice.yml builds the same v3 for its real-model tests.)
      v3) flags="-DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=ON";; \
      v4) flags="-DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=ON -DGGML_AVX512=ON -DGGML_AVX512_VBMI=ON -DGGML_AVX512_VNNI=ON -DGGML_AVX512_BF16=ON -DGGML_AMX_TILE=ON -DGGML_AMX_INT8=ON -DGGML_AMX_BF16=ON";; \
      *) echo "CPU_LEVEL must be v3, v4 or native" >&2; exit 1;; \
    esac; \
    scripts/configure.sh cpu-server $flags -DNEMO_SPEECH_BUILD_NMT=OFF -DNEMO_SPEECH_BUILD_DIAR=OFF; \
    cmake --build --preset cpu-server -j "$(nproc)"; \
    cmake --install build/cpu-server --prefix /opt/nemo-speech; \
    rm -rf build
COPY native /src/nemo-voice
RUN set -eux; \
    cmake -S /src/nemo-voice -B /src/nemo-voice/build -G Ninja -DCMAKE_PREFIX_PATH=/opt/nemo-speech -DCMAKE_INSTALL_PREFIX=/opt/nemo-speech; \
    cmake --build /src/nemo-voice/build; \
    cmake --install /src/nemo-voice/build; \
    # A v4 build needs AVX-512 and AMX, which the machine building it may not have.
    if [ "$CPU_LEVEL" != v4 ]; then /opt/nemo-speech/bin/nemo-speech --version; fi

# The models are the same for every CPU level, so they're fetched apart from the engine.
FROM ${BUILD_IMAGE} AS models
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY scripts/fetch-models.sh scripts/magpie-q8.py /src/
RUN /src/fetch-models.sh /models

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN set -eux; \
    npm ci --omit=dev --no-audit --no-fund; \
    # ONNX Runtime ships every platform's binaries: keep Linux x64's.
    find node_modules/onnxruntime-node/bin -mindepth 3 -maxdepth 3 -type d ! -path "*/linux/x64" -exec rm -rf {} +

FROM ${NODE_IMAGE}
ARG CPU_LEVEL=v3
LABEL org.opencontainers.image.title="build-a-bot-voice" \
      org.opencontainers.image.description="Calls with your Build-a-bot: NVIDIA Parakeet hears, NVIDIA Magpie speaks, Nemotron talks" \
      org.opencontainers.image.licenses="Apache-2.0"
RUN apt-get update && apt-get install -y --no-install-recommends tini libsentencepiece0 libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=engine /opt/nemo-speech/bin /opt/nemo-speech/bin
COPY --from=engine /opt/nemo-speech/lib /opt/nemo-speech/lib
COPY --from=engine /opt/nemo-speech/share/licenses /opt/nemo-speech/share/licenses
COPY --from=models /models /models
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY LICENSES.md /licenses/LICENSES.md
ENV NODE_ENV=production \
    PORT=8080 \
    MODELS_DIR=/models \
    NEMO_VOICE_BIN=/opt/nemo-speech/bin/nemo-voice \
    SILERO_VAD_MODEL=/models/silero_vad.onnx \
    CPU_LEVEL=${CPU_LEVEL}
# Every library the engine needs is here (running it waits for a CPU with the instructions it was built for).
RUN ! ldd /opt/nemo-speech/bin/nemo-voice /opt/nemo-speech/lib/*.so* | grep "not found"
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.ts"]
