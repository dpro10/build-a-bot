"""
Interface sounds for the promo, synthesized and placed on the moments the stage reports
(video/out/events.json, from `node video/scripts/render.mjs events`): avatar pops, memory chimes,
clicks, card flips, data packets. Pitched to the score (F major), quiet enough to sit under the voice.

  python3 video/audio/sfx.py   -> video/audio/build/sfx.wav
"""
import json
import os
import sys

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, os.path.dirname(__file__))
from synth import SR, RNG, bandpass, highpass, lowpass, midi_hz, moving_bandpass, noise, pan, secs  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TL = json.load(open(os.path.join(ROOT, "timeline.json")))
EVENTS = json.load(open(os.path.join(ROOT, "out", "events.json")))

PENTA = [72, 74, 77, 79, 81, 84, 86, 89]  # F major pentatonic from C5


def env(n, a, d):
    t = secs(n)
    return np.minimum(t / max(a, 1e-5), 1.0) * np.exp(-t / d)


def bell(m, dur=1.2, vel=0.5):
    n = int(dur * SR)
    t = secs(n)
    f = float(midi_hz(m))
    parts = [(1.0, 1.0, 1.0), (2.0, 0.4, 0.6), (3.0, 0.18, 0.4), (4.2, 0.08, 0.25), (6.8, 0.04, 0.15)]
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (dur * 0.35 * d)) for r, a, d in parts)
    return x * np.minimum(t / 0.0015, 1) * vel


def pop(p=0, soft=False):
    n = int(0.22 * SR)
    t = secs(n)
    base = float(midi_hz(PENTA[p % len(PENTA)] - 12))
    f = base * (0.55 + 0.45 * (1 - np.exp(-t / 0.018))) * (1 + 0.6 * np.exp(-t / 0.01))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.06)
    click = highpass(noise(n), 3000) * env(n, 0.0005, 0.004) * 0.15
    x = (body + click) * (0.45 if soft else 0.7)
    return x


def tick(p=0):
    n = int(0.12 * SR)
    t = secs(n)
    f = float(midi_hz(PENTA[(p + 2) % len(PENTA)] + 12))
    x = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 1.5 * t)) * env(n, 0.001, 0.028)
    return x * 0.35


def send():
    n = int(0.3 * SR)
    t = secs(n)
    center = 500 * (6 ** (t / 0.18))
    w = moving_bandpass(noise(n), np.minimum(center, 7000), q=2.0) * np.sin(np.pi * np.clip(t / 0.2, 0, 1)) * 0.5
    return w * 0.35


def chime(p=0):
    x = bell(PENTA[p % len(PENTA)] + 12, 1.3, 0.32)
    hi = bell(PENTA[p % len(PENTA)] + 24, 0.8, 0.12)
    x[: len(hi)] += 0.4 * hi
    return x


def count():
    out = np.zeros(int(1.1 * SR))
    # A riffle of tiny ticks, fast in the middle.
    times = np.cumsum(0.02 + 0.06 * (np.linspace(-1, 1, 22) ** 2))
    times = times / times[-1] * 0.95
    for k, tt in enumerate(times):
        x = tick(k % 5) * 0.35
        i = int(tt * SR)
        out[i:i + len(x)] += x[: len(out) - i]
    return out


def sparkle(p=0):
    out = np.zeros(int(1.0 * SR))
    for k in range(8):
        m = PENTA[(k + 3 * p) % len(PENTA)] + 24
        x = bell(m, 0.5, 0.1 * (1 - k / 10))
        i = int((k * 0.045) * SR)
        out[i:i + len(x)] += x[: len(out) - i]
    return out


def click():
    n = int(0.06 * SR)
    t = secs(n)
    snap = bandpass(noise(n), 1800, 5200) * env(n, 0.0004, 0.006)
    body = np.sin(2 * np.pi * 220 * t) * env(n, 0.001, 0.01) * 0.4
    return (snap + body) * 0.45


def type_():
    n = int(0.05 * SR)
    snap = bandpass(noise(n), 1200, 4200) * env(n, 0.0005, 0.008)
    return snap * 0.22


def whoosh(soft=False):
    n = int(0.55 * SR)
    t = secs(n)
    p = t / (n / SR)
    w = moving_bandpass(noise(n), 400 * (8 ** np.sin(p * np.pi * 0.9)), q=1.4)
    a = np.sin(np.pi * p) ** 2
    return np.stack([w * a * (1 - p * 0.6), w * a * (0.4 + p * 0.6)]) * (0.22 if soft else 0.35)


def poof():
    n = int(0.45 * SR)
    t = secs(n)
    w = moving_bandpass(noise(n), 3200 * (0.2 ** (t / 0.3)), q=1.1)
    a = env(n, 0.004, 0.12)
    return w * a * 0.5 + 0.25 * sparkle(1)[:n] * np.exp(-t / 0.2)


def stamp(p=0):
    n = int(0.9 * SR)
    t = secs(n)
    f = 80 + 70 * np.exp(-t / 0.03)
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.07) * 0.6
    snap = bandpass(noise(n), 1500, 6000) * env(n, 0.0005, 0.01) * 0.25
    ding = bell(81 + 2 * p, 0.9, 0.18)[:n]
    return thump + snap + ding


def flip(p=0, fast=False):
    n = int(0.16 * SR)
    t = secs(n)
    flick = bandpass(noise(n), 2500, 7500) * env(n, 0.001, 0.012 if fast else 0.02)
    m = PENTA[p % len(PENTA)] + (12 if fast else 0)
    tone = np.sin(2 * np.pi * float(midi_hz(m)) * t) * env(n, 0.002, 0.03 if fast else 0.05) * 0.3
    return (flick * 0.6 + tone) * (0.22 if fast else 0.36)


def kept():
    out = np.zeros(int(1.6 * SR))
    for k, m in enumerate((84, 91, 96)):
        x = bell(m, 1.3, 0.22 - 0.04 * k)
        i = int(k * 0.09 * SR)
        out[i:i + len(x)] += x[: len(out) - i]
    return out


def zip_(p=0):
    n = int(0.42 * SR)
    t = secs(n)
    q = t / (n / SR)
    f = (500 * 3 ** q) if p == 0 else (1500 / 2.5 ** q)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * q) ** 1.5 * 0.18
    w = moving_bandpass(noise(n), f * 2, q=3) * np.sin(np.pi * q) * 0.12
    s = x + w
    return np.stack([s * (0.8 - 0.4 * q), s * (0.4 + 0.4 * q)]) if p == 0 else np.stack([s * (0.4 + 0.4 * q), s * (0.8 - 0.4 * q)])


def dissolve():
    n = int(0.9 * SR)
    out = np.zeros(n)
    for k in range(70):
        g = int((RNG.random() ** 1.6) * 0.75 * SR)
        L = int(0.012 * SR)
        grain = highpass(noise(L), 4000) * np.hanning(L) * 0.12 * (1 - g / n)
        out[g:g + L] += grain[: n - g]
    return np.stack([out * 0.4, out * 0.9])


def blip():
    out = np.zeros(int(0.5 * SR))
    for k, m in enumerate((88, 93)):
        x = bell(m, 0.4, 0.16)
        i = int(k * 0.07 * SR)
        out[i:i + len(x)] += x[: len(out) - i]
    return out


def place(buf, t, x, gain=1.0, p=0.0):
    x = np.atleast_2d(x)
    if x.shape[0] == 1:
        x = pan(x[0], p)
    i = int(t * SR)
    n = min(x.shape[1], buf.shape[1] - i)
    if n > 0:
        buf[:, i:i + n] += x[:, :n] * gain


def main():
    buf = np.zeros((2, int((TL["duration"] + 3) * SR)))
    for e in EVENTS:
        k, t, p = e["type"], e["t"], e.get("p", 0)
        if k == "pop":
            place(buf, t, pop(p, e.get("soft")), 1.0, [0, -0.35, 0.35, -0.6, 0.6, 0, 0, 0][p % 8])
        elif k == "tick":
            place(buf, t, tick(p), 1.0, -0.3 + 0.15 * p)
        elif k == "send":
            place(buf, t, send(), 1.0, 0.45)
        elif k == "chime":
            place(buf, t, chime(p), 1.0, -0.45)
        elif k == "count":
            place(buf, t, count(), 0.8, -0.45)
        elif k == "sparkle":
            place(buf, t, sparkle(p), 1.0, 0.0)
        elif k == "click":
            place(buf, t, click(), 1.0, -0.2)
        elif k == "type":
            place(buf, t, type_(), 1.0, -0.2)
        elif k == "whoosh":
            place(buf, t, whoosh(e.get("soft")), 1.0)
        elif k == "poof":
            place(buf, t, poof(), 1.0, -0.3)
        elif k == "stamp":
            place(buf, t, stamp(p), 1.0, 0.35)
        elif k == "flip":
            # A touch early and soft: it shouldn't land on top of the word it illustrates.
            place(buf, t - 0.06, flip(p, e.get("fast")), 0.8, 0.0)
        elif k == "kept":
            place(buf, t, kept(), 1.0, 0.0)
        elif k == "zip":
            place(buf, t, zip_(p), 1.0)
        elif k == "dissolve":
            place(buf, t, dissolve(), 1.0)
        elif k == "blip":
            place(buf, t, blip(), 1.0, 0.0)
    buf = lowpass(highpass(buf, 120), 15000)
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    wavfile.write(os.path.join(HERE, "build", "sfx.wav"), SR, buf.T.astype(np.float32))
    print(f"sfx: {len(EVENTS)} events, peak {np.abs(buf).max():.2f}")


if __name__ == "__main__":
    main()
