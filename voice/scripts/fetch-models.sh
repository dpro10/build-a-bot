#!/usr/bin/env bash
# Fetches the voice server's models into DEST, each pinned by revision and checked by SHA-256, and
# makes Magpie's Q8_0 GGUF (magpie-q8.py). Used by the Dockerfile and by CI's real-models job.
#
#   voice/scripts/fetch-models.sh DEST
#
# DEST/parakeet-tdt-0.6b-v3.q8_0.gguf                 NVIDIA Parakeet TDT 0.6B v3: hears the caller
# DEST/silero_vad.onnx                                 Silero VAD v6.2.0: when someone is talking
# DEST/magpie/magpie_tts_multilingual_357m.v2607.q8_0.gguf, its NanoCodec decoder and tokenizer/
#                                                      NVIDIA Magpie TTS: the bot's voice
#
# Magpie's files are the ones `nemo-speech pull magpie` gets (NeMo-Speech.cpp v0.2.0's
# models/index.json), fetched without running NVIDIA's binary, so a build for one CPU can run
# anywhere. One exception: Magpie's GGUF is NVIDIA's next revision (2026-10-15). Its weights are
# byte for byte the same, but the one v0.2.0 pins names its voices in the wrong order (John, Sofia,
# Aria, Jason, Leo for what are Aria, Jason, John, Leo and Sofia, as the checkpoint's own
# speakers.json says), so asking for one voice got another. Needs curl, tar, sha256sum and python3
# (with venv).
set -euo pipefail

DEST="${1:?usage: fetch-models.sh DEST}"
HERE="$(cd "$(dirname "$0")" && pwd)"
HF=https://huggingface.co

PARAKEET_REVISION=541d1f99c6b0c3cd0b11a95167540bb8edefd82b
PARAKEET_SHA256=e3880d0aaaaf2c308ea2c35016b2b895c423eb3fda924c1b463d1c19b7f4d32e
SILERO_WHEEL=https://files.pythonhosted.org/packages/9e/76/12cbd574562511a8914731436b6c584112186bb6bf149e9f952af4940146/silero_vad-6.2.0-py3-none-any.whl
SILERO_WHEEL_SHA256=8a31f1e58e73cdc20820d842f757e678e0ae1b0ee1cb7b8aa50f20f8fd7f7638
SILERO_ONNX_SHA256=1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3
# The .nemo (where the tokenizer comes from) is the same file in this revision as in v0.2.0's.
MAGPIE_REVISION=446bff55e1fe3d3aa29c771574e7d2b0fa322990
MAGPIE_F16_SHA256=fb8e9297138dcc7b5fc51332f361e3cddfd433d4e0bc1d87e16e6aed21f618fc
# What magpie-q8.py makes of it (the conversion is exact, so the result is always this file).
MAGPIE_Q8_SHA256=5dcf54ce2f078322b0d3e9d1a97f9ddbf666fe1a655ce73f1e75daa70135b8f7
CODEC_REVISION=fc00890b604aa2de298d2641ffc6c5f6caf8c4d7
CODEC_SHA256=cc86d36d821a27cdc1d4ef600a3e2b0dabe76e88fcc2a8652d9543134c07ef2d
# The tokenizer is inside the 1.5 GB .nemo (a tar): its first 20.6 MB and its last 10.5 MB, around
# the model weights, which aren't needed (the weights are in the GGUF).
TOKENIZER_HEAD=0-20619263
TOKENIZER_TAIL=1459750400-1470207999
TOKENIZER_SHA256=169144a64f6d775178696914e5aad8282db44820e73341d5f9a4e7865fac1f26

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
get() { curl -fsSL --retry 5 --retry-all-errors --connect-timeout 30 "$@"; }
check() { echo "$1  $2" | sha256sum -c --quiet -; }

mkdir -p "$DEST/magpie/tokenizer"

echo "== Parakeet"
get -o "$DEST/parakeet-tdt-0.6b-v3.q8_0.gguf" "$HF/nvidia/parakeet-tdt-0.6b-v3/resolve/$PARAKEET_REVISION/parakeet-tdt-0.6b-v3.q8_0.gguf"
check "$PARAKEET_SHA256" "$DEST/parakeet-tdt-0.6b-v3.q8_0.gguf"

echo "== Silero VAD"
get -o "$TMP/silero.whl" "$SILERO_WHEEL"
check "$SILERO_WHEEL_SHA256" "$TMP/silero.whl"
python3 -I -c "import sys, zipfile; open(sys.argv[2], 'wb').write(zipfile.ZipFile(sys.argv[1]).read('silero_vad/data/silero_vad.onnx'))" "$TMP/silero.whl" "$DEST/silero_vad.onnx"
check "$SILERO_ONNX_SHA256" "$DEST/silero_vad.onnx"

echo "== Magpie's codec"
get -o "$DEST/magpie/nemo_nano_codec_22khz_1.89kbps_21.5fps.decoder.f16.gguf" "$HF/nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps/resolve/$CODEC_REVISION/nemo_nano_codec_22khz_1.89kbps_21.5fps.decoder.f16.gguf"
check "$CODEC_SHA256" "$DEST/magpie/nemo_nano_codec_22khz_1.89kbps_21.5fps.decoder.f16.gguf"

echo "== Magpie's tokenizer"
NEMO="$HF/nvidia/magpie_tts_multilingual_357m/resolve/$MAGPIE_REVISION/magpie_tts_multilingual_357m.nemo"
get -r "$TOKENIZER_HEAD" -o "$TMP/nemo.tar" "$NEMO"
get -r "$TOKENIZER_TAIL" -o "$TMP/nemo.tail" "$NEMO"
cat "$TMP/nemo.tar" "$TMP/nemo.tail" | sha256sum | grep -q "^$TOKENIZER_SHA256 " || { echo "Magpie's tokenizer doesn't match its SHA-256" >&2; exit 1; }
# Put the tail back where it sits in the .nemo, leaving a hole (no disk used) for the weights, then
# unpack: later copies of a file in the tar replace earlier ones, as NVIDIA's pull does.
dd if="$TMP/nemo.tail" of="$TMP/nemo.tar" bs=512 seek=$((${TOKENIZER_TAIL%-*} / 512)) conv=notrunc status=none
# (The tar's own folder is private to its owner: keep ours, so the server's user can read it.)
tar -xf "$TMP/nemo.tar" -C "$DEST/magpie/tokenizer" --exclude=./model_weights.ckpt --no-same-owner --no-same-permissions --no-overwrite-dir
(
  cd "$DEST/magpie/tokenizer"
  sha256sum -c --quiet - <<'SUMS'
6492abc404db16bbad83dd9d7f9a60eb617699f0a3ff54b3be6184e14507b745  05adc40366e149b69319acd4b28a4919_pt_br_prondict-v1.0.dict
3b50cc2c21cd8d34983d8492c91308e9db4a58c1194d6506fdbb2b97aead75fc  339da71c54b046f98cbcf38ef6d4ff67_hindi_phoneme_merged_phoneme_dict.dict
36cdcf01ebc0afb506660ac71f2d0a211236374ad5c872d7d8d985a3f9f6ccaf  41913ebaa70342058574da74293b7630_magpie_tts_multilingual_357m.nemo.speakers.json
b701909aedf753172eff223950f8859cd4b9b4c80199cf0a6e9ac4a307c8f8ec  61d57a4ccb064d1e8e3d9f871c571932_heteronyms-052722
252e8eaf60dfd891520759913dc8534393eebfa8d57192365f76f9229f294e9e  74b3e832fe914a569fcd42b51d06b2f1_ipa_dict_nv23.05.txt
94c9a25bb359f733cd863c887d0112e7ae19a744b0333ef64b6a88e576428669  7dbc31751f224f2486090d59dc95b9f7_es_ES_nv230301.dict
771cc585a574fd35bd14f4ce6108edf1e0e512a8dbc810db7de4c1165ba9d0ef  c5e4ec2af5a14ce294f4b9edcc936535_de_nv230119.heteronym
5c7bbf3346ebd6dc57769b5cc805124215cb1bcc3b8174c4254e9e928c5d6094  cf01ab5c48c84f3282ef7888263361e5_de_nv230119.dict
7ea5c4c2c59cc780748b24d4ab60bd689779c4ac4ea7e27c0a8c3e20f300c0fa  dc7d60d6b15a4651b21c9ca2932b62c6_ipa_cmudict-0.7b_nv23.01.txt
9577bfa4769981849feccd6a54d38425d81fff41ac16c282f60be97faf46ebe4  model_config.yaml
SUMS
)

echo "== Magpie, requantized to Q8_0"
get -o "$TMP/magpie.f16.gguf" "$HF/nvidia/magpie_tts_multilingual_357m/resolve/$MAGPIE_REVISION/magpie_tts_multilingual_357m.v2607.f16.gguf"
check "$MAGPIE_F16_SHA256" "$TMP/magpie.f16.gguf"
python3 -m venv "$TMP/venv"
"$TMP/venv/bin/pip" install --quiet --no-cache-dir --disable-pip-version-check "gguf==0.17.1" "numpy==2.2.6"
"$TMP/venv/bin/python" -I "$HERE/magpie-q8.py" "$TMP/magpie.f16.gguf" "$DEST/magpie/magpie_tts_multilingual_357m.v2607.q8_0.gguf"
check "$MAGPIE_Q8_SHA256" "$DEST/magpie/magpie_tts_multilingual_357m.v2607.q8_0.gguf"

# Readable by whoever runs the server (the container's user isn't the one that fetched them).
chmod -R a+rX "$DEST"
find "$DEST" -type f -exec ls -l {} + | awk '{print $5, $9}'
