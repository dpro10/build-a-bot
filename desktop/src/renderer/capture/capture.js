/*
 * The hidden capture page. Two tracks:
 *   mic    — your microphone (getUserMedia, with echo cancellation)
 *   system — the call's audio (getDisplayMedia + Electron's system-audio loopback;
 *            the video track it needs is dropped at once)
 * Each track has its own MediaRecorder (webm/opus, ~32 kbps), restarted every chunk so
 * every chunk is a complete file. Chunks, a 0..1 level and "silent" flags go to the
 * main process; nothing is stored here. Paused = microphone released.
 *
 * The main process drives it through window.__babCapture (start/pause/resume/stop).
 */
"use strict";

(() => {
  const bridge = window.babCapture;
  const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  const UPLOAD_MIME = MIME.startsWith("audio/ogg") ? "audio/ogg" : "audio/webm";

  let cfg = { chunkMs: 20000, system: "loopback", silenceRms: 0.006 };
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {Record<string, TrackRec>} */
  let tracks = {};
  let chunkNo = 0;
  let segStartMs = 0; // timeline position of the current segment (pauses excluded)
  let segT0 = 0; // performance.now() when it began
  let running = false;
  let discarding = false;
  let rotateTimer = 0;
  let levelTimer = 0;
  let systemStatus = "off";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (msg) => {
    try {
      bridge.send("log", String(msg).slice(0, 500));
    } catch {
      /* ignore */
    }
  };

  class TrackRec {
    constructor(name, stream) {
      this.name = name;
      this.stream = stream;
      this.cur = null;
      this.analyser = null;
      this.buf = null;
      this.ended = false;
      for (const t of stream.getAudioTracks()) {
        t.addEventListener("ended", () => {
          if (this.ended) return;
          this.ended = true;
          if (!discarding) bridge.send("track-ended", { track: name, reason: "ended" });
        });
      }
    }

    meter(audioCtx) {
      try {
        const src = audioCtx.createMediaStreamSource(this.stream);
        const an = audioCtx.createAnalyser();
        an.fftSize = 2048;
        src.connect(an);
        this.analyser = an;
        this.buf = new Float32Array(an.fftSize);
      } catch (err) {
        log(`meter failed for ${this.name}: ${err}`);
      }
    }

    /** RMS loudness right now (0..1). */
    rms() {
      if (!this.analyser || this.ended) return 0;
      this.analyser.getFloatTimeDomainData(this.buf);
      let s = 0;
      for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
      return Math.sqrt(s / this.buf.length);
    }

    /** Start a new segment; returns the previous one (still recording) so it can be finished. */
    begin(chunk, startMs) {
      const prev = this.cur;
      if (this.ended) {
        this.cur = null;
        return prev;
      }
      const rec = new MediaRecorder(this.stream, { mimeType: MIME, audioBitsPerSecond: 32000 });
      const seg = { rec, chunk, startMs, t0: performance.now(), parts: [], voiced: 0, done: null };
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) seg.parts.push(e.data);
      };
      seg.done = new Promise((resolve) => {
        rec.onstop = () => resolve();
        rec.onerror = () => resolve();
      });
      rec.start();
      this.cur = seg;
      return prev;
    }
  }

  /** Stop a segment and send it as one standalone file. */
  async function finishSegment(track, seg, durationMs) {
    if (!seg) return;
    try {
      if (seg.rec.state !== "inactive") seg.rec.stop();
    } catch {
      /* already stopped */
    }
    await Promise.race([seg.done, sleep(4000)]);
    if (discarding) return;
    const blob = new Blob(seg.parts, { type: MIME });
    if (!blob.size) return;
    const data = new Uint8Array(await blob.arrayBuffer());
    bridge.send("chunk", {
      track: track.name,
      chunk: seg.chunk,
      startMs: Math.max(0, Math.round(seg.startMs)),
      durationMs: Math.max(1, Math.round(durationMs)),
      // Fewer than ~0.2 s above the noise floor: nothing worth transcribing.
      silent: seg.voiced < 2,
      mime: UPLOAD_MIME,
      data,
    });
  }

  function toLevel(rms) {
    if (rms <= 0) return 0;
    const db = 20 * Math.log10(rms);
    return Math.max(0, Math.min(1, (db + 60) / 50));
  }

  function startLevels() {
    clearInterval(levelTimer);
    let tick = 0;
    levelTimer = setInterval(() => {
      let max = 0;
      for (const t of Object.values(tracks)) {
        const r = t.rms();
        if (r >= cfg.silenceRms && t.cur) t.cur.voiced++;
        if (r > max) max = r;
      }
      // Levels go out ~6 times a second; voice is measured 10 times a second.
      if (++tick % 2 === 0 || max > 0.05) bridge.send("level", Math.round(toLevel(max) * 100) / 100);
    }, 100);
  }

  function scheduleRotate() {
    clearTimeout(rotateTimer);
    rotateTimer = setTimeout(rotate, cfg.chunkMs);
  }

  async function rotate() {
    if (!running) return;
    const now = performance.now();
    const dur = now - segT0;
    const nextStart = segStartMs + dur;
    chunkNo += 1;
    segT0 = now;
    segStartMs = nextStart;
    // Start the next recorder first, then stop the old one: no gap between chunks.
    const prev = Object.values(tracks).map((t) => [t, t.begin(chunkNo, nextStart)]);
    scheduleRotate();
    await Promise.all(prev.map(([t, seg]) => finishSegment(t, seg, dur)));
    // A track that ended (e.g. system audio permission revoked) is let go.
    for (const [name, t] of Object.entries(tracks)) if (t.ended && !t.cur) delete tracks[name];
  }

  function begin() {
    running = true;
    segT0 = performance.now();
    for (const t of Object.values(tracks)) t.begin(chunkNo, segStartMs);
    scheduleRotate();
    startLevels();
  }

  /** Mic, then the call's audio. getDisplayMedia is asked first, while the start still counts as the owner's click. */
  async function acquire() {
    const wantSystem = cfg.system !== "off";
    const displayP = wantSystem
      ? navigator.mediaDevices
          .getDisplayMedia({
            video: true,
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
            systemAudio: "include",
            selfBrowserSurface: "exclude",
          })
          .then(
            (s) => ({ s }),
            (err) => ({ err }),
          )
      : Promise.resolve({ err: { name: "Off" } });

    let mic;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false,
      });
    } catch (err) {
      displayP.then((r) => r.s && r.s.getTracks().forEach((t) => t.stop()));
      return { ok: false, mic: false, system: "off", error: `${err.name}: ${err.message}` };
    }
    ctx = new AudioContext();
    try {
      await ctx.resume();
    } catch {
      /* metering only */
    }
    tracks = { mic: new TrackRec("mic", mic) };
    tracks.mic.meter(ctx);

    systemStatus = "off";
    if (wantSystem) {
      const r = await displayP;
      if (r.err) {
        log(`system audio: ${r.err.name}: ${r.err.message || ""}`);
        systemStatus = r.err.name === "NotAllowedError" ? "denied" : "unavailable";
      } else {
        const display = r.s;
        for (const v of display.getVideoTracks()) {
          v.stop();
          display.removeTrack(v);
        }
        const a = display.getAudioTracks()[0];
        if (!a) systemStatus = "unavailable";
        else {
          // macOS without the System Audio Recording permission hands over an already-ended track.
          if (a.readyState === "live") await sleep(300);
          if (a.readyState !== "live") {
            systemStatus = "denied";
            a.stop();
          } else {
            tracks.system = new TrackRec("system", new MediaStream([a]));
            tracks.system.meter(ctx);
            systemStatus = "ok";
          }
        }
      }
    }
    return { ok: true, mic: true, system: systemStatus };
  }

  function release() {
    clearInterval(levelTimer);
    for (const t of Object.values(tracks)) for (const tr of t.stream.getTracks()) tr.stop();
    tracks = {};
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
  }

  async function start(opts) {
    cfg = { ...cfg, ...(opts || {}) };
    if (!MIME) return { ok: false, mic: false, system: "off", error: "This computer can't record audio (no MediaRecorder)." };
    chunkNo = 0;
    segStartMs = 0;
    discarding = false;
    const res = await acquire();
    if (res.ok) begin();
    return res;
  }

  async function pause() {
    if (!running) return { ok: true };
    running = false;
    clearTimeout(rotateTimer);
    const dur = performance.now() - segT0;
    const segs = Object.values(tracks).map((t) => [t, t.cur]);
    for (const t of Object.values(tracks)) t.cur = null;
    await Promise.all(segs.map(([t, seg]) => finishSegment(t, seg, dur)));
    segStartMs += dur;
    chunkNo += 1;
    release(); // the mic is let go while paused
    return { ok: true };
  }

  async function resume() {
    if (running) return { ok: true, system: systemStatus };
    const res = await acquire();
    if (res.ok) begin();
    return res;
  }

  async function stop(opts) {
    discarding = Boolean(opts && opts.discard);
    clearTimeout(rotateTimer);
    if (running) {
      running = false;
      const dur = performance.now() - segT0;
      const segs = Object.values(tracks).map((t) => [t, t.cur]);
      for (const t of Object.values(tracks)) t.cur = null;
      await Promise.all(segs.map(([t, seg]) => finishSegment(t, seg, dur)));
    }
    release();
    bridge.send("flushed", { discarded: discarding });
    return { ok: true };
  }

  window.__babCapture = Object.freeze({ start, pause, resume, stop });
})();
