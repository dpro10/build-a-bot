"""
The promo's original score: warm, modern and hopeful, in F major at 96 BPM, one bar per 2.5 seconds,
so every scene change in video/timeline.json lands on a downbeat. Rendered from scratch with
video/audio/synth.py (no samples, no loops, nothing copyrighted).

  python3 video/audio/music.py            -> video/audio/build/music.wav (+ stems)

Arc: a dark, curious intro (the question) -> a bright reveal with the first kick -> a groove that
builds while the bot learns -> steady under "own your data" -> the brightest, busiest part for
"own your intelligence" -> a hushed breakdown for zero data retention -> the theme returns, full, for
the end card, resolving on Fmaj9.
"""
import json
import os
import sys

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, os.path.dirname(__file__))
from synth import (SR, RNG, adsr, bandpass, fade, highpass, limiter, lowpass, make_room, midi_hz, moving_bandpass,  # noqa: E402
                   moving_lowpass, noise, pan, peaking, perc, pingpong, reverb, saw, secs, shelf, sine, soft_clip)

HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, "..", "timeline.json")))
BPM = TL["bpm"]
BEAT = 60.0 / BPM
BAR = 4 * BEAT
DUR = TL["duration"] + 2.5  # room for the last chord's tail

# ---------------------------------------------------------------- harmony
# Voicings (MIDI). Pads take the whole chord; the arp takes the upper notes; the bass the root.
CH = {
    "Dm9": ([50, 53, 57, 60, 64], 38),
    "Bbmaj7": ([46, 53, 57, 62, 65], 34),
    "Fadd9": ([53, 57, 60, 67, 69], 41),
    "C/E": ([52, 55, 60, 64, 67], 40),
    "Bbmaj9": ([50, 53, 57, 60, 65], 34),
    "F/A": ([53, 57, 60, 65, 69], 45),
    "Gm9": ([50, 53, 57, 58, 62], 43),
    "Csus4": ([53, 55, 60, 65, 67], 36),
    "C": ([52, 55, 60, 64, 67], 36),
    "Am7": ([52, 55, 57, 60, 64], 45),
    "Dm7": ([50, 53, 57, 60, 65], 38),
    "Bbmaj7#11": ([52, 53, 57, 62, 64], 34),
    "C69": ([50, 55, 57, 62, 64], 36),
    "Fmaj9": ([52, 55, 57, 60, 64], 41),
}

# One chord per bar, 24 bars (60 s). Section names match timeline.json scenes.
PROG = [
    # hook (0-5 s)
    ("Dm9", "hook"), ("Bbmaj7", "hook"),
    # reveal (5-10 s)
    ("Fadd9", "reveal"), ("C/E", "reveal"),
    # smarter (10-22.5 s)
    ("Bbmaj9", "smarter"), ("F/A", "smarter"), ("Gm9", "smarter"), ("Csus4", "smarter"), ("Dm7", "smarter"),
    # data (22.5-32.5 s)
    ("Bbmaj9", "data"), ("C", "data"), ("Am7", "data"), ("Dm9", "data"),
    # intelligence (32.5-45 s)
    ("Gm9", "intelligence"), ("Bbmaj9", "intelligence"), ("F/A", "intelligence"), ("Csus4", "intelligence"), ("C", "intelligence"),
    # zdr (45-52.5 s)
    ("Dm9", "zdr"), ("Bbmaj7#11", "zdr"), ("Csus4", "zdr"),
    # cta (52.5-60 s)
    ("Bbmaj9", "cta"), ("C69", "cta"), ("Fmaj9", "cta"),
]
assert abs(len(PROG) * BAR - TL["musicEnd"]) < 1e-6, "24 bars must end where the timeline says the music ends"

# The theme, two bars: (beat, midi, beats). Chord tones of Dm9 then Bbmaj9, and of F then C.
THEME_A = [(0.0, 72, 1.0), (1.0, 69, 0.5), (1.5, 77, 1.5), (3.0, 76, 1.0)]
THEME_B = [(0.0, 74, 1.0), (1.0, 72, 0.5), (1.5, 69, 1.0), (2.5, 72, 1.5)]
THEME_END = [(0.0, 72, 1.0), (1.0, 74, 0.5), (1.5, 76, 1.0), (2.5, 77, 3.5)]


def bar_t(i):
    return i * BAR


class Track:
    def __init__(self, name):
        self.name = name
        self.x = np.zeros((2, int(DUR * SR)))

    def add(self, t, sig, gain=1.0):
        sig = np.atleast_2d(sig)
        if sig.shape[0] == 1:
            sig = np.vstack([sig, sig]) * np.sqrt(0.5)
        i = int(round(t * SR))
        if i >= self.x.shape[1]:
            return
        n = min(sig.shape[1], self.x.shape[1] - i)
        self.x[:, i:i + n] += sig[:, :n] * gain


# ---------------------------------------------------------------- instruments

def pad_chord(notes, dur, cutoff, att=0.9, rel=1.8, air=0.0):
    n = int((dur + rel) * SR)
    t = secs(n)
    out = np.zeros((2, n))
    for k, m in enumerate(notes):
        f0 = float(midi_hz(m))
        for j, cents in enumerate((-13, -5, 0, 6, 12)):
            drift = 1 + 0.0015 * np.sin(2 * np.pi * (0.11 + 0.05 * j + 0.03 * k) * t + RNG.random() * 6.28)
            s = saw(np.full(n, f0 * 2 ** (cents / 1200)) * drift)
            out += pan(s, ((j / 4) * 2 - 1) * 0.8)
        # A sine an octave down under the lowest note, for warmth.
        if k == 0:
            out += pan(sine(np.full(n, f0 / 2)) * 0.55, 0)
    out /= 5 * len(notes)
    out = moving_lowpass(out, np.full(n, cutoff), q=0.6)
    out = lowpass(out, cutoff * 1.6)
    if air:
        out += air * highpass(out, 5000)
    env = adsr(n, att, 0.8, 0.9, dur, rel)
    return out * env


def keys_note(m, dur, vel=0.7):
    """Felt electric piano: FM body with a short bell-like tine."""
    n = int((dur + 1.6) * SR)
    t = secs(n)
    f = float(midi_hz(m))
    index = 1.5 * np.exp(-t / 0.3) + 0.2
    body = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t))
    tine = 0.22 * np.sin(2 * np.pi * f * 7.0 * t) * np.exp(-t / 0.045)
    warm = 0.3 * np.sin(2 * np.pi * f * 0.5 * t) * np.exp(-t / 0.6)
    env = np.minimum(t / 0.003, 1) * np.exp(-t / 1.6)
    rel = np.clip((t - dur) / 0.5, 0, 1)
    env *= (1 - rel) ** 2
    x = (body + tine + warm) * env * vel
    x = lowpass(x, 4200)
    return pan(x, (m - 72) / 18)


def pluck(m, vel=0.6, bright=3600, decay=0.16):
    n = int(0.7 * SR)
    t = secs(n)
    f = float(midi_hz(m))
    s = 0.6 * saw(np.full(n, f)) + 0.4 * saw(np.full(n, f * 1.004))
    cut = 380 + bright * np.exp(-t / 0.07)
    y = moving_lowpass(s, cut, q=1.1, block=64)
    env = np.minimum(t / 0.002, 1) * np.exp(-t / decay)
    return fade(y * env * vel, 0.001, 0.05)


def bass_note(m, dur, vel=0.9):
    n = int((dur + 0.15) * SR)
    t = secs(n)
    f = float(midi_hz(m))
    x = np.sin(2 * np.pi * f * t) + 0.22 * np.sin(2 * np.pi * 2 * f * t) + 0.06 * np.sin(2 * np.pi * 3 * f * t)
    x = soft_clip(x * 0.9, 1.6)
    env = np.minimum(t / 0.006, 1) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.05))
    return lowpass(x * env * vel, 900)


def kick(vel=1.0):
    n = int(0.55 * SR)
    t = secs(n)
    f = 44 + 100 * np.exp(-t / 0.042)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3)
    click = highpass(noise(n), 2500) * np.exp(-t / 0.0035) * 0.22
    return soft_clip((body + click) * vel, 1.5)


def clap(vel=0.7):
    n = int(0.45 * SR)
    t = secs(n)
    w = bandpass(noise(n), 900, 3200)
    env = np.zeros(n)
    for k, t0 in enumerate((0.0, 0.009, 0.019)):
        env += np.where(t >= t0, np.exp(-(t - t0) / 0.005), 0) * (0.8 + 0.1 * k)
    env += np.where(t >= 0.022, np.exp(-(t - 0.022) / 0.1), 0) * 0.55
    return w * env * vel * 0.6


def hat(vel=0.4, open_=False):
    n = int((0.35 if open_ else 0.09) * SR)
    t = secs(n)
    w = highpass(noise(n), 7200, 3) + 0.4 * bandpass(noise(n), 9000, 13000)
    return w * np.exp(-t / (0.16 if open_ else 0.028)) * vel * 0.6


def shaker(vel=0.25):
    n = int(0.12 * SR)
    t = secs(n)
    w = bandpass(noise(n), 4500, 9500)
    env = np.minimum(t / 0.012, 1) * np.exp(-t / 0.045)
    return w * env * vel * 0.4


def riser(dur, vel=0.5, lo=300, hi=9000):
    n = int(dur * SR)
    t = secs(n)
    p = t / dur
    center = lo * (hi / lo) ** (p ** 1.6)
    w = moving_bandpass(noise(n), center, q=1.6)
    tone = sine(220 * 2 ** (p * 1.0)) * 0.08
    x = (w + tone) * (p ** 2.2) * vel
    return np.stack([x * (0.8 + 0.2 * np.sin(p * 9)), x * (0.8 + 0.2 * np.cos(p * 9))])


def downlifter(dur, vel=0.4):
    x = riser(dur, vel)[:, ::-1]
    return x


def impact(vel=1.0):
    n = int(2.6 * SR)
    t = secs(n)
    f = 32 + 55 * np.exp(-t / 0.18)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    thump = lowpass(noise(n), 900) * np.exp(-t / 0.12) * 0.5
    air = highpass(noise(n), 3000) * np.exp(-t / 0.5) * 0.12
    x = soft_clip((sub + thump) * vel, 1.3)
    return np.stack([x + air * 0.9, x + air * 1.1 * -1])


def bell(m, vel=0.4, decay=2.2):
    n = int((decay * 1.6) * SR)
    t = secs(n)
    f = float(midi_hz(m))
    parts = [(1.0, 1.0, 1.0), (2.0, 0.45, 0.7), (2.76, 0.3, 0.45), (5.4, 0.12, 0.25), (8.9, 0.06, 0.15)]
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (decay * d)) for r, a, d in parts)
    return x * np.minimum(t / 0.002, 1) * vel * 0.35


# ---------------------------------------------------------------- arrangement

def build():
    pad, keys, arp, bass, drums, fx = (Track(n) for n in ("pad", "keys", "arp", "bass", "drums", "fx"))
    sends = {"pad": 0.55, "keys": 0.7, "arp": 0.35, "bass": 0.0, "drums": 0.12, "fx": 0.6}

    # Pad brightness (low-pass cutoff) per section: dark intro and breakdown, brightest in the build.
    cutoff = {"hook": 1250, "reveal": 2600, "smarter": 2500, "data": 2300, "intelligence": 2700, "zdr": 1500, "cta": 5200}
    level = {"hook": 0.9, "reveal": 0.85, "smarter": 0.75, "data": 0.72, "intelligence": 0.8, "zdr": 0.9, "cta": 1.0}

    for i, (name, sec) in enumerate(PROG):
        notes, root = CH[name]
        t0 = bar_t(i)
        last = i == len(PROG) - 1
        pad.add(t0, pad_chord(notes, BAR + (2.0 if last else 0.15), cutoff[sec], att=0.6 if sec != "hook" else 1.4, rel=3.0 if last else 1.6, air=0.15 if sec in ("hook", "zdr") else 0.35), level[sec])

        # Bass: enters with the reveal; sustained in the breakdown; whole notes at the end.
        if sec in ("reveal", "smarter", "data", "intelligence"):
            pattern = [(0, 1.5), (1.5, 0.5), (2, 1.5), (3.5, 0.5)] if sec != "reveal" else [(0, 3.75)]
            if sec == "intelligence":
                pattern = [(b * 0.5, 0.45) for b in range(8)]
            for b, d in pattern:
                m = root + (12 if (sec == "intelligence" and int(b * 2) % 4 == 3) else 0)
                bass.add(t0 + b * BEAT, bass_note(m, d * BEAT, 0.9 if b == 0 else 0.75), 0.9)
        elif sec == "zdr":
            bass.add(t0, bass_note(root, BAR * 0.95, 0.55), 0.8)
        elif sec == "cta":
            bass.add(t0, bass_note(root, BAR * (1.6 if last else 0.97), 0.9), 1.0)

        # Arp: chord tones in 16ths (8ths in the reveal), up and down over the upper notes.
        if sec in ("reveal", "smarter", "data", "intelligence", "cta"):
            tones = sorted(notes[1:]) + [notes[1] + 12, notes[2] + 12]
            order = [0, 1, 2, 3, 4, 3, 2, 1] if sec != "intelligence" else [0, 2, 1, 3, 2, 4, 3, 5]
            step = 0.5 if sec in ("reveal",) else 0.25
            bright = {"reveal": 3200, "smarter": 3900, "data": 3400, "intelligence": 4600, "cta": 5400}[sec]
            steps = int(4 / step)
            if last:
                steps = int(2 / step)
            for s in range(steps):
                m = tones[order[s % len(order)] % len(tones)] + 12
                accent = 1.0 if s % 4 == 0 else 0.7
                arp.add(t0 + s * step * BEAT, pluck(m, 0.42 * accent, bright), 0.85 if sec == "intelligence" else 1.0)

        # Theme on the keys: the question, the reveal, a reminder in the build, and the ending.
        theme = None
        # (Not under the densest narration, "own your intelligence": the keys sit right in the voice's range.)
        if i in (0, 2):
            theme = THEME_A
        elif i in (1, 3):
            theme = THEME_B
        elif i == 21:
            theme = THEME_A
        elif i == 22:
            theme = THEME_B
        elif i == 23:
            theme = THEME_END
        if theme:
            vel = 0.5 if sec in ("hook",) else 0.42
            for b, m, d in theme:
                keys.add(t0 + b * BEAT, keys_note(m + (0 if sec != "intelligence" else 12), d * BEAT, vel), 1.0)
        # Sparse low keys in the breakdown.
        if sec == "zdr":
            for b, m in ((0, notes[2] + 12), (1.5, notes[3] + 12), (3, notes[4] + 12)):
                keys.add(t0 + b * BEAT, keys_note(m, 1.2 * BEAT, 0.32), 1.0)

        # Drums.
        def at(b):
            return t0 + b * BEAT

        if sec == "reveal":
            drums.add(at(0), kick(0.95))
            if i == 3:
                drums.add(at(2.5), kick(0.6))
                for b in range(8):
                    drums.add(at(b * 0.5), hat(0.25 if b % 2 else 0.35))
        elif sec == "smarter":
            four = i >= 6
            for b in (range(4) if four else (0, 2)):
                drums.add(at(b), kick(0.9 if b == 0 else 0.8))
            if i >= 6:
                for b in (1, 3):
                    drums.add(at(b), clap(0.65))
            for b in range(16 if i >= 6 else 8):
                step = 0.25 if i >= 6 else 0.5
                drums.add(at(b * step), hat(0.32 if (b * step) % 1 == 0.5 else 0.22))
            if i >= 7:
                for b in range(16):
                    drums.add(at(b * 0.25 + 0.02), shaker(0.25 if b % 2 else 0.15))
        elif sec == "data":
            for b in range(4):
                drums.add(at(b), kick(0.85))
            for b in (1, 3):
                drums.add(at(b), clap(0.36))  # soft: the narration is dense here
            for b in range(8):
                drums.add(at(b * 0.5), hat(0.3 if b % 2 else 0.18, open_=(b == 7)))
        elif sec == "intelligence":
            for b in range(4):
                drums.add(at(b), kick(0.95))
            for b in (1, 3):
                drums.add(at(b), clap(0.4))  # soft: the narration is dense here
            for b in range(16):
                drums.add(at(b * 0.25), hat(0.34 if b % 2 else 0.22, open_=(b % 8 == 6)))
            if i == 17:
                # A clap roll into the breakdown.
                for k in range(8):
                    drums.add(at(2 + k * 0.25), clap(0.25 + 0.06 * k))
        elif sec == "cta":
            drums.add(at(0), kick(1.0))
            if not last:
                drums.add(at(2), kick(0.8))
                drums.add(at(2), clap(0.7))
                for b in range(8):
                    drums.add(at(b * 0.5), hat(0.26 if b % 2 else 0.16))

    # Effects that belong to the music (transitions). Interface sounds live in sfx.py.
    fx.add(bar_t(2) - 2 * BEAT, riser(2 * BEAT, 0.45))      # into the reveal
    fx.add(bar_t(2), impact(0.8))
    fx.add(bar_t(4) - BEAT, riser(BEAT, 0.25, 800, 9000))   # into "smarter"
    fx.add(bar_t(9) - BEAT, riser(BEAT, 0.22, 800, 9000))   # into "data"
    fx.add(bar_t(13) - BEAT, riser(BEAT, 0.25, 800, 9000))  # into "intelligence"
    fx.add(bar_t(18) - 4 * BEAT, riser(4 * BEAT, 0.5))       # the build peaks...
    fx.add(bar_t(18), downlifter(2 * BEAT, 0.35))            # ...and falls into the breakdown
    fx.add(bar_t(21) - 2 * BEAT, riser(2 * BEAT, 0.55))      # into the end card
    fx.add(bar_t(21), impact(1.0))
    for k, m in enumerate((77, 81, 84, 89)):
        fx.add(bar_t(21) + k * 0.06, bell(m, 0.32, 2.6))
    for k, m in enumerate((72, 76, 79, 84, 88)):
        fx.add(bar_t(23) + k * BEAT * 0.5, bell(m, 0.22, 3.0))

    # Sidechain: everything but drums ducks a little under each kick.
    kicks = []
    for i, (_, sec) in enumerate(PROG):
        if sec in ("smarter", "data", "intelligence"):
            kicks += [bar_t(i) + b * BEAT for b in range(4)]
        elif sec in ("reveal", "cta"):
            kicks += [bar_t(i)]
    n = pad.x.shape[1]
    t = secs(n)
    duck = np.ones(n)
    for k in kicks:
        i0 = int(k * SR)
        seg = t[i0:i0 + int(0.4 * SR)] - k
        duck[i0:i0 + len(seg)] = np.minimum(duck[i0:i0 + len(seg)], 1 - 0.32 * np.exp(-seg / 0.11))
    for tr in (pad, arp, bass):
        tr.x *= duck

    # Arp echoes (dotted eighth), then the shared room.
    arp.x += pingpong(arp.x, 0.75 * BEAT, 0.33, 6, 3000) * 0.55
    room = make_room(2.8, 3.6)
    send = sum(tr.x * sends[tr.name] for tr in (pad, keys, arp, bass, drums, fx))
    wet = reverb(highpass(send, 220), room) * 0.32

    # Per-track tone and level.
    # Room for the voice: the pad steps back where vowels live (about 400 Hz to 2 kHz).
    pad.x = peaking(peaking(shelf(highpass(pad.x, 110), 6000, 3.0), 900, -5.0, 0.7), 2000, -2.5, 1.0) * 1.15
    keys.x = highpass(keys.x, 140) * 0.8
    arp.x = shelf(highpass(arp.x, 260), 5000, 2.5) * 0.95
    bass.x = lowpass(bass.x, 700) * 0.27
    drums.x = drums.x * 0.55
    fx.x = fx.x * 0.55

    stems = {tr.name: tr.x for tr in (pad, keys, arp, bass, drums, fx)}
    stems["room"] = wet
    mix = sum(stems.values())
    mix = peaking(mix, 300, -1.5, 0.8)
    mix = shelf(mix, 7000, 2.5)
    mix = shelf(mix, 90, -2.0, high=False)
    mix = highpass(mix, 28)
    # Fade the very end after the last chord rings.
    end = int((TL["duration"] + 1.2) * SR)
    tail = np.ones(mix.shape[1])
    tail[end:] = np.exp(-(secs(mix.shape[1] - end)) / 0.45)
    mix *= tail
    for k in stems:
        stems[k] = stems[k] * tail
    return mix, stems


def write(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wavfile.write(path, SR, x.T.astype(np.float32))


if __name__ == "__main__":
    mix, stems = build()
    peak = np.abs(mix).max()
    out = os.path.join(HERE, "build")
    write(os.path.join(out, "music.wav"), mix / max(peak, 1e-9) * 0.7)
    for k, v in stems.items():
        write(os.path.join(out, f"stem-{k}.wav"), v / max(peak, 1e-9) * 0.7)
    print(f"music: {mix.shape[1] / SR:.1f} s, peak before normalizing {peak:.2f}")
