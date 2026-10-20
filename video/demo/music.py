"""
The demo video's score: the promo's world (F major, 96 BPM, one bar per 2.5 seconds, the same
synthesized instruments from video/audio/music.py) arranged under the demo's beats. No samples, no
loops, nothing copyrighted.

  video/out/venv/bin/python video/demo/music.py       -> video/out/demo/music.wav

It follows video/out/demo/timeline.json (written by assemble.mjs), so run the assembler once first:
  silent under the cold-open call -> a bright reveal -> a light groove under the walkthrough ->
  a hushed pad under the call -> the groove again -> a build into "how it's built" -> the theme
  returns for the end card and resolves on Fmaj9.
The assembler ducks it under every voice, so it can stay musical without fighting the words.
"""
import json
import os
import sys

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "audio"))
from synth import SR, highpass, lowpass, make_room, peaking, pingpong, reverb, secs, shelf  # noqa: E402
from music import (BAR, BEAT, CH, THEME_A, THEME_B, THEME_END, bass_note, bell, clap, hat, impact, keys_note, kick,  # noqa: E402
                   pad_chord, pluck, riser, shaker)

OUT = os.path.join(HERE, "..", "out", "demo")
TL = json.load(open(os.path.join(OUT, "timeline.json")))
SEG = {s["id"]: s for s in TL["segments"]}
TOTAL = TL["total"]
DUR = TOTAL + 3.0


def start(seg_id):
    return SEG[seg_id]["start"]


class Track:
    def __init__(self, name):
        self.name = name
        self.x = np.zeros((2, int(DUR * SR)))

    def add(self, t, sig, gain=1.0):
        sig = np.atleast_2d(sig)
        if sig.shape[0] == 1:
            sig = np.vstack([sig, sig]) * np.sqrt(0.5)
        i = int(round(t * SR))
        if i < 0 or i >= self.x.shape[1]:
            return
        n = min(sig.shape[1], self.x.shape[1] - i)
        self.x[:, i:i + n] += sig[:, :n] * gain


# Sections by time: (from, to, kind). Bars start at the reveal's first downbeat.
T0 = start("reveal")
REVEAL_END = start("builder-a")
CALL_FROM, CALL_TO = start("call-start"), start("voice")
BUILD_FROM = start("built")
END_FROM = start("end")

LOOP = ["Bbmaj9", "F/A", "Gm9", "Csus4"]
LOOP_2 = ["Bbmaj9", "C", "Am7", "Dm9"]


def section(t):
    if t < T0:
        return None
    if t < REVEAL_END - 0.1:
        return "reveal"
    if CALL_FROM - 0.4 <= t < CALL_TO - 0.4:
        return "hush"
    if BUILD_FROM - 0.4 <= t < END_FROM - 0.4:
        return "build"
    if t >= END_FROM - 0.4:
        return "end"
    return "groove"


def build():
    pad, keys, arp, bass, drums, fx = (Track(n) for n in ("pad", "keys", "arp", "bass", "drums", "fx"))
    sends = {"pad": 0.55, "keys": 0.7, "arp": 0.35, "bass": 0.0, "drums": 0.12, "fx": 0.6}
    cutoff = {"reveal": 2600, "groove": 2300, "hush": 1300, "build": 2800, "end": 5200}
    level = {"reveal": 0.85, "groove": 0.62, "hush": 0.55, "build": 0.75, "end": 1.0}

    bars = int((TOTAL - T0) / BAR) + 1
    end_bar = int(round((END_FROM - T0) / BAR))
    kicks = []
    for i in range(bars):
        t0 = T0 + i * BAR
        sec = section(t0 + 0.05)
        if sec is None:
            continue
        k = i - end_bar
        if sec == "reveal":
            name = ["Fadd9", "C/E", "Bbmaj9"][min(i, 2)]
        elif sec == "end":
            name = ["Bbmaj9", "C69", "Fmaj9", "Fmaj9"][min(max(k, 0), 3)]
        elif sec == "hush":
            name = ["Dm9", "Bbmaj7#11", "Fadd9", "Csus4"][i % 4]
        else:
            name = (LOOP if (i // 8) % 2 == 0 else LOOP_2)[i % 4]
        notes, root = CH[name]
        last = sec == "end" and k >= 2
        pad.add(t0, pad_chord(notes, BAR + (2.5 if last else 0.15), cutoff[sec], att=0.6, rel=3.0 if last else 1.6, air=0.15 if sec == "hush" else 0.3), level[sec])

        # Bass: a gentle pulse in the groove, held in the hush, whole notes at the end.
        if sec in ("groove", "build"):
            for b, d in ([(0, 1.5), (1.5, 0.5), (2, 1.5), (3.5, 0.5)] if sec == "groove" else [(b * 0.5, 0.45) for b in range(8)]):
                bass.add(t0 + b * BEAT, bass_note(root, d * BEAT, 0.85 if b == 0 else 0.7), 0.8)
        elif sec == "reveal":
            bass.add(t0, bass_note(root, BAR * 0.95, 0.85), 0.9)
        elif sec == "hush":
            bass.add(t0, bass_note(root, BAR * 0.95, 0.45), 0.6)
        elif sec == "end" and k <= 2:
            bass.add(t0, bass_note(root, BAR * (1.6 if last else 0.97), 0.9), 1.0)

        # Arp: chord tones, 8ths in the reveal and the groove, 16ths in the build and the ending.
        if sec in ("reveal", "groove", "build", "end") and not (sec == "end" and k >= 3):
            tones = sorted(notes[1:]) + [notes[1] + 12, notes[2] + 12]
            order = [0, 1, 2, 3, 4, 3, 2, 1] if sec != "build" else [0, 2, 1, 3, 2, 4, 3, 5]
            step = 0.5 if sec in ("reveal", "groove") else 0.25
            bright = {"reveal": 3200, "groove": 3300, "build": 4600, "end": 5400}[sec]
            steps = int(4 / step) if not last else int(2 / step)
            for s in range(steps):
                m = tones[order[s % len(order)] % len(tones)] + 12
                accent = 1.0 if s % 4 == 0 else 0.7
                arp.add(t0 + s * step * BEAT, pluck(m, 0.36 * accent, bright), 0.8 if sec == "groove" else 1.0)

        # The theme on the keys: at the reveal, and again for the end card.
        theme = None
        if sec == "reveal" and i < 2:
            theme = THEME_A if i == 0 else THEME_B
        elif sec == "end":
            theme = [THEME_A, THEME_B, THEME_END, None][min(max(k, 0), 3)]
        if theme:
            for b, m, d in theme:
                keys.add(t0 + b * BEAT, keys_note(m, d * BEAT, 0.42), 1.0)
        if sec == "hush":
            for b, m in ((0, notes[2] + 12), (1.5, notes[3] + 12), (3, notes[4] + 12)):
                keys.add(t0 + b * BEAT, keys_note(m, 1.2 * BEAT, 0.26), 1.0)

        # Drums: soft (the narration sits on top), four on the floor only in the build.
        def at(b):
            return t0 + b * BEAT

        if sec == "reveal":
            drums.add(at(0), kick(0.9))
            kicks.append(at(0))
        elif sec == "groove":
            for b in (0, 2):
                drums.add(at(b), kick(0.8))
                kicks.append(at(b))
            for b in range(8):
                drums.add(at(b * 0.5), hat(0.26 if b % 2 else 0.16))
            if i % 2:
                for b in range(16):
                    drums.add(at(b * 0.25 + 0.02), shaker(0.18 if b % 2 else 0.1))
        elif sec == "build":
            for b in range(4):
                drums.add(at(b), kick(0.85))
                kicks.append(at(b))
            for b in (1, 3):
                drums.add(at(b), clap(0.35))
            for b in range(16):
                drums.add(at(b * 0.25), hat(0.28 if b % 2 else 0.18, open_=(b % 8 == 6)))
        elif sec == "end" and k <= 2:
            drums.add(at(0), kick(1.0))
            kicks.append(at(0))
            if k < 2:
                drums.add(at(2), kick(0.75))
                drums.add(at(2), clap(0.6))
                for b in range(8):
                    drums.add(at(b * 0.5), hat(0.22 if b % 2 else 0.14))

    # Transitions.
    fx.add(T0 - 2 * BEAT, riser(2 * BEAT, 0.4))            # out of the cold open, into the reveal
    fx.add(T0, impact(0.7))
    fx.add(BUILD_FROM - 2 * BEAT, riser(2 * BEAT, 0.3, 600, 9000))
    fx.add(END_FROM - 2 * BEAT, riser(2 * BEAT, 0.5))      # into the end card
    fx.add(END_FROM, impact(0.9))
    for j, m in enumerate((77, 81, 84, 89)):
        fx.add(END_FROM + j * 0.06, bell(m, 0.3, 2.6))

    # Everything but drums ducks a little under each kick.
    n = pad.x.shape[1]
    t = secs(n)
    duck = np.ones(n)
    for kk in kicks:
        i0 = int(kk * SR)
        seg = t[i0:i0 + int(0.4 * SR)] - kk
        duck[i0:i0 + len(seg)] = np.minimum(duck[i0:i0 + len(seg)], 1 - 0.28 * np.exp(-seg / 0.11))
    for tr in (pad, arp, bass):
        tr.x *= duck

    arp.x += pingpong(arp.x, 0.75 * BEAT, 0.33, 6, 3000) * 0.5
    room = make_room(2.8, 3.6)
    send = sum(tr.x * sends[tr.name] for tr in (pad, keys, arp, bass, drums, fx))
    wet = reverb(highpass(send, 220), room) * 0.3

    pad.x = peaking(peaking(shelf(highpass(pad.x, 110), 6000, 3.0), 900, -6.0, 0.7), 2000, -3.0, 1.0) * 1.1
    keys.x = highpass(keys.x, 140) * 0.75
    arp.x = shelf(highpass(arp.x, 260), 5000, 2.0) * 0.85
    bass.x = lowpass(bass.x, 700) * 0.26
    drums.x = drums.x * 0.5
    fx.x = fx.x * 0.5
    mix = pad.x + keys.x + arp.x + bass.x + drums.x + fx.x + wet
    mix = peaking(mix, 300, -1.5, 0.8)
    mix = shelf(mix, 7000, 2.0)
    mix = highpass(mix, 28)

    # Silence before the reveal's riser; a long tail after the last chord.
    lead = int((T0 - 2 * BEAT - 0.05) * SR)
    mix[:, :max(lead, 0)] = 0
    end = int((TOTAL + 1.0) * SR)
    tail = np.ones(mix.shape[1])
    tail[end:] = np.exp(-(secs(mix.shape[1] - end)) / 0.6)
    return mix * tail


if __name__ == "__main__":
    mix = build()
    peak = np.abs(mix).max()
    os.makedirs(OUT, exist_ok=True)
    wavfile.write(os.path.join(OUT, "music.wav"), SR, (mix / max(peak, 1e-9) * 0.7).T.astype(np.float32))
    print(f"music: {mix.shape[1] / SR:.1f} s for a {TOTAL:.1f} s video, peak before normalizing {peak:.2f}")
