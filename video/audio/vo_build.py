"""
Turns the picked voice-over takes into finished lines: a little more air at sentence breaks (cut
only inside the take's own silences), a gentle slow-down with formant-preserving time-stretch,
broadcast EQ, de-essing and compression, all at 48 kHz. Then NVIDIA Parakeet hears each finished
line again, so the on-screen words can follow the voice exactly.

  python3 video/audio/vo_build.py TAKES_DIR ASR_DIR NEMO_SPEECH_BIN PARAKEET_GGUF
Reads video/audio/vo/picks.json; writes video/audio/vo/L*.flac and video/audio/vo/vo.json.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
VO = os.path.join(HERE, "vo")

# Extra silence (seconds) after a word ending in each mark, and the tempo of each line (1 = as spoken).
PAUSE = {".": 0.22, ":": 0.16, "?": 0.2, "!": 0.2, ",": 0.05}
LINES = {
    "L1": {"tempo": 0.94},
    "L2": {"tempo": 0.95, "pause": {".": 0.26}},
    "L3": {"tempo": 0.92, "pause": {".": 0.3, ",": 0.07}},
    "L4": {"tempo": 0.96, "pause": {".": 0.2, ",": 0.04}},
    "L5": {"tempo": 1.0, "pause": {".": 0.22, ":": 0.15, ",": 0.03}},
    "L6": {"tempo": 0.95, "pause": {".": 0.25, ",": 0.05}},
    "L7": {"tempo": 0.92, "pause": {".": 0.28}},
}


def rms_frames(x, sr, win=0.01):
    n = int(win * sr)
    k = len(x) // n
    return np.sqrt((x[: k * n].reshape(k, n) ** 2).mean(axis=1) + 1e-12), n


def add_pauses(x, sr, words, marks):
    """Insert silence after punctuation, at the quietest 10 ms between the two words."""
    env, n = rms_frames(x, sr)
    cuts = []
    for a, b in zip(words, words[1:]):
        mark = a["word"][-1]
        extra = marks.get(mark, PAUSE.get(mark, 0.0)) if mark in PAUSE else 0.0
        if extra <= 0:
            continue
        lo, hi = int((a["end"] - 0.08) * sr / n), int((b["start"] + 0.04) * sr / n)
        lo, hi = max(lo, 0), min(max(hi, lo + 1), len(env))
        k = lo + int(np.argmin(env[lo:hi]))
        if 20 * np.log10(env[k]) > -38:  # no real gap here: leave the phrasing alone
            continue
        cuts.append((k * n + n // 2, extra))
    out, prev = [], 0
    for at, extra in cuts:
        seg = x[prev:at].copy()
        f = min(int(0.006 * sr), len(seg))
        if f:
            seg[-f:] *= np.linspace(1, 0, f)
        out += [seg, np.zeros(int(extra * sr))]
        prev = at
    tail = x[prev:].copy()
    f = min(int(0.006 * sr), len(tail))
    if prev and f:
        tail[:f] *= np.linspace(0, 1, f)
    out.append(tail)
    return np.concatenate(out), len(cuts)


def trim(x, sr, floor_db=-46, pre=0.03, post=0.14):
    env, n = rms_frames(x, sr)
    on = np.where(20 * np.log10(env) > floor_db)[0]
    if not len(on):
        return x
    a = max(on[0] * n - int(pre * sr), 0)
    b = min((on[-1] + 1) * n + int(post * sr), len(x))
    y = x[a:b].copy()
    f = int(0.02 * sr)
    y[-f:] *= np.linspace(1, 0, f)
    return y


def ffmpeg(src, dst, tempo):
    chain = []
    if abs(tempo - 1) > 1e-3:
        chain.append(f"rubberband=tempo={tempo}:pitch=1:formant=preserved:transients=smooth:detector=soft:window=standard")
    chain += [
        "aresample=48000:resampler=soxr:precision=28",
        "highpass=f=75:poles=2",
        "equalizer=f=250:t=q:w=1.1:g=-2.0",
        "equalizer=f=3400:t=q:w=1.3:g=2.2",
        "equalizer=f=9000:t=q:w=0.9:g=1.5",
        "deesser=i=0.35:m=0.5:f=0.5",
        "acompressor=threshold=-21dB:ratio=2.8:attack=6:release=110:knee=4:makeup=1.6",
    ]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", ",".join(chain), "-ac", "1", "-c:a", "pcm_f32le", dst], check=True)


def loudness(path):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    line = [l for l in out.splitlines() if l.strip().startswith("I:")][-1]
    return float(line.split()[1])


def main(takes, asr, bin_, model):
    picks = json.load(open(os.path.join(VO, "picks.json")))
    tmp = tempfile.mkdtemp(prefix="vo-")
    report = {}
    for line, take in picks.items():
        cfg = LINES[line]
        sr, x = wavfile.read(os.path.join(takes, take + ".wav"))
        x = x.astype(np.float64) / 32768.0
        words = json.load(open(os.path.join(asr, take + ".json")))["words"]
        y, ncuts = add_pauses(x, sr, words, cfg.get("pause", {}))
        y = trim(y, sr)
        mid = os.path.join(tmp, f"{line}-edit.wav")
        wavfile.write(mid, sr, (y * 32767).astype(np.int16))
        done = os.path.join(tmp, f"{line}.wav")
        ffmpeg(mid, done, cfg["tempo"])
        # Every line at the same loudness (the mix sets the final level).
        gain = 10 ** ((-19.0 - loudness(done)) / 20)
        sr2, z = wavfile.read(done)
        z = np.clip(z.astype(np.float64) * gain, -0.98, 0.98)
        wavfile.write(done, sr2, z.astype(np.float32))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", done, "-c:a", "flac", "-sample_fmt", "s16", os.path.join(VO, f"{line}.flac")], check=True)
        report[line] = {"take": take, "pauses_added": ncuts, "duration": round(len(z) / sr2, 3)}
        print(line, report[line])

    # Hear the finished lines again for word timings.
    asr2 = os.path.join(tmp, "asr")
    subprocess.run([bin_, "transcribe", tmp, "--model", model, "-f", "json", "--output-dir", asr2, "--quiet", "--force"], check=True)
    out = {}
    for line in picks:
        a = json.load(open(os.path.join(asr2, f"{line}.json")))
        out[line] = {
            **report[line],
            "text": a["text"],
            "words": [{"w": w["word"], "s": round(w["start"], 3), "e": round(w["end"], 3)} for w in a["words"]],
        }
    json.dump(out, open(os.path.join(VO, "vo.json"), "w"), indent=1)
    print("wrote", os.path.join(VO, "vo.json"))


if __name__ == "__main__":
    main(*sys.argv[1:5])
