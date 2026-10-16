/**
 * Voice typing, wired into the app: picks how the shortcut is heard (the keyboard hook, or a
 * plain global shortcut while macOS Accessibility isn't allowed), keeps the pill page loaded,
 * runs the settings window and its messages, and tells the tray what to show.
 *
 * Everything here starts only once the owner turns voice typing on, on a paired computer.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ApiError } from "../api.mjs";
import { VoiceTyping } from "./controller.mjs";
import { FrontApp } from "./front-app.mjs";
import { minutesSaved, VoiceHistory, wordsPerMinute, wordsThisWeek } from "./history.mjs";
import { Hotkey, ToggleHotkey } from "./hotkey.mjs";
import { checkCustom, keyName, presetsFor, resolveShortcut } from "./keys.mjs";
import { suggestWords } from "./learn.mjs";
import { LOCAL_LANGUAGES, LocalSpeech, localFirst } from "./local-speech.mjs";
import { Paster, pressCopy, pressPaste } from "./paste.mjs";
import { PillWindow } from "./pill-window.mjs";
import { VoiceSettingsWindow } from "./settings-window.mjs";

const require = createRequire(import.meta.url);
const TOGGLE_ACCELERATOR = "CommandOrControl+Shift+Space";

/** How the toggle shortcut reads to people. */
function toggleLabel(platform) {
  return platform === "darwin" ? "⌘ Shift Space" : "Ctrl + Shift + Space";
}

/**
 * @param {object} o
 * @param {typeof import('electron')} o.electron
 * @param {import('../store.mjs').Settings} o.settings
 * @param {import('../store.mjs').TokenStore} o.tokens
 * @param {import('../account.mjs').Account} o.account
 * @param {ReturnType<typeof import('../api.mjs').createApi>} o.api
 * @param {Electron.Session} o.apiSession
 * @param {{ isShowing(): boolean, win: any }} o.buddy
 * @param {string} o.userData
 * @param {(url: string, opts?: any) => void} o.openAppLink
 * @param {() => void} o.showPairing
 * @param {() => Promise<boolean>} o.ensureMicAccess
 * @param {() => void} o.onChange  tray and windows should refresh
 * @param {(m: string) => void} o.log
 */
export function setupVoice(o) {
  const { electron, settings, account, api, log } = o;
  const { systemPreferences, clipboard, globalShortcut, shell, safeStorage } = electron;
  const platform = process.platform;

  const history = new VoiceHistory({ file: path.join(o.userData, "voice-history.json"), safeStorage, secure: () => o.tokens.security().secure });
  // NVIDIA Parakeet on this computer. It downloads through the app's own network stack (the
  // system's proxy and certificates). BAB_SPEECH_*_URL: other places to download it from (tests, a
  // mirror); the files still have to match the pinned hashes. BAB_PRIVATE_SPEECH=off: not at all.
  const localOff = process.env.BAB_PRIVATE_SPEECH === "off";
  const local = new LocalSpeech({
    dir: path.join(o.userData, "speech"),
    fetchImpl: (url, init) => o.apiSession.fetch(url, init),
    log,
    sources: {
      ...(process.env.BAB_SPEECH_RUNTIME_URL ? { runtimeUrl: process.env.BAB_SPEECH_RUNTIME_URL } : {}),
      ...(process.env.BAB_SPEECH_ITN_URL ? { itnUrl: process.env.BAB_SPEECH_ITN_URL } : {}),
      ...(process.env.BAB_SPEECH_MODEL_URL ? { modelUrl: process.env.BAB_SPEECH_MODEL_URL } : {}),
    },
  });
  local.on("change", () => {
    pushState();
    o.onChange();
  });
  /** When it last started downloading Parakeet (a download that failed tries again on its own later). */
  let localTriedAt = 0;
  const frontApp = new FrontApp({ log });
  const settingsWindow = new VoiceSettingsWindow({ log, onClosed: () => stopAccessibilityWatch() });

  /** @type {Hotkey | null} */
  let hook = null;
  /** @type {ToggleHotkey | null} */
  let toggle = null;
  /** @type {Hotkey | ToggleHotkey | null} */
  let active = null;
  /** @type {{ message: string, actions?: Array<{ id: string, label: string }> } | null} */
  let problem = null;
  let mode = /** @type {'hold'|'toggle'|'off'} */ ("off");
  let accessTimer = null;
  let lastWarm = 0;

  const trusted = () => (platform === "darwin" ? safely(() => systemPreferences.isTrustedAccessibilityClient(false), false) : true);
  const canPaste = () => {
    if (platform === "darwin") return trusted() && Boolean(hook?.hook);
    if (platform === "win32") return Boolean(hook?.hook);
    return Boolean(process.env.DISPLAY);
  };

  const pill = new PillWindow({
    log,
    onAction: (a) => void voice.action(a),
    onHover: (h) => voice.setHovering(h),
    // Sit above the meeting bot when it's on screen.
    lift: () => (o.buddy.isShowing() && o.buddy.win && !o.buddy.win.isDestroyed() ? o.buddy.win.getBounds().height - 20 : 0),
  });

  const paster = new Paster({
    clipboard,
    makeItem: (data) => new electron.ClipboardItem(data),
    press: pressPaste({ platform, hook: () => hook?.hook ?? null, expectSynthetic: (c) => hook?.expectSynthetic(c) }),
    pressCopy: pressCopy({ platform, hook: () => hook?.hook ?? null, expectSynthetic: (c) => hook?.expectSynthetic(c) }),
    canPress: canPaste,
    // Paste only once the shortcut's keys are let go (⌥ still down would make ⌘V into ⌥⌘V).
    waitForRelease: async () => {
      if (!hook?.running) return;
      await hook.waitForRelease(hook.state.down ? 15_000 : 800);
    },
    log,
  });

  /**
   * Speech-to-text runs on this computer for the next dictation: it's on, downloaded, the server
   * takes text, and Parakeet speaks the language picked.
   */
  function onDevice() {
    const v = settings.get().voice;
    const lang = v.language || "auto";
    return !localOff && v.onDevice !== false && local.isInstalled() && !local.blocked() && account.session?.voice?.local === true && (lang === "auto" || LOCAL_LANGUAGES.has(lang));
  }

  /** On this computer first; if that fails, the recording goes to the server as before. */
  const dictate = localFirst({ local, api, use: onDevice, log });

  /**
   * Get Parakeet in the background while voice typing is on. After a failed download it tries again
   * on its own half an hour later (or right away from Settings: `now`).
   */
  function maybeInstall(now = false) {
    const v = settings.get().voice;
    if (localOff || !v.enabled || !account.device || v.onDevice === false || !local.supported() || local.blocked() || local.isInstalled() || local.installing) return;
    if (!now && localTriedAt && Date.now() - localTriedAt < 30 * 60_000) return;
    localTriedAt = Date.now();
    // Just downloaded: load it now, so the first dictation doesn't wait for it.
    void local
      .install()
      .then(() => {
        if (onDevice()) local.warm();
      })
      .catch(() => {});
  }

  const voice = new VoiceTyping({
    settings,
    account,
    api: { ...api, dictate },
    localReady: onDevice,
    pill,
    paster,
    frontApp,
    history,
    canPaste,
    ensureMic: o.ensureMicAccess,
    warmUp,
    open,
    platform,
    log,
    // Tests: which line a demo server "hears" (BAB_VOICE_DEMO, or re-read from BAB_VOICE_DEMO_FILE).
    demoSample: () => {
      if (process.env.BAB_VOICE_DEMO_FILE) {
        try {
          return fs.readFileSync(process.env.BAB_VOICE_DEMO_FILE, "utf8").trim() || null;
        } catch {
          return null;
        }
      }
      return process.env.BAB_VOICE_DEMO || null;
    },
  });
  voice.on("change", () => o.onChange());
  voice.on("dictated", () => pushState());
  voice.on("asked", () => pushState());

  /** Open the connection to the server, and start Parakeet, while the owner talks, so sending is quick. */
  function warmUp() {
    if (onDevice()) local.warm();
    else maybeInstall();
    const server = account.server();
    if (!server || Date.now() - lastWarm < 20_000) return;
    lastWarm = Date.now();
    try {
      o.apiSession.preconnect({ url: server, numSockets: 1 });
    } catch {
      /* best effort */
    }
  }

  function open(target, extra = {}) {
    const base = String(account.appUrl() ?? "").replace(/\/+$/, "");
    switch (target) {
      case "pair":
        return o.showPairing();
      case "settings":
        return void settingsWindow.show();
      case "upgrade":
        return o.openAppLink(`${base}/app/billing`);
      case "chat":
        return o.openAppLink(extra.botId ? `${base}/app/bots/${encodeURIComponent(extra.botId)}` : `${base}/app`);
      case "voice-page":
        return o.openAppLink(`${base}/app/voice`);
      case "app":
        return o.openAppLink(`${base}/app`);
      case "mic-settings":
        if (platform === "darwin") return void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
        if (platform === "win32") return void shell.openExternal("ms-settings:privacy-microphone");
        return;
      case "accessibility":
        return askAccessibility();
      default:
        return undefined;
    }
  }

  /** macOS: show the system prompt once, and open the Accessibility pane; watch for the switch. */
  function askAccessibility() {
    if (platform !== "darwin") return;
    safely(() => systemPreferences.isTrustedAccessibilityClient(true), false);
    void shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    watchAccessibility();
  }

  function watchAccessibility() {
    if (platform !== "darwin" || accessTimer) return;
    accessTimer = setInterval(() => {
      if (trusted()) {
        stopAccessibilityWatch();
        void apply().then(pushState);
      }
    }, 1500);
  }

  function stopAccessibilityWatch() {
    if (accessTimer) clearInterval(accessTimer);
    accessTimer = null;
  }

  function loadHook() {
    // Native code, loaded only when voice typing is turned on.
    const { uIOhook } = require("uiohook-napi");
    return Promise.resolve(uIOhook);
  }

  function useListener(next) {
    if (active === next) return;
    active?.disable();
    active = next;
    voice.setHotkey(next);
  }

  /** Turn the shortcut on or off to match the settings, the pairing and the permissions. */
  async function apply() {
    const v = settings.get().voice;
    const want = v.enabled && Boolean(account.device);
    if (!want) {
      active?.disable();
      active = null;
      mode = "off";
      problem = null;
      await voice.interrupt();
      pill.destroy();
      o.onChange();
      return;
    }
    void pill.ensure();
    maybeInstall();
    const shortcut = resolveShortcut(v, platform);
    problem = null;
    if (platform === "darwin" && !trusted()) {
      toggle ??= new ToggleHotkey({ globalShortcut, accelerator: TOGGLE_ACCELERATOR, log });
      const r = await toggle.enable();
      useListener(toggle);
      mode = r.ok ? "toggle" : "off";
      problem = {
        message: `To hold ${shortcut.label} and have it paste for you, allow Build-a-bot in Privacy & Security → Accessibility. Until then, press ${toggleLabel(platform)} to start and stop, and paste with ⌘V.`,
        actions: [{ id: "accessibility", label: "Open Accessibility settings" }],
      };
      watchAccessibility();
    } else {
      hook ??= new Hotkey({ loadHook, shortcut, platform, log });
      hook.setShortcut(shortcut);
      toggle?.disable();
      const r = await hook.enable();
      if (r.ok) {
        useListener(hook);
        mode = "hold";
        if (platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland") {
          problem = { message: "On Wayland, the shortcut is heard only while you're in some apps, and pasting may not work. An X11 session works best." };
        }
      } else {
        toggle ??= new ToggleHotkey({ globalShortcut, accelerator: TOGGLE_ACCELERATOR, log });
        const t = await toggle.enable();
        useListener(toggle);
        mode = t.ok ? "toggle" : "off";
        problem = { message: `Holding a key doesn't work on this computer (${r.code}). Press ${toggleLabel(platform)} to start and stop instead.` };
      }
    }
    o.onChange();
  }

  // ---------------------------------------------------------------------------
  // The settings window's view
  // ---------------------------------------------------------------------------

  function micStatus() {
    if (platform === "linux") return "granted";
    return safely(() => systemPreferences.getMediaAccessStatus("microphone"), "unknown");
  }

  function state() {
    const v = settings.get().voice;
    const s = settings.get().voiceStats;
    const shortcut = resolveShortcut(v, platform);
    const sessionVoice = account.session?.voice ?? null;
    return {
      paired: Boolean(account.device),
      platform,
      enabled: Boolean(v.enabled),
      mode,
      problem: account.device && sessionVoice && sessionVoice.available === false && !onDevice() ? { message: "Voice typing isn't set up on this server yet." } : problem,
      shortcut: { id: shortcut.id, label: shortcut.label },
      presets: presetsFor(platform).map((p) => ({ id: p.id, label: p.label, hint: p.hint ?? null })),
      toggleShortcut: toggleLabel(platform),
      options: {
        polish: v.polish,
        styles: v.styles,
        commands: v.commands,
        edit: v.edit !== false,
        onDevice: v.onDevice !== false,
        sounds: v.sounds,
        language: v.language,
        micId: v.micId,
        history: v.history,
        restoreClipboard: v.restoreClipboard,
      },
      permissions: { mic: micStatus(), accessibility: platform === "darwin" ? trusted() : null },
      server: sessionVoice ? { available: sessionVoice.available, polish: sessionVoice.polish, edit: sessionVoice.edit === true, simulated: sessionVoice.simulated } : null,
      /** Shift is one of the shortcut's keys (a custom one), so it can't also start editing. */
      editKey: !shortcut.slots.some((slot) => slot.some((k) => k === 42 || k === 54)),
      usage: voice.usage ?? sessionVoice?.usage ?? null,
      stats: { week: wordsThisWeek(s), total: s?.total ?? 0, saved: minutesSaved(s?.total ?? 0, s?.spokenMs ?? 0), wpm: wordsPerMinute(s) },
      bots: account.bots().map((b) => ({ id: b.id, name: b.name })),
      history: v.history ? history.list().slice(0, 50) : [],
      last: voice.last,
      /** Speech-to-text on this computer: where it's at. */
      local: {
        ...local.status(),
        supported: local.supported() && !localOff,
        on: v.onDevice !== false,
        server: sessionVoice ? sessionVoice.local === true : null,
        language: (v.language || "auto") === "auto" || LOCAL_LANGUAGES.has(v.language),
        active: onDevice(),
      },
    };
  }

  function pushState() {
    if (settingsWindow.isOpen()) settingsWindow.send(state());
  }

  async function showSettings(section) {
    if (!settings.get().voice.introduced) settings.updateVoice({ introduced: true });
    if (platform === "darwin" && !trusted()) watchAccessibility();
    await settingsWindow.show(section);
  }

  // ---------------------------------------------------------------------------
  // Messages from the pill and the settings window
  // ---------------------------------------------------------------------------

  /** Server calls for the window: { ok, data } or { ok: false, error } (never throws). */
  async function call(fn) {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      const e = /** @type {ApiError} */ (err);
      return { ok: false, error: e instanceof ApiError && e.status > 0 ? e.message : "I can't reach Build-a-bot right now." };
    }
  }

  function registerIpc(ipcMain) {
    ipcMain.on("dictation:size", (e, size) => pill.isSender(e) && pill.resize(size));
    ipcMain.on("dictation:action", (e, a) => pill.isSender(e) && void voice.action(String(a)));
    ipcMain.on("dictation:hover", (e, on) => pill.isSender(e) && voice.setHovering(on === true));
    ipcMain.on("dictation:log", (e, m) => pill.isSender(e) && log(`pill page: ${String(m).slice(0, 300)}`));

    const fromWindow = (e) => {
      if (!settingsWindow.isSender(e)) throw new Error("not allowed");
    };
    ipcMain.handle("voice:get-state", (e) => (fromWindow(e), state()));
    ipcMain.handle("voice:set", async (e, patch) => {
      fromWindow(e);
      const p = /** @type {Record<string, unknown>} */ (patch ?? {});
      const next = {};
      for (const k of ["enabled", "polish", "styles", "commands", "edit", "onDevice", "sounds", "history", "restoreClipboard"]) if (typeof p[k] === "boolean") next[k] = p[k];
      if (typeof p.language === "string" && /^(auto|[a-z]{2})$/.test(p.language)) next.language = p.language;
      if (typeof p.micId === "string" && p.micId.length <= 300) next.micId = p.micId;
      if (typeof p.shortcut === "string" && (presetsFor(platform).some((x) => x.id === p.shortcut) || (p.shortcut === "custom" && settings.get().voice.customKeys))) next.shortcut = p.shortcut;
      settings.updateVoice(next);
      if (next.history === false) history.clear();
      if (next.onDevice === true) maybeInstall(true);
      if (next.onDevice === false) void local.stop();
      if ("enabled" in next || "shortcut" in next || Object.keys(next).length === 0) await apply();
      return state();
    });
    ipcMain.handle("voice:record-shortcut", async (e) => {
      fromWindow(e);
      if (!hook?.running) return { ok: false, error: "Allow Accessibility first, so it can hear the keys.", state: state() };
      const keys = await hook.recordShortcut();
      if (!keys) return { ok: false, error: "", state: state() };
      const why = checkCustom(keys);
      if (why) return { ok: false, error: why, state: state() };
      settings.updateVoice({ shortcut: "custom", customKeys: keys });
      await apply();
      return { ok: true, label: keys.map((k) => keyName(k, platform)).join(" + "), state: state() };
    });
    ipcMain.on("voice:cancel-record-shortcut", (e) => settingsWindow.isSender(e) && hook?.cancelRecordShortcut());
    ipcMain.handle("voice:permission", async (e, kind) => {
      fromWindow(e);
      if (kind === "mic") await o.ensureMicAccess();
      if (kind === "accessibility") askAccessibility();
      return state();
    });
    ipcMain.handle("voice:microphones", async (e) => (fromWindow(e), pill.microphones()));
    ipcMain.handle("voice:dictionary", async (e) => (fromWindow(e), call(() => api.dictionary())));
    ipcMain.handle("voice:dictionary-add", async (e, entry) => {
      fromWindow(e);
      const x = /** @type {any} */ (entry ?? {});
      const clean = {
        kind: x.kind === "snippet" ? "snippet" : "word",
        text: String(x.text ?? "").slice(0, 4000),
        heard: Array.isArray(x.heard) ? x.heard.slice(0, 8).map((h) => String(h).slice(0, 80)) : [],
        ...(x.source === "correction" && x.kind !== "snippet" ? { source: "correction" } : {}),
      };
      const r = await call(() => api.addDictionaryEntry(clean));
      return r.ok ? { ok: true, entry: r.data.entry } : r;
    });
    ipcMain.handle("voice:dictionary-update", async (e, arg) => (fromWindow(e), call(() => api.updateDictionaryEntry(String(arg?.id ?? ""), arg?.patch ?? {}))));
    ipcMain.handle("voice:dictionary-delete", async (e, id) => (fromWindow(e), call(() => api.deleteDictionaryEntry(String(id ?? "")))));
    ipcMain.handle("voice:history-copy", (e, id) => {
      fromWindow(e);
      const entry = history.get(String(id));
      if (entry) paster.copy(entry.kind === "command" && entry.reply ? entry.reply : entry.text);
      return Boolean(entry);
    });
    ipcMain.handle("voice:history-remove", (e, id) => {
      fromWindow(e);
      history.remove(String(id));
      return state();
    });
    ipcMain.handle("voice:history-clear", (e) => {
      fromWindow(e);
      history.clear();
      return state();
    });
    ipcMain.handle("voice:history-fix", async (e, arg) => {
      fromWindow(e);
      const entry = history.get(String(arg?.id ?? ""));
      const text = String(arg?.text ?? "").trim();
      if (!entry || !text) return { suggestions: [], state: state() };
      const known = (await call(() => api.dictionary())).data?.entries?.map((x) => x.text) ?? [];
      const suggestions = suggestWords(entry.text, text, known);
      history.update(entry.id, { text });
      paster.copy(text);
      return { suggestions, state: state() };
    });
    ipcMain.handle("voice:local", async (e, action) => {
      fromWindow(e);
      if (action === "retry") maybeInstall(true);
      if (action === "remove") await local.remove();
      return state();
    });
    ipcMain.handle("voice:open", (e, what) => {
      fromWindow(e);
      open(String(what));
      return true;
    });
  }

  return {
    voice,
    history,
    pill,
    settingsWindow,
    apply,
    state,
    pushState,
    showSettings,
    registerIpc,
    /** The tray's voice typing line and items. */
    trayInfo() {
      const v = settings.get().voice;
      const shortcut = resolveShortcut(v, platform);
      return {
        enabled: Boolean(v.enabled),
        mode,
        hint: mode === "hold" ? `Hold ${shortcut.label} to talk` : mode === "toggle" ? `Press ${toggleLabel(platform)} to talk` : null,
        canPasteLast: Boolean(history.lastText() ?? (voice.last?.kind === "text" ? voice.last : null)),
        introduced: Boolean(v.introduced),
      };
    },
    /** The screen locked or the computer is going to sleep. */
    interrupt: () => voice.interrupt(),
    /** Unpaired: stop, and forget this account's history. */
    forget() {
      voice.forget();
      void apply();
    },
    dispose() {
      void local.stop();
      stopAccessibilityWatch();
      active?.disable();
      frontApp.dispose();
      pill.destroy();
    },
    /**
     * The packaged app's self-check (BAB_SMOKE=1, run by CI right after installing it): the native
     * keyboard hook loads and runs, the pill and the settings window load, the app in front can be
     * asked, and whether Private speech can run on this computer. Each line is "ok…" or "FAILED: …".
     * @returns {Promise<Record<string, string>>}
     */
    async smoke() {
      /** @type {Record<string, string>} */
      const out = {};
      const step = async (name, fn) => {
        try {
          out[name] = String(await fn());
        } catch (err) {
          out[name] = `FAILED: ${String(/** @type {any} */ (err)?.message ?? err).slice(0, 300)}`;
        }
      };
      await step("keyboard hook", async () => {
        const h = await loadHook();
        h.start();
        await new Promise((r) => setTimeout(r, 300));
        h.stop();
        return "ok";
      });
      await step("pill page", async () => {
        if (!(await pill.ensure())) throw new Error("it didn't load");
        return "ok";
      });
      await step("settings window", async () => {
        await settingsWindow.show();
        const loaded = Boolean(settingsWindow.webContents?.getURL().startsWith("bab-app://voice"));
        settingsWindow.close();
        if (!loaded) throw new Error("it didn't load");
        return "ok";
      });
      await step("app in front", async () => {
        const a = await frontApp.detect(8000);
        return a ? `ok (${a.category}${a.name ? `: ${a.name}` : ""})` : "ok (nothing in front)";
      });
      await step("private speech", async () => (local.supported() ? `ok (${process.platform}-${process.arch})` : `ok (not on ${process.platform}-${process.arch}: the server hears)`));
      return out;
    },
    /** For the e2e test: a read-only look (never includes the token). */
    probe() {
      return {
        mode,
        running: Boolean(active),
        recording: voice.isRecording(),
        phase: voice.pillState?.phase ?? null,
        pill: voice.pillState ?? null,
        last: voice.last,
        history: history.list().length,
        usage: voice.usage,
        problem: problem?.message ?? null,
        local: { state: local.status().state, active: onDevice() },
      };
    },
  };
}

function safely(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
