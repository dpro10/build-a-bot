"""Cuts one long narration take into a cue per sentence, by NVIDIA Parakeet's word timings, so the
edit can place each sentence on its own picture (edit.mjs refers to them as S01, S02, ...).

  python3 video/demo/vo/split.py TAKE.wav TAKE.asr.json OUT_DIR

TAKE.asr.json is `nemo-speech transcribe TAKE.wav -f json` (words with start and end). Each cue
keeps a little of the room before and after the words (never more than half the pause), with
10 ms fades, and OUT_DIR/cues.json lists them: id, text, length.
"""
import json
import os
import subprocess
import sys

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

cues = []
for i, s in enumerate(sentences):
    start, end = s[0]["start"], s[-1]["end"]
    prev_end = sentences[i - 1][-1]["end"] if i else 0
    next_start = sentences[i + 1][0]["start"] if i + 1 < len(sentences) else end + 1
    a = max(0, start - min(0.12, (start - prev_end) / 2))
    b = end + min(0.35, (next_start - end) / 2)
    cid = f"S{i + 1:02d}"
    path = os.path.join(out, f"{cid}.wav")
    d = b - a
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-af", f"atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st={max(0, d - 0.01):.3f}:d=0.01", "-ar", "48000", "-ac", "1", path], check=True)
    cues.append({"id": cid, "text": " ".join(w["word"] for w in s), "dur": round(d, 3), "from": round(a, 3)})
json.dump(cues, open(os.path.join(out, "cues.json"), "w"), indent=1)
for c in cues:
    print(f'{c["id"]} {c["dur"]:5.2f}  {c["text"]}')
