# Third-party software and models in the speech server image

| Component | What it does here | License |
| - | - | - |
| [NVIDIA NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) 0.2.0 (release archive, with its inverse text normalization grammars) | Runs the speech models | Apache License 2.0. Its own notices ship in the image under `/opt/nemo-speech/share/licenses/`. |
| [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), Q8_0 GGUF published for NeMo-Speech.cpp | Speech recognition: "detect it" and 25 European languages | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Model by NVIDIA; unmodified. |
| [NVIDIA Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b), Q8_0 GGUF | Speech recognition: Japanese, Chinese, Korean, Hindi, Arabic, Vietnamese, Turkish, Norwegian | [NVIDIA Open Model License (OpenMDW 1.1)](https://openmdw.ai/license/1-1/). Model by NVIDIA; unmodified. |
| [FFmpeg](https://ffmpeg.org/) (Debian bookworm package) | Turns recordings into 16 kHz WAV | LGPL 2.1+ / GPL 2+ (Debian's build). Source: `apt-get source ffmpeg`. |
| [Node.js](https://nodejs.org/) 22 (official `node:22-bookworm-slim` image) | Runs `server.mjs` | MIT |
| [tini](https://github.com/krallin/tini) (Debian package) | PID 1: forwards signals, reaps children | MIT |

Attribution for the models, as shown to people who use Build-a-bot's voice typing and meeting notes:
"Speech recognition by NVIDIA Parakeet TDT 0.6B v3 (CC BY 4.0) and NVIDIA Nemotron 3.5 ASR (OpenMDW 1.1)."
