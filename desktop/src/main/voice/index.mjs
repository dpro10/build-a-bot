/**
 * Voice typing, wired into the app: picks how the shortcut is heard (the keyboard hook, or a
 * plain global shortcut while macOS Accessibility isn't allowed), keeps the pill page loaded,
 * runs the settings window and its messages, tells the tray what to show, and learns a word the
 * owner fixes right where it was typed (fix-watch.mjs).
 *
 * Everything here starts only once the owner turns voice typing on, on a paired computer.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ApiError } from "../api.mjs";
import { VoiceTyping } from "./controller.mjs";
import { FixWatcher } from "./fix-watch.mjs";
import { FrontApp, permissionApp } from "./front-app.mjs";
import { minutesSaved, VoiceHistory, wordsPerMinute, wordsThisWeek } from "./history.mjs";
import { Hotkey, ToggleHotkey } from "./hotkey.mjs";
import { checkCustom, keyName, presetsFor, resolveShortcut } from "./keys.mjs";
import { stillToLearn, suggestWords } from "./learn.mjs";
import { LOCAL_LANGUAGES, LocalSpeech, localFirst } from "./local-speech.mjs";
import { Paster, pressCopy, pressPaste } from "./paste.mjs";
import { PillWindow } from "./pill-window.mjs";
import { VoiceSettingsWindow } from "./settings-window.mjs";
import { TextReader } from "./text-reader.mjs";

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
 * @param {(n: { title: string, body: string, onClick?: () => void, logAs?: string }) => void} o.notify
 * @param {string | null} [o.macHelper]  the Swift helper (macOS), which reads the box typed into
 * @param {() => void} o.onChange  tray and windows should refresh
 * @param {(m: string) => void} o.log
 */
export function setupVoice(o) {
  const { electron, settings, account, api, log } = o;
  const { systemPreferences, clipboard, globalShortcut, shell, safeStorage } = electron;
  const platform = process.platform;
  /** Whom macOS asks for the microphone and Accessibility (run from source: the terminal). */
  const askedFor = permissionApp({ platform, packaged: Boolean(electron.app?.isPackaged) });

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
  // An engine the last run didn't get to stop (it was force-quit, or an update closed it) is
  // stopped now, rather than at the first dictation.
  if (local.supported() && !localOff) void local.reap();
  /** When it last started downloading Parakeet (a download that failed tries again on its own later). */
  let localTriedAt = 0;
  const frontApp = new FrontApp({ log });
  const settingsWindow = new VoiceSettingsWindow({ log, onClosed: () => stopAccessibilityWatch() });
  // A word fixed right where it was typed is learned: that box is read on this computer for a
  // couple of minutes after pasting (never logged), and only the word goes to the dictionary.
  const reader = new TextReader({ platform, macHelper: o.macHelper ?? null, log });
  const fixes = new FixWatcher({
    reader,
    enabled: learnOn,
    onFix: (fix) => void learnFix(fix).catch((err) => log(`learn: couldn't learn (${String(err?.message ?? err).slice(0, 120)})`)),
    log,
  });
  /** Words learned this run, for the settings window (newest first). */
  const learned = /** @type {Array<{ text: string, heard: string[], at: number }>} */ ([]);

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

  /** This server turns recordings into text (it never makes words up; without that, only Parakeet hears). */
  const serverHears = () => account.session?.voice?.available !== false;

  /**
   * Why nothing can hear the next dictation, for the pill and settings: this server doesn't turn
   * recordings into text, and Parakeet on this computer can't hear it (yet). Null when it can.
   * @returns {{ code: string, message?: string, actions?: string[] } | null}
   */
  function cantHear() {
    if (serverHears() || onDevice()) return null;
    const v = settings.get().voice;
    const lang = v.language || "auto";
    const fix = ["settings"];
    if (localOff || !local.supported()) return { code: "on-device", message: "Voice typing can't hear you on this computer yet: this server doesn't turn recordings into text.", actions: [] };
    if (local.blocked()) return { code: "on-device", message: "NVIDIA Parakeet can't run from this Windows account's folder, and this server doesn't turn recordings into text.", actions: fix };
    if (v.onDevice === false) return { code: "on-device", message: "Turn on Private speech: NVIDIA Parakeet hears you on this computer, and this server doesn't turn recordings into text.", actions: fix };
    if (lang !== "auto" && !LOCAL_LANGUAGES.has(lang)) return { code: "on-device", message: "NVIDIA Parakeet doesn't speak the language you picked. Pick one it does, or “Detect it”, in settings.", actions: fix };
    // A server too old to take text heard on the computer.
    if (local.isInstalled() && account.session?.voice?.local !== true) return { code: "unavailable" };
    const s = local.status();
    if (s.state === "error") return { code: "on-device", message: "NVIDIA Parakeet didn't download. Try again from settings: voice typing works once it's here.", actions: fix };
    const pct = s.state === "downloading" && s.total ? ` ${Math.min(99, Math.floor((s.received / s.total) * 100))}%` : "";
    return { code: "on-device", message: `Getting NVIDIA Parakeet${pct ? `:${pct}` : ""}. Voice typing works as soon as it's done.`, actions: fix };
  }

  /**
   * On this computer first. If that fails, the recording goes to the server, when the server can
   * turn it into text; otherwise the pill says why it wasn't heard.
   */
  const dictate = localFirst({
    local,
    api,
    use: onDevice,
    log,
    noServer: () => (serverHears() ? null : (cantHear() ?? { code: "on-device", message: "NVIDIA Parakeet couldn't hear that one. Try again.", actions: ["retry"] })),
  });

  /**
   * Get Parakeet in the background while voice typing is on, or when meeting notes need it (`why`).
   * After a failed download it tries again on its own half an hour later (or right away from
   * Settings: `now`).
   * @param {boolean} [now]
   * @param {'voice'|'meetings'} [why]
   */
  function maybeInstall(now = false, why = "voice") {
    const v = settings.get().voice;
    if (why === "voice" && !v.enabled) return;
    if (localOff || !account.device || v.onDevice === false || !local.supported() || local.blocked() || local.isInstalled() || local.installing) return;
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
    // Pressed before Parakeet is here: say why, and make sure it's on its way.
    cantHear: () => {
      const why = cantHear();
      if (why) maybeInstall();
      return why;
    },
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
  voice.on("dictated", (d) => {
    // Typed where the cursor was: watch that box for a fix (an edit's words are the AI's, not misheard).
    if (d?.pasted && !d.edit) fixes.watch({ text: d.text, app: d.app ?? null });
    pushState();
  });
  // Ready by the time the words are typed (it stops again after a while without dictating).
  voice.on("recording", () => {
    if (learnOn()) void reader.warm();
  });
  voice.on("asked", () => pushState());

  /** Learning from fixes is on, and this computer can read the box typed into (macOS: Accessibility). */
  function learnOn() {
    const v = settings.get().voice;
    return Boolean(v.enabled && v.learnFixes !== false && account.device && reader.supported && (platform !== "darwin" || trusted()));
  }

  /**
   * Words the owner fixed where they were typed: into the dictionary (as corrections), unless it
   * already has them; then a notification says what was learned. Never logs the words.
   * @param {{ words: Array<{ text: string, heard: string[] }> }} fix
   */
  async function learnFix(fix) {
    if (!learnOn()) return;
    const dict = await call(() => api.dictionary());
    if (!dict.ok) return log("learn: couldn't read the dictionary; nothing learned");
    const known = (dict.data?.entries ?? []).filter((x) => x.kind === "word").map((x) => String(x.text));
    const words = stillToLearn(fix.words, known);
    if (!words.length) return log("learn: the dictionary already has it");
    const added = [];
    for (const w of words) {
      const r = await call(() => api.addDictionaryEntry({ kind: "word", text: w.text, heard: w.heard, source: "correction" }));
      if (r.ok) added.push(w);
      else log(`learn: the server didn't take a word (${String(r.error).slice(0, 120)})`);
    }
    if (!added.length) return;
    log(`learn: learned ${added.length} word${added.length === 1 ? "" : "s"}`);
    for (const w of added) learned.unshift({ text: w.text, heard: w.heard, at: Date.now() });
    learned.splice(20);
    const first = added[0];
    const more = added.length > 1 ? ` (and ${added.length - 1} more)` : "";
    o.notify({
      title: `Learned “${first.text}”${more}`,
      body: first.heard.length ? `From now on it types “${first.text}”, not “${first.heard[0]}”. Change it in Voice typing settings.` : `From now on it writes it “${first.text}”. Change it in Voice typing settings.`,
      onClick: () => void showSettings("dictionary"),
      logAs: `learned ${added.length} word${added.length === 1 ? "" : "s"}`,
    });
    pushState();
  }

  /** Open the connection to the server, and start Parakeet, while the owner talks, so sending is quick. */
  function warmUp() {
    if (onDevice()) {
      // A meeting's next piece waits until this dictation has been heard.
      local.expectForeground();
      local.warm();
    } else maybeInstall();
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
      fixes.stop("off");
      reader.stop();
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
        message: `To hold ${shortcut.label} and have it paste for you, allow ${askedFor} in Privacy & Security → Accessibility. Until then, press ${toggleLabel(platform)} to start and stop, and paste with ⌘V.`,
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

  // Meeting notes ------------------------------------------------------------------

  /**
   * NVIDIA Parakeet can hear meetings on this computer: the same engine and the same Private speech
   * setting as voice typing. A meeting's language is detected (voice typing's language doesn't apply).
   */
  function meetingParakeet() {
    const v = settings.get().voice;
    return !localOff && v.onDevice !== false && local.supported() && !local.blocked();
  }

  /** How the next piece of a meeting is heard (meeting-speech.mjs). @returns {'local'|'server'|'wait'} */
  function meetingWay() {
    const m = account.session?.meetings;
    if (m?.local === true && meetingParakeet()) {
      if (!local.isInstalled()) return "wait";
      if (!local.crashing()) return "local";
      // It keeps stopping on this computer: a server that hears audio takes the pieces meanwhile.
      return m.available === true ? "server" : "wait";
    }
    if (m?.available === true) return "server";
    return "wait";
  }

  /** Why meeting notes can't be taken on this computer, for the tray (null when they can). */
  function meetingProblem() {
    const m = account.session?.meetings;
    if (!m || m.available === true || (m.local === true && meetingParakeet())) return null;
    if (m.local !== true) return "Meeting notes aren't set up on this server";
    if (local.blocked()) return "NVIDIA Parakeet can't run from this Windows account's folder";
    if (localOff || !local.supported()) return "Meeting notes need NVIDIA Parakeet, which can't run here";
    return "Turn on Private speech to take notes";
  }

  /** How much of Parakeet's download is here, in whole percent (0 before it has really started). */
  function downloaded(s) {
    return s.state === "downloading" && s.total ? Math.min(99, Math.floor((s.received / s.total) * 100)) : 0;
  }

  /**
   * How this computer hears calls, for the pairing window (it's where the 0.7 GB download that
   * pairing starts is explained). Null when the server says nothing about meeting notes.
   */
  function meetingLine() {
    const m = account.session?.meetings;
    if (!m) return null;
    const problem = meetingProblem();
    if (problem) return `${problem}.`;
    const way = meetingWay();
    if (way === "server") {
      const why = local.isInstalled() && local.crashing() ? "NVIDIA Parakeet keeps stopping on this computer, so for now " : settings.get().voice.onDevice === false ? "Private speech is off, so " : "";
      return `${why}Build-a-bot's servers turn the call's audio into text, and throw the audio away.`;
    }
    if (local.isInstalled()) return local.crashing() ? "NVIDIA Parakeet keeps stopping on this computer. It tries again in a few minutes." : "NVIDIA Parakeet turns calls into text on this computer: the audio never leaves it.";
    const s = local.status();
    if (s.state === "error") return "NVIDIA Parakeet didn't download. It tries again on its own, or from Voice typing settings.";
    const pct = downloaded(s);
    return `Getting NVIDIA Parakeet, which turns calls into text on this computer${pct ? `: ${pct}%` : ""}. It's about 0.7 GB, once.`;
  }

  /** While a meeting's pieces wait for Parakeet to download: words for the bot's bubble (null when it's here). */
  function meetingWaitNote() {
    if (meetingWay() !== "wait") return null;
    if (local.isInstalled() && local.crashing()) return "NVIDIA Parakeet keeps stopping on this computer. I'm listening, and I'll write your notes once it runs again.";
    const s = local.status();
    if (s.state === "error") return "NVIDIA Parakeet didn't download. Your notes come once it's here: try again in Voice typing settings.";
    const pct = downloaded(s);
    return `Getting NVIDIA Parakeet${pct ? ` (${pct}%)` : ""}. I'm listening, and I'll write your notes once it's here.`;
  }

  /** Why voice typing can't hear right now, for the settings window (null when it can). */
  function voiceProblem() {
    const why = cantHear();
    if (!why) return null;
    return { message: why.message ?? "Voice typing isn't set up on this server yet." };
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
      problem: (account.device && voiceProblem()) || problem,
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
        learnFixes: v.learnFixes !== false,
      },
      permissions: { mic: micStatus(), accessibility: platform === "darwin" ? trusted() : null, app: askedFor },
      server: sessionVoice ? { available: sessionVoice.available, polish: sessionVoice.polish, edit: sessionVoice.edit === true, simulated: sessionVoice.simulated } : null,
      /** Shift is one of the shortcut's keys (a custom one), so it can't also start editing. */
      editKey: !shortcut.slots.some((slot) => slot.some((k) => k === 42 || k === 54)),
      usage: voice.usage ?? sessionVoice?.usage ?? null,
      stats: { week: wordsThisWeek(s), total: s?.total ?? 0, saved: minutesSaved(s?.total ?? 0, s?.spokenMs ?? 0), wpm: wordsPerMinute(s) },
      bots: account.bots().map((b) => ({ id: b.id, name: b.name })),
      history: v.history ? history.list().slice(0, 50) : [],
      last: voice.last,
      /** Learning from fixes: whether this computer can (macOS: once Accessibility is allowed), and what it learned. */
      learn: { supported: reader.supported, learned: learned.slice(0, 5) },
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
      for (const k of ["enabled", "polish", "styles", "commands", "edit", "onDevice", "sounds", "history", "restoreClipboard", "learnFixes"]) if (typeof p[k] === "boolean") next[k] = p[k];
      if (typeof p.language === "string" && /^(auto|[a-z]{2})$/.test(p.language)) next.language = p.language;
      if (typeof p.micId === "string" && p.micId.length <= 300) next.micId = p.micId;
      if (typeof p.shortcut === "string" && (presetsFor(platform).some((x) => x.id === p.shortcut) || (p.shortcut === "custom" && settings.get().voice.customKeys))) next.shortcut = p.shortcut;
      settings.updateVoice(next);
      if (next.history === false) history.clear();
      if (next.onDevice === true) maybeInstall(true);
      if (next.onDevice === false) void local.stop();
      if (next.learnFixes === false) {
        fixes.stop("off");
        reader.stop();
      }
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
    /** NVIDIA Parakeet for meeting notes: how each piece is heard (meeting-speech.mjs), and what to say meanwhile. */
    meetings: {
      way: meetingWay,
      problem: meetingProblem,
      waitNote: meetingWaitNote,
      line: meetingLine,
      /** @param {Uint8Array} wav @param {{ durationMs: number }} opts */
      hear: (wav, opts) => local.transcribeTimed(wav, opts),
      /** Meeting notes are possible here: make sure Parakeet is downloaded (or on its way). */
      ensure() {
        if (account.session?.meetings?.local === true && meetingParakeet() && !local.isInstalled()) maybeInstall(false, "meetings");
      },
      /** Load it ahead of a meeting's first piece. */
      warm() {
        if (meetingWay() === "local") local.warm();
      },
    },
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
    interrupt: () => {
      fixes.stop("off");
      return voice.interrupt();
    },
    /** Unpaired: stop, and forget this account's history. */
    forget() {
      fixes.stop("off");
      learned.length = 0;
      voice.forget();
      void apply();
    },
    dispose() {
      void local.stop();
      stopAccessibilityWatch();
      active?.disable();
      fixes.dispose();
      reader.dispose();
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
        // macOS starts the hook only once Accessibility is allowed (a fresh install hasn't been yet).
        if (!trusted()) return "ok (loaded; starts once Accessibility is allowed)";
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
      await step("text reader", async () => {
        if (!reader.supported) {
          if (platform === "darwin") throw new Error("the helper isn't in the app");
          return `ok (not on ${platform})`;
        }
        const r = await reader.ping();
        if (!r.ok) throw new Error(`it didn't answer (${r.error})`);
        if (platform === "darwin") return r.trusted ? "ok (Accessibility allowed)" : "ok (reads once Accessibility is allowed)";
        return "ok (UI Automation)";
      });
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
        // Counts only, never what was read or learned.
        learn: { supported: reader.supported, on: learnOn(), watching: fixes.watching, found: fixes.found, stats: fixes.stats, learned: learned.length },
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
