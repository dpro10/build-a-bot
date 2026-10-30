"""
Renders one segment of the demo video (1920x1080, 60 fps) from a spec that assemble.mjs writes:

  python3 video/demo/compose.py spec.json

  screen  a recording in a browser window on the stage (cards.html's stage, drawn at 2x), with a
          camera that pushes in and follows (eased, sub-pixel)
  full    a recording filling the frame (the desktop app), the same camera
  call    the call: the panel's column through a rounded hole in its frame, captions beside it
  card    a card already rendered by cards/render.mjs, as it is

The recording plays through `pieces` (seconds in it): `from`/`to` at a `speed`, or `freeze` for
`dur`. Pieces that follow on from each other ease from one speed to the next over `ramp` seconds
(the same length either way). Each frame of the video is a real frame of the recording: at normal
speed one after another, at 2x every other one (whole-number speeds keep the motion even). A
piece with `blend` averages every frame it spans instead, for a fast-forward through a wait (text
streaming in turns into a time-lapse). `overlays` are transparent PNGs (subtitles, notes) over the
picture at seconds in the segment, fading in and out.

Everything is read as RGB and written as BT.709, so colors come out the same from every source.
"""
import json
import math
import subprocess
import sys

import cv2
import numpy as np

W, H, FPS = 1920, 1080, 60
SUB = 8  # time steps per frame, for the eased speed changes


# ---------------------------------------------------------------------------------------------
# The recording, frame by frame


class Reader:
    """Frames of a video by index, decoded in order by ffmpeg (a jump back or far ahead reopens it)."""

    def __init__(self, path, size):
        self.path = path
        self.w, self.h = size
        self.proc = None
        self.next = 0
        self.cache = {}
        self.last = None

    def _open(self, idx):
        if self.proc:
            self.proc.kill()
            self.proc.wait()
        # Seeking to a frame's own time can land a frame early or late; start half a frame before
        # it and count from the first frame whose time is at or past that.
        t = max(0.0, (idx - 0.5) / FPS)
        self.proc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.5f}", "-i", self.path, "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            stdout=subprocess.PIPE,
            bufsize=self.w * self.h * 3 * 2,
        )
        self.next = idx

    def get(self, idx):
        idx = max(0, idx)
        if idx in self.cache:
            return self.cache[idx]
        if self.proc is None or idx < self.next or idx > self.next + 90:
            self._open(idx)
        n = self.w * self.h * 3
        while self.next <= idx:
            buf = self.proc.stdout.read(n)
            if len(buf) < n:
                frame = self.last  # past the end: the last frame holds
            else:
                frame = np.frombuffer(buf, np.uint8).reshape(self.h, self.w, 3)
            self.last = frame
            self.cache[self.next] = frame
            self.next += 1
        for k in [k for k in self.cache if k < idx - 12]:
            del self.cache[k]
        return self.cache[idx]

    def close(self):
        if self.proc:
            self.proc.kill()
            self.proc.wait()


def timemap(pieces, ramp, frames):
    """
    For each frame of the segment, the stretch of the recording it covers, in the recording's
    frames: [(a, b, blend)], where frame i of the recording is [i, i+1).
    """
    runs = []
    for p in pieces:
        if "freeze" in p:
            runs.append({"freeze": p["freeze"], "frames": max(1, round(p["dur"] * FPS))})
            continue
        speed = p.get("speed", 1.0)
        blend = bool(p.get("blend"))
        # Each piece starts on a frame of the recording and lasts whole frames of the video.
        a = round(p["from"] * FPS)
        n = max(1, round((p["to"] - p["from"]) * FPS / speed))
        b = a + (p["to"] - p["from"]) * FPS
        last = runs[-1] if runs else None
        if last and "freeze" not in last and abs(last["pieces"][-1][1] - a) < 1.5:
            a = last["pieces"][-1][1]
            last["pieces"].append((a, b, n, blend))
        else:
            runs.append({"pieces": [(a, b, n, blend)]})
    spans = []
    for run in runs:
        if "freeze" in run:
            f = round(run["freeze"] * FPS)
            spans += [(f, f, False)] * run["frames"]
            continue
        n = sum(p[2] for p in run["pieces"])
        # The speed at each time step (recording frames per video frame), eased between pieces.
        v = np.concatenate([np.full(p[2] * SUB, (p[1] - p[0]) / p[2]) for p in run["pieces"]])
        k = int(ramp * FPS * SUB)
        if k > 2 and len(run["pieces"]) > 1:
            win = np.hanning(k + 2)[1:-1]
            win /= win.sum()
            pad = np.concatenate([np.full(k, v[0]), v, np.full(k, v[-1])])
            v = np.convolve(pad, win, mode="same")[k:-k]
        x = np.concatenate([[0.0], np.cumsum(v) / SUB])
        start, end = run["pieces"][0][0], run["pieces"][-1][1]
        x = start + x * (end - start) / x[-1]
        blends = [p[3] for p in run["pieces"] for _ in range(p[2])]
        spans += [(x[i * SUB], x[(i + 1) * SUB], blends[i]) for i in range(n)]
    if not spans:
        raise ValueError("no pieces")
    spans = spans[:frames] + [spans[-1]] * max(0, frames - len(spans))
    return spans


def sample(reader, span):
    """
    One frame of the video: the recording's frame in the middle of [a, b), or (blending) its frames
    over [a, b), each weighted by how much of it falls inside.
    """
    a, b, blend = span
    if b - a < 1e-6:
        return reader.get(int(math.floor(a + 1e-6)))
    if not blend:
        return reader.get(int(math.floor((a + b) / 2 + 1e-6)))
    i0, i1 = int(math.floor(a + 1e-6)), int(math.ceil(b - 1e-6))
    weights = [(j, min(b, j + 1) - max(a, j)) for j in range(i0, i1)]
    weights = [(j, w) for j, w in weights if w > 1e-3]
    if len(weights) == 1:
        return reader.get(weights[0][0])
    # A running average, one frame at a time.
    acc, total = reader.get(weights[0][0]), weights[0][1]
    for j, w in weights[1:]:
        acc = cv2.addWeighted(acc, total / (total + w), reader.get(j), w / (total + w), 0)
        total += w
    return acc


# ---------------------------------------------------------------------------------------------
# The camera


def smootherstep(t):
    t = min(1.0, max(0.0, t))
    return t * t * t * (t * (6 * t - 15) + 10)


class Camera:
    """
    Where the camera looks, as the part of the stage (1920x1080) on screen. Moves: at `t` (seconds
    in the segment) it starts toward zoom `z` centered on (x, y) of the recording's page (CSS px of
    its 1280x720) over `dur` seconds, eased; the view never leaves the stage.
    """

    def __init__(self, moves, win, page=(1280, 720)):
        self.win, self.page = win, page
        self.moves = sorted(moves or [], key=lambda m: m["t"])
        self.start = self.rect(1.0, None)

    def rect(self, z, focus):
        w, h = W / z, H / z
        if focus is None:
            cx, cy = W / 2, H / 2
        else:
            cx = self.win["x"] + focus[0] * self.win["w"] / self.page[0]
            cy = self.win["y"] + focus[1] * self.win["h"] / self.page[1]
        cx = min(max(cx, w / 2), W - w / 2)
        cy = min(max(cy, h / 2), H - h / 2)
        return (cx, cy, w)

    def at(self, t):
        cur = self.start
        for m in self.moves:
            if t < m["t"]:
                break
            focus = (m["x"], m["y"]) if "x" in m else None
            target = self.rect(m.get("z", 1.0), focus)
            e = smootherstep((t - m["t"]) / max(m.get("dur", 0.8), 1e-3))
            # Position eases straight across; size eases in proportion (a zoom feels even).
            cx = cur[0] + (target[0] - cur[0]) * e
            cy = cur[1] + (target[1] - cur[1]) * e
            w = cur[2] * (target[2] / cur[2]) ** e
            cur = (cx, cy, w)
        cx, cy, w = cur
        z = W / w
        return z, cx - w / 2, cy - (H / z) / 2


def place(img, s, ox, oy, interp_up=cv2.INTER_LINEAR):
    """
    img scaled by s with its top-left corner at (ox, oy) on the 1920x1080 frame (sub-pixel): only
    the part that shows is scaled, with an area filter when it shrinks (text stays clean), then
    moved into place by the fraction of a pixel that's left.
    """
    h, w = img.shape[:2]
    x0 = max(0, int(math.floor(-ox / s)) - 2)
    x1 = min(w, int(math.ceil((W - ox) / s)) + 2)
    y0 = max(0, int(math.floor(-oy / s)) - 2)
    y1 = min(h, int(math.ceil((H - oy) / s)) + 2)
    if x1 <= x0 or y1 <= y0:
        return np.zeros((H, W) + img.shape[2:], img.dtype)
    crop = img[y0:y1, x0:x1]
    tw = max(1, int(round(s * (x1 - x0))))
    th = max(1, int(round(s * (y1 - y0))))
    small = cv2.resize(crop, (tw, th), interpolation=cv2.INTER_AREA if s < 1 else interp_up)
    sx = s * (x1 - x0) / tw
    sy = s * (y1 - y0) / th
    # Corner-based placement (pixel i spans [i, i+1)), in OpenCV's center-based terms.
    m = np.float32([[sx, 0, ox + s * x0 + 0.5 * (sx - 1)], [0, sy, oy + s * y0 + 0.5 * (sy - 1)]])
    return cv2.warpAffine(small, m, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


# ---------------------------------------------------------------------------------------------
# Overlays and output


def load_rgba(path):
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(path)
    if img.shape[2] == 3:
        img = np.dstack([img, np.full(img.shape[:2], 255, np.uint8)])
    rgba = cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)
    return rgba


def premultiplied(rgba):
    """RGBA as premultiplied color and alpha, 8 bits each (so OpenCV's fast paths do the work)."""
    a = np.ascontiguousarray(rgba[:, :, 3])
    rgb = cv2.multiply(np.ascontiguousarray(rgba[:, :, :3]), cv2.merge([a, a, a]), scale=1 / 255)
    return rgb, a


def over(frame, rgb, a, k=1.0):
    """Premultiplied color with alpha a (times k) over the frame."""
    if k < 1.0:
        rgb = cv2.multiply(rgb, np.full(rgb.shape, k * 255, np.uint8), scale=1 / 255)
        a = cv2.multiply(a, np.full(a.shape, k * 255, np.uint8), scale=1 / 255)
    inv = 255 - a
    return cv2.add(cv2.multiply(frame, cv2.merge([inv, inv, inv]), scale=1 / 255), rgb)


class Overlays:
    def __init__(self, items):
        self.items = []
        for o in items or []:
            rgb, a = premultiplied(load_rgba(o["png"]))
            if rgb.shape[:2] != (H, W):
                raise ValueError(f"{o['png']}: overlays are 1920x1080")
            # Only the part with something in it is blended.
            ys, xs = np.nonzero(a > 0)
            if len(xs) == 0:
                continue
            box = (ys.min(), ys.max() + 1, xs.min(), xs.max() + 1)
            y0, y1, x0, x1 = box
            self.items.append({**o, "rgb": rgb[y0:y1, x0:x1], "a": a[y0:y1, x0:x1], "box": box})

    def apply(self, frame, t):
        for o in self.items:
            if t < o["a0"] or t > o["b0"]:
                continue
            k = 1.0
            if o.get("fadeIn", 0) > 0:
                k = min(k, (t - o["a0"]) / o["fadeIn"])
            if o.get("fadeOut", 0) > 0:
                k = min(k, (o["b0"] - t) / o["fadeOut"])
            k = max(0.0, min(1.0, k))
            if k <= 0:
                continue
            y0, y1, x0, x1 = o["box"]
            frame[y0:y1, x0:x1] = over(np.ascontiguousarray(frame[y0:y1, x0:x1]), o["rgb"], o["a"], k)
        return frame


def writer(path):
    return subprocess.Popen(
        [
            "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
            "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-movflags", "+faststart", path,
        ],
        stdin=subprocess.PIPE,
    )


# ---------------------------------------------------------------------------------------------
# The kinds of segment


def render(spec):
    frames = int(round(spec["duration"] * FPS))
    kind = spec["kind"]
    overlays = Overlays([{**o, "a0": o["a"], "b0": o["b"]} for o in spec.get("overlays", [])])
    out = writer(spec["out"])

    if kind == "card":
        reader = Reader(spec["file"], (W, H))
        for k in range(frames):
            frame = reader.get(k).copy()
            out.stdin.write(overlays.apply(frame, k / FPS).tobytes())
        reader.close()
    elif kind in ("screen", "full"):
        size = spec["srcSize"]
        reader = Reader(spec["src"], size)
        spans = timemap(spec["pieces"], spec.get("ramp", 0.35), frames)
        if kind == "screen":
            win = spec["win"]
            stage_rgb, stage_a = premultiplied(load_rgba(spec["stage"]))
            stage_scale = stage_rgb.shape[1] / W  # the stage is drawn at 2x
            stage_cache = {}
        else:
            win = {"x": 0, "y": 0, "w": W, "h": H}
        cam = Camera(spec.get("camera"), win, page=tuple(spec.get("page", (1280, 720))))
        for k in range(frames):
            z, rx, ry = cam.at(k / FPS)
            src = sample(reader, spans[k])
            s = win["w"] / size[0] * z
            frame = place(src, s, (win["x"] - rx) * z, (win["y"] - ry) * z)
            if kind == "screen":
                # The stage only changes when the camera moves.
                key = (round(z, 5), round(rx, 3), round(ry, 3))
                if key not in stage_cache:
                    stage_cache.clear()
                    ss = z / stage_scale
                    stage_cache[key] = (place(stage_rgb, ss, -rx * z, -ry * z), place(stage_a, ss, -rx * z, -ry * z))
                frame = over(frame, *stage_cache[key])
            out.stdin.write(overlays.apply(frame, k / FPS).tobytes())
        reader.close()
    elif kind == "call":
        size = spec["srcSize"]
        reader = Reader(spec["src"], size)
        spans = timemap(spec["pieces"], 0, frames)
        col, hole = spec["col"], spec["hole"]
        frame_rgb, frame_a = premultiplied(load_rgba(spec["frame"]))
        s = hole["w"] / col["w"]
        for k in range(frames):
            src = sample(reader, spans[k])[col["y"]:col["y"] + col["h"], col["x"]:col["x"] + col["w"]]
            panel = cv2.resize(src, (hole["w"], hole["h"]), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
            frame = np.zeros((H, W, 3), np.uint8)
            frame[hole["y"]:hole["y"] + hole["h"], hole["x"]:hole["x"] + hole["w"]] = panel
            frame = over(frame, frame_rgb, frame_a)
            out.stdin.write(overlays.apply(frame, k / FPS).tobytes())
        reader.close()
    else:
        raise ValueError(f"unknown kind {kind}")

    out.stdin.close()
    if out.wait() != 0:
        raise RuntimeError(f"ffmpeg failed writing {spec['out']}")


if __name__ == "__main__":
    render(json.load(open(sys.argv[1])))
