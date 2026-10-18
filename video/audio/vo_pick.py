"""
Scores the voice-over takes (NVIDIA Magpie TTS, voice Sofia) so the best one of each line can be
picked without guessing: NVIDIA Parakeet's transcript must match the script word for word, then
livelier pitch, an unhurried pace and clean pauses win.

  python3 video/audio/vo_pick.py TAKES_DIR ASR_DIR LINES_TSV
"""
import json
import os
import re
import sys

import numpy as np
from scipy.io import wavfile

ALIASES = [
    (r"\bbuild ?a ?bot\b|\bbuildabot\b", "buildabot"),
    (r"\ba ?p ?i\b", "api"),
    (r"\bchat ?g ?p ?t\b", "chatgpt"),
    (r"\ben ?vidia\b", "nvidia"),
    (r"\ba i\b", "ai"),
]


def norm(s):
    s = s.lower().replace("-", " ").replace(".", " ")
    s = re.sub(r"[^a-z0-9' ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for a, b in ALIASES:
        s = re.sub(a, b, s)
    return s.split()


def wer(ref, hyp):
    d = np.zeros((len(ref) + 1, len(hyp) + 1), dtype=int)
    d[:, 0] = np.arange(len(ref) + 1)
    d[0, :] = np.arange(len(hyp) + 1)
    for i in range(1, len(ref) + 1):
        for j in range(1, len(hyp) + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    return int(d[-1, -1])


def pitch_track(x, sr, frame=0.04, hop=0.01, fmin=120, fmax=420):
    n, h = int(frame * sr), int(hop * sr)
    f0 = []
    for i in range(0, len(x) - n, h):
        w = x[i:i + n] * np.hanning(n)
        if np.sqrt(np.mean(w ** 2)) < 0.01:
            continue
        ac = np.correlate(w, w, "full")[n - 1:]
        lo, hi = int(sr / fmax), int(sr / fmin)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] / (ac[0] + 1e-9) > 0.45:
            f0.append(sr / k)
    return np.array(f0)


def main(takes, asr, lines_tsv):
    lines = dict(l.rstrip("\n").split("\t", 1) for l in open(lines_tsv) if l.strip())
    rows = []
    for f in sorted(os.listdir(asr)):
        if not f.endswith(".json"):
            continue
        a = json.load(open(os.path.join(asr, f)))
        take = f[:-5]
        line = take.split("-s")[0]
        sr, x = wavfile.read(os.path.join(takes, take + ".wav"))
        x = x.astype(np.float64) / 32768.0
        ref = norm(lines[line])
        hyp = norm(a["text"])
        words = a["words"]
        gaps = [round(words[i + 1]["start"] - words[i]["end"], 2) for i in range(len(words) - 1)]
        f0 = pitch_track(x, sr)
        semis = 12 * np.log2(f0 / np.median(f0)) if len(f0) else np.array([0.0])
        rows.append({
            "take": take, "line": line, "errors": wer(ref, hyp), "heard": a["text"],
            "dur": round(len(x) / sr, 2), "wps": round(len(ref) / (len(x) / sr), 2),
            "f0_med": round(float(np.median(f0)), 1) if len(f0) else 0, "f0_sd": round(float(np.std(semis)), 2),
            "max_gap": max(gaps) if gaps else 0, "peak": round(float(np.abs(x).max()), 2),
        })
    best = {}
    for r in rows:
        group = [q for q in rows if q["line"][:2] == r["line"][:2]]
        med = np.median([q["dur"] for q in group])
        # Livelier pitch, a pace near the group's middle, no clipping.
        r["score"] = round(-5 * r["errors"] + 1.2 * r["f0_sd"] - 2.0 * abs(r["dur"] - med) / med - (2 if r["peak"] > 0.98 else 0), 3)
        key = r["line"][:2]
        if key not in best or r["score"] > best[key]["score"]:
            best[key] = r
    for r in sorted(rows, key=lambda q: (q["line"], -q["score"])):
        print(json.dumps(r))
    print("BEST", json.dumps({k: v["take"] for k, v in sorted(best.items())}))


if __name__ == "__main__":
    main(*sys.argv[1:4])
