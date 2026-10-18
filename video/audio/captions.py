"""
Captions for the promo (SRT), timed from NVIDIA Parakeet's word timings of the finished voice-over
(video/audio/vo/vo.json) and written with the script's own spelling.

  python3 video/audio/captions.py   -> video/out/build-a-bot-promo.en.srt
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")

# (line, first word, last word, text): word indexes are Parakeet's words in vo.json.
CUES = [
    ("L1", 0, 6, "What if your AI was actually yours?"),
    ("L2", 0, 1, "Meet Build-a-bot."),
    ("L2", 2, 9, "Your own AI assistant, in about a minute."),
    ("L3", 0, 7, "It gets smarter the more you use it."),
    ("L3", 8, 22, "It learns the people in your life,\nyour routines, and how you like things done."),
    ("L4", 0, 5, "And everything it learns is yours."),
    ("L4", 6, 15, "See it, change it, export it, or delete it all."),
    ("L4", 16, 25, "We never sell it. We never train AI on it."),
    ("L5", 0, 5, "Even its brain is your choice."),
    ("L5", 6, 13, "Open NVIDIA Nemotron models, your own API key,"),
    ("L5", 14, 23, "or the Claude or ChatGPT plan you already have."),
    ("L5", 24, 30, "Switch anytime, and it keeps its memory."),
    ("L6", 0, 2, "Zero data retention."),
    ("L6", 3, 9, "The open models keep nothing you say,"),
    ("L6", 10, 19, "and your voice is heard right on your own computer."),
    ("L7", 0, 5, "Build-a-bot. Own your AI."),
]


def stamp(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def main():
    tl = json.load(open(os.path.join(ROOT, "timeline.json")))
    vo = json.load(open(os.path.join(HERE, "vo", "vo.json")))
    expected = {"L1": 7, "L2": 10, "L3": 23, "L4": 26, "L5": 31, "L6": 20, "L7": 6}
    for line, n in expected.items():
        got = len(vo[line]["words"])
        if got != n:
            raise SystemExit(f"{line}: {got} words in vo.json, the cues expect {n}; update CUES")
    cues = []
    for line, a, b, text in CUES:
        w = vo[line]["words"]
        start = tl["vo"][line] + w[a]["s"] - 0.05
        end = tl["vo"][line] + w[b]["e"] + 0.25
        cues.append([start, end, text])
    for i in range(len(cues) - 1):  # never overlap the next cue
        cues[i][1] = min(cues[i][1], cues[i + 1][0] - 0.02)
    out = os.path.join(ROOT, "out", "build-a-bot-promo.en.srt")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        for i, (s, e, text) in enumerate(cues, 1):
            f.write(f"{i}\n{stamp(s)} --> {stamp(e)}\n{text}\n\n")
    print(f"{len(cues)} captions -> {out}")


if __name__ == "__main__":
    main()
