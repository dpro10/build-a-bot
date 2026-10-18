"""
Small synthesizer toolkit for the promo's original score and sound effects: band-limited oscillators,
envelopes, filters (static and automated), a convolution reverb with a generated room, delays and
a lookahead limiter. Everything renders to numpy arrays at 48 kHz; stereo is shape (2, n).
"""
import numpy as np
from scipy import signal

SR = 48000
RNG = np.random.default_rng(20261030)


def midi_hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


def secs(n):
    return np.arange(n) / SR


# ---------- oscillators ----------

def _polyblep(t, dt):
    out = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m]
    out[m] = x + x - x * x - 1.0
    m = t > 1.0 - dt
    x = (t[m] - 1.0) / dt[m]
    out[m] = x * x + x + x + 1.0
    return out


def phase(freq, start=None):
    """Running phase (cycles) for a per-sample frequency array."""
    dt = np.asarray(freq, dtype=float) / SR
    p0 = RNG.random() if start is None else start
    return np.cumsum(dt) + p0, dt


def saw(freq, start=None):
    ph, dt = phase(freq, start)
    t = ph % 1.0
    return 2.0 * t - 1.0 - _polyblep(t, dt)


def sine(freq, start=0.0):
    ph, _ = phase(freq, start)
    return np.sin(2 * np.pi * ph)


def tri(freq, start=None):
    # Integrated band-limited square would be cleaner; a soft-clipped sine-ish triangle is enough here.
    ph, _ = phase(freq, start)
    t = ph % 1.0
    return 1.0 - 4.0 * np.abs(t - 0.5)


def noise(n):
    return RNG.standard_normal(n)


# ---------- envelopes ----------

def adsr(n, a, d, s, hold, r):
    """Attack/decay to sustain, held for `hold` seconds from the start, then released over `r`."""
    t = secs(n)
    env = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = np.clip((t - hold) / max(r, 1e-6), 0, 1)
    at_hold = env[min(int(hold * SR), n - 1)] if n else 0
    env = np.where(t < hold, env, at_hold * (1 - rel) ** 2)
    return env


def perc(n, a, decay):
    t = secs(n)
    return np.minimum(t / max(a, 1e-6), 1.0) * np.exp(-t / decay)


def fade(x, fin=0.002, fout=0.01):
    n = x.shape[-1]
    i, o = min(int(fin * SR), n), min(int(fout * SR), n)
    env = np.ones(n)
    if i:
        env[:i] = np.linspace(0, 1, i)
    if o:
        env[n - o:] *= np.linspace(1, 0, o)
    return x * env


# ---------- filters ----------

def lowpass(x, fc, order=2):
    b, a = signal.butter(order, min(fc, SR * 0.45) / (SR / 2), "low")
    return signal.lfilter(b, a, x, axis=-1)


def highpass(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), "high")
    return signal.lfilter(b, a, x, axis=-1)


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], "band")
    return signal.lfilter(b, a, x, axis=-1)


def peaking(x, f0, gain_db, q=1.0):
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / SR
    al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return signal.lfilter(b, a, x, axis=-1)


def shelf(x, f0, gain_db, high=True):
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / SR
    cw, al = np.cos(w), np.sin(w) / 2 * np.sqrt(2)
    s = 1 if high else -1
    b0 = A * ((A + 1) + s * (A - 1) * cw + 2 * np.sqrt(A) * al)
    b1 = -s * 2 * A * ((A - 1) + s * (A + 1) * cw)
    b2 = A * ((A + 1) + s * (A - 1) * cw - 2 * np.sqrt(A) * al)
    a0 = (A + 1) - s * (A - 1) * cw + 2 * np.sqrt(A) * al
    a1 = s * 2 * ((A - 1) - s * (A + 1) * cw)
    a2 = (A + 1) - s * (A - 1) * cw - 2 * np.sqrt(A) * al
    return signal.lfilter([b0 / a0, b1 / a0, b2 / a0], [1, a1 / a0, a2 / a0], x, axis=-1)


def moving_lowpass(x, cutoff, q=0.707, block=128):
    """Resonant low-pass whose cutoff follows a per-sample curve (block-wise biquad, state carried)."""
    x = np.atleast_2d(x)
    out = np.zeros_like(x)
    zi = np.zeros((x.shape[0], 2))
    n = x.shape[-1]
    for i in range(0, n, block):
        fc = float(np.clip(cutoff[min(i + block // 2, n - 1)], 20, SR * 0.45))
        w = 2 * np.pi * fc / SR
        al = np.sin(w) / (2 * q)
        cw = np.cos(w)
        a0 = 1 + al
        b = np.array([(1 - cw) / 2, 1 - cw, (1 - cw) / 2]) / a0
        a = np.array([1, -2 * cw / a0, (1 - al) / a0])
        out[:, i:i + block], zi = signal.lfilter(b, a, x[:, i:i + block], axis=-1, zi=zi)
    return out if out.shape[0] > 1 else out[0]


def moving_bandpass(x, center, q=1.2, block=128):
    x = np.atleast_2d(x)
    out = np.zeros_like(x)
    zi = np.zeros((x.shape[0], 2))
    n = x.shape[-1]
    for i in range(0, n, block):
        fc = float(np.clip(center[min(i + block // 2, n - 1)], 30, SR * 0.45))
        w = 2 * np.pi * fc / SR
        al = np.sin(w) / (2 * q)
        a0 = 1 + al
        b = np.array([al, 0, -al]) / a0
        a = np.array([1, -2 * np.cos(w) / a0, (1 - al) / a0])
        out[:, i:i + block], zi = signal.lfilter(b, a, x[:, i:i + block], axis=-1, zi=zi)
    return out if out.shape[0] > 1 else out[0]


# ---------- space ----------

def pan(x, p):
    """Equal-power pan, p in [-1, 1]."""
    ang = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(ang), x * np.sin(ang)])


def make_room(rt60=2.6, length=3.4, predelay=0.024, width=1.0):
    n = int(length * SR)
    t = secs(n)
    ir = np.zeros((2, n))
    for ch in range(2):
        w = noise(n)
        lo, mid, hi = lowpass(w, 600), bandpass(w, 600, 4500), highpass(w, 4500)
        d = lambda rt: np.exp(-6.91 * t / rt)
        ir[ch] = lo * d(rt60 * 1.15) + mid * d(rt60) + 0.6 * hi * d(rt60 * 0.45)
        # A soft onset, so the tail blooms instead of clicking.
        ir[ch] *= np.minimum(t / 0.012, 1.0)
        # A few early reflections.
        for k in range(7):
            j = int((0.007 + 0.011 * k + 0.004 * RNG.random()) * SR)
            ir[ch, j] += (0.5 - 0.05 * k) * (1 if RNG.random() > 0.5 else -1)
    mid_ = (ir[0] + ir[1]) / 2
    side = (ir[0] - ir[1]) / 2 * width
    ir = np.stack([mid_ + side, mid_ - side])
    ir = np.pad(ir, ((0, 0), (int(predelay * SR), 0)))[:, :n]
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True).mean())
    return ir


def reverb(x, ir):
    x = np.atleast_2d(x)
    if x.shape[0] == 1:
        x = np.vstack([x, x])
    return np.stack([signal.fftconvolve(x[c], ir[c])[: x.shape[1]] for c in range(2)])


def pingpong(x, delay_s, feedback=0.35, taps=7, tone=3500):
    """Ping-pong echoes as a sum of shifted, filtered copies (no feedback loop needed)."""
    x = np.atleast_2d(x)
    mono = x.mean(axis=0)
    out = np.zeros((2, x.shape[1]))
    d = int(delay_s * SR)
    y = mono.copy()
    for k in range(1, taps + 1):
        y = lowpass(y, tone) * feedback
        sh = d * k
        if sh >= len(mono):
            break
        ch = (k - 1) % 2
        out[ch, sh:] += y[: len(mono) - sh]
    return out


# ---------- dynamics ----------

def envelope_follow(x, attack=0.005, release=0.12):
    """Peak envelope of a (2, n) or (n,) signal."""
    a = np.abs(np.atleast_2d(x)).max(axis=0)
    # Smooth with asymmetric one-pole filters (two passes: attack then release).
    ka, kr = np.exp(-1 / (attack * SR)), np.exp(-1 / (release * SR))
    up = signal.lfilter([1 - ka], [1, -ka], a)
    env = np.maximum(a, up)
    return signal.lfilter([1 - kr], [1, -kr], env)


def limiter(x, ceiling_db=-1.0, lookahead=0.004, release=0.08):
    ceiling = 10 ** (ceiling_db / 20)
    peak = np.abs(x).max(axis=0)
    w = int(lookahead * SR)
    # Max over the lookahead window, so gain drops before the peak arrives.
    from scipy.ndimage import maximum_filter1d

    ahead = maximum_filter1d(peak, size=2 * w + 1) if w else peak
    gain = np.minimum(1.0, ceiling / np.maximum(ahead, 1e-9))
    kr = np.exp(-1 / (release * SR))
    # Instant attack, smooth release: run a min-hold then a one-pole release on the inverted curve.
    g = signal.lfilter([1 - kr], [1, -kr], 1 - gain)
    g = np.maximum(1 - gain, g)
    out = x * (1 - g)
    return np.clip(out, -ceiling, ceiling)


def soft_clip(x, drive=1.0):
    return np.tanh(drive * x) / np.tanh(drive)


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))
