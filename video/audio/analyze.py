"""Quick objective checks for a mix: octave-band balance (vs pink), stem levels, loudness arc."""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

def load(p):
    sr, x = wavfile.read(p)
    x = x.astype(np.float64)
    if x.ndim == 2:
        x = x.mean(axis=1)
    return sr, x

def octaves(p, t0=None, t1=None):
    sr, x = load(p)
    if t0 is not None:
        x = x[int(t0 * sr):int(t1 * sr)]
    f, P = signal.welch(x, sr, nperseg=8192)
    bands = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    out = []
    for fc in bands:
        m = (f >= fc / np.sqrt(2)) & (f < fc * np.sqrt(2))
        out.append(10 * np.log10(P[m].sum() + 1e-20))
    ref = out[5]
    return bands, [round(v - ref, 1) for v in out]

def rms_db(p, t0=None, t1=None):
    sr, x = load(p)
    if t0 is not None:
        x = x[int(t0 * sr):int(t1 * sr)]
    return round(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12), 1)

if __name__ == "__main__":
    for p in sys.argv[1:]:
        b, v = octaves(p)
        print(p.split("/")[-1], "rms", rms_db(p), "dB | octave bands rel 1k:", dict(zip(b, v)))
