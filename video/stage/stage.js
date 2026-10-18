/*
 * The promo, as a pure function of time: STAGE.render(t) draws the frame at t seconds. render.mjs
 * calls it once per frame and takes a screenshot; nothing here depends on the wall clock.
 * Inputs (set before init): window.TL (video/timeline.json) and window.VO (video/audio/vo/vo.json).
 * Output for the soundtrack: STAGE.events, every on-screen moment that has a sound.
 */
(() => {
  "use strict";

  // ------------------------------------------------------------------ math
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    linear: (p) => p,
    inCubic: (p) => p * p * p,
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outQuint: (p) => 1 - Math.pow(1 - p, 5),
    inOutQuint: (p) => (p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2),
    outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inExpo: (p) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10)),
    inOutSine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
    outBack: (p, s = 1.6) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2),
  };
  /** Damped spring from 0 to 1, t seconds after release. */
  function spring(t, k = 190, c = 15) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(k), z = c / (2 * Math.sqrt(k));
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  /** Deterministic pseudo-random numbers. */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  /** Piecewise keyframes: [[t, value], ...] with easing into each key. */
  function keys(t, ks, ease = E.inOutCubic) {
    if (t <= ks[0][0]) return ks[0][1];
    for (let i = 1; i < ks.length; i++) {
      if (t <= ks[i][0]) {
        const p = (ease)(prog(t, ks[i - 1][0], ks[i][0]));
        const a = ks[i - 1][1], b = ks[i][1];
        return Array.isArray(a) ? a.map((v, j) => lerp(v, b[j], p)) : lerp(a, b, p);
      }
    }
    return ks[ks.length - 1][1];
  }
  const bez2 = (a, c, b, p) => (1 - p) * (1 - p) * a + 2 * (1 - p) * p * c + p * p * b;

  // ------------------------------------------------------------------ DOM
  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  function icon(name, parent, cls = "ic") {
    const s = el("span", cls, parent);
    s.innerHTML = window.BAB_ICONS[name];
    return s;
  }
  /** Center-anchored placement. */
  function put(e, x, y, s = 1, o = 1, x2 = {}) {
    let tf = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) translate(-50%, -50%)`;
    if (x2.rx) tf += ` perspective(900px) rotateX(${x2.rx.toFixed(2)}deg)`;
    if (x2.r) tf += ` rotate(${x2.r.toFixed(2)}deg)`;
    if (s !== 1 || x2.sx || x2.sy) tf += ` scale(${((x2.sx ?? 1) * s).toFixed(4)}, ${((x2.sy ?? 1) * s).toFixed(4)})`;
    e.style.transform = tf;
    show(e, o, x2.blur);
  }
  function show(e, o, blur) {
    e.style.opacity = o.toFixed(4);
    e.style.visibility = o <= 0.002 ? "hidden" : "visible";
    e.style.filter = blur && blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
  }
  /** Splits text into word spans (spaces kept as text nodes). */
  function words(parent, text, cls = "w") {
    const out = [];
    text.split(" ").forEach((w, i, all) => {
      const s = el("span", cls, parent);
      s.textContent = w;
      out.push(s);
      if (i < all.length - 1) parent.appendChild(document.createTextNode(" "));
    });
    return out;
  }
  /** The house text entrance: rise, sharpen, fade in. */
  function rise(span, t, t0, { dur = 0.6, dy = 34, blur = 14, s0 = 0.97, extra = "" } = {}) {
    const p = E.outExpo(prog(t, t0, t0 + dur));
    span.style.opacity = clamp(p * 1.25).toFixed(4);
    span.style.transform = `translateY(${((1 - p) * dy).toFixed(2)}px) scale(${lerp(s0, 1, p).toFixed(4)})`;
    const b = (1 - p) * blur;
    span.style.filter = (b > 0.05 ? `blur(${b.toFixed(2)}px) ` : "") + extra;
  }
  function sink(span, t, t0, { dur = 0.45, dy = -26, blur = 12 } = {}) {
    const p = E.inCubic(prog(t, t0, t0 + dur));
    if (p <= 0) return false;
    span.style.opacity = (1 - p).toFixed(4);
    span.style.transform = `translateY(${(p * dy).toFixed(2)}px)`;
    span.style.filter = p * blur > 0.05 ? `blur(${(p * blur).toFixed(2)}px)` : "";
    return true;
  }

  /** An avatar with crossfading mood layers (all running their own CSS motion). */
  function avatar(parent, name, moods, size, small = false, phase = 0) {
    const wrap = el("div", "abs avatar", parent);
    wrap.style.width = wrap.style.height = size + "px";
    wrap.dataset.phase = phase;
    const layers = {};
    for (const m of moods) {
      const d = el("div", "svgfill mood", wrap, window.BAB_ASSETS[`${name}-${m}${small ? "-sm" : ""}`]);
      d.dataset.phase = phase;
      layers[m] = d;
    }
    return {
      el: wrap,
      mood(t, schedule) {
        // schedule: [[t, mood], ...]; 0.22 s crossfades.
        const w = {};
        for (const m in layers) w[m] = 0;
        let cur = schedule[0][1];
        w[cur] = 1;
        for (let i = 1; i < schedule.length; i++) {
          const [ts, m] = schedule[i];
          const p = E.inOutSine(prog(t, ts, ts + 0.22));
          if (p <= 0) break;
          for (const k in w) w[k] *= 1 - p;
          w[m] = (w[m] || 0) + p;
          cur = m;
        }
        for (const m in layers) {
          layers[m].style.opacity = (w[m] || 0).toFixed(3);
          layers[m].style.visibility = (w[m] || 0) < 0.002 ? "hidden" : "visible";
        }
      },
    };
  }

  // ------------------------------------------------------------------ timeline data
  let TL, VO, VOW, S;
  const EVENTS = [];
  const ev = (t, type, extra = {}) => EVENTS.push({ t: Math.round(t * 1000) / 1000, type, ...extra });
  const vw = (L, i) => VOW[L][i].s;
  function vf(L, re, nth = 0) {
    let k = 0;
    for (const w of VOW[L]) if (re.test(w.w.toLowerCase())) if (k++ === nth) return w.s;
    throw new Error(`no word ${re} in ${L}`);
  }

  // ------------------------------------------------------------------ stage
  const stage = document.getElementById("stage");
  const R = {};

  function build() {
    TL = window.TL;
    VO = window.VO;
    VOW = {};
    for (const L in VO) VOW[L] = VO[L].words.map((w) => ({ w: w.w, s: TL.vo[L] + w.s, e: TL.vo[L] + w.e }));
    S = TL.scenes;

    R.bgDark = el("div", "layer", stage);
    R.bgDark.id = "bg-dark";
    R.s1 = el("div", "scene", stage);
    R.s1.id = "s1";
    R.world = el("div", "layer", stage);
    R.world.id = "world";
    R.bgLight = el("div", "layer", R.world);
    R.bgLight.id = "bg-light";
    R.s2 = el("div", "scene", R.world);
    R.s3 = el("div", "scene", R.world);
    R.s4 = el("div", "scene", R.world);
    R.s5 = el("div", "scene", R.world);
    R.heroLayer = el("div", "scene", R.world);
    R.top3 = el("div", "scene", R.world); // chips fly above everything in the light world
    R.s6 = el("div", "scene", stage);
    R.s6.id = "s6";
    R.cta = el("div", "layer", stage);
    R.bgCta = el("div", "layer", R.cta);
    R.bgCta.id = "bg-cta";
    el("div", "dots", R.bgCta);
    R.s7 = el("div", "scene", R.cta);
    R.s7.id = "s7";
    R.fx = el("canvas", "", stage);
    R.fx.id = "fx";
    R.fx.width = 1920;
    R.fx.height = 1080;
    R.ctx = R.fx.getContext("2d");
    R.vignette = el("div", "", stage);
    R.vignette.id = "vignette";
    // Film grain is added when encoding (video/build.sh), where it's cheap and also dithers the
    // gradients; set window.STAGE_GRAIN to see it here.
    R.grain = el("div", "", stage);
    R.grain.id = "grain";
    if (window.STAGE_GRAIN) R.grain.style.backgroundImage = `url(${grainTile()})`;
    else R.grain.style.display = "none";

    buildS1();
    buildS2();
    buildS3();
    buildS4();
    buildS5();
    buildS6();
    buildS7();
    R.hero = avatar(R.heroLayer, "otto", ["idle", "happy", "thinking", "working", "listening", "alert"], 330, false, 0.4);
  }

  function grainTile() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const img = g.createImageData(256, 256);
    const r = rng(7);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (r() - 0.5) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }

  // ------------------------------------------------------------------ S1: the question
  function buildS1() {
    R.q1 = el("div", "q display", R.s1);
    R.q2 = el("div", "q display", R.s1);
    R.q1w = words(R.q1, "What if your AI");
    R.q2w = words(R.q2, "was actually");
    R.q2.appendChild(document.createTextNode(" "));
    const y = el("span", "w grad-dark", R.q2);
    y.textContent = "yours?";
    R.q2w.push(y);
    R.orb = el("div", "abs", R.s1);
    R.orb.id = "orb";
    R.ring = el("div", "abs", stage);
    R.ring.id = "iris-ring";
    R.s1t = [...R.q1w, ...R.q2w].map((_, i) => vw("L1", i) - 0.07);
  }

  function renderS1(t) {
    const on = t < S.hook[1] + 0.6;
    show(R.s1, on ? 1 : 0);
    if (!on) return;
    const cam = 1 + 0.035 * E.inOutSine(prog(t, 0, 4.7));
    R.s1.style.transform = `scale(${cam.toFixed(4)})`;
    put(R.q1, 960, 455, 1);
    put(R.q2, 960, 600, 1);
    const all = [...R.q1w, ...R.q2w];
    all.forEach((s, i) => {
      const glow = i === all.length - 1 ? "drop-shadow(0 0 28px rgba(190,150,255,0.55))" : "";
      if (!sink(s, t, 4.22 + i * 0.03, { dur: 0.42, dy: -18, blur: 16 })) rise(s, t, R.s1t[i], { dur: 0.7, dy: 40, blur: 18, extra: glow });
    });
    // The orb gathers at the center, then the light world opens out of it.
    const po = E.outCubic(prog(t, 4.3, 4.9));
    const fade = 1 - E.inOutSine(prog(t, 4.9, 5.25));
    put(R.orb, 960, 540, lerp(0.05, 1.05, po), po * fade);
  }

  // ------------------------------------------------------------------ S2: meet Build-a-bot
  function buildS2() {
    R.eyebrow = el("div", "abs eyebrow", R.s2);
    R.eyebrowW = el("span", "w", R.eyebrow, "Meet");
    R.lockup = el("div", "abs lockup", R.s2);
    R.mark = el("div", "mark svgfill", R.lockup, window.BAB_ASSETS.logo);
    R.word = el("div", "word", R.lockup);
    R.wordLetters = [];
    for (const ch of "Build-a-bot") {
      const s = el("span", "w", R.word);
      s.textContent = ch;
      R.wordLetters.push(s);
    }
    R.sub2 = el("div", "abs sub", R.s2);
    R.sub2w = words(R.sub2, "Your own AI assistant, in about a minute.");
    R.cast = [
      { a: avatar(R.s2, "nimbus", ["idle", "happy"], 250, false, 1.3), x: 660, y: 690, t: 5.34 },
      { a: avatar(R.s2, "sprout", ["idle", "happy"], 250, false, 2.1), x: 1260, y: 690, t: 5.44 },
      { a: avatar(R.s2, "blip", ["idle", "happy"], 220, false, 0.7), x: 390, y: 742, t: 5.54 },
      { a: avatar(R.s2, "ember", ["idle", "happy"], 220, false, 1.7), x: 1530, y: 742, t: 5.64 },
    ];
    R.steps = el("div", "abs steps", R.s2);
    R.stepEls = [];
    ["Face", "Name", "Brain", "Apps", "Talk"].forEach((label, i) => {
      if (i) {
        const line = el("div", "step-line", R.steps);
        R.stepEls.push({ line: el("i", "", line) });
      }
      const st = el("div", "step", R.steps);
      const num = el("span", "num", st, String(i + 1));
      const chk = icon("Check", num);
      el("span", "", st, label);
      R.stepEls.push({ st, num, chk });
    });
    R.stepT = [0, 1, 2, 3, 4].map((k) => 7.72 + k * 0.27);

    ev(5.08, "pop", { p: 0 });
    R.cast.forEach((c, i) => ev(c.t, "pop", { p: i + 1 }));
    R.stepT.forEach((ts, i) => ev(ts, "tick", { p: i }));
  }

  function renderS2(t) {
    const on = t > 4.6 && t < S.reveal[1] + 0.5;
    show(R.s2, on ? 1 : 0);
    if (!on) return;
    const out = (i) => prog(t, 9.5 + i * 0.05, 9.95 + i * 0.05);
    // Header.
    const tE = vw("L2", 0) - 0.12;
    rise(R.eyebrowW, t, tE, { dur: 0.6, dy: 20, blur: 8 });
    put(R.eyebrow, 960, 158 - 30 * E.inCubic(out(0)), 1, 1 - E.inCubic(out(0)));
    const tM = vw("L2", 1) - 0.16;
    const sm = spring(t - tM, 230, 14);
    put(R.lockup, 960, 262 - 34 * E.inCubic(out(1)), 1, 1 - E.inCubic(out(1)));
    R.mark.style.transform = `scale(${sm.toFixed(4)}) rotate(${((1 - sm) * -18).toFixed(2)}deg)`;
    R.mark.style.opacity = clamp(sm * 2).toFixed(3);
    R.wordLetters.forEach((s, i) => rise(s, t, tM + 0.06 + i * 0.022, { dur: 0.55, dy: 30, blur: 10 }));
    R.sub2w.forEach((s, i) => rise(s, t, vw("L2", i + 2) - 0.08, { dur: 0.55, dy: 22, blur: 8 }));
    put(R.sub2, 960, 378 - 30 * E.inCubic(out(2)), 1, 1 - E.inCubic(out(2)));
    // The cast pops in around Otto.
    R.cast.forEach((c, i) => {
      const s = spring(t - c.t, 210, 13);
      // Out sideways and up, clearing the way before Otto moves left.
      const o = E.inCubic(prog(t, 9.28 + i * 0.04, 9.72 + i * 0.04));
      const side = c.x < 960 ? -1 : 1;
      put(c.a.el, c.x + side * 140 * o, c.y + (1 - s) * 60 - 90 * o, Math.max(s, 0.001) * (1 - 0.15 * o), clamp(s * 3) * (1 - o), { r: (1 - s) * (i % 2 ? 14 : -14) + side * 10 * o });
      c.a.mood(t, [[0, "idle"], [9.1 + i * 0.06, "happy"]]);
    });
    // Five quick choices.
    const so = E.inCubic(prog(t, 9.55, 9.95));
    put(R.steps, 960, 968 + 40 * so, 1, clamp(prog(t, 7.35, 7.7)) * (1 - so));
    let k = 0;
    R.stepEls.forEach((s) => {
      if (s.line) {
        const ts = R.stepT[k];
        s.line.style.transform = `scaleX(${E.outCubic(prog(t, ts - 0.22, ts)).toFixed(3)})`;
        return;
      }
      const ts = R.stepT[k++];
      const p = E.outBack(prog(t, ts, ts + 0.35));
      const on2 = t >= ts;
      s.st.classList.toggle("on", on2);
      s.num.style.background = on2 ? "var(--primary)" : "var(--bg-2)";
      s.num.style.color = on2 ? "transparent" : "var(--muted)";
      s.num.style.transform = `scale(${on2 ? lerp(0.6, 1, p) : 1})`;
      s.chk.style.opacity = on2 ? clamp(p).toFixed(3) : "0";
      s.st.style.borderColor = on2 ? "rgb(124 92 255 / 0.45)" : "";
    });
  }

  // ------------------------------------------------------------------ S3: smarter the more you use it
  const CHIPS = [
    { icon: "Cake", text: "Sam · sister · June 3", x: 330, y: 330 },
    { icon: "User", text: "Priya · your manager", x: 668, y: 410 },
    { icon: "Footprints", text: "Sunday run · 8 am", x: 196, y: 626 },
    { icon: "Mail", text: "Short emails, signed D", x: 690, y: 770 },
    { icon: "Leaf", text: "Vegetarian · no peanuts", x: 360, y: 900 },
  ];
  const TEACH = [
    { text: "My sister Sam’s birthday is June 3.", chip: "Sam’s birthday is June 3", day: "Day 1" },
    { text: "Priya is my manager.", chip: "Priya is your manager", day: "Day 4" },
    { text: "I run every Sunday at 8.", chip: "You run Sundays at 8", day: "Week 2" },
    { text: "Keep my emails short. Sign them D.", chip: "Short emails, signed D", day: "Month 2" },
    { text: "I’m vegetarian. No peanuts, ever.", chip: "Vegetarian, no peanuts", day: "Month 3" },
  ];
  const CHAT = { x: 1340, y: 640, w: 900, h: 640 };
  const HERO3 = { x: 430, y: 610 };

  function buildS3() {
    R.h3 = el("div", "abs", R.s3);
    R.h3a = el("div", "display", R.h3);
    R.h3b = el("div", "display", R.h3);
    R.h3.style.fontSize = "92px";
    R.h3aw = words(R.h3a, "Gets smarter");
    R.h3bw = words(R.h3b, "the more you use it.");
    R.h3bw[R.h3bw.length - 1].classList.add("grad");
    R.h3bw[R.h3bw.length - 2].classList.add("grad");
    R.h3bw[R.h3bw.length - 3].classList.add("grad");
    R.h3t = [1, 2, 3, 4, 5, 6, 7].map((i) => vw("L3", i) - 0.06);

    R.orbitGlow = el("div", "abs", R.s3);
    R.orbitGlow.id = "orbit-glow";
    R.orbit = el("div", "abs", R.s3);
    R.orbit.id = "orbit";

    // The chat card.
    R.chat = el("div", "abs card chat", R.s3);
    const head = el("div", "chat-head", R.chat);
    const hav = el("div", "av", head);
    R.chatAv = avatar(hav, "otto", ["idle", "happy", "thinking"], 58, true, 0.9);
    R.chatAv.el.style.position = "absolute";
    R.chatAv.el.style.left = "0";
    R.chatAv.el.style.top = "0";
    const who = el("div", "", head);
    const nm = el("div", "name", who, "Otto ");
    nm.appendChild(el("span", "badge", null, "AI assistant"));
    const st = el("div", "status", who);
    el("span", "dot", st);
    el("span", "", st, "Online · Nemotron 3.5 Lightning");
    const day = el("div", "day", head);
    R.days = TEACH.map((m) => el("span", "", day, m.day)).concat([el("span", "", day, "Month 6")]);
    R.body = el("div", "chat-body", R.chat);
    const comp = el("div", "composer", R.chat);
    icon("Paperclip", comp);
    el("span", "", comp, "Message Otto…");
    const send = el("div", "send", comp);
    icon("ArrowUp", send);

    // Messages: teaching, then the payoff.
    R.msgs = [];
    const T0 = [12.72, 13.74, 14.86, 15.96, 16.9];
    TEACH.forEach((m, i) => {
      R.msgs.push(msg("user", m.text, T0[i], 17.95));
      R.msgs.push(msg("tool", m.chip, T0[i] + 0.34, 17.95));
    });
    R.ask = msg("user", "What should I cook for Sam’s birthday?", 18.28, 99);
    R.msgs.push(R.ask);
    R.typing = msg("typing", "", 18.7, 99, 19.22);
    R.msgs.push(R.typing);
    R.reply = msg("bot", "", 19.22, 99);
    R.msgs.push(R.reply);
    const b = R.reply.bubble;
    const parts = [["Lemon-ricotta pasta:", 0], ["vegetarian, peanut-free,", 1], ["done in 25 minutes.", 0], ["Add it to", 0], ["June 3?", 2]];
    R.replyWords = [];
    R.hl = {};
    parts.forEach(([txt, hl], i) => {
      const host = hl ? el("span", "hl", b) : b;
      if (hl) R.hl[hl] = host;
      txt.split(" ").forEach((w, j, arr) => {
        const s = el("span", "w", host);
        s.textContent = w;
        R.replyWords.push(s);
        if (j < arr.length - 1) host.appendChild(document.createTextNode(" "));
      });
      if (i < parts.length - 1) b.appendChild(document.createTextNode(" "));
    });
    R.replyT = R.replyWords.map((_, i) => 19.3 + i * 0.085);

    // Links first, so the chips sit on top of them.
    R.links = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    R.top3.appendChild(R.links);
    // Chips (in the top layer so they can fly anywhere).
    R.chips = CHIPS.map((c) => {
      const e = el("div", "abs chip", R.top3);
      const ci = el("span", "ci", e);
      icon(c.icon, ci);
      el("span", "", e, c.text);
      return { ...c, el: e };
    });
    R.chipT = T0.map((t) => t + 0.34);
    R.counter = el("div", "abs counter", R.s3);
    icon("Brain", R.counter);
    R.countB = el("b", "", R.counter, "0");
    el("span", "", R.counter, "memories");

    R.links.setAttribute("id", "links");
    R.links.setAttribute("viewBox", "0 0 1920 1080");
    R.links.setAttribute("width", "1920");
    R.links.setAttribute("height", "1080");
    R.links.innerHTML = `<defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#9b85ff"/><stop offset="1" stop-color="#5b3cf0"/></linearGradient></defs>`;
    R.link = [0, 1].map(() => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "url(#lg)");
      p.setAttribute("stroke-width", "3.5");
      p.setAttribute("stroke-linecap", "round");
      R.links.appendChild(p);
      const d = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      d.setAttribute("r", "7");
      d.setAttribute("fill", "#fff");
      d.setAttribute("stroke", "#7c5cff");
      d.setAttribute("stroke-width", "3");
      R.links.appendChild(d);
      return { p, d };
    });
    R.linkT = [19.42, 20.12];

    T0.forEach((t, i) => ev(t, "send", { p: i }));
    R.chipT.forEach((t, i) => ev(t + 0.62, "chime", { p: i }));
    ev(18.28, "send", { p: 5 });
    ev(19.22, "pop", { p: 6, soft: 1 });
    R.linkT.forEach((t, i) => ev(t, "sparkle", { p: i }));
    ev(17.35, "count");
  }

  function msg(kind, text, tIn, tOut, tEnd = 999) {
    const row = el("div", `msg ${kind === "user" ? "user" : "bot"}`, null);
    let bubble;
    if (kind === "tool") {
      const sp = el("span", "", row);
      sp.style.width = "58px";
      sp.style.flex = "none";
      bubble = el("div", "toolchip", row);
      icon("Check", bubble);
      el("span", "", bubble, `Remembered: “${text}”`);
    } else if (kind === "typing") {
      const av = el("div", "bav", row);
      avatar(av, "otto", ["thinking"], 46, true, 0.2).el.style.cssText += "left:0;top:0;";
      bubble = el("div", "bubble typing", row);
      R.dots = [el("i", "", bubble), el("i", "", bubble), el("i", "", bubble)];
    } else {
      if (kind === "bot") {
        const av = el("div", "bav", row);
        avatar(av, "otto", ["happy"], 46, true, 0.5).el.style.cssText += "left:0;top:0;";
      }
      bubble = el("div", "bubble", row, kind === "bot" ? "" : text);
    }
    return { kind, row, bubble, tIn, tOut, tEnd, h: 0 };
  }

  function layoutS3() {
    // Measure every message once, fonts loaded.
    R.msgs.forEach((m) => {
      R.body.appendChild(m.row);
      m.h = m.row.getBoundingClientRect().height;
    });
    // The reply grows as it types; measure its final height.
    R.replyWords.forEach((s) => (s.style.opacity = 1));
    R.reply.h = R.reply.row.getBoundingClientRect().height;
  }

  function chipPos(i, t) {
    // Before landing: flying from its message; after: settled in orbit with a gentle drift.
    const c = R.chips[i];
    const drift = [Math.sin(t * 0.7 + i * 1.7) * 5, Math.cos(t * 0.6 + i * 2.3) * 4];
    return [c.x + drift[0], c.y + drift[1]];
  }

  function renderS3(t) {
    const on = t > S.smarter[0] - 0.6 && t < S.smarter[1] + 0.9;
    show(R.s3, on ? 1 : 0);
    const chipsOn = t > 12.9 && t < S.data[0] + 0.9;
    show(R.top3, chipsOn ? 1 : 0);
    if (!on && !chipsOn) return;
    const exitP = E.inCubic(prog(t, 21.9, 22.4));
    // Headline.
    put(R.h3, 890 + 470, 212 - 40 * exitP, 1, 1 - exitP);
    R.h3.style.width = "940px";
    [...R.h3aw, ...R.h3bw].forEach((s, i) => rise(s, t, R.h3t[i], { dur: 0.6, dy: 30, blur: 12 }));
    // Orbit.
    const orbIn = E.outCubic(prog(t, 10.3, 11.2)) * (1 - E.inCubic(prog(t, 21.9, 22.5)));
    put(R.orbitGlow, HERO3.x, HERO3.y, lerp(0.7, 1, orbIn), orbIn);
    put(R.orbit, HERO3.x, HERO3.y, lerp(0.8, 1, orbIn), orbIn * 0.9, { r: t * 6 });
    // Chat card.
    const cin = E.outExpo(prog(t, 10.55, 11.35));
    put(R.chat, CHAT.x + (1 - cin) * 120 + exitP * 160, CHAT.y, 1, cin * (1 - exitP));
    // Day chip.
    const dayT = [12.6, 13.62, 14.74, 15.84, 16.78, 17.4];
    R.days.forEach((d, i) => {
      const a = dayT[i], b = dayT[i + 1] ?? 99;
      const pin = E.outCubic(prog(t, a, a + 0.25)), pout = E.inCubic(prog(t, b - 0.05, b + 0.15));
      d.style.opacity = (t < a ? 0 : pin * (1 - pout)).toFixed(3);
      d.style.transform = `translateY(${((1 - pin) * 14 - pout * 14).toFixed(2)}px)`;
    });
    // Messages stack from the bottom of the body; each new one pushes the rest up.
    const bodyH = CHAT.h - 104 - 110;
    const gap = 14;
    const vis = R.msgs.filter((m) => t >= m.tIn - 0.01 && t < m.tOut + 0.5 && t < m.tEnd + 0.3);
    let acc = 0;
    for (let i = vis.length - 1; i >= 0; i--) {
      const m = vis[i];
      const g = E.outCubic(prog(t, m.tIn, m.tIn + 0.38));
      const outP = E.inCubic(prog(t, m.tOut, m.tOut + 0.35));
      const endP = E.inCubic(prog(t, m.tEnd, m.tEnd + 0.15));
      const h = m === R.reply ? lerp(70, m.h, E.outCubic(prog(t, m.tIn, R.replyT[R.replyT.length - 1] + 0.1))) : m.h;
      const y = bodyH - 22 - acc - h;
      m.row.style.transform = `translateY(${(y + (1 - g) * 24 - outP * 40).toFixed(2)}px)`;
      m.row.style.opacity = (clamp(g * 1.5) * (1 - outP) * (1 - endP)).toFixed(3);
      acc += (h + gap) * g * (1 - endP);
    }
    R.msgs.forEach((m) => {
      if (!vis.includes(m)) m.row.style.opacity = "0";
    });
    if (R.dots) R.dots.forEach((d, i) => (d.style.transform = `translateY(${(-6 * Math.max(0, Math.sin((t - 18.7) * 9 - i * 0.9))).toFixed(2)}px)`));
    R.replyWords.forEach((s, i) => rise(s, t, R.replyT[i], { dur: 0.35, dy: 10, blur: 6 }));
    // Highlights glow as the link arrives.
    [1, 2].forEach((k, j) => {
      const p = E.outCubic(prog(t, R.linkT[j] + 0.35, R.linkT[j] + 0.6));
      R.hl[k].style.setProperty("--hl", (0.16 * p).toFixed(3));
      R.hl[k].style.color = p > 0.5 ? "var(--primary)" : "";
      R.hl[k].style.fontWeight = p > 0.5 ? "650" : "";
    });
    R.chatAv.mood(t, [[0, "idle"], [18.7, "thinking"], [19.25, "happy"]]);

    // Chips: born at their tool message, fly into orbit, glow when used, then become memory rows.
    R.chips.forEach((c, i) => {
      const t0 = R.chipT[i];
      if (t < t0) {
        show(c.el, 0);
        return;
      }
      const msgRow = R.msgs[i * 2 + 1];
      const r0 = msgRow.bubble.getBoundingClientRect();
      const sx = r0.left + 200, sy = r0.top + r0.height / 2;
      const [tx, ty] = chipPos(i, t);
      const p = E.inOutCubic(prog(t, t0 + 0.05, t0 + 0.62));
      const land = spring(t - (t0 + 0.62), 260, 12);
      let x = bez2(sx, (sx + tx) / 2, tx, p);
      let y = bez2(sy, Math.min(sy, ty) - 180, ty, p);
      let s = lerp(0.55, 1, p) * (p >= 1 ? lerp(0.92, 1, land) : 1);
      let o = clamp(prog(t, t0, t0 + 0.12));
      // Toward S4: each chip lands on its memory row.
      const q = E.inOutCubic(prog(t, 21.95 + i * 0.04, 22.7 + i * 0.04));
      if (q > 0) {
        const row = R.rowPos[i];
        x = lerp(x, row[0], q);
        y = lerp(y, row[1], q);
        s = lerp(s, 0.9, q);
        o *= 1 - E.inCubic(prog(t, 22.45 + i * 0.04, 22.68 + i * 0.04));
      }
      put(c.el, x, y, s, o);
      // Glow when the payoff uses it.
      const used = (i === 0 && t > R.linkT[1]) || (i === 4 && t > R.linkT[0]);
      c.el.classList.toggle("lit", used && t < 21.95);
      c.el.style.boxShadow = used && t < 21.95 ? `0 0 0 ${(6 * E.outCubic(prog(t, used ? (i === 0 ? R.linkT[1] : R.linkT[0]) : 0, 99))).toFixed(1)}px rgb(124 92 255 / 0.18), 0 10px 30px -10px rgb(32 24 12 / 0.22)` : "";
    });
    // Counter: one per lesson, then months of use.
    const landed = R.chipT.filter((t0) => t >= t0 + 0.62).length;
    const months = E.outCubic(prog(t, 17.35, 18.35));
    const n = Math.round(lerp(landed, 214, months));
    R.countB.textContent = String(n);
    const cIn = E.outCubic(prog(t, 13.2, 13.6)) * (1 - E.inCubic(prog(t, 21.9, 22.3)));
    put(R.counter, HERO3.x, 1012, lerp(0.9, 1, cIn), cIn);

    // Links from memory to answer.
    R.link.forEach((L, j) => {
      const t0 = R.linkT[j];
      const p = E.inOutCubic(prog(t, t0, t0 + 0.5));
      const fadeL = 1 - E.inCubic(prog(t, 21.6, 22.0));
      if (p <= 0 || fadeL <= 0) {
        L.p.style.opacity = 0;
        L.d.style.opacity = 0;
        return;
      }
      const chip = R.chips[j === 0 ? 4 : 0].el.getBoundingClientRect();
      const bub = R.reply.bubble.getBoundingClientRect();
      const ax = chip.right - 10, ay = chip.top + chip.height / 2;
      const bx = bub.left - 2, by = bub.top + bub.height * (j === 0 ? 0.36 : 0.7);
      const d = `M ${ax} ${ay} C ${ax + 200} ${ay}, ${bx - 220} ${by}, ${bx} ${by}`;
      L.p.setAttribute("d", d);
      const len = L.p.getTotalLength();
      L.p.style.strokeDasharray = `${len}`;
      L.p.style.strokeDashoffset = `${(len * (1 - p)).toFixed(1)}`;
      L.p.style.opacity = (0.9 * fadeL).toFixed(3);
      const pt = L.p.getPointAtLength(len * p);
      L.d.setAttribute("cx", pt.x.toFixed(1));
      L.d.setAttribute("cy", pt.y.toFixed(1));
      L.d.style.opacity = ((p < 1 ? 1 : 1 - prog(t, t0 + 0.5, t0 + 0.8)) * fadeL).toFixed(3);
    });
  }

  // ------------------------------------------------------------------ S4: own your data
  const PANEL = { x: 600, y: 585, w: 900, h: 830 };
  const ROWS = [
    { icon: "Cake", text: "Sam · sister · birthday June 3", meta: "Otto learned this · 4 months ago" },
    { icon: "User", text: "Priya · your manager", meta: "Otto learned this · 4 months ago" },
    { icon: "Footprints", text: "Sunday run · 8 am", meta: "Otto learned this · 3 months ago" },
    { icon: "Mail", text: "Short emails, signed D", meta: "Otto learned this · 2 months ago" },
    { icon: "Leaf", text: "Vegetarian · no peanuts", meta: "Otto learned this · 2 months ago" },
  ];
  const ROW_TOP = 282, ROW_STEP = 88;

  function buildS4() {
    R.panel = el("div", "abs card panel", R.s4);
    R.panel.style.height = PANEL.h + "px";
    const head = el("div", "panel-head", R.panel);
    el("h3", "", head, "Memory");
    el("p", "", head, "What Otto knows about you.");
    R.exportBtn = el("div", "btn-export", R.panel);
    icon("Download", R.exportBtn);
    el("span", "", R.exportBtn, "Export everything");
    const lock = el("div", "lockrow", R.panel);
    const li = el("span", "li", lock);
    icon("Lock", li);
    el("span", "", lock, "<b>This stays with Otto.</b> Change or delete anything, anytime.");
    const rows = el("div", "rows", R.panel);
    R.rows = ROWS.map((r, i) => {
      const row = el("div", "row", rows);
      const av = el("div", "rav", row);
      const a = avatar(av, "otto", ["idle"], 50, true, i * 0.37);
      a.el.style.left = "0";
      a.el.style.top = "0";
      const tx = el("div", "", row);
      const txt = el("div", "txt", tx);
      const meta = el("div", "meta", tx, r.meta);
      const acts = el("div", "acts", row);
      const pen = el("span", "", acts);
      icon("Pencil", pen);
      const bin = el("span", "", acts);
      icon("Trash2", bin);
      const edit = el("div", "editbox", row);
      txt.textContent = r.text;
      return { row, txt, meta, pen, bin, edit };
    });
    R.foot4 = el("div", "panel-foot", R.panel, "214 memories · Otto keeps up to 2,000 and uses the ones that matter");
    R.rowPos = ROWS.map((_, i) => [PANEL.x - PANEL.w / 2 + 40 + 74 + 170, PANEL.y - PANEL.h / 2 + ROW_TOP + i * ROW_STEP + 38]);

    R.h4 = el("div", "abs display", R.s4);
    R.h4.style.fontSize = "104px";
    R.h4w = words(R.h4, "Own your data.");
    R.h4w.slice(2).forEach((s) => s.classList.add("grad"));
    R.acts = [
      ["Eye", "See it", /^see/],
      ["Pencil", "Change it", /^change/],
      ["Download", "Export it", /^export/],
      ["Trash2", "Delete it", /^delete/],
    ].map(([ic, label, re], i) => {
      const a = el("div", "abs act", R.s4);
      const ai = el("span", "ai", a);
      icon(ic, ai);
      el("span", "", a, label);
      return { el: a, t: vf("L4", re) - 0.12, i };
    });
    R.promises = [
      ["ShieldCheck", "We never sell it", /^sell/],
      ["Ban", "We never train AI on it", /^train/],
    ].map(([ic, label, re]) => {
      const p = el("div", "abs promise", R.s4);
      icon(ic, p);
      el("span", "", p, label);
      return { el: p, t: vf("L4", re) - 0.15 };
    });
    R.file = el("div", "abs filecard", R.s4);
    const fi = el("span", "fi", R.file);
    icon("FileJson", fi);
    el("span", "", R.file, "otto-memories.json");
    R.toast = el("div", "abs toast", R.s4);
    icon("CircleCheck", R.toast);
    el("span", "", R.toast, "Exported to your computer");
    R.cursor = el("div", "abs", R.s4);
    R.cursor.id = "cursor";
    R.cursor.innerHTML = `<svg viewBox="0 0 32 32" width="44" height="44"><path d="M7 4.5v20.2l5.3-5.1 3.4 7.9 3.6-1.5-3.4-7.8h7.4z" fill="#16151c" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;

    const tSee = vf("L4", /^see/), tCh = vf("L4", /^change/), tEx = vf("L4", /^export/), tDel = vf("L4", /^delete/);
    R.t4 = { tSee, tCh, tEx, tDel };
    const py = (i) => PANEL.y - PANEL.h / 2 + ROW_TOP + i * ROW_STEP + 38;
    const pen = (i) => [PANEL.x + PANEL.w / 2 - 40 - 18 - 21 - 52, py(i)];
    const bin = (i) => [PANEL.x + PANEL.w / 2 - 40 - 18 - 21, py(i)];
    const exp = [PANEL.x + PANEL.w / 2 - 40 - 118, PANEL.y - PANEL.h / 2 + 46 + 25];
    R.cur = [
      [tSee - 0.4, [1180, 1010]],
      [tSee + 0.08, [560, py(0) + 8]],
      [tSee + 0.7, [600, py(4) + 8]],
      [tCh - 0.05, [pen(2)[0] + 8, pen(2)[1] + 10]],
      [tCh + 0.85, [pen(2)[0] + 8, pen(2)[1] + 10]],
      [tEx - 0.06, [exp[0] + 10, exp[1] + 12]],
      [tEx + 0.6, [exp[0] + 10, exp[1] + 12]],
      [tDel - 0.06, [bin(1)[0] + 8, bin(1)[1] + 10]],
      [tDel + 0.5, [bin(1)[0] + 8, bin(1)[1] + 10]],
      [tDel + 1.1, [1110, 900]],
    ];
    R.clicks = [tCh + 0.02, tEx + 0.02, tDel + 0.02];
    R.clicks.forEach((t) => ev(t, "click"));
    ev(tCh + 0.22, "type");
    ev(tCh + 0.4, "type");
    ev(tEx + 0.1, "whoosh", { soft: 1 });
    ev(tDel + 0.07, "poof");
    R.acts.forEach((a) => ev(a.t + 0.05, "tick", { p: a.i + 2 }));
    R.promises.forEach((p, i) => ev(p.t, "stamp", { p: i }));
  }

  function renderS4(t) {
    const on = t > S.data[0] - 0.4 && t < S.data[1] + 0.8;
    show(R.s4, on ? 1 : 0);
    if (!on) return;
    const { tSee, tCh, tEx, tDel } = R.t4;
    // Panel in, then out toward the memory capsule of S5.
    const pin = E.outExpo(prog(t, 22.35, 23.05));
    const pout = E.inOutCubic(prog(t, 31.7, 32.45));
    const px = lerp(PANEL.x, 560, pout), py = lerp(PANEL.y, 720, pout);
    put(R.panel, px - (1 - pin) * 80, py + (1 - pin) * 30, lerp(lerp(0.96, 1, pin), 0.32, pout), pin * (1 - E.inCubic(prog(t, 32.0, 32.5))));
    // Rows: appear as the chips land; row 1 is deleted.
    R.rows.forEach((r, i) => {
      const a = E.outCubic(prog(t, 22.58 + i * 0.04, 22.92 + i * 0.04));
      let y = i * ROW_STEP;
      let o = a, sx = 1;
      if (i > 1) y -= ROW_STEP * E.inOutCubic(prog(t, tDel + 0.18, tDel + 0.62));
      if (i === 1) {
        const d = E.inCubic(prog(t, tDel + 0.06, tDel + 0.36));
        o *= 1 - d;
        sx = 1 - 0.06 * d;
      }
      r.row.style.transform = `translateY(${y.toFixed(2)}px) scale(${sx.toFixed(4)})`;
      r.row.style.opacity = o.toFixed(3);
      // "See it": a highlight follows the cursor down the list.
      const scan = prog(t, tSee + 0.08, tSee + 0.7) * 4;
      const near = t > tSee && t < tSee + 0.85 ? Math.max(0, 1 - Math.abs(scan - i) * 1.2) : 0;
      const edit = i === 2 && t > tCh + 0.06 && t < tCh + 0.75 ? 1 : 0;
      r.row.style.background = near > 0 ? `rgb(239 234 255 / ${near.toFixed(3)})` : "#fff";
      r.row.style.borderColor = near > 0.3 || edit ? "rgb(124 92 255 / 0.4)" : "";
      r.edit.style.opacity = edit ? "1" : "0";
      const showActs = (i === 2 && t > tCh - 0.5 && t < tCh + 0.8) || (i === 1 && t > tDel - 0.5) || near > 0.5;
      r.pen.parentElement.style.opacity = showActs ? "1" : "0.35";
    });
    // Change it: 8 am becomes 9 am.
    const r2 = R.rows[2];
    const base = "Sunday run · ";
    let val = "8 am", caret = false;
    if (t > tCh + 0.06) {
      caret = t < tCh + 0.75;
      if (t > tCh + 0.2) val = " am";
      if (t > tCh + 0.38) val = "9 am";
    }
    r2.txt.innerHTML = base + val.replace(/^ /, "") + (caret ? '<span class="caret"></span>' : "");
    if (t > tCh + 0.06 && t < tCh + 0.2) r2.txt.innerHTML = base + "8 am" + '<span class="caret"></span>';
    if (t > tCh + 0.2 && t < tCh + 0.38) r2.txt.innerHTML = base + '<span class="caret"></span> am';
    r2.meta.textContent = t > tCh + 0.75 ? "Updated · just now" : ROWS[2].meta;
    r2.meta.style.color = t > tCh + 0.75 ? "var(--success)" : "";
    R.foot4.textContent = (t > tDel + 0.3 ? "213" : "214") + " memories · Otto keeps up to 2,000 and uses the ones that matter";
    // Export: the file leaves the panel; a toast confirms.
    const fp = E.outBack(prog(t, tEx + 0.06, tEx + 0.36));
    const ff = E.inOutCubic(prog(t, tEx + 0.42, tEx + 1.05));
    const ex = [PANEL.x + PANEL.w / 2 - 158, PANEL.y - PANEL.h / 2 + 71];
    put(R.file, lerp(ex[0], 1000, ff), lerp(ex[1] + 70 * fp, 1060, ff), lerp(0.4, 1, fp) * lerp(1, 0.6, ff), clamp(fp * 2) * (1 - E.inCubic(prog(t, tEx + 0.8, tEx + 1.05))));
    const tp = E.outBack(prog(t, tEx + 0.75, tEx + 1.05)) * (1 - E.inCubic(prog(t, tEx + 2.1, tEx + 2.4)));
    put(R.toast, 600, 1022 + (1 - tp) * 30, lerp(0.9, 1, tp), clamp(tp));
    // Cursor.
    const cIn = clamp(prog(t, tSee - 0.4, tSee - 0.2)) * (1 - prog(t, tDel + 0.85, tDel + 1.1));
    const [cx, cy] = keys(t, R.cur, E.inOutCubic);
    const click = R.clicks.reduce((m, c) => Math.max(m, 1 - Math.abs(t - c - 0.05) / 0.08), 0);
    put(R.cursor, cx + 14, cy + 14, 1 - 0.14 * clamp(click), cIn * (1 - pout));
    // Right column.
    const out4 = E.inCubic(prog(t, 31.65, 32.1));
    const tH = TL.vo.L4 + 0.25;
    R.h4w.forEach((s, i) => rise(s, t, tH + i * 0.12, { dur: 0.65, dy: 34, blur: 14 }));
    put(R.h4, 1120 + 360, 262 - 30 * out4, 1, 1 - out4);
    R.h4.style.width = "720px";
    R.acts.forEach((a, i) => {
      const p = E.outExpo(prog(t, a.t, a.t + 0.5));
      put(a.el, 1120 + 200, 418 + i * 86 - 20 * out4, lerp(0.94, 1, p), clamp(p * 1.4) * (1 - out4), { blur: (1 - p) * 8 });
      a.el.style.width = "400px";
      a.el.style.color = t > a.t + 0.1 ? "var(--ink)" : "var(--muted)";
    });
    R.promises.forEach((p, i) => {
      const s = spring(t - p.t, 300, 16);
      put(p.el, 1120 + (i ? 214 : 172), 790 + i * 92 - 20 * out4, lerp(1.25, 1, clamp(s)), clamp(s * 2) * (1 - out4));
    });
  }

  // ------------------------------------------------------------------ S5: own your intelligence
  const BRAINS = [
    { icon: "Brain", bg: "#f1ede6", fg: "#6a6677", t1: "Choose its brain", t2: "The AI model it thinks with" },
    { icon: "Cpu", bg: "#eef7dc", fg: "#4f7f00", t1: "NVIDIA Nemotron", t2: "Open model · on Nebius Token Factory" },
    { icon: "KeyRound", bg: "#efeaff", fg: "#5b3cf0", t1: "Your own API key", t2: "Anthropic, OpenAI, Gemini and more · encrypted" },
    { icon: "Laptop", bg: "#fff1e6", fg: "#c2560f", t1: "Your Claude plan", t2: "Thinks through your own computer" },
    { icon: "Laptop", bg: "#e3f8ef", fg: "#0b7f53", t1: "Your ChatGPT plan", t2: "Thinks through your own computer" },
    { icon: "Cpu", bg: "#f1ede6", fg: "#5b3cf0", t1: "Qwen3 30B", t2: "Open model" },
    { icon: "Cpu", bg: "#f1ede6", fg: "#5b3cf0", t1: "gpt-oss-120b", t2: "Open model" },
    { icon: "Cpu", bg: "#f1ede6", fg: "#5b3cf0", t1: "DeepSeek V4 Flash", t2: "Open model" },
    { icon: "Cpu", bg: "#eef7dc", fg: "#4f7f00", t1: "Nemotron 3 Super", t2: "Open model · NVIDIA" },
    { icon: "Laptop", bg: "#fff1e6", fg: "#c2560f", t1: "Your Claude plan", t2: "Thinks through your own computer" },
    { icon: "Cpu", bg: "#eef7dc", fg: "#4f7f00", t1: "NVIDIA Nemotron 3.5 Lightning", t2: "Open model · on Nebius Token Factory" },
  ];

  function buildS5() {
    R.h5 = el("div", "abs display", R.s5);
    R.h5.style.fontSize = "100px";
    R.h5w = words(R.h5, "Own your intelligence.");
    R.h5w.slice(2).forEach((s) => s.classList.add("grad"));
    R.sub5 = el("div", "abs sub", R.s5);
    R.sub5w = words(R.sub5, "Pick any brain. Switch anytime.");
    R.blabel = el("div", "abs brain-label", R.s5, "BRAIN");
    R.ripples = [0, 1, 2].map(() => el("div", "abs ripple", R.s5));
    R.bwrap = el("div", "abs brain-wrap", R.s5);
    R.cap = el("div", "cap", R.bwrap);
    R.capI = el("span", "ci", R.cap);
    R.capTx = el("div", "", R.cap);
    R.capT1 = el("div", "t1", R.capTx);
    R.capT2 = el("div", "t2", R.capTx);
    R.thread = el("div", "abs thread", R.s5);
    R.pulseDot = el("div", "abs pulse", R.s5);
    R.memSide = side(R.s5, "Brain", "213 memories");
    R.appSide = side(R.s5, "Puzzle", "12 apps · 5 routines");
    R.oss = el("div", "abs oss", R.s5);
    icon("Code2", R.oss);
    el("span", "", R.oss, "Open source · Apache 2.0");

    const tN = vf("L5", /^nvidia/), tK = vf("L5", /^your/, 1), tC = vf("L5", /^claude/), tG = vf("L5", /^chat/), tS = vf("L5", /^switch/), tKeep = vf("L5", /^keeps/);
    R.bt = [
      [34.4, 0],
      [tN - 0.06, 1],
      [tK + 0.1, 2],
      [tC - 0.05, 3],
      [tG - 0.05, 4],
      [tS - 0.02, 5],
      [tS + 0.17, 6],
      [tS + 0.33, 7],
      [tS + 0.48, 8],
      [tS + 0.62, 9],
      [tS + 0.82, 10],
    ];
    R.tKeep = tKeep;
    R.bt.slice(1).forEach(([t], i) => ev(t, "flip", { p: i, fast: i >= 4 ? 1 : 0 }));
    ev(tKeep, "kept");
    ev(43.95, "pop", { p: 3, soft: 1 });
  }

  function side(parent, ic, title) {
    const s = el("div", "abs side", parent);
    const si = el("span", "si", s);
    icon(ic, si);
    const tx = el("div", "", s);
    el("div", "t1", tx, title);
    const t2 = el("div", "t2", tx);
    icon("Check", t2);
    el("span", "", t2, "Kept");
    return s;
  }

  function renderS5(t) {
    const on = t > S.intelligence[0] - 0.8 && t < S.intelligence[1] + 0.4;
    show(R.s5, on ? 1 : 0);
    if (!on) return;
    const tH = TL.vo.L5 + 0.05;
    R.h5w.forEach((s, i) => rise(s, t, tH + i * 0.12, { dur: 0.65, dy: 34, blur: 14 }));
    put(R.h5, 960, 150, 1);
    R.sub5w.forEach((s, i) => rise(s, t, 33.35 + i * 0.07, { dur: 0.5, dy: 18, blur: 8 }));
    put(R.sub5, 960, 246, 1);
    // Which brain, and the flip between brains.
    let cur = R.bt[0];
    for (let i = 0; i < R.bt.length; i++) if (t >= R.bt[i][0]) cur = R.bt[i];
    const idx = R.bt.indexOf(cur);
    const next = R.bt[idx + 1];
    const b = BRAINS[cur[1]];
    if (R._b !== cur[1]) {
      R._b = cur[1];
      R.capI.innerHTML = window.BAB_ICONS[b.icon];
      R.capI.firstChild.classList?.add("ic");
      R.capI.querySelector("svg").setAttribute("width", "34");
      R.capI.querySelector("svg").setAttribute("height", "34");
      R.capI.style.background = b.bg;
      R.capI.style.color = b.fg;
      R.capT1.textContent = b.t1;
      R.capT2.textContent = b.t2;
    }
    const fast = idx >= 5;
    const dOut = fast ? 0.07 : 0.15, dIn = fast ? 0.09 : 0.22;
    let rx = 0;
    if (next && t > next[0] - dOut) rx = 90 * E.inCubic(prog(t, next[0] - dOut, next[0]));
    else if (t < cur[0] + dIn && idx > 0) rx = -90 * (1 - E.outCubic(prog(t, cur[0], cur[0] + dIn)));
    const capIn = E.outExpo(prog(t, 34.25, 34.8));
    put(R.bwrap, 960, 418, 1.18 * lerp(0.9, 1, capIn), capIn, { rx });
    put(R.blabel, 960, 336, 1, capIn * 0.9);
    // Ripples and the thread pulse on each switch.
    R.ripples.forEach((r, k) => {
      const sw = R.bt.slice(1).filter(([ts]) => t >= ts).map(([ts]) => ts);
      const last = sw[sw.length - 1 - k];
      if (last == null) {
        show(r, 0);
        return;
      }
      const p = prog(t, last, last + 0.9);
      put(r, 960, 418, lerp(1.25, 2.0, E.outCubic(p)), (1 - p) * 0.7);
    });
    const threadIn = E.outCubic(prog(t, 34.6, 35.0));
    put(R.thread, 960, 498, 1, threadIn, { sy: 0.55 });
    const lastSw = R.bt.slice(1).filter(([ts]) => t >= ts).pop();
    const pp = lastSw ? prog(t, lastSw[0] + 0.05, lastSw[0] + 0.35) : 0;
    put(R.pulseDot, 960, lerp(462, 520, E.inOutCubic(pp)), 1, lastSw && pp > 0 && pp < 1 ? Math.sin(pp * Math.PI) : 0);
    // Memory and apps stay, and say so.
    const sideIn = (d) => E.outExpo(prog(t, 32.22 + d, 32.8 + d));
    const kept = R.bt.slice(1).reduce((m, [ts]) => Math.max(m, 1 - Math.abs(t - ts - 0.28) / 0.22), 0);
    const big = E.outCubic(prog(t, R.tKeep, R.tKeep + 0.25)) * (1 - E.inCubic(prog(t, R.tKeep + 0.6, R.tKeep + 1.2)));
    const sc = 1 + 0.05 * clamp(kept) + 0.08 * big;
    put(R.memSide, 520, 720, sc * lerp(0.9, 1, sideIn(0)), sideIn(0));
    put(R.appSide, 1400, 720, sc * lerp(0.9, 1, sideIn(1.0)), sideIn(1.0));
    const glow = Math.max(clamp(kept) * 0.6, big);
    [R.memSide, R.appSide].forEach((s) => (s.style.boxShadow = glow > 0.01 ? `0 0 0 ${(8 * glow).toFixed(1)}px rgb(47 203 148 / ${(0.25 * glow).toFixed(3)}), var(--shadow-lift)` : ""));
    const op = E.outBack(prog(t, 43.95, 44.3));
    put(R.oss, 960, 990, lerp(0.8, 1, op), clamp(op));
  }

  // ------------------------------------------------------------------ S6: zero data retention
  function buildS6() {
    R.h6 = el("div", "abs display", R.s6);
    R.h6.style.fontSize = "112px";
    R.h6.style.color = "var(--dark-ink)";
    R.h6w = words(R.h6, "Zero data retention.");
    R.h6w[0].classList.add("grad-dark");
    R.flow = el("div", "abs", R.s6);
    R.flow.style.width = "1920px";
    R.flow.style.height = "1080px";
    R.flow.style.left = "0";
    R.flow.style.top = "0";
    R.flow.style.transform = "none";
    R.youNode = node(R.flow, "MessageCircle", "You", "your question");
    R.core = el("div", "abs", R.flow);
    R.core.id = "core";
    R.coreLabel = el("div", "abs", R.flow);
    R.coreLabel.id = "core-label";
    R.coreLabel.innerHTML = "<b>Open model</b>on Nebius Token Factory";
    R.keptNode = node(R.flow, "Database", "Kept after it answers", "");
    R.keptNum = el("div", "kept-num", R.keptNode, "0 bytes");
    R.p1 = el("div", "abs packet", R.flow);
    icon("MessageCircle", R.p1);
    el("span", "", R.p1, "Sam’s birthday dinner?");
    R.p2 = el("div", "abs packet reply", R.flow);
    el("span", "", R.p2, "Lemon-ricotta pasta");
    R.ghost = el("div", "abs packet", R.flow);
    el("span", "", R.ghost, "a copy?");

    R.lap = el("div", "abs laptop", R.s6);
    const scr = el("div", "scr", R.lap);
    el("div", "base", R.lap);
    R.typed = el("div", "typed", scr);
    R.vpill = el("div", "vpill", scr);
    const vav = el("div", "vav", R.vpill);
    const va = avatar(vav, "otto", ["idle"], 40, true, 0.3);
    va.el.style.left = "0";
    va.el.style.top = "0";
    R.bars = el("div", "bars", R.vpill);
    R.barEls = Array.from({ length: 14 }, () => el("i", "", R.bars));
    R.zrow = el("div", "abs", R.s6);
    R.zrow.style.display = "flex";
    R.zrow.style.gap = "18px";
    R.z1 = el("div", "zchip", R.zrow);
    icon("Mic", R.z1);
    el("span", "", R.z1, "Heard on your computer by NVIDIA Parakeet");
    R.z2 = el("div", "zchip", R.zrow);
    icon("CloudOff", R.z2);
    el("span", "", R.z2, "Audio never kept");
    R.foot6 = el("div", "abs foot", R.s6, "The included open models run on Nebius Token Factory with Zero Data Retention. Voice typing and meeting notes hear you in the desktop app.");

    const tThe = vf("L6", /^the/), tKeep = vf("L6", /^keep/), tNothing = vf("L6", /^nothing/), tVoice = vf("L6", /^voice/), tHeard = vf("L6", /^heard/), tComp = vf("L6", /^computer/);
    R.t6 = { tThe, tKeep, tNothing, tVoice, tHeard, tComp };
    ev(tThe, "zip", { p: 0 });
    ev(tThe + 0.95, "zip", { p: 1 });
    ev(tKeep + 0.05, "dissolve");
    ev(tVoice - 0.3, "whoosh", { soft: 1 });
    ev(tComp - 0.1, "blip");
  }

  function node(parent, ic, title, sub) {
    const n = el("div", "abs node", parent);
    const nb = el("div", "nb", n);
    icon(ic, nb);
    el("b", "", n, title);
    if (sub) el("span", "", n, sub);
    return n;
  }

  function renderS6(t) {
    const on = t > S.zdr[0] - 0.7 && t < S.zdr[1] + 0.5;
    show(R.s6, on ? 1 : 0);
    if (!on) return;
    const { tThe, tKeep, tNothing, tVoice, tHeard, tComp } = R.t6;
    const fin = E.outCubic(prog(t, 44.45, 44.7));
    const fout = E.inCubic(prog(t, 52.15, 52.55));
    R.s6.style.opacity = (fin * (1 - fout)).toFixed(3);
    R.h6w.forEach((s, i) => rise(s, t, vw("L6", i) - 0.08, { dur: 0.7, dy: 34, blur: 16 }));
    put(R.h6, 960, 170, 1);
    // Flow, then the laptop.
    const swap = E.inOutCubic(prog(t, tVoice - 0.45, tVoice + 0.05));
    R.flow.style.transform = `translateX(${(-260 * swap).toFixed(1)}px)`;
    show(R.flow, 1 - swap, swap * 10);
    const nIn = (d) => E.outExpo(prog(t, 45.9 + d, 46.5 + d));
    put(R.youNode, 420, 560, 1.18 * lerp(0.9, 1, nIn(0)), nIn(0));
    put(R.keptNode, 1500, 600, 1.18 * lerp(0.9, 1, nIn(0.2)), nIn(0.2));
    const pulse = Math.max(0, 1 - Math.abs(t - (tThe + 0.78)) / 0.25);
    const coreBirth = E.outBack(prog(t, 44.85, 45.6));
    put(R.core, 960, 520, 1.2 * lerp(0.15, 1, coreBirth) * (1 + 0.05 * Math.sin(t * 2.2) + 0.12 * pulse), clamp(coreBirth * 2));
    put(R.coreLabel, 960, 750, 1.1, nIn(0.15));
    // Question in, answer out, and the copy that never gets kept.
    const p1 = E.inOutCubic(prog(t, tThe, tThe + 0.8));
    put(R.p1, bez2(560, 700, 830, p1), bez2(470, 360, 470, p1), 1.15 * lerp(0.7, 1, Math.sin(p1 * Math.PI)), p1 > 0 && p1 < 1 ? clamp(Math.sin(p1 * Math.PI) * 2) : 0);
    const p2 = E.inOutCubic(prog(t, tThe + 0.95, tThe + 1.75));
    put(R.p2, bez2(830, 700, 560, p2), bez2(590, 700, 640, p2), 1.15 * lerp(0.7, 1, Math.sin(p2 * Math.PI)), p2 > 0 && p2 < 1 ? clamp(Math.sin(p2 * Math.PI) * 2) : 0);
    const g = E.outCubic(prog(t, tKeep, tKeep + 0.8));
    put(R.ghost, lerp(1110, 1330, g), 510 - 30 * Math.sin(g * Math.PI), 1.0, g > 0 ? (1 - E.inCubic(prog(t, tKeep + 0.25, tKeep + 0.6))) * 0.8 : 0, { blur: 10 * prog(t, tKeep + 0.2, tKeep + 0.6) });
    const flash = Math.max(0, 1 - Math.abs(t - tNothing - 0.1) / 0.3);
    R.keptNum.style.color = flash > 0 ? `rgb(${lerp(243, 169, flash)} ${lerp(241, 147, flash)} ${lerp(248, 255, flash)})` : "";
    R.keptNum.style.transform = `scale(${(1 + 0.08 * flash).toFixed(3)})`;
    // Laptop: the voice becomes text on the computer.
    const lin = E.outExpo(prog(t, tVoice - 0.25, tVoice + 0.45));
    put(R.lap, 960 + (1 - lin) * 200, 590, lerp(0.94, 1, lin), lin * (1 - fout));
    const talk = prog(t, tVoice + 0.05, tComp - 0.25);
    R.barEls.forEach((b, i) => {
      const a = talk > 0 && talk < 1 ? 0.25 + 0.75 * Math.abs(Math.sin(t * (7 + i * 0.9) + i * 1.3)) * Math.sin(talk * Math.PI) : 0;
      b.style.height = (8 + 32 * a).toFixed(1) + "px";
      b.style.opacity = (0.4 + 0.6 * a).toFixed(2);
    });
    const txt = "Remind me to call Mom at 5.";
    const n = Math.round(txt.length * clamp(prog(t, tComp - 0.35, tComp + 0.45)));
    R.typed.innerHTML = txt.slice(0, n) + (t > tVoice && t < 52.4 ? `<span class="caret" style="opacity:${Math.sin(t * 9) > 0 || n < txt.length ? 1 : 0}"></span>` : "");
    const z = E.outExpo(prog(t, tHeard - 0.1, tHeard + 0.4));
    put(R.zrow, 960, 940, 1, z * (1 - fout));
    R.z2.style.opacity = E.outCubic(prog(t, tComp + 0.1, tComp + 0.5)).toFixed(3);
    put(R.foot6, 960, 1040, 1, 0.9 * E.outCubic(prog(t, 46.4, 47.0)));
  }

  // ------------------------------------------------------------------ S7: end card
  function buildS7() {
    R.lock7 = el("div", "abs lockup", R.s7);
    R.lock7.style.gap = "28px";
    R.appIcon = el("div", "appicon", R.lock7);
    el("div", "mark svgfill", R.appIcon, window.BAB_ASSETS.logo);
    R.endWord = el("div", "endword", R.lock7);
    R.endLetters = [];
    for (const ch of "Build-a-bot") {
      const s = el("span", "w", R.endWord);
      s.textContent = ch;
      R.endLetters.push(s);
    }
    R.h7 = el("div", "abs display endline", R.s7);
    R.h7w = words(R.h7, "Own your AI.");
    R.sub7 = el("div", "abs endcta", R.s7);
    el("span", "", R.sub7, "build-a-bot.site");
    icon("ArrowRight", R.sub7);
    R.pills = el("div", "abs", R.s7);
    R.pills.style.display = "flex";
    R.pills.style.gap = "14px";
    R.pillEls = ["Free to start", "Web", "Mac", "Windows", "Open source"].map((p) => el("div", "pill", R.pills, p));
    R.legal = el("div", "abs legal", R.s7, "For adults 18+ · Bots are AI assistants, never people");
    R.endCast = [
      { a: avatar(R.s7, "blip", ["happy"], 190, false, 0.3), x: 560, y: 930, t: 53.0 },
      { a: avatar(R.s7, "nimbus", ["happy"], 200, false, 0.9), x: 760, y: 925, t: 53.08 },
      { a: avatar(R.s7, "otto", ["happy"], 240, false, 0.0), x: 960, y: 905, t: 52.92 },
      { a: avatar(R.s7, "sprout", ["happy"], 200, false, 0.5), x: 1160, y: 925, t: 53.16 },
      { a: avatar(R.s7, "ember", ["happy"], 190, false, 1.1), x: 1360, y: 930, t: 53.24 },
    ];
    R.endCast.forEach((c, i) => ev(c.t + 0.05, "pop", { p: i, soft: 1 }));
    ev(52.72, "pop", { p: 7 });
  }

  function renderS7(t) {
    const on = t > S.cta[0] - 0.4;
    show(R.cta, on ? 1 : 0);
    if (!on) return;
    const r = 1250 * E.inOutCubic(prog(t, 52.2, 52.78));
    R.cta.style.clipPath = r >= 1249 ? "none" : `circle(${r.toFixed(1)}px at 960px 560px)`;
    const sm = spring(t - 52.72, 220, 14);
    put(R.lock7, 960, 238, 1, 1);
    R.appIcon.style.transform = `scale(${sm.toFixed(4)}) rotate(${((1 - sm) * -16).toFixed(2)}deg)`;
    R.appIcon.style.opacity = clamp(sm * 2).toFixed(3);
    const beat = Math.max(0, 1 - Math.abs(t - vw("L7", 0) - 0.05) / 0.22);
    R.lock7.style.transform += ` scale(${(1 + 0.035 * beat).toFixed(4)})`;
    R.endLetters.forEach((s, i) => rise(s, t, 52.86 + i * 0.024, { dur: 0.55, dy: 28, blur: 10 }));
    R.h7w.forEach((s, i) => rise(s, t, vw("L7", 3 + i) - 0.07, { dur: 0.7, dy: 40, blur: 16 }));
    put(R.h7, 960, 425, 1);
    const sp = spring(t - 55.85, 240, 16);
    put(R.sub7, 960, 590 + (1 - clamp(sp)) * 24, lerp(0.85, 1, clamp(sp)), clamp(sp * 2));
    put(R.pills, 960, 700, 1, 1);
    R.pillEls.forEach((p, i) => {
      const q = E.outBack(prog(t, 56.2 + i * 0.08, 56.55 + i * 0.08));
      p.style.opacity = clamp(q).toFixed(3);
      p.style.transform = `translateY(${((1 - q) * 16).toFixed(2)}px)`;
    });
    R.endCast.forEach((c) => {
      const s = spring(t - c.t, 200, 13);
      put(c.a.el, c.x, c.y + (1 - s) * 260, 1, clamp(s * 3));
    });
    put(R.legal, 960, 1052, 1, 0.85 * E.outCubic(prog(t, 56.6, 57.2)));
  }

  // ------------------------------------------------------------------ hero Otto and backgrounds
  function renderHero(t) {
    const p0 = spring(t - 5.08, 220, 14);
    const kf = [
      [5.08, [960, 630, 380]],
      [9.62, [960, 630, 380]],
      [10.32, [HERO3.x, HERO3.y, 290]],
      [21.95, [HERO3.x, HERO3.y, 290]],
      [22.6, [330, 1240, 230]],
      [31.85, [960, 1250, 300]],
      [32.7, [960, 662, 330]],
      [44.5, [960, 662, 330]],
      [45.0, [960, 640, 250]],
    ];
    const [x, y, size] = keys(t, kf, E.inOutCubic);
    let o = t < 5.08 ? 0 : 1;
    if (t > 22.0 && t < 32.0) o = 1 - E.inCubic(prog(t, 22.0, 22.5)) + E.outCubic(prog(t, 31.85, 32.4));
    if (t > 44.5) o = 1 - E.inCubic(prog(t, 44.5, 45.0));
    const s = (size / 330) * (t < 6.5 ? Math.max(p0, 0.001) : 1);
    put(R.hero.el, x, y + (t < 6.5 ? (1 - p0) * 70 : 0), s, clamp(o) * (t < 6.5 ? clamp(p0 * 3) : 1), { r: t < 6.5 ? (1 - p0) * -12 : 0 });
    const tS = R.bt;
    const moods = [
      [0, "happy"],
      [7.4, "idle"],
      [13.55, "happy"],
      [14.1, "idle"],
      [15.65, "happy"],
      [16.2, "idle"],
      [17.3, "happy"],
      [18.3, "idle"],
      [18.7, "thinking"],
      [19.3, "happy"],
      [21.0, "idle"],
      [32.6, "idle"],
    ];
    for (let i = 1; i < tS.length; i++) {
      if (i <= 4) moods.push([tS[i][0] - 0.12, "thinking"], [tS[i][0] + 0.4, "happy"]);
    }
    moods.push([tS[5][0] - 0.1, "thinking"], [R.tKeep - 0.05, "happy"]);
    moods.sort((a, b) => a[0] - b[0]);
    R.hero.mood(t, moods);
  }

  function renderBackgrounds(t) {
    // The light world opens from the orb, and fades out for the dark scene.
    const iris = 1300 * E.inOutCubic(prog(t, 4.72, 5.36));
    const close = 1300 * (1 - E.inOutCubic(prog(t, 44.45, 45.1)));
    const worldOn = t > 4.72 && t < 45.1;
    show(R.world, worldOn ? 1 : 0);
    const rad = Math.min(iris, close);
    R.world.style.clipPath = rad >= 1299 ? "none" : `circle(${rad.toFixed(1)}px at 960px ${t > 30 ? 520 : 540}px)`;
    const ringP = prog(t, 4.72, 5.45);
    const ringQ = prog(t, 44.45, 45.12);
    // Sized directly (not scaled), so its soft glow stays smooth at any size.
    const ringR = t < 30 ? iris : close;
    R.ring.style.width = R.ring.style.height = `${Math.max(2, ringR * 2).toFixed(1)}px`;
    if (t < 30) put(R.ring, 960, 540, 1, ringP > 0 && ringP < 1 ? (1 - ringP) * clamp(ringP * 6) : 0);
    else put(R.ring, 960, 520, 1, ringQ > 0 && ringQ < 1 ? clamp(ringQ * 4) * (1 - E.inCubic(ringQ)) : 0);
    // Slow drift of the glows keeps still frames alive.
    const L = R.bgLight.style;
    L.setProperty("--g1x", `${18 + 6 * Math.sin(t * 0.13)}%`);
    L.setProperty("--g1y", `${12 + 5 * Math.cos(t * 0.11)}%`);
    L.setProperty("--g2x", `${86 + 5 * Math.cos(t * 0.09)}%`);
    L.setProperty("--g2y", `${8 + 6 * Math.sin(t * 0.12)}%`);
    L.setProperty("--g3x", `${68 + 8 * Math.sin(t * 0.07)}%`);
    const D = R.bgDark.style;
    D.setProperty("--d1x", `${30 + 8 * Math.sin(t * 0.15)}%`);
    D.setProperty("--d1y", `${40 + 6 * Math.cos(t * 0.12)}%`);
    D.setProperty("--d2x", `${72 + 6 * Math.cos(t * 0.1)}%`);
    D.setProperty("--d2y", `${62 + 6 * Math.sin(t * 0.14)}%`);
    // Grain moves every frame (a fixed pattern would read as dirt on the lens).
    const f = Math.floor(t * 60);
    const r = rng(f * 7919 + 1);
    R.grain.style.backgroundPosition = `${Math.floor(r() * 256)}px ${Math.floor(r() * 256)}px`;
    R.grain.style.opacity = t < 5.2 || (t > 44.8 && t < 52.5) ? "0.42" : "0.3";
    R.vignette.style.opacity = t > 4.8 && t < 44.9 ? "1" : "0";
  }

  // ------------------------------------------------------------------ particles
  function bursts() {
    if (R._bursts) return R._bursts;
    const B = [];
    const add = (t, x, y, n, opts = {}) => B.push({ t, x, y, n, seed: Math.floor(t * 1000) + n, ...opts });
    add(5.12, 960, 600, 26, { colors: ["#ffcf4a", "#b7a6ff", "#ff9b85"], speed: 520, life: 0.9 });
    R.chipT.forEach((t0, i) => add(t0 + 0.62, CHIPS[i].x, CHIPS[i].y, 12, { colors: ["#b7a6ff", "#7c5cff"], speed: 220, life: 0.6 }));
    add(19.35, HERO3.x, HERO3.y - 120, 18, { colors: ["#ffcf4a", "#b7a6ff"], speed: 300, life: 0.8 });
    const { tDel } = R.t4;
    add(tDel + 0.12, 600, PANEL.y - PANEL.h / 2 + ROW_TOP + ROW_STEP + 38, 30, { colors: ["#c9c3d6", "#b7a6ff", "#e8e2d8"], speed: 260, life: 0.7, dust: true });
    add(R.tKeep + 0.05, 520, 720, 16, { colors: ["#2fcb94", "#9bf0cd"], speed: 240, life: 0.7 });
    add(R.tKeep + 0.05, 1400, 720, 16, { colors: ["#2fcb94", "#9bf0cd"], speed: 240, life: 0.7 });
    const { tKeep } = R.t6;
    add(tKeep + 0.35, 1250, 500, 40, { colors: ["#b7a6ff", "#ffffff", "#d38bff"], speed: 160, life: 1.0, dust: true });
    add(52.75, 960, 560, 40, { colors: ["#ffffff", "#ffcf4a", "#ffd0c4"], speed: 700, life: 1.1 });
    R._bursts = B;
    return B;
  }

  function renderParticles(t) {
    const g = R.ctx;
    g.clearRect(0, 0, 1920, 1080);
    // Stars in the dark: the opening question and zero data retention.
    const starO = Math.max(1 - E.inCubic(prog(t, 4.5, 5.2)), E.outCubic(prog(t, 45.0, 45.8)) * (1 - E.inCubic(prog(t, 52.1, 52.5))));
    if (starO > 0.01) {
      const r = rng(42);
      for (let i = 0; i < 90; i++) {
        const x0 = r() * 1920, y0 = r() * 1080, sp = 6 + r() * 18, sz = 0.6 + r() * 1.8, ph = r() * 6.28, tw = 0.5 + r() * 2;
        const y = (((y0 - t * sp) % 1080) + 1080) % 1080;
        const a = starO * (0.18 + 0.5 * (0.5 + 0.5 * Math.sin(t * tw + ph))) * (0.4 + 0.6 * r());
        g.fillStyle = `rgba(230,224,255,${a.toFixed(3)})`;
        g.beginPath();
        g.arc(x0 + Math.sin(t * 0.3 + ph) * 8, y, sz, 0, 6.283);
        g.fill();
      }
    }
    for (const b of bursts()) {
      const age = t - b.t;
      if (age < 0 || age > b.life) continue;
      const r = rng(b.seed);
      for (let i = 0; i < b.n; i++) {
        const ang = r() * 6.283, v = b.speed * (0.35 + 0.65 * r()), col = b.colors[Math.floor(r() * b.colors.length)];
        const p = age / b.life;
        const d = v * age * (1 - 0.5 * p);
        const x = b.x + Math.cos(ang) * d, y = b.y + Math.sin(ang) * d + (b.dust ? 60 * age * age : 120 * age * age);
        const a = (1 - p) * (b.dust ? 0.8 : 1);
        const sz = (b.dust ? 2.5 : 3.5) * (1 - p * 0.6) * (0.6 + r());
        g.globalAlpha = clamp(a);
        g.fillStyle = col;
        if (b.dust) {
          g.beginPath();
          g.arc(x, y, sz, 0, 6.283);
          g.fill();
        } else star(g, x, y, sz * 2.2, ang + age * 3);
      }
      g.globalAlpha = 1;
    }
  }
  function star(g, x, y, s, rot) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const rr = k % 2 ? s * 0.32 : s;
      const a = (k * Math.PI) / 4;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.restore();
  }

  // ------------------------------------------------------------------ the frame
  function seekAnimations(t) {
    for (const a of document.getAnimations()) {
      const tgt = a.effect && a.effect.target;
      const holder = tgt && tgt.closest ? tgt.closest("[data-phase]") : null;
      const ph = holder ? parseFloat(holder.dataset.phase) || 0 : 0;
      a.pause();
      a.currentTime = (t + ph) * 1000;
    }
  }

  function render(t) {
    renderBackgrounds(t);
    renderS1(t);
    renderS2(t);
    renderHero(t);
    renderS4(t); // before S3: chips fly to rows S4 lays out
    renderS3(t);
    renderS5(t);
    renderS6(t);
    renderS7(t);
    renderParticles(t);
    seekAnimations(t);
  }

  async function init() {
    build();
    await document.fonts.ready;
    await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
    layoutS3();
    EVENTS.sort((a, b) => a.t - b.t);
    render(0);
    return true;
  }

  window.STAGE = { init, render, events: EVENTS };
})();
