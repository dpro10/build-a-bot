"""Cuts one long narration take into a cue per sentence, by NVIDIA Parakeet's word timings, so the
edit can place each sentence on its own picture (the edit refers to them as S01, S02, ...).

  python3 video/demo/vo/split.py TAKE.wav TAKE.asr.json OUT_DIR

TAKE.asr.json is `nemo-speech transcribe TAKE.wav -f json` (words with start and end). Parakeet's
words follow on from each other with no gaps, so each cut between sentences goes in the quietest
stretch of the take near where one sentence ends and the next begins. Each cue keeps a little of
the room before and after its words, with 10 ms fades, and OUT_DIR/cues.json lists them: id, text,
length, and where it starts in the take.
"""
import json
import os
import subprocess
import sys

import numpy as np
from scipy.io import wavfile

wav, asr, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
words = json.load(open(asr))["words"]

sentences, cur = [], []
for w in words:
    cur.append(w)
    if w["word"].rstrip('"”’)').endswith((".", "?", "!")):
        sentences.append(cur)
        cur = []
if cur:
    sentences.append(cur)

# The take's loudness in 10 ms steps.
rate, x = wavfile.read(wav)
x = x.astype(np.float32)
if x.ndim > 1:
    x = x.mean(axis=1)
x /= max(1.0, np.abs(x).max())
hop = rate // 100
rms = np.sqrt(np.convolve(x * x, np.ones(hop) / hop, mode="same")[::hop] + 1e-12)
db = 20 * np.log10(rms)
quiet = db < db.max() - 42


def silence_near(lo, hi):
    """The longest quiet stretch between lo and hi (seconds): (start, end), or None."""
    a, b = max(0, int(lo * 100)), min(len(db), int(hi * 100))
    best, run = None, None
    for i in range(a, b):
        if quiet[i]:
            run = (run[0], i + 1) if run else (i, i + 1)
            if best is None or run[1] - run[0] > best[1] - best[0]:
                best = run
        else:
            run = None
    return (best[0] / 100, best[1] / 100) if best else None


# Where each sentence's sound starts and stops: the quiet stretch around each boundary.
bounds = []
for i in range(len(sentences) - 1):
    last, nxt = sentences[i][-1], sentences[i + 1][0]
    gap = silence_near(last["start"] + 0.1, nxt["start"] + min(0.4, (nxt["end"] - nxt["start"]) * 0.6))
    bounds.append(gap if gap else (last["end"], last["end"]))

cues = []
for i, s in enumerate(sentences):
    head = bounds[i - 1][1] if i else 0.0
    tail = bounds[i][0] if i < len(bounds) else len(x) / rate
    # A breath of room each side (less than the silence there is).
    room_before = (bounds[i - 1][1] - bounds[i - 1][0]) if i else 0.5
    room_after = (bounds[i][1] - bounds[i][0]) if i < len(bounds) else 0.8
    a = max(0.0, head - min(0.08, room_before / 2))
    b = min(len(x) / rate, tail + min(0.25, room_after / 2))
    cid = f"S{i + 1:02d}"
    path = os.path.join(out, f"{cid}.wav")
    d = b - a
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-af", f"atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st={max(0, d - 0.01):.3f}:d=0.01", "-ar", "48000", "-ac", "1", path], check=True)
    cues.append({"id": cid, "text": " ".join(w["word"] for w in s), "dur": round(d, 3), "from": round(a, 3)})
json.dump(cues, open(os.path.join(out, "cues.json"), "w"), indent=1)
for c in cues:
    print(f'{c["id"]} {c["from"]:7.2f} {c["dur"]:5.2f}  {c["text"]}')
