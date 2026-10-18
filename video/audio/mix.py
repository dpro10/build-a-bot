"""
Mixes the promo's soundtrack: the voice-over lines at their cues (video/timeline.json), the score
ducked under the voice (deeper in the presence band, so the words stay clear without the music
dropping out), the interface sounds, a short room on the voice, then -14 LUFS integrated for
YouTube with true peaks under -1 dBTP.

  python3 video/audio/mix.py [--no-vo]   -> video/audio/build/mix.wav (or mix-novo.wav)
"""
import json
import os
import subprocess
import sys

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, os.path.dirname(__file__))
from synth import SR, bandpass, envelope_follow, highpass, limiter, lowpass, make_room, reverb, secs  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TL = json.load(open(os.path.join(ROOT, "timeline.json")))
END = TL["duration"]


def read_audio(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


def fit(x, n):
    out = np.zeros((2, n))
    m = min(n, x.shape[1])
    out[:, :m] = x[:, :m]
    return out


def lufs(x):
    path = os.path.join(HERE, "build", "_measure.wav")
    wavfile.write(path, SR, x.T.astype(np.float32))
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    os.remove(path)
    i = float([l for l in err.splitlines() if l.strip().startswith("I:")][-1].split()[1])
    tp = float([l for l in err.splitlines() if l.strip().startswith("Peak:")][-1].split()[1])
    return i, tp


def main(with_vo=True):
    n = int(END * SR)
    music = fit(read_audio(os.path.join(HERE, "build", "music.wav")), n)
    sfx = fit(read_audio(os.path.join(HERE, "build", "sfx.wav")), n)

    vo = np.zeros((2, n))
    if with_vo:
        for line, start in TL["vo"].items():
            x = read_audio(os.path.join(HERE, "vo", f"{line}.flac"))
            i = int(start * SR)
            m = min(x.shape[1], n - i)
            vo[:, i:i + m] += x[:, :m]
        # A short, bright room, so the voice sits in the same space as the music.
        room = make_room(0.7, 1.0, predelay=0.012, width=0.6)
        vo = vo + 0.07 * reverb(highpass(vo, 400), room)

    # How much the voice is talking, smoothed: 0 (silent) to 1 (speaking).
    env = envelope_follow(vo, attack=0.03, release=0.35)
    dbv = 20 * np.log10(np.maximum(env, 1e-6))
    duck = np.clip((dbv + 42) / 14, 0, 1)
    mid = bandpass(music, 650, 4800)
    rest = music - mid
    music_d = rest * (1 - 0.48 * duck) + mid * (1 - 0.72 * duck)

    mix = 1.0 * vo + 0.62 * music_d + 0.42 * sfx
    mix = highpass(mix, 25)
    # Ease out the last second of the end card.
    t = secs(n)
    mix *= np.clip((END - t) / 1.1, 0, 1) ** 1.5
    mix[:, : int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))

    # Loudness: -14 LUFS integrated, limited so true peaks stay under -1 dBTP.
    target = -14.0
    for _ in range(3):
        i, tp = lufs(mix)
        mix *= 10 ** ((target - i) / 20)
        mix = limiter(mix, -1.6, 0.004, 0.09)
    i, tp = lufs(mix)
    name = "mix.wav" if with_vo else "mix-novo.wav"
    wavfile.write(os.path.join(HERE, "build", name), SR, mix.T.astype(np.float32))
    print(f"{name}: {i:.1f} LUFS integrated, true peak {tp:.1f} dBTP, {n / SR:.1f} s")


if __name__ == "__main__":
    main(with_vo="--no-vo" not in sys.argv)
