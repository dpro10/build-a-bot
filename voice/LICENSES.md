# Third-party software and models in the voice server image

| Component | What it does here | License |
| - | - | - |
| [NVIDIA NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) 0.2.0, built from source (with [ggml](https://github.com/ggml-org/ggml) from llama.cpp and [cpp-httplib](https://github.com/yhirose/cpp-httplib)) | Runs the speech models; `nemo-voice` (ours) drives it through its C API | Apache License 2.0 (ggml, cpp-httplib: MIT). Their notices ship in the image under `/opt/nemo-speech/share/licenses/`. |
| [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), Q8_0 GGUF published for NeMo-Speech.cpp | Hears what callers say | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Model by NVIDIA; unmodified. |
| [NVIDIA MagpieTTS Multilingual 357M](https://huggingface.co/nvidia/magpie_tts_multilingual_357m) v2607 | Speaks the bot's replies | [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/). Model by NVIDIA; its GGUF requantized to Q8_0 here (scripts/magpie-q8.py), as NVIDIA's own converter does. |
| [NVIDIA NeMo NanoCodec](https://huggingface.co/nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps) 22 kHz decoder | Turns Magpie's codes into audio | NVIDIA Open Model License. Model by NVIDIA; unmodified. |
| [Silero VAD](https://github.com/snakers4/silero-vad) 6.2.0 (ONNX model from its PyPI wheel) | Hears when someone is talking | MIT |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) (`onnxruntime-node`) | Runs Silero VAD | MIT |
| [ws](https://github.com/websockets/ws) | WebSockets for calls | MIT |
| [SentencePiece](https://github.com/google/sentencepiece) (Debian package) | Tokenizer library the engine links | Apache License 2.0 |
| [Node.js](https://nodejs.org/) 22 (official `node:22-bookworm-slim` image) | Runs the server | MIT |
| [tini](https://github.com/krallin/tini) (Debian package) | PID 1: forwards signals, reaps children | MIT |

The talker, NVIDIA Nemotron 3.5 Lightning, isn't in the image: it runs on Nebius Token Factory.

Attribution for the models, as shown to people who call their bots:
"Speech by NVIDIA Parakeet TDT 0.6B v3 (CC BY 4.0) and NVIDIA MagpieTTS Multilingual (NVIDIA Open Model License)."
