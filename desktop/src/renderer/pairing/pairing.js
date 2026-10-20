/* The pairing window. Talks to the main process through window.babPairing only. */
"use strict";

(() => {
  const api = window.babPairing;
  const $ = (id) => document.getElementById(id);
  const COLORS = { ocean: "#3B82F6", sky: "#8EA8FF", grape: "#7C5CFF", rose: "#F2679B", coral: "#FF6F59", sunny: "#FFC23D", mint: "#2FCB94", midnight: "#363C5E" };
  let state = null;
  let serverTouched = false;

  function show(view) {
    for (const id of ["loading", "signed-out", "paired"]) $(id).hidden = id !== view;
  }

  function formatCode(value) {
    const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
  }

  function renderSignedOut(s) {
    show("signed-out");
    const reason = $("signed-out-reason");
    reason.hidden = !s.signedOutReason;
    reason.textContent = s.signedOutReason || "";
    if (!serverTouched) $("server").value = s.server || s.defaultServer;
    $("server-details").open = Boolean(s.server && s.server !== s.defaultServer);
  }

  function botRow(bot, chosen) {
    const row = document.createElement("label");
    row.className = `bot${bot.meetingsOn ? "" : " off"}`;
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = COLORS[bot.color] || COLORS.grape;
    const text = document.createElement("span");
    text.className = "grow";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = bot.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = !bot.meetingsOn ? " · Meeting notes are off" : bot.paused ? " · Paused" : "";
    text.append(name, meta);
    if (bot.meetingsOn) {
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "bot";
      radio.value = bot.id;
      radio.checked = bot.id === chosen;
      radio.addEventListener("change", () => api.chooseBot(bot.id));
      row.append(radio, dot, text);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "link turn-on";
      btn.textContent = "Turn on";
      btn.setAttribute("aria-label", `Turn on meeting notes for ${bot.name}`);
      btn.addEventListener("click", () => api.open("bot-apps", bot.id));
      row.append(dot, text, btn);
    }
    return row;
  }

  function renderPaired(s) {
    show("paired");
    const who = s.ownerName ? `${s.ownerName}'s` : "your";
    $("paired-line").textContent = `This computer (${s.deviceName}) is paired with ${who} Build-a-bot. When a call starts, your bot will pop up at the bottom of the screen and ask before it takes notes.`;
    $("offline").hidden = s.status !== "offline";
    const list = $("bots");
    list.replaceChildren();
    const on = s.bots.filter((b) => b.meetingsOn);
    for (const b of [...on, ...s.bots.filter((x) => !x.meetingsOn)]) list.append(botRow(b, s.botId));
    // How calls are heard here (NVIDIA Parakeet, and how far its download has got).
    $("hearing").hidden = !s.hearing;
    $("hearing").textContent = s.hearing || "";
    const none = s.status === "ready" && on.length === 0;
    $("no-bots").hidden = !none;
    if (none) {
      const first = s.bots[0];
      $("no-bots-text").textContent = first
        ? `None of your bots take meeting notes yet. Turn on Meeting notes in ${first.name}'s apps, then come back here.`
        : "You don't have a bot yet. Make one in Build-a-bot, then turn on Meeting notes.";
      $("turn-on").textContent = first ? `Turn on meeting notes for ${first.name}` : "Open Build-a-bot";
      $("turn-on").onclick = () => (first ? api.open("bot-apps", first.id) : api.open("app"));
    }
    $("storage").textContent =
      s.storage === "encrypted"
        ? "This computer's key is stored in your system keychain."
        : s.storage === "plaintext"
          ? "This computer's key is stored without encryption (BAB_ALLOW_PLAINTEXT_TOKEN=1, for testing only)."
          : "This computer has no keychain, so its key is kept only until you quit. You'll pair again next time.";
    $("close-hint").textContent = `You can close this window. Build-a-bot keeps watching for calls from the ${s.trayWord}.`;
    const v = s.voice;
    $("voice-line").textContent =
      v && v.enabled && v.hint
        ? `On. ${v.hint}, and your words are typed where your cursor is.`
        : "Hold a key in any app and talk. Your words are typed where your cursor is, cleaned up, spelled your way.";
    $("voice-open").textContent = v && v.enabled ? "Voice typing settings" : "Set up voice typing";
    // "Give my bot a folder".
    const lib = s.library;
    $("library-card").hidden = !(lib && lib.available && s.bots.length);
    if (lib && lib.available && s.bots.length) {
      const choose = $("library-choose");
      const select = $("library-bot");
      if (lib.folder) {
        $("library-line").textContent = lib.status;
        $("library-hint").textContent = `${lib.note ? `${lib.note}. ` : ""}New and changed files go to ${lib.botName ?? "your bot"}'s Library by themselves. Nothing else on this computer is read.`;
        choose.textContent = "Choose another folder";
        $("library-stop").hidden = false;
        select.hidden = true;
      } else {
        const first = s.bots.find((b) => b.id === lib.botId) ?? s.bots[0];
        $("library-line").textContent = `Give ${s.bots.length > 1 ? "a bot" : first.name} a folder, like your class files. Its PDFs, Word files, slides, text and photos go to the bot's Library and stay in step.`;
        $("library-hint").textContent = "Only that folder is read. Nothing else on this computer.";
        choose.textContent = "Choose a folder";
        $("library-stop").hidden = true;
        select.hidden = s.bots.length < 2;
        if (s.bots.length > 1 && !select.dataset.filled) {
          select.replaceChildren(...s.bots.map((b) => Object.assign(document.createElement("option"), { value: b.id, textContent: b.name })));
          select.value = first.id;
          select.dataset.filled = "1";
        }
      }
      choose.onclick = async () => render(await api.chooseFolder(lib.folder ? lib.botId : select.hidden ? s.bots[0].id : select.value));
      $("library-stop").onclick = async () => render(await api.stopFolder());
    }
  }

  function render(s) {
    state = s;
    if (!s) return show("loading");
    if (!s.paired) return renderSignedOut(s);
    return renderPaired(s);
  }

  $("code").addEventListener("input", (e) => {
    const el = /** @type {HTMLInputElement} */ (e.target);
    el.value = formatCode(el.value);
    $("pair-error").hidden = true;
  });
  $("server").addEventListener("input", () => {
    serverTouched = true;
  });
  $("open-pair-page").addEventListener("click", () => api.open("pair-page"));

  $("pair-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = $("pair-button");
    const err = $("pair-error");
    err.hidden = true;
    button.disabled = true;
    button.textContent = "Pairing…";
    try {
      const res = await api.pair($("server").value, $("code").value);
      if (!res.ok) {
        err.textContent = res.error;
        err.hidden = false;
        $("code").focus();
      } else {
        $("code").value = "";
        render(res.state);
      }
    } catch {
      err.textContent = "Something went wrong. Try again.";
      err.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = "Pair";
    }
  });

  $("check-again").addEventListener("click", async () => render(await api.refresh()));
  $("voice-open").addEventListener("click", () => api.open("voice"));
  $("done").addEventListener("click", () => api.close());
  $("unpair").addEventListener("click", async () => {
    if (!window.confirm("Unpair this computer? Your bot won't offer to take notes here until you pair it again.")) return;
    render(await api.unpair());
  });

  api.onState((s) => render(s));
  api.getState().then((s) => {
    render(s);
    if (!s.paired) $("code").focus();
  });
})();
