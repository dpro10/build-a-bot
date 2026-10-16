/**
 * Voice activity: is someone talking in this slice of audio? Silero VAD (MIT, a 2 MB neural net run
 * by ONNX Runtime) gives a speech probability for every 32 ms of 16 kHz audio, robust to the hiss,
 * clicks and compression of a phone line. EnergyVad is the stand-in when the model isn't there
 * (and for tests that need it to be predictable).
 */
import ort from "onnxruntime-node";

export const VAD_RATE = 16000;
/** Samples per decision: 512 at 16 kHz = 32 ms. */
export const VAD_WINDOW = 512;
export const VAD_WINDOW_MS = (VAD_WINDOW * 1000) / VAD_RATE;

export interface VadStream {
  /** 16 kHz samples in; one speech probability (0..1) out per complete 32 ms window. */
  push(pcm: Int16Array): Promise<number[]>;
  reset(): void;
}

export interface Vad {
  stream(): VadStream;
}

/** Collects samples into whole windows. */
class Windows {
  private pending = new Int16Array(0);

  take(pcm: Int16Array): Int16Array[] {
    const all = new Int16Array(this.pending.length + pcm.length);
    all.set(this.pending, 0);
    all.set(pcm, this.pending.length);
    const out: Int16Array[] = [];
    let at = 0;
    for (; at + VAD_WINDOW <= all.length; at += VAD_WINDOW) out.push(all.subarray(at, at + VAD_WINDOW));
    this.pending = all.slice(at);
    return out;
  }

  reset(): void {
    this.pending = new Int16Array(0);
  }
}

export class SileroVad implements Vad {
  private readonly session: ort.InferenceSession;

  private constructor(session: ort.InferenceSession) {
    this.session = session;
  }

  static async load(modelPath: string): Promise<SileroVad> {
    const session = await ort.InferenceSession.create(modelPath, {
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      executionMode: "sequential",
      graphOptimizationLevel: "all",
    });
    for (const name of ["input", "state", "sr"]) {
      if (!session.inputNames.includes(name)) throw new Error(`${modelPath} isn't a Silero VAD v5+ model (no "${name}" input)`);
    }
    return new SileroVad(session);
  }

  stream(): VadStream {
    const session = this.session;
    const windows = new Windows();
    const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(VAD_RATE)]), []);
    let state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    // Silero v5 reads each window with the 64 samples before it.
    let context = new Float32Array(64);
    // Windows are scored strictly in order, one at a time.
    let chain: Promise<unknown> = Promise.resolve();
    let generation = 0;

    const score = async (win: Int16Array, gen: number): Promise<number> => {
      const x = new Float32Array(64 + VAD_WINDOW);
      x.set(context, 0);
      for (let i = 0; i < VAD_WINDOW; i++) x[64 + i] = win[i] / 32768;
      context = x.slice(VAD_WINDOW);
      const out = await session.run({ input: new ort.Tensor("float32", x, [1, x.length]), state, sr });
      if (gen === generation) state = out.stateN as ort.Tensor;
      return (out.output.data as Float32Array)[0];
    };

    return {
      push(pcm) {
        const wins = windows.take(pcm);
        const gen = generation;
        const run = chain.then(async () => {
          const probs: number[] = [];
          for (const w of wins) probs.push(await score(w, gen));
          return probs;
        });
        chain = run.catch(() => undefined);
        return run;
      },
      reset() {
        generation++;
        windows.reset();
        state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
        context = new Float32Array(64);
      },
    };
  }
}

/**
 * Loudness against an adaptive noise floor. Crude next to Silero (a cough or a door counts as
 * speech), but predictable and dependency-free.
 */
export class EnergyVad implements Vad {
  private readonly opts: { marginDb?: number; floorDb?: number };

  constructor(opts: { marginDb?: number; floorDb?: number } = {}) {
    this.opts = opts;
  }

  stream(): VadStream {
    const margin = this.opts.marginDb ?? 12;
    const minFloor = this.opts.floorDb ?? -60;
    const windows = new Windows();
    let floor = minFloor;
    return {
      async push(pcm) {
        return windows.take(pcm).map((w) => {
          let sum = 0;
          for (let i = 0; i < w.length; i++) sum += w[i] * w[i];
          const db = sum > 0 ? 20 * Math.log10(Math.sqrt(sum / w.length) / 32768) : -100;
          // The floor follows quiet stretches quickly and loud ones slowly.
          floor = db < floor ? Math.max(minFloor, db) : floor + (db - floor) * 0.01;
          floor = Math.max(minFloor, floor);
          const above = db - floor;
          return Math.max(0, Math.min(1, (above - margin / 2) / margin));
        });
      },
      reset() {
        windows.reset();
        floor = minFloor;
      },
    };
  }
}
