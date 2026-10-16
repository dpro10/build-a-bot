/* Voice typing's window. Talks to the main process through window.babVoice only. */
"use strict";

(() => {
  const api = window.babVoice;
  const $ = (id) => document.getElementById(id);
  const LANGUAGES = [
    ["auto", "Detect it"],
    ["en", "English"],
    ["es", "Spanish"],
    ["fr", "French"],
    ["de", "German"],
    ["it", "Italian"],
    ["pt", "Portuguese"],
    ["nl", "Dutch"],
    ["sv", "Swedish"],
    ["no", "Norwegian"],
    ["da", "Danish"],
    ["fi", "Finnish"],
    ["pl", "Polish"],
    ["cs", "Czech"],
    ["hu", "Hungarian"],
    ["ro", "Romanian"],
    ["el", "Greek"],
    ["ru", "Russian"],
    ["uk", "Ukrainian"],
    ["tr", "Turkish"],
    ["ar", "Arabic"],
    ["he", "Hebrew"],
    ["fa", "Persian"],
    ["hi", "Hindi"],
    ["bn", "Bengali"],
    ["ur", "Urdu"],
    ["zh", "Chinese"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["vi", "Vietnamese"],
    ["th", "Thai"],
    ["id", "Indonesian"],
    ["ms", "Malay"],
    ["tl", "Tagalog"],
  ];
  const n = (x) => Number(x || 0).toLocaleString();

  let state = null;
  let mics = [];
  let dict = { entries: [], fromMemories: [], bots: [] };
  let dictLoaded = false;
  /** The history entry being fixed, and what it suggests. */
  let fixing = null;
  let suggestions = {};
  let recording = false;

  function show(view) {
    for (const id of ["loading", "unpaired", "main"]) $(id).hidden = id !== view;
  }

  function kbd(label) {
    const k = document.createElement("kbd");
    k.textContent = label;
    return k;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function render(s) {
    state = s;
    if (!s) return show("loading");
    $("enabled-wrap").hidden = !s.paired;
    if (!s.paired) return show("unpaired");
    show("main");
    $("enabled").checked = s.enabled;

    const key = s.mode === "toggle" ? s.toggleShortcut : s.shortcut.label;
    const how = $("how");
    how.replaceChildren(
      document.createTextNode(s.mode === "toggle" ? "Press " : "Hold "),
      kbd(key),
      document.createTextNode(s.mode === "toggle" ? " and talk. Press it again, and it's typed where your cursor is." : " and talk. Let go, and it's typed where your cursor is."),
    );
    $("tip-handsfree").textContent = s.mode === "toggle" ? "It keeps listening until you press the shortcut again (up to 10 minutes)." : "Tap it twice to keep listening hands-free; tap once more to finish.";
    // Editing by voice: Shift with the shortcut (not with the toggle shortcut, which can't read a selection).
    const canEdit = s.mode === "hold" && s.editKey && s.server?.edit !== false;
    const tipEdit = $("tip-edit");
    tipEdit.hidden = !canEdit || !s.options.edit;
    if (canEdit) {
      tipEdit.replaceChildren(
        document.createTextNode("Select some text and hold "),
        kbd(`Shift + ${s.shortcut.label}`),
        document.createTextNode(" to change it: “make this friendlier”, “turn it into a list”. Nothing selected? It writes what you ask for."),
      );
    }
    $("edit-row").hidden = !canEdit;
    $("edit-hint").textContent = `Hold Shift with ${s.shortcut.label} and say what to do with the text you selected. ${s.platform === "darwin" ? "⌘Z" : "Ctrl+Z"} undoes it. Not in terminals.`;
    const bot = s.bots[0];
    $("tip-bot").hidden = !bot || !s.options.commands;
    if (bot) $("tip-bot").textContent = `Start with “Hey ${bot.name}” to ask ${bot.name} instead of typing.`;
    // Demo mode means the server can't hear you; NVIDIA Parakeet on this computer can.
    $("demo").hidden = !s.server?.simulated || Boolean(s.local?.active);
    $("privacy-voice").textContent = s.local?.active ? "Your voice is turned into text on this computer and never leaves it; only the words go on, to be cleaned up." : "Your voice is turned into text and thrown away;";

    // What's in the way.
    const problem = $("problem");
    problem.hidden = !s.problem;
    if (s.problem) {
      $("problem-text").textContent = s.problem.message;
      const actions = $("problem-actions");
      actions.replaceChildren();
      for (const a of s.problem.actions || []) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "secondary";
        b.textContent = a.label;
        b.addEventListener("click", () => act(a.id));
        actions.append(b);
      }
    }

    renderSetup(s);
    $("try-hint").replaceChildren(
      document.createTextNode("Click in the box, hold "),
      kbd(key),
      document.createTextNode(" and say something like “Um, let's meet at two, no wait, three tomorrow.”"),
    );
    const heard = $("try-heard");
    if (s.last?.kind === "text" && s.last.heard && s.last.heard !== s.last.text) {
      heard.hidden = false;
      heard.replaceChildren(document.createTextNode("It heard: "), Object.assign(document.createElement("strong"), { textContent: `“${s.last.heard}”` }));
    } else heard.hidden = true;

    // Stats and plan.
    $("stat-week").textContent = n(s.stats.week);
    $("stat-saved").textContent = s.stats.saved >= 60 ? `${(s.stats.saved / 60).toFixed(1)} h` : `${s.stats.saved} min`;
    $("stat-wpm").textContent = s.stats.wpm ? String(s.stats.wpm) : "–";
    const plan = $("plan");
    plan.replaceChildren();
    if (s.usage) {
      if (s.usage.limit) {
        plan.append(document.createTextNode(`${n(s.usage.words)} of ${n(s.usage.limit)} words this month on the Free plan. `));
        const up = document.createElement("button");
        up.type = "button";
        up.className = "link";
        up.textContent = "Unlimited with Plus";
        up.addEventListener("click", () => api.open("upgrade"));
        plan.append(up);
      } else plan.textContent = `${n(s.usage.words)} words this month. Unlimited on your plan.`;
    }

    renderShortcuts(s);
    for (const input of document.querySelectorAll("input[data-opt]")) input.checked = Boolean(s.options[input.dataset.opt]);
    $("commands-title").textContent = bot ? `Talk to ${bot.name}` : "Talk to your bot";
    $("commands-hint").textContent = bot
      ? `Start with “Hey ${bot.name}” to ask instead of typing: “Hey ${bot.name}, remind me to call Mom at 5.” Writing to someone named ${bot.name}? Turn this off.`
      : "Start with “Hey” and your bot's name to ask it instead of typing.";
    renderSelects(s);
    renderLocal(s);
    renderHistory(s);
  }

  const MB = (b) => Math.round(b / 1e6).toLocaleString();

  /** Private speech: NVIDIA Parakeet on this computer, and where its download is at. */
  function renderLocal(s) {
    const l = s.local;
    const card = $("local");
    card.hidden = !l || !l.supported;
    if (card.hidden) return;
    $("local-on").checked = l.on;
    const status = $("local-status");
    const bar = $("local-progress");
    const pct = l.total ? Math.min(100, Math.floor((l.received / l.total) * 100)) : 0;
    const langName = (LANGUAGES.find(([code]) => code === s.options.language) || [])[1] || "That language";
    bar.hidden = !(l.on && l.state === "downloading");
    bar.value = pct;
    $("local-retry").hidden = !(l.on && l.state === "error" && !l.blocked);
    $("local-remove").hidden = !(l.state === "installed" || l.state === "ready" || l.state === "starting");
    if (!l.on) status.textContent = "Off: your voice goes to Build-a-bot's servers to be turned into text, and is thrown away there.";
    else if (l.blocked) status.textContent = "It can't run from this Windows account's folder yet (its name has letters from outside English), so Build-a-bot's servers hear you, and throw your voice away once it's text.";
    else if (l.state === "downloading") status.textContent = l.total ? `Getting NVIDIA Parakeet: ${pct}% (${MB(l.received)} of ${MB(l.total)} MB). Until it's done, Build-a-bot's servers hear you.` : "Getting NVIDIA Parakeet…";
    else if (l.state === "error") status.textContent = `${l.error || "It didn't download."} Until then, Build-a-bot's servers hear you.`;
    else if (l.state === "absent") status.textContent = "It downloads when voice typing is on.";
    else if (l.server === false) status.textContent = "Downloaded, but this Build-a-bot server can't take text from it yet, so the servers hear you for now.";
    else if (!l.language) status.textContent = `${langName} isn't one of Parakeet's languages, so Build-a-bot's servers hear you in it. English and 24 European languages work here.`;
    else status.textContent = "On: your voice is turned into text on this computer and never leaves it.";
  }

  function renderSetup(s) {
    const micOk = s.permissions.mic === "granted";
    const micStep = $("step-mic");
    micStep.className = micOk ? "done" : "todo";
    $("step-mic-text").textContent = micOk
      ? "Allowed. It's on only while you hold the shortcut."
      : s.permissions.mic === "denied"
        ? "Turned off for Build-a-bot. Turn it on in your system settings."
        : "Your computer will ask the first time.";
    $("mic-allow").hidden = micOk || s.platform === "linux";
    $("mic-allow").textContent = s.permissions.mic === "denied" ? "Open settings" : "Allow";

    const accessStep = $("step-access");
    accessStep.hidden = s.platform !== "darwin";
    if (s.platform === "darwin") {
      const ok = s.permissions.accessibility === true;
      accessStep.className = ok ? "done" : "todo";
      $("step-access-text").textContent = ok
        ? "Allowed. It can hear the shortcut and paste for you."
        : "So it can hear the shortcut in any app and paste for you. Turn on Build-a-bot in Privacy & Security → Accessibility.";
      $("access-allow").hidden = ok;
    }
    $("step-try").className = s.stats.total > 0 ? "done" : "todo";
    // The setup card goes away once everything's done.
    $("setup").hidden = micOk && (s.platform !== "darwin" || s.permissions.accessibility === true) && s.stats.total > 0;
  }

  function renderShortcuts(s) {
    const box = $("shortcuts");
    box.replaceChildren();
    const list = [...s.presets];
    if (s.shortcut.id === "custom") list.push({ id: "custom", label: s.shortcut.label, hint: "Your own keys." });
    for (const p of list) {
      const row = document.createElement("label");
      row.className = `option${p.id === s.shortcut.id ? " on" : ""}`;
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "shortcut";
      radio.value = p.id;
      radio.checked = p.id === s.shortcut.id;
      radio.disabled = s.mode === "toggle";
      radio.addEventListener("change", () => api.set({ shortcut: p.id }).then(render));
      const text = document.createElement("span");
      text.className = "grow";
      text.append(kbd(p.label));
      if (p.hint) text.append(Object.assign(document.createElement("span"), { className: "hint", textContent: p.hint }));
      row.append(radio, text);
      box.append(row);
    }
    $("record").disabled = s.mode === "toggle" || recording;
  }

  function renderSelects(s) {
    const lang = $("language");
    if (!lang.options.length) for (const [code, label] of LANGUAGES) lang.append(new Option(label, code));
    lang.value = s.options.language || "auto";
    const mic = $("mic");
    const want = s.options.micId || "default";
    mic.replaceChildren(new Option("System default", "default"));
    for (const m of mics) if (m.id !== "default") mic.append(new Option(m.label, m.id));
    if (want !== "default" && !mics.some((m) => m.id === want)) mic.append(new Option("Saved microphone (not connected)", want));
    mic.value = want;
  }

  function when(at) {
    const d = new Date(at);
    const today = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  }

  function renderHistory(s) {
    const list = $("history-list");
    $("history-note").textContent = s.options.history
      ? "Only on this computer, encrypted. The last 100, for 30 days."
      : "History is off: nothing you dictate is kept.";
    $("clear-history").hidden = !s.history.length;
    if (fixing && document.activeElement && list.contains(document.activeElement)) return; // don't disturb typing
    list.replaceChildren();
    for (const e of s.history) list.append(historyItem(e));
  }

  function historyItem(e) {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "meta";
    const where = document.createElement("span");
    where.className = "grow";
    const did = e.kind === "command" ? `asked ${e.bot}` : e.kind === "edit" ? (e.answer ? "answered" : "edited by voice") : null;
    where.textContent = [when(e.at), did, e.app, e.words ? `${e.words} words` : null].filter(Boolean).join(" · ");
    meta.append(where);
    if (e.kind === "text" && e.polished) meta.append(Object.assign(document.createElement("span"), { className: "badge", textContent: "cleaned up", title: "The AI cleanup ran" }));
    const actions = document.createElement("span");
    const btn = (label, fn, aria) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "icon-btn";
      b.textContent = label;
      if (aria) b.setAttribute("aria-label", aria);
      b.addEventListener("click", fn);
      return b;
    };
    actions.append(
      btn("Copy", async (ev) => {
        await api.copy(e.id);
        ev.target.textContent = "Copied";
        setTimeout(() => (ev.target.textContent = "Copy"), 1500);
      }),
    );
    if (e.kind === "text") actions.append(btn("Fix", () => startFix(e, li)));
    actions.append(btn("Delete", () => api.remove(e.id).then(render), "Delete from history"));
    meta.append(actions);
    li.append(meta);
    if (e.kind === "edit" && e.instruction) li.append(Object.assign(document.createElement("p"), { className: "instruction", textContent: `“${e.instruction}”` }));
    const text = document.createElement("p");
    text.className = e.kind === "edit" && e.answer ? "reply" : "text";
    text.textContent = e.text;
    li.append(text);
    if (e.reply) li.append(Object.assign(document.createElement("p"), { className: "reply", textContent: e.reply }));
    const sug = suggestions[e.id];
    if (sug?.length) li.append(suggestBox(e.id, sug));
    return li;
  }

  function startFix(e, li) {
    fixing = e.id;
    const area = document.createElement("textarea");
    area.rows = 3;
    area.value = e.text;
    area.setAttribute("aria-label", "Fix what was typed");
    const row = document.createElement("div");
    row.className = "row";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary small";
    save.textContent = "Save fix";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "link";
    cancel.textContent = "Cancel";
    row.append(save, cancel);
    li.querySelector(".text").replaceWith(area);
    li.append(row);
    area.focus();
    cancel.addEventListener("click", () => {
      fixing = null;
      render(state);
    });
    save.addEventListener("click", async () => {
      const res = await api.fix(e.id, area.value);
      fixing = null;
      suggestions[e.id] = res?.suggestions || [];
      render(res?.state || state);
    });
  }

  function suggestBox(id, list) {
    const box = document.createElement("div");
    box.className = "suggest";
    box.append(document.createTextNode("Fixed and copied. Teach it: "));
    for (const sgt of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "secondary";
      b.textContent = sgt.heard?.length ? `Add “${sgt.text}” (it wrote “${sgt.heard[0]}”)` : `Add “${sgt.text}”`;
      b.addEventListener("click", async () => {
        const r = await api.addEntry({ kind: "word", text: sgt.text, heard: sgt.heard || [], source: "correction" });
        if (r?.ok) {
          suggestions[id] = (suggestions[id] || []).filter((x) => x !== sgt);
          await loadDictionary();
          render(state);
        }
      });
      box.append(" ", b);
    }
    return box;
  }

  // ---------------------------------------------------------------------------
  // The dictionary
  // ---------------------------------------------------------------------------

  async function loadDictionary() {
    const r = await api.dictionary();
    if (r?.ok) {
      dict = r.data;
      dictLoaded = true;
    }
    renderDictionary();
  }

  function renderDictionary() {
    const words = $("words");
    words.replaceChildren();
    for (const e of dict.entries.filter((x) => x.kind === "word")) {
      const li = document.createElement("li");
      li.append(document.createTextNode(e.text));
      if (e.heard.length) li.append(Object.assign(document.createElement("span"), { className: "heard-as", textContent: ` (not “${e.heard.join("”, “")}”)` }));
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "×";
      del.setAttribute("aria-label", `Remove ${e.text}`);
      del.addEventListener("click", () => api.deleteEntry(e.id).then(loadDictionary));
      li.append(del);
      words.append(li);
    }
    if (dictLoaded && !words.children.length) words.append(Object.assign(document.createElement("li"), { className: "empty", textContent: "No words yet" }));
    const snippets = $("snippets");
    snippets.replaceChildren();
    for (const e of dict.entries.filter((x) => x.kind === "snippet")) {
      const li = document.createElement("li");
      li.append(Object.assign(document.createElement("span"), { className: "phrase", textContent: `“${e.heard[0]}”` }), document.createTextNode("→"));
      li.append(Object.assign(document.createElement("span"), { className: "text grow", textContent: e.text }));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn";
      del.textContent = "Delete";
      del.setAttribute("aria-label", `Delete the snippet for ${e.heard[0]}`);
      del.addEventListener("click", () => api.deleteEntry(e.id).then(loadDictionary));
      li.append(del);
      snippets.append(li);
    }
    $("known-wrap").hidden = !dict.fromMemories?.length;
    $("known").textContent = (dict.fromMemories || []).join(", ");
  }

  function showError(id, message) {
    const el = $(id);
    el.textContent = message || "";
    el.hidden = !message;
  }

  $("word-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("word").value.trim();
    if (!text) return showError("word-error", "Type the word.");
    const heard = $("word-heard").value.trim();
    const r = await api.addEntry({ kind: "word", text, heard: heard ? [heard] : [] });
    if (!r?.ok) return showError("word-error", r?.error || "That didn't work. Try again.");
    showError("word-error", "");
    $("word").value = "";
    $("word-heard").value = "";
    $("word").focus();
    await loadDictionary();
  });

  $("snippet-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const phrase = $("snippet-phrase").value.trim();
    const text = $("snippet-text").value;
    if (!phrase) return showError("snippet-error", "Type the phrase you'll say.");
    if (!text.trim()) return showError("snippet-error", "Type what it should type.");
    const r = await api.addEntry({ kind: "snippet", text, heard: [phrase] });
    if (!r?.ok) return showError("snippet-error", r?.error || "That didn't work. Try again.");
    showError("snippet-error", "");
    $("snippet-phrase").value = "";
    $("snippet-text").value = "";
    await loadDictionary();
  });

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  async function act(id) {
    if (id === "accessibility" || id === "mic") render(await api.permission(id));
    else if (id === "retry") render(await api.set({}));
    else api.open(id);
  }

  $("enabled").addEventListener("change", async (e) => render(await api.set({ enabled: e.target.checked })));
  for (const input of document.querySelectorAll("input[data-opt]")) {
    input.addEventListener("change", async () => render(await api.set({ [input.dataset.opt]: input.checked })));
  }
  $("language").addEventListener("change", async (e) => render(await api.set({ language: e.target.value })));
  $("local-on").addEventListener("change", async (e) => render(await api.set({ onDevice: e.target.checked })));
  $("local-retry").addEventListener("click", async () => render(await api.local("retry")));
  $("local-remove").addEventListener("click", async () => {
    if (!confirm("Remove NVIDIA Parakeet from this computer? Voice typing will use Build-a-bot's servers until it downloads again (about 0.7 GB).")) return;
    $("local-on").checked = false;
    render(await api.set({ onDevice: false }));
    render(await api.local("remove"));
  });
  $("mic").addEventListener("change", async (e) => render(await api.set({ micId: e.target.value })));
  $("mic-allow").addEventListener("click", () => act(state?.permissions.mic === "denied" ? "mic-settings" : "mic"));
  $("access-allow").addEventListener("click", () => act("accessibility"));
  $("pair").addEventListener("click", () => api.open("pair"));
  $("open-voice-page").addEventListener("click", () => api.open("voice-page"));
  $("clear-history").addEventListener("click", async () => {
    if (!window.confirm("Clear your voice typing history on this computer?")) return;
    suggestions = {};
    render(await api.clearHistory());
  });
  $("record").addEventListener("click", async () => {
    recording = true;
    $("record").disabled = true;
    $("record-status").textContent = "Press the keys you want to hold, then let go. Esc cancels.";
    const r = await api.recordShortcut();
    recording = false;
    $("record-status").textContent = r?.ok ? `Now hold ${r.label}.` : r?.error || "";
    render(r?.state || state);
  });

  api.onState((s) => render(s));
  api.onSection((section) => document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  api.getState().then(async (s) => {
    render(s);
    if (s?.paired) {
      await loadDictionary();
      mics = (await api.microphones()) || [];
      render(state);
    }
    const section = decodeURIComponent(location.hash.slice(1));
    if (section) document.getElementById(section)?.scrollIntoView({ block: "start" });
    if (!section || section === "setup") $("try-box")?.focus();
  });
})();
