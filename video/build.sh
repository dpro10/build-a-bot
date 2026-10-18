#!/usr/bin/env bash
# Builds the promo end to end (video/README.md): assets, sound, picture, then the MP4.
set -euo pipefail
cd "$(dirname "$0")/.."

npx tsx video/scripts/export-assets.tsx
node video/scripts/render.mjs events
python3 video/audio/music.py
python3 video/audio/sfx.py
python3 video/audio/mix.py
python3 video/audio/mix.py --no-vo
python3 video/audio/captions.py
node video/scripts/render.mjs video --fps 60 --out video/out/final-frames.mkv

# H.264 High for YouTube and the web: BT.709 colors, a keyframe every 2 s, the moov atom first.
mux() {
  ffmpeg -v error -y -i video/out/final-frames.mkv -i "$1" \
    -map 0:v -map 1:a -c:v libx264 -preset slow -crf 16 -profile:v high -level 4.2 -g 120 -bf 2 \
    -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
    -c:a aac -b:a 320k -ar 48000 -movflags +faststart -shortest "$2"
}
mux video/audio/build/mix.wav video/out/build-a-bot-promo.mp4
mux video/audio/build/mix-novo.wav video/out/build-a-bot-promo-music-only.mp4
echo "video/out/build-a-bot-promo.mp4"
