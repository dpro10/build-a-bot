/**
 * Streaming sample-rate conversion by any rational ratio (8 kHz phone audio up to the 16 kHz the
 * speech models hear, a browser's 48 kHz down to 16 kHz...). A polyphase FIR: a Kaiser-windowed
 * sinc low-pass cut below the lower rate's Nyquist frequency, applied without computing the
 * zero-stuffed samples. Chunks can be any size; the filter state carries across them.
 */

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Zeroth-order modified Bessel function of the first kind (for the Kaiser window). */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

export class Resampler {
  readonly from: number;
  readonly to: number;
  private readonly up: number;
  private readonly down: number;
  private readonly taps: number;
  private readonly phases: Float32Array[];
  private history: Float32Array;
  private pos: number;

  /** quality = filter taps per input sample at the lower of the two rates (more = sharper, slower). */
  constructor(from: number, to: number, quality = 24) {
    if (!(from > 0 && to > 0) || !Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`bad sample rates ${from} → ${to}`);
    this.from = from;
    this.to = to;
    const g = gcd(from, to);
    this.up = to / g;
    this.down = from / g;
    const L = this.up;
    const M = this.down;
    this.taps = Math.max(2, Math.ceil((quality * Math.max(L, M)) / L));
    const n = this.taps * L;
    const cutoff = (0.5 / Math.max(L, M)) * 0.92;
    const beta = 7.5;
    const centre = (n - 1) / 2;
    const h = new Float64Array(n);
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const t = k - centre;
      const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
      const r = (2 * k) / (n - 1) - 1;
      const window = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
      h[k] = sinc * window;
      sum += h[k];
    }
    // Zero-stuffing by L divides the level by L: each phase's taps sum to ~1 after this.
    const gain = L / sum;
    this.phases = [];
    for (let p = 0; p < L; p++) {
      const phase = new Float32Array(this.taps);
      for (let m = 0; m < this.taps; m++) phase[m] = h[p + m * L] * gain;
      this.phases.push(phase);
    }
    this.history = new Float32Array(this.taps - 1);
    this.pos = (this.taps - 1) * L;
  }

  /** Samples delayed by the filter, at the output rate. */
  get delay(): number {
    return ((this.taps * this.up - 1) / 2 / this.up) * (this.to / this.from);
  }

  process(input: Int16Array): Int16Array {
    if (this.from === this.to) return input.slice();
    const L = this.up;
    const M = this.down;
    const keep = this.taps - 1;
    const buf = new Float32Array(keep + input.length);
    buf.set(this.history, 0);
    for (let i = 0; i < input.length; i++) buf[keep + i] = input[i];
    const out = new Int16Array(Math.ceil(((buf.length * L - this.pos) / M) + 1));
    let count = 0;
    let pos = this.pos;
    for (;;) {
      const base = Math.floor(pos / L);
      if (base >= buf.length) break;
      const phase = this.phases[pos - base * L];
      let acc = 0;
      for (let m = 0; m < phase.length; m++) acc += phase[m] * buf[base - m];
      out[count++] = acc > 32767 ? 32767 : acc < -32768 ? -32768 : Math.round(acc);
      pos += M;
    }
    this.history = buf.slice(buf.length - keep);
    this.pos = pos - (buf.length - keep) * L;
    return out.slice(0, count);
  }

  reset(): void {
    this.history.fill(0);
    this.pos = (this.taps - 1) * this.up;
  }
}

/** One-shot conversion of a whole clip. */
export function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  return from === to ? pcm.slice() : new Resampler(from, to).process(pcm);
}
