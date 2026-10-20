#!/usr/bin/env bash
# Builds native/macos/build/bab-audio-helper, a universal (arm64 + x86_64) binary.
# Needs a Mac with Xcode 15.4+ (the macOS 14.5 SDK has the Core Audio process-object
# and tap APIs). Runs on macOS 13+; per-app mic info needs macOS 14, the tap 14.2.
#
#   bash native/macos/build.sh                      # ad-hoc signed, for local runs
#   BAB_CODESIGN_IDENTITY="Developer ID Application: …" bash native/macos/build.sh
#
# electron-builder copies the result into the app (extraResources → Resources/bin/),
# where the app looks for it. Without it, call detection on macOS falls back to
# process names (limited).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
for arch in arm64 x86_64; do
  xcrun swiftc -O -swift-version 5 -target "${arch}-apple-macos13.0" \
    -framework CoreAudio -framework AppKit -framework ApplicationServices \
    -o "build/bab-audio-helper-${arch}" BabAudioHelper.swift
done
lipo -create -output build/bab-audio-helper build/bab-audio-helper-arm64 build/bab-audio-helper-x86_64
rm -f build/bab-audio-helper-arm64 build/bab-audio-helper-x86_64
# Hardened runtime so it can ship inside a notarized app; "-" signs ad hoc.
codesign --force --options runtime --timestamp=none --sign "${BAB_CODESIGN_IDENTITY:--}" build/bab-audio-helper
./build/bab-audio-helper mic >/dev/null && echo "built native/macos/build/bab-audio-helper"
