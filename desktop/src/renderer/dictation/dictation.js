/*
 * Voice typing's pill, and its recorder.
 *
 * Recorder: the microphone opens when the main process calls start() (the shortcut was pressed)
 * and is released on stop() or cancel(). One MediaRecorder (webm/opus, 32 kbps: plenty for speech)
 * while it's held; nothing is stored here. stop() hands the recording to the main process, which
 * sends it once and forgets it.
 *
 * Pill: shows what the main process says (listening, writing, typed, the bot's answer, errors)
 * and sends back button presses and its size (the window is exactly as big as the pill).
 */
"use strict";

(() => {
  const bridge = window.babDictation;
  const $ = (id) => document.getElementById(id);
  const COLORS = { ocean: "#3B82F6", sky: "#8EA8FF", grape: "#7C5CFF", rose: "#F2679B", coral: "#FF6F59", sunny: "#FFC23D", mint: "#2FCB94", midnight: "#5B63A6" };
  const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  const UPLOAD_MIME = MIME.startsWith("audio/ogg") ? "audio/ogg" : MIME.startsWith("audio/mp4") ? "audio/mp4" : "audio/webm";
  /** Above this loudness (after the mic's own gain control) counts as speech. */
  const SPEECH_RMS = 0.012;

  // -------------------------------------------------------------------------
  // Recorder
  // -------------------------------------------------------------------------

  let ctx = null;
  let stream = null;
  let rec = null;
  let chunks = [];
  let t0 = 0;
  let speechMs = 0;
  let meterTimer = 0;
  let analyser = null;
  let buf = null;
  let sounds = true;
  const BARS = 24;
  const levels = new Array(BARS).fill(0);

  function audio() {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  }

  /** A short, soft two-note chime (no files: synthesized). */
  function chime(kind) {
    if (!sounds) return;
    try {
      const c = audio();
      const notes = kind === "start" ? [587, 880] : kind === "stop" ? [880, 587] : [392];
      let t = c.currentTime + 0.01;
      for (const f of notes) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
        o.connect(g).connect(c.destination);
        o.start(t);
        o.stop(t + 0.12);
        t += 0.075;
      }
    } catch {
      /* no sound, no problem */
    }
  }

  async function openMic(micId) {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    if (micId && micId !== "default") {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: micId } }, video: false });
      } catch (err) {
        // The chosen mic was unplugged: use the default one.
        if (err.name !== "OverconstrainedError" && err.name !== "NotFoundError") throw err;
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: base, video: false });
  }

  function meter() {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / buf.length);
    if (rms >= SPEECH_RMS) speechMs += 50;
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    levels.push(Math.max(0, Math.min(1, (db + 56) / 44)));
    levels.shift();
  }

  function release() {
    clearInterval(meterTimer);
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    analyser = null;
    levels.fill(0);
  }

  function endRecorder() {
    return new Promise((resolve) => {
      const r = rec;
      rec = null;
      if (!r || r.state === "inactive") return resolve();
      r.onstop = () => resolve();
      r.onerror = () => resolve();
      try {
        r.stop();
      } catch {
        resolve();
      }
      setTimeout(resolve, 3000);
    });
  }

  async function start(opts) {
    opts = opts || {};
    sounds = opts.sounds !== false;
    if (rec || stream) await cancel();
    if (!MIME) return { ok: false, error: "NoMediaRecorder: this computer can't record audio" };
    try {
      stream = await openMic(opts.micId);
    } catch (err) {
      return { ok: false, error: `${err.name}: ${err.message}` };
    }
    const c = audio();
    try {
      await c.resume();
    } catch {
      /* metering only */
    }
    analyser = c.createAnalyser();
    analyser.fftSize = 1024;
    c.createMediaStreamSource(stream).connect(analyser);
    buf = new Float32Array(analyser.fftSize);
    chunks = [];
    rec = new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: 32000 });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    rec.start(250);
    t0 = performance.now();
    speechMs = 0;
    clearInterval(meterTimer);
    meterTimer = setInterval(meter, 50);
    chime("start");
    return { ok: true };
  }

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function stop() {
    const durationMs = Math.round(performance.now() - t0);
    const heard = speechMs;
    await endRecorder();
    release();
    chime("stop");
    const blob = new Blob(chunks, { type: MIME });
    chunks = [];
    if (!blob.size) return { ok: false };
    return { ok: true, data: await toBase64(blob), mime: UPLOAD_MIME, durationMs, speechMs: heard };
  }

  async function cancel() {
    const was = Boolean(rec);
    await endRecorder();
    chunks = [];
    release();
    if (was) chime("cancel");
    return { ok: true };
  }

  async function microphones() {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications").map((d) => ({ id: d.deviceId, label: d.label || "Microphone" }));
  }

  window.__babDictation = Object.freeze({ start, stop, cancel, microphones });

  // -------------------------------------------------------------------------
  // Pill
  // -------------------------------------------------------------------------

  const ICONS = {
    mic: '<svg viewBox="0 0 16 16"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15"/></svg>',
    check: '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5"/></svg>',
    warn: '<svg viewBox="0 0 16 16"><path d="M8 4.5v4.5M8 11.6v.1"/></svg>',
    info: '<svg viewBox="0 0 16 16"><path d="M8 7v5M8 4.3v.1"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>',
  };

  const LABELS = {
    retry: "Try again",
    upgrade: "Upgrade",
    pair: "Pair",
    settings: "Settings",
    "mic-settings": "Allow microphone",
    accessibility: "Allow",
    paste: "Paste",
    copy: "Copy",
    reply: "Reply",
    chat: "Open chat",
    "type-instead": "Type it instead",
  };

  let state = null;
  let raf = 0;
  let tick = 0;

  function button(action, opts = {}) {
    const b = document.createElement("button");
    b.type = "button";
    if (opts.icon) {
      b.className = `icon-btn ${opts.className || ""}`;
      b.innerHTML = ICONS[opts.icon];
      b.setAttribute("aria-label", opts.label);
      b.title = opts.label;
    } else {
      b.textContent = LABELS[action] || action;
      if (opts.primary) b.className = "primary";
    }
    b.addEventListener("click", () => bridge.action(action));
    return b;
  }

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function drawWave() {
    const canvas = $("wave");
    const g = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== 132 * dpr) {
      canvas.width = 132 * dpr;
      canvas.height = 28 * dpr;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, 132, 28);
    const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7c5cff";
    const w = 132 / BARS;
    for (let i = 0; i < BARS; i++) {
      // Quiet still shows a gentle ripple, so it's clear it's listening.
      const idle = 0.08 + 0.05 * Math.sin((tick / 9 + i) * 0.7);
      const v = Math.max(idle, levels[i]);
      const h = Math.max(3, v * 26);
      // Older sound fades toward the left.
      g.fillStyle = color;
      g.globalAlpha = 0.35 + 0.65 * (i / BARS);
      const x = i * w + w * 0.2;
      roundRect(g, x, (28 - h) / 2, w * 0.6, h, Math.min(2, w * 0.3));
    }
    g.globalAlpha = 1;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.fill();
  }

  function frame() {
    raf = 0;
    if (!state || state.phase !== "listening") return;
    tick++;
    drawWave();
    const left = (state.maxMs || 600000) - (Date.now() - (state.startedAt || Date.now()));
    const timer = $("timer");
    if (left <= 30000) {
      timer.textContent = `${Math.ceil(Math.max(0, left) / 1000)}s left`;
      timer.classList.add("ending");
    } else {
      timer.textContent = fmt(Date.now() - (state.startedAt || Date.now()));
      timer.classList.remove("ending");
    }
    raf = requestAnimationFrame(frame);
  }

  function setAccent(color) {
    document.documentElement.style.setProperty("--accent", COLORS[color] || COLORS.grape);
  }

  function renderPill(s) {
    const pill = $("pill");
    const icon = $("icon");
    const label = $("label");
    const actions = $("actions");
    const wave = $("wave");
    const timer = $("timer");
    pill.hidden = false;
    $("card").hidden = true;
    actions.replaceChildren();
    $("badge").hidden = true;
    label.classList.remove("wrap");
    icon.className = "icon";
    wave.hidden = true;
    timer.hidden = true;
    label.hidden = false;

    if (s.phase === "listening") {
      icon.innerHTML = ICONS.mic;
      wave.hidden = false;
      timer.hidden = false;
      label.textContent = s.replying && s.bot ? `To ${s.bot.name}` : "";
      label.hidden = !label.textContent;
      if (s.handsfree) {
        actions.append(button("done", { icon: "stop", label: "Done", className: "stop" }), button("cancel", { icon: "close", label: "Cancel" }));
      }
      if (!raf) raf = requestAnimationFrame(frame);
    } else if (s.phase === "working") {
      icon.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
      icon.classList.add("info");
      label.textContent = s.bot ? `Sending to ${s.bot.name}…` : "Writing…";
    } else if (s.phase === "done") {
      icon.innerHTML = ICONS.check;
      icon.classList.add("good");
      const text = String(s.text || "").replace(/\s+/g, " ").trim();
      label.textContent = text.length > 48 ? `${text.slice(0, 47)}…` : text || "Typed";
      // Demo mode: it didn't hear you, it typed a sample line.
      $("badge").hidden = !s.simulated;
    } else if (s.phase === "note" || s.phase === "error") {
      icon.innerHTML = s.phase === "error" ? ICONS.warn : ICONS.info;
      icon.classList.add(s.phase === "error" ? "warn" : "info");
      label.textContent = s.message || "";
      label.classList.add("wrap");
      for (const a of s.actions || []) actions.append(button(a, { primary: true }));
      if (s.phase === "error") actions.append(button("dismiss", { icon: "close", label: "Close" }));
    }
  }

  function renderCard(s) {
    $("pill").hidden = true;
    const card = $("card");
    card.hidden = false;
    $("card-bot").textContent = s.bot ? s.bot.name : "Your bot";
    $("card-command").textContent = s.command ? `“${s.command}”` : "";
    $("card-command").hidden = !s.command;
    const text = $("card-text");
    const label = $("card-label");
    const actions = $("card-actions");
    actions.replaceChildren();
    if (s.phase === "asking") {
      label.innerHTML = "";
      const dots = document.createElement("span");
      dots.className = "dots";
      dots.innerHTML = "<i></i><i></i><i></i>";
      label.append(dots, document.createTextNode(` ${String(s.label || "is thinking…").replace(s.bot ? `${s.bot.name} ` : "", "")}`));
      text.textContent = "";
    } else {
      label.textContent = s.approvals ? "needs your OK in the app" : "";
      text.textContent = s.message || "";
    }
    for (const a of s.actions || []) actions.append(button(a, { primary: a === "paste" || a === "reply" && !s.command }));
  }

  function render() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (!state) {
      $("pill").hidden = true;
      $("card").hidden = true;
      document.body.dataset.phase = "";
      return;
    }
    document.body.dataset.phase = state.phase;
    setAccent(state.bot ? state.bot.color : "grape");
    if (state.phase === "asking" || state.phase === "reply") renderCard(state);
    else renderPill(state);
    report();
  }

  function report() {
    const stage = $("stage");
    const r = stage.getBoundingClientRect();
    bridge.size(Math.ceil(r.width), Math.ceil(r.height));
  }

  new ResizeObserver(report).observe($("stage"));
  $("card-close").addEventListener("click", () => bridge.action("dismiss"));
  $("stage").addEventListener("mouseenter", () => bridge.hover(true));
  $("stage").addEventListener("mouseleave", () => bridge.hover(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") bridge.action(state && state.phase === "listening" ? "cancel" : "dismiss");
  });

  bridge.onState((s) => {
    state = s;
    render();
  });
})();
